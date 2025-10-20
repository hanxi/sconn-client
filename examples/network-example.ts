/**
 * 使用Network实现的WebSocket客户端示例
 * 
 * 这个示例展示了如何使用Network类来创建一个
 * 基于sproto协议的WebSocket客户端，支持请求-响应模式
 */

import { Network } from '../src/network';
import { readFileSync } from 'fs';
import { join } from 'path';

class NetworkExample {
  private network: Network | null = null;
  private isRunning = false;
  private updateInterval: NodeJS.Timeout | null = null;

  /**
   * 初始化Network实例
   */
  async initialize(): Promise<boolean> {
    try {
      // 创建协议缓冲区
      const protocolBuffer = this.createProtocolBuffer();

      this.network = new Network(protocolBuffer);
      console.log('Network实例创建成功');

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
  private createProtocolBuffer(): number[] {
    // 尝试读取协议文件
    const protocolPath = join(__dirname, 'sproto.spb');
    const protocolData = readFileSync(protocolPath);
    return Array.from(protocolData);
  }

  /**
   * 连接到WebSocket服务器
   */
  async connect(url: string): Promise<boolean> {
    if (!this.network) {
      console.error('Network未初始化');
      return false;
    }

    console.log(`正在连接到 ${url}...`);

    const connectResult = this.network.connect(url);

    if (!connectResult.success) {
      console.error(`连接失败: ${connectResult.error}`);
      return false;
    }

    console.log('连接成功！');

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

    console.log('消息处理器注册完成');
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
    console.log('重连功能需要配合SConn使用');
  }

  /**
   * 发送登录请求
   */
  async login(username: string, password: string): Promise<any> {
    if (!this.network) {
      throw new Error('Network未初始化');
    }

    console.log(`发送登录请求: ${username}`);

    try {
      const response = await this.network.call('login.login', {
        username,
        password,
        timestamp: Date.now()
      });

      console.log('登录响应:', response);
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
    console.log('正在断开连接...');

    this.isRunning = false;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.network) {
      this.network.close();
      this.network = null;
    }

    console.log('连接已断开');
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
    const connected = await client.connect('ws://localhost:8080');
    if (!connected) {
      console.error('无法连接到服务器');
      return;
    }

    // 等待连接稳定
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 发送登录请求
    try {
      const loginResult = await client.login('testuser', 'password123');
      console.log('登录成功:', loginResult);
    } catch (error) {
      console.log('登录请求发送失败（这在示例中是正常的）:', error.message);
    }

    // 发送心跳
    // client.sendHeartbeat();

    // 定期发送心跳
    const heartbeatInterval = setInterval(() => {
      if (client.isConnected()) {
        console.log('发送心跳...');
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
  console.log('=== Network WebSocket客户端示例 ===');
  console.log('连接到 ws://localhost:8080');
  console.log('确保你有一个WebSocket服务器在运行...');
  console.log('你可以使用 npm run server 启动测试服务器');
  console.log('');

  runExample().catch(console.error);
}

export { NetworkExample };