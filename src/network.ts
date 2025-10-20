/**
 * Network - 基于 sproto 和 conn 的网络通信模块
 * TypeScript 版本，移植自 network.lua
 */

import sproto from '@imhanxi/sproto-js';
import { SConn, connect } from './sconn';

/**
 * 会话项接口
 */
interface SessionItem {
  name: string;
  handle: ((response: any) => void) | null;
}

/**
 * 连接结果接口
 */
interface ConnectionResult {
  success: boolean;
  error?: string;
}

/**
 * 更新结果接口
 */
interface UpdateResult {
  success: boolean;
  error?: string;
  status?: string;
}

/**
 * 响应处理器类型
 */
type ResponseHandler = (request: any) => any;

/**
 * 回调函数类型
 */
type CallbackFunction = (response: any) => void;

/**
 * Network 类 - 网络通信管理器
 */
export class Network {
  private sessionIndex: number = 0;
  private requestSession: Map<number, SessionItem> = new Map();
  private responseHandle: Map<string, ResponseHandler> = new Map();
  private outputBuffer: any[] = [];
  private connection: SConn | null = null;

  private sp: any = null;
  private client: any = null;
  private clientRequest: ((name: string, args?: any, session?: number) => number[]) | null = null;

  /**
   * 创建新的 Network 实例
   * @param protocolBuffer 协议二进制数据
   * @param packageName 包名，默认为 "base.package"
   */
  constructor(protocolBuffer: number[] | ArrayBuffer | Uint8Array, packageName: string = "base.package") {
    this.initialize(protocolBuffer, packageName);
  }

  /**
   * 初始化协议
   */
  private initialize(protocolBuffer: number[] | ArrayBuffer | Uint8Array, packageName: string): void {
    try {
      // 创建 sproto 实例
      this.sp = sproto.createNew(protocolBuffer);
      if (!this.sp) {
        throw new Error('Failed to create sproto instance');
      }

      // 创建 host
      this.client = this.sp.host(packageName);
      if (!this.client) {
        throw new Error('Failed to create sproto host');
      }

      // 创建 attach 函数
      this.clientRequest = this.client.attach(this.sp);
      if (!this.clientRequest) {
        throw new Error('Failed to create sproto attach function');
      }

      console.log('Network initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Network:', error);
      throw error;
    }
  }

  /**
   * 连接到指定URL
   * @param url WebSocket URL
   * @returns 连接结果
   */
  public connect(url: string, targetServer: string): ConnectionResult {
    // 重置请求会话
    this.requestSession.clear();

    try {
      const result = connect(url, targetServer);

      if (!result.connection) {
        return {
          success: false,
          error: result.error || 'Connection failed'
        };
      } else {
        this.connection = result.connection;
        return { success: true };
      }
    } catch (error) {
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * 分发接收到的响应消息
   * @param response 响应数据
   */
  private dispatch(response: number[]): void {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    try {
      // 使用 client.dispatch 处理响应
      const dispatchResult = this.client.dispatch(response);

      if (!dispatchResult) {
        console.warn('Dispatch returned null or undefined');
        return;
      }

      if (dispatchResult.type === "RESPONSE") {
        const session = dispatchResult.session || 0;
        const responseData = dispatchResult.result || dispatchResult;

        const sessionItem = this.requestSession.get(session);
        if (sessionItem && sessionItem.handle) {
          (sessionItem.handle as CallbackFunction)(responseData);
          this.requestSession.delete(session);
        }
      } else if (dispatchResult.type === "REQUEST") {
        const name = dispatchResult.pname || dispatchResult.name;
        const request = dispatchResult.result || dispatchResult.data;

        if (name) {
          const handle = this.responseHandle.get(name);
          if (handle) {
            const data = handle(request);
            if (this.connection && this.clientRequest) {
              // 使用 clientRequest 编码响应数据
              const encodedData = this.clientRequest(name, data);
              this.connection.send(encodedData);
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to dispatch response:', error);
      // 不抛出错误，避免中断整个流程
    }
  }

  /**
   * 更新网络连接状态
   * @returns 更新结果
   */
  public update(): UpdateResult {
    if (!this.connection) {
      return {
        success: false,
        error: 'No connection established'
      };
    }

    try {
      const updateResult = this.connection.update();

      if (updateResult.success) {
        // 清空输出缓冲区
        this.outputBuffer.length = 0;

        // 接收消息
        const count = this.connection.recv(this.outputBuffer);

        for (let i = 0; i < count; i++) {
          const response = this.outputBuffer[i];
          // 将接收到的字符串转换为数字数组进行处理
          const responseArray = this.stringToNumberArray(response);
          this.dispatch(responseArray);
        }
      }

      return {
        success: updateResult.success,
        error: updateResult.error,
        status: updateResult.status
      };
    } catch (error) {
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * 发送请求消息到服务器
   * @param name 协议名称
   * @param data 请求数据
   * @param sessionIndex 会话索引
   * @returns 是否发送成功
   */
  private request(name: string, data: any, sessionIndex?: number): boolean {
    if (!this.clientRequest || !this.connection) {
      return false;
    }

    try {
      const requestData = this.clientRequest(name, data, sessionIndex);
      this.connection.send(requestData);
      return true;
    } catch (error) {
      console.error('Failed to send request:', error);
      return false;
    }
  }

  /**
   * 发送请求并等待响应
   * @param name 协议名称
   * @param data 请求数据
   * @returns Promise<any>
   */
  public call(name: string, data: any): Promise<any> {
    const sessionIndex = this.sessionIndex;
    this.sessionIndex = sessionIndex + 1;

    if (this.requestSession.has(sessionIndex)) {
      throw new Error(`Session ${sessionIndex} already exists`);
    }

    const sessionItem: SessionItem = {
      name: name,
      handle: null
    };
    this.requestSession.set(sessionIndex, sessionItem);

    // 返回 Promise 来模拟协程行为
    return new Promise((resolve, reject) => {
      sessionItem.handle = (response: any) => {
        resolve(response);
      };

      if (!this.request(name, data, sessionIndex)) {
        reject(new Error('Failed to send request'));
      }
    });
  }

  /**
   * 发送请求并立即返回
   * @param name 协议名称
   * @param data 请求数据
   * @returns 是否发送成功
   */
  public invoke(name: string, data: any): boolean {
    return this.request(name, data);
  }

  /**
   * 注册处理特定请求的回调函数
   * @param name 协议名称
   * @param callback 处理函数
   */
  public register(name: string, callback: ResponseHandler): void {
    if (!callback) {
      throw new Error('Callback is required');
    }

    if (this.responseHandle.has(name)) {
      throw new Error(`Handler for ${name} already registered`);
    }

    this.responseHandle.set(name, callback);
  }

  /**
   * 工具方法：字符串转数字数组
   */
  private stringToNumberArray(str: string): number[] {
    const encoder = new TextEncoder();
    return Array.from(encoder.encode(str));
  }

  /**
   * 工具方法：数字数组转字符串
   */
  private numberArrayToString(arr: number[]): string {
    const decoder = new TextDecoder();
    return decoder.decode(new Uint8Array(arr));
  }

  /**
   * 获取连接状态
   */
  public isConnected(): boolean {
    return this.connection !== null;
  }

  /**
   * 关闭连接
   */
  public close(): void {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    this.requestSession.clear();
    this.responseHandle.clear();
  }
}

export default Network;
