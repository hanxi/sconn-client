/**
 * Network - 基于sproto协议和SConn的网络通信模块
 * 
 * 提供以下功能：
 * - 基于sproto协议的消息编解码
 * - 请求-响应模式的网络通信
 * - 自动会话管理
 * - 消息处理器注册机制
 * 
 * TypeScript版本，移植自network.lua
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
 * Network类 - 高级网络通信管理器
 * 
 * 封装了sproto协议处理和SConn连接管理，提供简单易用的API
 * 支持异步请求-响应模式和消息处理器注册
 */
export class Network {
  private sessionIndex: number = 0;
  private requestSession: Map<number, SessionItem> = new Map();
  private responseHandle: Map<string, ResponseHandler> = new Map();
  private connection: SConn | null = null;

  private sp: any = null;
  private client: any = null;
  private clientRequest: ((name: string, args?: any, session?: number) => Uint8Array) | null = null;

  /**
   * 创建新的 Network 实例
   * @param protocolBuffer 协议二进制数据
   * @param packageName 包名，默认为 "base.package"
   */
  constructor(protocolBuffer: number[], packageName: string = "base.package") {
    this.initialize(protocolBuffer, packageName);
  }

  /**
   * 初始化sproto协议
   * @param protocolBuffer 协议二进制数据
   * @param packageName 协议包名
   */
  private initialize(protocolBuffer: number[], packageName: string): void {
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

    } catch (error) {
      console.error('Failed to initialize Network:', error);
      throw error;
    }
  }

  /**
   * 连接到指定的WebSocket服务器
   * @param url WebSocket服务器URL
   * @param targetServer 目标服务器标识
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
   * 分发接收到的消息
   * 根据消息类型（REQUEST/RESPONSE）进行相应处理
   * @param response 接收到的消息数据
   */
  private dispatch(response: Uint8Array): void {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    try {
      // 使用sproto客户端分发消息
      const responseArray = Array.from(response);
      console.log("responseArray", responseArray);
      const dispatchResult = this.client.dispatch(responseArray);
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
              this.connection.sendMsg(encodedData);
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
        // 清空消息缓冲区
        let outputBuffer: Uint8Array[] = [];

        // 接收并处理消息
        const count = this.connection.recvMsg(outputBuffer);

        for (let i = 0; i < count; i++) {
          const response = outputBuffer[i];
          this.dispatch(response);
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
      this.connection.sendMsg(requestData);
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

    // 返回Promise实现异步请求-响应模式
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
   * 获取连接状态
   * @returns 是否已连接
   */
  public isConnected(): boolean {
    return this.connection !== null;
  }

  /**
   * 关闭连接并清理资源
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
