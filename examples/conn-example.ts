/**
 * 使用conn实现的WebSocket客户端示例
 * 
 * 这个示例展示了如何使用基础的WSClient和WSConnection类
 * 来创建一个简单的WebSocket客户端
 */

import { WSClient, connect, type IWSConnection } from '../src/conn';

class ConnExample {
  private connection: IWSConnection | null = null;
  private isRunning = false;

  /**
   * 连接到WebSocket服务器
   */
  async connect(url: string): Promise<boolean> {
    console.log(`正在连接到 ${url}...`);

    const connectResult = connect(url);
    
    if (!connectResult.connection || connectResult.error) {
      console.error(`连接失败: ${connectResult.error}`);
      return false;
    }

    this.connection = connectResult.connection;
    console.log('连接成功！');
    
    // 开始消息循环
    this.startMessageLoop();
    return true;
  }

  /**
   * 发送消息
   */
  sendMessage(message: string): boolean {
    if (!this.connection) {
      console.error('未连接到服务器');
      return false;
    }

    try {
      this.connection.send(message);
      console.log(`发送消息: ${message}`);
      return true;
    } catch (error) {
      console.error(`发送消息失败: ${error}`);
      return false;
    }
  }

  /**
   * 发送带头部的消息
   */
  sendPackedMessage(message: string): boolean {
    if (!this.connection) {
      console.error('未连接到服务器');
      return false;
    }

    try {
      // 使用2字节头部，big endian格式
      const result = this.connection.popMsg(2, 'big');
      if (result !== null) {
        console.log(`发送打包消息: ${message}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`发送打包消息失败: ${error}`);
      return false;
    }
  }

  /**
   * 开始消息循环
   */
  private startMessageLoop(): void {
    this.isRunning = true;
    this.messageLoop();
  }

  /**
   * 消息循环处理
   */
  private async messageLoop(): Promise<void> {
    while (this.isRunning && this.connection) {
      try {
        // 更新连接状态
        const updateResult = this.connection.update();
        
        if (!updateResult.success) {
          if (updateResult.status === 'connect_break') {
            console.log('连接断开，尝试重连...');
            await this.reconnect();
            continue;
          } else if (updateResult.error) {
            console.error(`连接错误: ${updateResult.error}, 状态: ${updateResult.status}`);
          }
        }

        // 接收消息
        const messages: string[] = [];
        const count = this.connection.recv(messages);
        
        if (count > 0) {
          messages.forEach(msg => {
            console.log(`收到消息: ${msg}`);
            this.handleMessage(msg);
          });
        }

        // 短暂延迟避免CPU占用过高
        await this.sleep(10);
        
      } catch (error) {
        console.error(`消息循环错误: ${error}`);
        await this.sleep(1000);
      }
    }
  }

  /**
   * 处理收到的消息
   */
  private handleMessage(message: string): void {
    // 简单的echo处理
    if (message.startsWith('echo:')) {
      const response = `回复: ${message.substring(5)}`;
      this.sendMessage(response);
    }
    
    // 处理ping消息
    if (message === 'ping') {
      this.sendMessage('pong');
    }
  }

  /**
   * 重连
   */
  private async reconnect(): Promise<void> {
    if (!this.connection?.url) {
      console.error('缺少重连信息');
      return;
    }

    const reconnectResult = this.connection.newConnect(this.connection.url);

    if (reconnectResult.success) {
      console.log('重连成功');
    } else {
      console.error(`重连失败: ${reconnectResult.error}`);
      await this.sleep(2000); // 等待2秒后重试
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    console.log('正在断开连接...');
    this.isRunning = false;
    
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    
    console.log('连接已断开');
  }

  /**
   * 获取连接状态
   */
  isConnected(): boolean {
    if (!this.connection) return false;
    
    const updateResult = this.connection.update();
    return updateResult.success;
  }

  /**
   * 工具方法：延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 示例使用方法
 */
async function runExample() {
  const client = new ConnExample();

  try {
    // 连接到WebSocket服务器
    const connected = await client.connect('ws://localhost:8080');
    
    if (!connected) {
      console.error('无法连接到服务器');
      return;
    }

    // 发送一些测试消息
    client.sendMessage('Hello, WebSocket!');
    client.sendMessage('echo:这是一个echo测试');
    client.sendMessage('ping');

    // 运行10秒后断开
    setTimeout(() => {
      client.disconnect();
      process.exit(0);
    }, 10000);

  } catch (error) {
    console.error(`示例运行错误: ${error}`);
  }
}

// 如果直接运行此文件，则执行示例
if (require.main === module) {
  console.log('=== WebSocket客户端示例 (使用conn) ===');
  console.log('连接到 ws://localhost:8080');
  console.log('确保你有一个WebSocket服务器在运行...');
  
  runExample().catch(console.error);
}

export { ConnExample };