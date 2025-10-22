/**
 * SConn - WebSocket连接管理库
 * 基于状态机的WebSocket连接，支持断线重连和数据缓存
 */

import { connect as connectWS, IWSConnection } from './conn';
import { Buffer } from './buffer';

const CACHE_MAX_COUNT = 100;
const DEF_MSG_HEADER_LEN = 2;
const DEF_MSG_ENDIAN = "big";

// 日志开关和格式化函数
const VERBOSE = false;

/**
 * 加密工具类 - 浏览器版本，兼容goscon服务器的DH和HMAC MD5
 */
class CryptUtils {
  // DH参数 (RFC 3526 - 2048-bit MODP Group)
  private static readonly DH_P = BigInt('0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF');
  private static readonly DH_G = BigInt(2);

  /**
   * 生成随机DH私钥
   */
  static generateRandomKey(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  /**
   * DH密钥交换 - 计算公钥
   */
  static dhExchange(privateKey: Uint8Array): Uint8Array {
    const privKeyBigInt = this.bytesToBigInt(privateKey);
    const publicKeyBigInt = this.modPow(this.DH_G, privKeyBigInt, this.DH_P);
    return this.bigIntToBytes(publicKeyBigInt, 256); // 2048 bits = 256 bytes
  }

  /**
   * DH密钥交换 - 计算共享密钥
   */
  static dhSecret(serverPublicKey: Uint8Array, clientPrivateKey: Uint8Array): Uint8Array {
    const serverPubBigInt = this.bytesToBigInt(serverPublicKey);
    const clientPrivBigInt = this.bytesToBigInt(clientPrivateKey);
    const sharedSecretBigInt = this.modPow(serverPubBigInt, clientPrivBigInt, this.DH_P);
    return this.bigIntToBytes(sharedSecretBigInt, 32); // 取前32字节作为共享密钥
  }

  /**
   * 字节数组转BigInt
   */
  private static bytesToBigInt(bytes: Uint8Array): bigint {
    let result = BigInt(0);
    for (let i = 0; i < bytes.length; i++) {
      result = (result << BigInt(8)) + BigInt(bytes[i]);
    }
    return result;
  }

  /**
   * BigInt转字节数组
   */
  private static bigIntToBytes(bigint: bigint, length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let i = length - 1; i >= 0; i--) {
      bytes[i] = Number(bigint & BigInt(0xFF));
      bigint = bigint >> BigInt(8);
    }
    return bytes;
  }

  /**
   * 模幂运算
   */
  private static modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    let result = BigInt(1);
    base = base % modulus;
    while (exponent > BigInt(0)) {
      if (exponent % BigInt(2) === BigInt(1)) {
        result = (result * base) % modulus;
      }
      exponent = exponent >> BigInt(1);
      base = (base * base) % modulus;
    }
    return result;
  }

  /**
   * Base64编码
   */
  static base64Encode(data: Uint8Array): string {
    return btoa(String.fromCharCode(...data));
  }

  /**
   * Base64解码
   */
  static base64Decode(str: string): Uint8Array {
    const binaryString = atob(str);
    return new Uint8Array(binaryString.length).map((_, i) => binaryString.charCodeAt(i));
  }

  /**
   * MD5哈希算法实现
   */
  static md5(data: Uint8Array): Uint8Array {
    // MD5算法实现
    const h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476];
    const k = [
      0xD76AA478, 0xE8C7B756, 0x242070DB, 0xC1BDCEEE, 0xF57C0FAF, 0x4787C62A, 0xA8304613, 0xFD469501,
      0x698098D8, 0x8B44F7AF, 0xFFFF5BB1, 0x895CD7BE, 0x6B901122, 0xFD987193, 0xA679438E, 0x49B40821,
      0xF61E2562, 0xC040B340, 0x265E5A51, 0xE9B6C7AA, 0xD62F105D, 0x02441453, 0xD8A1E681, 0xE7D3FBC8,
      0x21E1CDE6, 0xC33707D6, 0xF4D50D87, 0x455A14ED, 0xA9E3E905, 0xFCEFA3F8, 0x676F02D9, 0x8D2A4C8A,
      0xFFFA3942, 0x8771F681, 0x6D9D6122, 0xFDE5380C, 0xA4BEEA44, 0x4BDECFA9, 0xF6BB4B60, 0xBEBFBC70,
      0x289B7EC6, 0xEAA127FA, 0xD4EF3085, 0x04881D05, 0xD9D4D039, 0xE6DB99E5, 0x1FA27CF8, 0xC4AC5665,
      0xF4292244, 0x432AFF97, 0xAB9423A7, 0xFC93A039, 0x655B59C3, 0x8F0CCC92, 0xFFEFF47D, 0x85845DD1,
      0x6FA87E4F, 0xFE2CE6E0, 0xA3014314, 0x4E0811A1, 0xF7537E82, 0xBD3AF235, 0x2AD7D2BB, 0xEB86D391
    ];

    const s = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];

    // 预处理
    const originalLength = data.length;
    const paddedData = new Uint8Array(Math.ceil((originalLength + 9) / 64) * 64);
    paddedData.set(data);
    paddedData[originalLength] = 0x80;

    // 添加长度信息
    const lengthInBits = originalLength * 8;
    const view = new DataView(paddedData.buffer);
    view.setUint32(paddedData.length - 8, lengthInBits, true);
    view.setUint32(paddedData.length - 4, Math.floor(lengthInBits / 0x100000000), true);

    // 处理每个512位块
    for (let offset = 0; offset < paddedData.length; offset += 64) {
      const w = new Uint32Array(16);
      for (let i = 0; i < 16; i++) {
        w[i] = view.getUint32(offset + i * 4, true);
      }

      let [a, b, c, d] = h;

      for (let i = 0; i < 64; i++) {
        let f: number, g: number;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) % 16;
        }

        const temp = d;
        d = c;
        c = b;
        b = (b + this.leftRotate((a + f + k[i] + w[g]) >>> 0, s[i])) >>> 0;
        a = temp;
      }

      h[0] = (h[0] + a) >>> 0;
      h[1] = (h[1] + b) >>> 0;
      h[2] = (h[2] + c) >>> 0;
      h[3] = (h[3] + d) >>> 0;
    }

    // 转换为字节数组
    const result = new Uint8Array(16);
    const resultView = new DataView(result.buffer);
    for (let i = 0; i < 4; i++) {
      resultView.setUint32(i * 4, h[i], true);
    }
    return result;
  }

  /**
   * 左旋转
   */
  private static leftRotate(value: number, amount: number): number {
    return ((value << amount) | (value >>> (32 - amount))) >>> 0;
  }

  /**
   * HMAC-MD5计算
   */
  static hmacMd5(key: Uint8Array, data: Uint8Array): Uint8Array {
    const blockSize = 64;
    let keyArray = new Uint8Array(key);

    // 如果密钥长度大于块大小，先哈希密钥
    if (keyArray.length > blockSize) {
      keyArray = new Uint8Array(this.md5(keyArray));
    }

    // 填充密钥到块大小
    const paddedKey = new Uint8Array(blockSize);
    paddedKey.set(keyArray);

    // 创建内外填充
    const ipad = new Uint8Array(blockSize);
    const opad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      ipad[i] = paddedKey[i] ^ 0x36;
      opad[i] = paddedKey[i] ^ 0x5C;
    }

    // 计算内部哈希
    const innerData = new Uint8Array(blockSize + data.length);
    innerData.set(ipad);
    innerData.set(data, blockSize);
    const innerHash = this.md5(innerData);

    // 计算外部哈希
    const outerData = new Uint8Array(blockSize + 16);
    outerData.set(opad);
    outerData.set(innerHash, blockSize);
    return this.md5(outerData);
  }

  /**
   * 计算字符串的hash (使用MD5)
   */
  static hashKey(content: string): Uint8Array {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    return this.md5(data);
  }
}

/**
 * 格式化日志输出
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

// 组件专用日志函数
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
   * 清空缓存
   */
  clear(): void {
    this.size = 0;
    this.top = 0;
    this.cache = {};
  }
}

/**
 * 打包数据函数
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
 * 虚拟发送函数
 */
function dummy(self: SConn, data: Uint8Array): void {
  log.debug("sending dummy data");
}

/**
 * 错误处理函数
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

      // 发送在新连接建立中间缓存的数据包
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
      const out: Uint8Array[] = [];
      const count = sock.recv(out);
      for (let i = 0; i < count; i++) {
        const v = out[i];
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
 * 切换状态
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
 * SConn主类
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

  // 新增加密相关字段
  public vPrivateKey?: Uint8Array;
  public vSecret: Uint8Array;

  constructor(sock: IWSConnection) {
    this.vState = states.newconnect;
    this.vSock = sock;
    this.vSecret = new Uint8Array(0); // 初始化为空数组，将在DH密钥交换后设置实际值
  }

  /**
   * 获取当前状态
   */
  curState(): string {
    return this.vState.name;
  }

  /**
   * 重连
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
   * 刷新发送缓冲区
   */
  flushSend(): void {
    // 空实现
  }

  /**
   * 更新连接状态
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
   */
  recvMsg(outMsg: Uint8Array[], headerLen?: number, endian?: string): number {
    headerLen = headerLen || DEF_MSG_HEADER_LEN;
    endian = endian || DEF_MSG_ENDIAN;

    const recvBuf = this.vRecvBuf;
    const count = recvBuf.popAllMsg(outMsg, headerLen, endian);

    return count;
  }

  /**
   * 关闭连接
   */
  close(): void {
    this.vSock.close();
    this.vRecvBuf.clear();
    switchState(this, "close");
  }
}

/**
 * 连接主机
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

export { Cache, packData, CryptUtils };
