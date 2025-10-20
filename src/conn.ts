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
   * 检查连接状态
   */
  private checkConnect(): ConnectionCheckResult {
    if (this.vState === stateForward) {
      return { connected: true };
    } else if (this.vState === stateConnect) {
      const deadline = this.vDeadline;
      if (deadline && deadline < this.time()) {
        return {
          connected: false,
          error: "dial_timeout",
          status: this.vState.name
        };
      } else {
        return {
          connected: false,
          status: this.vState.name
        };
      }
    } else {
      if (this.vRecvBuf.getSize() > 0) {
        return { connected: true };
      }
      return {
        connected: false,
        error: this.vState.name
      };
    }
  }

  /**
   * 更新发送
   */
  updateSend(sendBuf: Buffer): SendUpdateResult {
    if (this.vState !== stateForward) {
      return {
        bytesSent: 0,
        error: this.vState.name
      };
    }

    const msg = sendBuf.popAll();
    if (msg) {
      try {
        this.websocket.send(msg);
        return { bytesSent: msg.length };
      } catch (error) {
        return {
          bytesSent: 0,
          error: String(error)
        };
      }
    }
    return { bytesSent: 0 };
  }

  /**
   * 更新接收
   */
  updateRecv(buf: Buffer): ReceiveUpdateResult {
    const checkResult = this.checkConnect();
    if (!checkResult.connected) {
      return {
        bytesReceived: 0,
        error: checkResult.error
      };
    }

    const msg = this.vRecvBuf.popAll();
    if (!msg) {
      return {
        bytesReceived: 0,
        error: this.socketError || undefined
      };
    }

    buf.push(msg);
    return {
      bytesReceived: msg.length,
      error: this.socketError || undefined
    };
  }

  /**
   * 关闭连接
   */
  close(code?: number, reason?: string): void {
    this.log(`ws:${this.websocket.url} close`);
    this.websocket.close(code, reason);
    this.vState = stateClose;
  }

  /**
   * 获取连接状态
   */
  getState(): string {
    return this.vState.name;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.vState === stateForward;
  }

  /**
   * 获取WebSocket原始对象
   */
  raw(): WebSocket {
    return this.websocket;
  }

  /**
   * 注册回调函数
   */
  protected registerCallback(): void {
    this.websocket.onopen = () => {
      this.vState = stateForward;
      this.log("websocket connect succeed");
    };

    this.websocket.onmessage = (event) => {
      this.vRecvBuf.push(event.data);
    };

    this.websocket.onclose = () => {
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
  send(data: string): void;
  popMsg(headerLen?: number, endian?: string): string | null;
  recv(out: string[]): number;
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
   * 发送数据
   */
  send(data: string): void {
    if (this.vState === stateForward) {
      try {
        this.websocket.send(data);
      } catch (error) {
        this.socketError = String(error);
      }
    } else {
      this.sendBuffer.push(data);
    }
  }

  /**
   * 弹出消息
   */
  popMsg(headerLen: number = 2, endian: string = "big"): string | null {
    const oldHeaderLen = this.vRecvBuf.headerLen;
    const oldEndian = this.vRecvBuf.headerEndian;

    this.vRecvBuf.setHeader(headerLen, endian);
    const result = this.vRecvBuf.popMsg();

    this.vRecvBuf.setHeader(oldHeaderLen, oldEndian);
    return result;
  }

  /**
   * 接收数据到数组
   */
  recv(out: string[]): number {
    const data = this.vRecvBuf.popAll();
    if (data) {
      out.push(data);
      return 1;
    }
    return 0;
  }

  /**
   * 更新连接状态
   */
  update(): ConnectionUpdateResult {
    if (this.vState === stateForward) {
      // 发送缓冲的数据
      const bufferedData = this.sendBuffer.popAll();
      if (bufferedData) {
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
   * 重新连接
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
   * 重新注册回调（需要公开访问）
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