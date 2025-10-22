/**
 * WebSocket库
 */

import { Buffer } from './buffer';

const stateConnect = { name: "connect" };
const stateForward = { name: "forward" };
const stateClose = { name: "close" };

type State = typeof stateConnect | typeof stateForward | typeof stateClose;

/**
 * 连接检查结果接口
 */
interface ConnectionCheckResult {
  connected: boolean;
  error?: string;
  status?: string;
}

/**
 * 发送更新结果接口
 */
interface SendUpdateResult {
  bytesSent: number;
  error?: string;
}

/**
 * 接收更新结果接口
 */
interface ReceiveUpdateResult {
  bytesReceived: number;
  error?: string;
}

/**
 * 连接更新结果接口
 */
interface ConnectionUpdateResult {
  success: boolean;
  error?: string;
  status?: string;
}

/**
 * 新连接结果接口
 */
interface NewConnectionResult {
  success: boolean;
  error?: string;
}

/**
 * 连接结果接口
 */
interface ConnectionResult {
  connection: IWSConnection | null;
  error?: string;
}

/**
 * WebSocket连接类
 */
class WSConnection {
  public websocket: WebSocket;
  public vState: State;
  public vRecvBuf: Buffer;
  public vDeadline?: number;
  public socketError: string | null = null;
  public time: () => number;
  public log: (msg: string) => void;

  constructor(websocket: WebSocket) {
    this.websocket = websocket;
    this.vState = stateConnect;
    this.vRecvBuf = Buffer.create();
    this.socketError = null;
    this.time = () => Date.now();
    this.log = (msg) => {
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
      console.log(`[${timestamp}] [INFO] [WSConnection] ${msg}`);
    };

    this.registerCallback();
  }

  /**
   * 关闭WebSocket连接
   * @param code 关闭代码
   * @param reason 关闭原因
   */
  close(code?: number, reason?: string): void {
    this.log(`ws:${this.websocket.url} close`);
    this.websocket.close(code, reason);
    this.vState = stateClose;
  }

  /**
   * 注册WebSocket事件回调函数
   */
  protected registerCallback(): void {
    this.websocket.onopen = () => {
      this.vState = stateForward;
      this.log("websocket connect succeed");
    };

    this.websocket.onmessage = (event) => {
      this.vRecvBuf.push(event.data);
    };

    this.websocket.onclose = (event) => {
      this.vState = stateClose;
      this.log("websocket close");
    };

    this.websocket.onerror = () => {
      this.log("websocket error");
      this.socketError = "websocket_error";
    };
  }
}

/**
 * WebSocket连接接口，为sconn.ts提供基础功能
 */
export interface IWSConnection {
  setBinaryType(type: BinaryType): void ;
  send(data: Uint8Array): void;
  popMsg(headerLen?: number, endian?: string): Uint8Array | null;
  recv(out: Uint8Array[]): number;
  update(): ConnectionUpdateResult;
  newConnect(url: string): NewConnectionResult;
  close(): void;
  url?: string;
}

/**
 * 扩展WSConnection类以实现IWSConnection接口
 */
class ExtendedWSConnection extends WSConnection implements IWSConnection {
  public url?: string;
  private sendBuffer: Buffer = Buffer.create();

  constructor(websocket: WebSocket, url?: string) {
    super(websocket);
    this.url = url;
  }

  /**
   * 发送数据到WebSocket
   * @param data 要发送的二进制数据
   */
  send(data: Uint8Array): void {
    if (this.vState === stateForward) {
      try {
        this.websocket.send(data);
      } catch (error) {
        this.socketError = String(error);
      }
    } else {
      // 连接未就绪时，将数据缓存到发送缓冲区
      this.sendBuffer.push(data);
    }
  }
  setBinaryType(type: BinaryType): void {
    this.websocket.binaryType = type;
  }

  /**
   * 弹出消息
   * @param headerLen 包头长度，默认为2字节
   * @param endian 字节序，默认为big endian
   * @returns 解析出的消息，如果数据不足则返回null
   */
  popMsg(headerLen: number = 2, endian: string = "big"): Uint8Array | null {
    const result = this.vRecvBuf.popMsg(headerLen, endian);
    return result;
  }

  /**
   * 接收数据到数组
   * @param out 输出数组
   * @returns 接收到的数据块数量
   */
  recv(out: Uint8Array[]): number {
    const data = this.vRecvBuf.popAll();
    if (data.length>0) {
      out.push(data);
      return 1;
    }
    return 0;
  }

  /**
   * 更新连接状态
   * @returns 连接状态更新结果
   */
  update(): ConnectionUpdateResult {
    if (this.vState === stateForward) {
      // 发送缓冲的数据
      const bufferedData = this.sendBuffer.popAll();
      if (bufferedData.length>0) {
        this.send(bufferedData);
      }
      return {
        success: true,
        status: "forward"
      };
    } else if (this.vState === stateConnect) {
      const deadline = this.vDeadline;
      if (deadline && deadline < this.time()) {
        return {
          success: false,
          error: "dial_timeout",
          status: "connect"
        };
      }
      return {
        success: false,
        status: "connect"
      };
    } else if (this.vState === stateClose) {
      return {
        success: false,
        error: "connection_closed",
        status: "close"
      };
    }

    if (this.socketError) {
      if (this.websocket.readyState === WebSocket.CLOSED) {
        return {
          success: false,
          error: this.socketError,
          status: "connect_break"
        };
      }
      return {
        success: false,
        error: this.socketError,
        status: this.vState.name
      };
    }

    return {
      success: true,
      status: this.vState.name
    };
  }

  /**
   * 重新连接到指定URL
   * @param url WebSocket服务器URL
   * @returns 重连操作结果
   */
  newConnect(url: string): NewConnectionResult {
    try {
      this.close();
      const newWs = new WebSocket(url);

      // 替换WebSocket实例
      this.websocket = newWs;
      this.vState = stateConnect;
      this.socketError = null;
      this.url = url;

      this.registerCallback();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * 重新注册WebSocket事件回调函数（公开方法）
   */
  public registerCallback(): void {
    super.registerCallback();
  }
}

/**
 * WebSocket客户端主模块
 */
export class WSClient {
  /**
   * 创建新的WebSocket连接
   * @param url WebSocket服务器URL
   * @returns WebSocket连接实例，失败时返回null
   */
  static new(url: string): ExtendedWSConnection | null {
    try {
      const ws = new WebSocket(url);

      if (!ws) {
        return null;
      }

      const conn = new ExtendedWSConnection(ws, url);
      return conn;
    } catch (error) {
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
      console.error(`[${timestamp}] [ERROR] [WSClient] WebSocket connection failed:`, error);
      return null;
    }
  }

}

/**
 * 连接WebSocket函数，为sconn.ts提供接口
 * @param url WebSocket服务器URL
 * @returns 连接结果
 */
export function connect(url: string): ConnectionResult {
  const conn = WSClient.new(url);
  if (!conn) {
    return {
      connection: null,
      error: "connection_failed"
    };
  }
  return { connection: conn };
}


export { WSConnection };
export default WSClient;