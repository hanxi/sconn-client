/**
 * 使用Network实现的WebSocket客户端示例
 * 
 * 这个示例展示了如何使用Network类来创建一个
 * 基于sproto协议的WebSocket客户端，支持请求-响应模式
 */

import { Network } from '../src/network';
import { readFileSync } from 'fs';
import { join } from 'path';


async function jwtSign(payload: any, secret: string, alg: string = "HS256", expiresInSec: number = 60) {
  // 1. 设置 JWT header
  const header = {
    alg,
    typ: "JWT"
  };

  // 2. 设置 payload，加上 exp（过期时间）
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSec,
  };

  // 3. Base64URL 编码函数
  const base64UrlEncode = (obj) => {
    return btoa(JSON.stringify(obj))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  };

  const headerB64 = base64UrlEncode(header);
  const payloadB64 = base64UrlEncode(fullPayload);
  const data = `${headerB64}.${payloadB64}`;

  // 4. HMAC 签名（使用 SubtleCrypto）
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" }[alg] },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  // 5. 返回完整 token
  return `${data}.${signatureB64}`;
}

class NetworkExample {
  private network: Network | null = null;
  private isRunning = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private checksum: string | null = null;

  /**
   * 初始化Network实例
   */
  async initialize(): Promise<boolean> {
    try {
      // 创建协议缓冲区
      const protocolBuffer = this.createProtocolBuffer();
      this.network = new Network(protocolBuffer);
      this.checksum = this.network.checksumValue();
      console.log('协议校验码:', this.checksum);

      // 注册消息处理器
      this.registerHandlers();

      return true;
    } catch (error) {
      console.error('初始化Network失败:', error);
      return false;
    }
  }

  /**
   * 创建协议缓冲区
   * 从.sproto文件读取并编译生成二进制数据
   */
  private createProtocolBuffer(): Uint8Array {
    // 尝试读取协议文件
    const protocolPath = join(__dirname, 'sproto.spb');
    const protocolData = readFileSync(protocolPath);
    return new Uint8Array(protocolData);
  }

  /**
   * 连接到WebSocket服务器
   */
  async connect(url: string): Promise<boolean> {
    if (!this.network) {
      console.error('Network未初始化');
      return false;
    }


    const connectResult = this.network.connect(url, "game1");

    if (!connectResult.success) {
      console.error(`连接失败: ${connectResult.error}`);
      return false;
    }


    // 开始网络更新循环
    this.startUpdateLoop();
    return true;
  }

  /**
   * 注册消息处理器
   */
  private registerHandlers(): void {
    if (!this.network) return;

    // 注册登录响应处理器
    this.network.register('login.login', (request: any) => {
      console.log('处理登录请求:', request);
      return {
        success: true,
        userId: 12345,
        username: request.username,
        token: 'mock_token_' + Date.now()
      };
    });

  }

  /**
   * 开始网络更新循环
   */
  private startUpdateLoop(): void {
    this.isRunning = true;

    this.updateInterval = setInterval(() => {
      if (!this.network || !this.isRunning) {
        return;
      }

      const updateResult = this.network.update();

      if (!updateResult.success) {
        console.error(`网络更新错误: ${updateResult.error}`);

        if (updateResult.status === 'connect_break') {
          console.log('连接断开，尝试重连...');
          this.handleReconnect();
        }
      }
    }, 50); // 每50ms更新一次
  }

  /**
   * 处理重连
   */
  private async handleReconnect(): Promise<void> {
    // 这里可以实现重连逻辑
  }

  /**
   * 发送登录请求
   */
  async login(token: string): Promise<any> {
    if (!this.network) {
      throw new Error('Network未初始化');
    }


    try {
      const ctx = {
        rid: 0,
        proto_checksum: this.checksum,
      };
      const data = {
        token,
        ctx,
      };
      console.log("开始登录", data);
      const response = await this.network.call('login.login', data);

      return response;
    } catch (error) {
      console.error('登录失败:', error);
      throw error;
    }
  }


  /**
   * 断开连接
   */
  disconnect(): void {

    this.isRunning = false;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.network) {
      this.network.close();
      this.network = null;
    }

  }

  /**
   * 获取连接状态
   */
  isConnected(): boolean {
    return this.network ? this.network.isConnected() : false;
  }
}

/**
 * 示例使用方法
 */
async function runExample() {
  const client = new NetworkExample();

  try {
    // 初始化Network
    const initialized = await client.initialize();
    if (!initialized) {
      console.error('初始化失败');
      return;
    }

    // 连接到WebSocket服务器
    const connected = await client.connect('ws://localhost:1249');
    if (!connected) {
      console.error('无法连接到服务器');
      return;
    }

    // 等待连接稳定
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 发送登录请求
    try {
      const secret = "login_jwt_secret";
      const data = {
        account: "robot3"
      }
      const token = await jwtSign(data, secret, "HS512", 60);
      
      const loginResult = await client.login(token);
      console.log('登录成功:', loginResult);
    } catch (error) {
      console.log('登录请求发送失败（这在示例中是正常的）:', error.message);
    }

    // 发送心跳
    // client.sendHeartbeat();

    // 定期发送心跳
    const heartbeatInterval = setInterval(() => {
      if (client.isConnected()) {
        //client.sendHeartbeat();
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 5000);

    // 运行30秒后断开
    setTimeout(() => {
      clearInterval(heartbeatInterval);
      client.disconnect();
      process.exit(0);
    }, 30000);

  } catch (error) {
    console.error(`示例运行错误: ${error}`);
    client.disconnect();
  }
}

// 如果直接运行此文件，则执行示例
if (require.main === module) {

  runExample().catch(console.error);
}

export { NetworkExample };
