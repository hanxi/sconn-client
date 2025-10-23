/**
 * SConn - WebSocket连接管理库
 * 基于状态机的WebSocket连接，支持断线重连和数据缓存
 */

import { connect as connectWS, IWSConnection } from './conn';
import { Buffer } from './buffer';
import { CryptUtils } from './crypto';

const CACHE_MAX_COUNT = 100;
const DEF_MSG_HEADER_LEN = 2;
const DEF_MSG_ENDIAN = "big";

// 日志开关和格式化函数
const VERBOSE = false;


/**
 * 格式化日志输出
 * @param level 日志级别
 * @param component 组件名称
 * @param message 日志消息
 * @param data 可选的附加数据
 */
function formatLog(level: string, component: string, message: string, data?: any): void {
  if (!VERBOSE) return;

  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
  const baseMessage = `[${timestamp}] [${level}] [${component}] ${message}`;

  if (data !== undefined) {
    if (typeof data === 'object') {
      console.log(`${baseMessage}`, JSON.stringify(data));
    } else {
      console.log(`${baseMessage}`, data);
    }
  } else {
    console.log(baseMessage);
  }
}

/** SConn组件专用日志函数 */
const log = {
  debug: (message: string, data?: any) => formatLog('DEBUG', 'SConn', message, data),
  info: (message: string, data?: any) => formatLog('INFO', 'SConn', message, data),
  warn: (message: string, data?: any) => formatLog('WARN', 'SConn', message, data),
  error: (message: string, data?: any) => formatLog('ERROR', 'SConn', message, data)
};

/**
 * 状态处理结果接口
 */
interface StateDisposeResult {
  success: boolean;
  error?: string;
  status?: string;
}

/**
 * 重连结果接口
 */
interface ReconnectResult {
  success: boolean;
  error?: string;
}

/**
 * 连接结果接口
 */
interface ConnectResult {
  connection: SConn | null;
  error?: string;
}

/**
 * 缓存类，用于断线重连时的数据包重传
 */
class Cache {
  private size: number = 0;
  private top: number = 0;
  private cache: { [key: number]: Uint8Array } = {};

  /**
   * 插入数据到缓存
   * @param data 要缓存的数据
   */
  insert(data: Uint8Array): void {
    this.top = this.top + 1;
    this.cache[this.top] = data;
    this.size = this.size + data.length;

    const removeKey = this.top - CACHE_MAX_COUNT;
    const removeCacheValue = this.cache[removeKey];
    if (removeCacheValue !== undefined) {
      delete this.cache[removeKey];
      this.size = this.size - removeCacheValue.length;
    }
  }

  /**
   * 获取指定字节数的数据
   * @param nbytes 需要获取的字节数
   * @returns 获取到的数据，如果缓存不足则返回null
   */
  get(nbytes: number): Uint8Array | null {
    if (this.size < nbytes) {
      return null;
    }

    let i = this.top;
    let count = 0;
    const ret: Uint8Array[] = [];

    while (count < nbytes) {
      const v = this.cache[i];
      if (!v) break;

      const len = v.length;
      let n = len;
      let vv = v;

      if (count + len > nbytes) {
        const subN = nbytes - count;
        const pos = len - subN;
        vv = v.slice(pos);
        n = subN;
      }

      ret.unshift(vv);
      count = count + n;
      i = i - 1;
    }

    // 合并所有 Uint8Array
    const totalLength = ret.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of ret) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }

  /**
   * 清空缓存中的所有数据
   */
  clear(): void {
    this.size = 0;
    this.top = 0;
    this.cache = {};
  }
}

/**
 * 打包数据函数 - 为数据添加长度头部
 * @param data 要打包的数据
 * @param headerLen 头部长度（字节）
 * @param endian 字节序（'big' 或 'little'）
 * @returns 打包后的数据（头部+数据）
 */
function packData(data: Uint8Array, headerLen: number, endian: 'big' | 'little'): Uint8Array {
  // 数据已经是字节数组
  const dataBytes = data;
  const len = dataBytes.length;

  // 创建头部字节数组
  const header = new Uint8Array(headerLen);
  if (endian === 'big') {
    for (let i = 0; i < headerLen; i++) {
      header[headerLen - 1 - i] = (len >> (i * 8)) & 0xFF;
    }
  } else {
    for (let i = 0; i < headerLen; i++) {
      header[i] = (len >> (i * 8)) & 0xFF;
    }
  }

  // 合并 header + data
  const result = new Uint8Array(headerLen + len);
  result.set(header, 0);
  result.set(dataBytes, headerLen);

  return result;
}

/**
 * 状态接口
 */
interface IState {
  name: string;
  request?: (self: SConn, ...args: any[]) => void;
  dispatch?: (self: SConn) => void;
  send?: (self: SConn, data: Uint8Array) => void;
  dispose?: (self: SConn, success: boolean, err?: string, status?: string) => StateDisposeResult;
}

/**
 * 虚拟发送函数 - 用于错误状态下的空操作
 * @param self SConn实例
 * @param data 要发送的数据
 */
function dummy(self: SConn, data: Uint8Array): void {
  log.debug("sending dummy data");
}

/**
 * 错误状态处理函数
 * @param self SConn实例
 * @param success 操作是否成功
 * @param err 错误信息
 * @param status 状态信息
 * @returns 状态处理结果
 */
function disposeError(self: SConn, success: boolean, err?: string, status?: string): StateDisposeResult {
  return {
    success: false,
    error: self.vState.name,
    status: "reconnect_error"
  };
}

/**
 * 状态定义
 */
const states: { [key: string]: IState } = {
  newconnect: {
    name: "newconnect",
    request: async (self: SConn, targetServer?: string, flag?: number) => {
      // 实现完整的DH密钥交换
      targetServer = targetServer || "";
      flag = flag || 0;

      // 生成客户端DH私钥和公钥
      const privateKey = CryptUtils.generateRandomKey();
      const dhPublicKey = CryptUtils.dhExchange(privateKey);

      // 构建连接请求：0\nbase64(DH_key)\nTargetServer\nflag\nAcceptEncodings
      let data = `0\n${CryptUtils.base64Encode(dhPublicKey)}\n${targetServer}\n${flag}`;

      // 将字符串转换为 Uint8Array
      const textEncoder = new TextEncoder();
      const dataBytes = textEncoder.encode(data);
      const packedData = packData(dataBytes, 2, "big");

      self.vSock.send(packedData);
      self.vPrivateKey = privateKey;
      self.vSendBufTop = 0;
    },

    send: (self: SConn, data: Uint8Array) => {
      self.vSendBufTop = self.vSendBufTop + 1;
      self.vSendBuf[self.vSendBufTop] = data;
    },

    dispatch: async (self: SConn) => {
      const data = self.vSock.popMsg(2, "big");
      if (!data) return;

      log.debug("received connection response", data);
      const decoder = new TextDecoder('utf-8');
      const str = decoder.decode(data);
      const lines = str.split('\n');
      const id = lines[0];
      const serverKeyB64 = lines[1];

      self.vId = parseInt(id) || 0;

      // 计算共享密钥
      if (serverKeyB64 && self.vPrivateKey) {
        const serverPublicKey = CryptUtils.base64Decode(serverKeyB64);
        self.vSecret = CryptUtils.dhSecret(serverPublicKey, self.vPrivateKey);
        log.debug("DH secret computed successfully");
      } else {
        log.error("Missing server public key or client private key for DH exchange");
      }

      switchState(self, "forward");

      self.vSock.setBinaryType("arraybuffer");

      // 发送在新连接建立期间缓存的数据包
      for (let i = 1; i <= self.vSendBufTop; i++) {
        if (self.vSendBuf[i]) {
          self.send(self.vSendBuf[i]);  
        }
      }
      self.vSendBufTop = 0;
      self.vSendBuf = {};
    },

    dispose: (self: SConn, success: boolean, err?: string, status?: string): StateDisposeResult => {
      if (success) {
        return {
          success: true,
          status: "connect"
        };
      } else {
        const errorMsg = `sock_error:${err} sock_status:${status} sconn_state:newconnect`;
        return {
          success: false,
          error: errorMsg,
          status: "connect"
        };
      }
    }
  },

  reconnect: {
    name: "reconnect",
    request: async (self: SConn) => {
      self.vReconnectIndex = self.vReconnectIndex + 1;

      // 构建重连请求内容：id\nindex\nrecvnumber\nbase64(HMAC_CODE)
      const content = `${self.vId}\n${self.vReconnectIndex}\n${self.vRecvNumber}\n`;

      let data = content;

      // 如果有共享密钥，计算HMAC验证码
      const contentHash = CryptUtils.hashKey(content);
      const hmac = CryptUtils.hmacMd5(self.vSecret, contentHash);
      const hmacB64 = CryptUtils.base64Encode(hmac);
      data = `${content}${hmacB64}\n`;

      // 将字符串转换为 Uint8Array
      const textEncoder = new TextEncoder();
      const dataBytes = textEncoder.encode(data);
      const packedData = packData(dataBytes, 2, "big");

      log.debug("sending reconnect request", {
        reconnectIndex: self.vReconnectIndex,
        recvNumber: self.vRecvNumber,
        hasHmac: !!self.vSecret
      });
      self.vSock.send(packedData);
    },

    send: (self: SConn, data: Uint8Array) => {
      // 在断线重连期间，仅仅是把数据插入到cache中
      self.vSendNumber = self.vSendNumber + data.length;
      self.vCache.insert(data);
    },

    dispatch: (self: SConn) => {
      const data = self.vSock.popMsg(2, "big");
      if (!data) return;

      log.debug("received reconnect response", data);
      const decoder = new TextDecoder('utf-8');
      const str = decoder.decode(data);
      const lines = str.split('\n');
      const recv = parseInt(lines[0]) || 0;
      const msg = lines[1];

      const sendNumber = self.vSendNumber;
      const cb = self.vReconnectCb;
      self.vReconnectCb = undefined;

      // 重连失败
      if (msg !== "200") {
        log.warn("reconnect failed", { message: msg });
        if (cb) cb(false);
        switchState(self, "reconnect_error");
        return;
      }

      // 服务器接受的数据要比客户端记录的发送的数据还要多
      if (recv > sendNumber) {
        if (cb) cb(false);
        switchState(self, "reconnect_match_error");
        return;
      }

      // 需要补发的数据
      if (recv < sendNumber) {
        const nbytes = sendNumber - recv;
        const resendData = self.vCache.get(nbytes);

        // 缓存的数据不足
        if (!resendData) {
          if (cb) cb(false);
          switchState(self, "reconnect_cache_error");
          return;
        }

        // 发送补发数据
        self.vSock.send(resendData);
      }

      // 重连成功
      if (cb) cb(true);
      switchState(self, "forward");
    },

    dispose: (self: SConn, success: boolean, err?: string, status?: string): StateDisposeResult => {
      if (success) {
        return {
          success: true,
          status: "reconnect"
        };
      } else {
        const errorMsg = `sock_error:${err} sock_status:${status} sconn_state:reconnect`;
        return {
          success: false,
          error: errorMsg,
          status: "reconnect"
        };
      }
    }
  },

  forward: {
    name: "forward",
    dispatch: (self: SConn) => {
      const recvBuf = self.vRecvBuf;
      const sock = self.vSock;
      const v = sock.recv();
      if (v.length>0) {
        self.vRecvNumber = self.vRecvNumber + v.length;
        recvBuf.push(v);
      }
    },

    send: (self: SConn, data: Uint8Array) => {
      const sock = self.vSock;
      const cache = self.vCache;

      sock.send(data);
      self.vSendNumber = self.vSendNumber + data.length;
      cache.insert(data);
    },

    dispose: (self: SConn, success: boolean, err?: string, status?: string): StateDisposeResult => {
      if (success) {
        if (status !== "forward") {
          throw new Error(`invalid sock_status:${status}`);
        }
        return {
          success: true,
          status: "forward"
        };
      } else {
        const errorMsg = `sock_error:${err} sock_status:${status} sconn_state:forward`;
        return {
          success: false,
          error: errorMsg,
          status: "forward"
        };
      }
    }
  },

  reconnect_error: {
    name: "reconnect_error",
    send: dummy,
    dispose: disposeError
  },

  reconnect_match_error: {
    name: "reconnect_match_error",
    send: dummy,
    dispose: disposeError
  },

  reconnect_cache_error: {
    name: "reconnect_cache_error",
    send: dummy,
    dispose: disposeError
  },

  close: {
    name: "close",
    send: dummy,
    dispose: (self: SConn, success: boolean, err?: string, status?: string): StateDisposeResult => {
      const errorMsg = `sock_error:${err} sock_status:${status} sconn_state:close`;
      return {
        success: false,
        error: errorMsg,
        status: "close"
      };
    }
  }
};

/**
 * 切换SConn状态机状态
 * @param self SConn实例
 * @param stateName 目标状态名称
 * @param args 状态切换参数
 */
function switchState(self: SConn, stateName: string, ...args: any[]): void {
  const state = states[stateName];
  if (!state) {
    throw new Error(`Invalid state: ${stateName}`);
  }

  log.debug("switching state", { from: self.vState.name, to: stateName, args });
  self.vState = state;

  if (state.request) {
    // 异步调用request函数，但不等待结果
    Promise.resolve(state.request(self, ...args)).catch(error => {
      log.error("Error in state request", { state: stateName, error: error.message });
    });
  }
}

/**
 * SConn主类 - 基于状态机的WebSocket连接管理器
 * 
 * 提供以下功能：
 * - 自动重连机制
 * - 数据缓存和重传
 * - DH密钥交换和加密通信
 * - 状态机驱动的连接管理
 */
export class SConn {
  public vState: IState;
  public vSock: IWSConnection;
  public vId: number = 0;
  public vSendNumber: number = 0;
  public vRecvNumber: number = 0;
  public vReconnectIndex: number = 0;
  public vCache: Cache = new Cache();
  public vSendBuf: { [key: number]: Uint8Array } = {};
  public vSendBufTop: number = 0;
  public vRecvBuf: Buffer = Buffer.create();
  public vReconnectCb?: (success: boolean) => void;

  /** 加密相关字段 */
  public vPrivateKey?: Uint8Array;
  public vSecret: Uint8Array;

  constructor(sock: IWSConnection) {
    this.vState = states.newconnect;
    this.vSock = sock;
    this.vSecret = new Uint8Array(0); // 初始化为空，DH密钥交换后设置实际值
  }

  /**
   * 获取当前状态
   * @returns 当前状态名称
   */
  curState(): string {
    return this.vState.name;
  }

  /**
   * 重连到服务器
   * @param cb 重连结果回调函数
   * @returns 重连操作结果
   */
  reconnect(cb?: (success: boolean) => void): ReconnectResult {
    const stateName = this.vState.name;
    if (stateName !== "forward" && stateName !== "reconnect") {
      return {
        success: false,
        error: `error state switch '${stateName}' to reconnect`
      };
    }

    const url = this.vSock.url;

    if (!url) {
      return {
        success: false,
        error: "missing connection url"
      };
    }

    const result = this.vSock.newConnect(url);
    if (!result.success) {
      return {
        success: false,
        error: result.error
      };
    }

    this.vReconnectCb = cb;
    switchState(this, "reconnect");
    return { success: true };
  }

  /**
   * 刷新发送缓冲区（空实现）
   */
  flushSend(): void {
    // 空实现
  }

  /**
   * 更新连接状态
   * @returns 状态更新结果
   */
  update(): StateDisposeResult {
    const sock = this.vSock;
    const state = this.vState;
    const updateResult = sock.update();

    if (updateResult.success && state.dispatch) {
      state.dispatch(this);
    }

    // 网络连接主动断开
    if (updateResult.status === "connect_break") {
      return {
        success: updateResult.success,
        error: updateResult.error,
        status: updateResult.status
      };
    }

    // 处理返回状态值
    if (state.dispose) {
      return state.dispose(this, updateResult.success, updateResult.error, updateResult.status);
    }

    return {
      success: updateResult.success,
      error: updateResult.error,
      status: updateResult.status
    };
  }

  /**
   * 发送数据
   * @param data 要发送的数据
   * @returns 是否发送成功
   */
  send(data: Uint8Array): boolean {
    const sendFn = this.vState.send;
    if (sendFn) {
      log.debug("sending data", { dataLength: data.length });
      sendFn(this, data);
    }
    return true;
  }

  /**
   * 发送消息（带包头）
   * @param data 要发送的消息数据
   * @param headerLen 包头长度，默认为2字节
   * @param endian 字节序，默认为big endian
   * @returns 是否发送成功
   */
  sendMsg(data: Uint8Array, headerLen?: number, endian?: string): boolean {
    const sendFn = this.vState.send;
    headerLen = headerLen || DEF_MSG_HEADER_LEN;
    endian = endian || DEF_MSG_ENDIAN;

    const packedData = packData(data, headerLen, endian as 'big' | 'little');
    if (sendFn) {
      sendFn(this, packedData);
    }
    return true;
  }

  /**
   * 接收消息
   * @param outMsg 输出消息数组
   * @param headerLen 包头长度，默认为2字节
   * @param endian 字节序，默认为big endian
   * @returns 接收到的消息数量
   */
  recvMsg(outMsg: Uint8Array[], headerLen?: number, endian?: string): number {
    headerLen = headerLen || DEF_MSG_HEADER_LEN;
    endian = endian || DEF_MSG_ENDIAN;

    const recvBuf = this.vRecvBuf;
    const count = recvBuf.popAllMsg(outMsg, headerLen, endian);

    return count;
  }

  /**
   * 关闭连接并清理资源
   */
  close(): void {
    this.vSock.close();
    this.vRecvBuf.clear();
    switchState(this, "close");
  }
}

/**
 * 连接到指定的WebSocket服务器
 * @param url WebSocket服务器URL
 * @param targetServer 目标服务器标识
 * @param flag 连接标志
 * @returns 连接结果，包含SConn实例或错误信息
 */
export function connect(url: string, targetServer?: string, flag?: number): ConnectResult {
  const connectResult = connectWS(url);
  if (!connectResult.connection) {
    return {
      connection: null,
      error: connectResult.error
    };
  }

  const sconn = new SConn(connectResult.connection);
  switchState(sconn, "newconnect", targetServer, flag);

  return {
    connection: sconn
  };
}

export { Cache, packData };
