/**
 * 使用SConn实现的WebSocket客户端示例
 * 
 * 这个示例展示了如何使用高级的SConn类来创建一个
 * 支持状态机管理、断线重连和数据缓存的WebSocket客户端
 */

import { SConn, connect } from '../src/sconn';

class SConnExample {
  private sconn: SConn | null = null;
  private isRunning = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  /**
   * 连接到WebSocket服务器
   */
  async connect(url: string, targetServer?: string): Promise<boolean> {
    console.log(`正在连接到 ${url}...`);
    
    if (targetServer) {
      console.log(`目标服务器: ${targetServer}`);
    }

    const connectResult = connect(url, targetServer);
    
    if (!connectResult.connection || connectResult.error) {
      console.error(`连接失败: ${connectResult.error}`);
      return false;
    }

    this.sconn = connectResult.connection;
    console.log('SConn连接创建成功！');
    console.log(`当前状态: ${this.sconn.curState()}`);
    
    // 开始状态管理循环
    this.startStateLoop();
    return true;
  }

  /**
   * 发送普通消息
   */
  sendMessage(message: string): boolean {
    if (!this.sconn) {
      console.error('SConn未初始化');
      return false;
    }

    const success = this.sconn.send(message);
    if (success) {
      console.log(`发送消息: ${message}`);
      console.log(`累计发送字节数: ${this.sconn.vSendNumber}`);
    } else {
      console.error('发送消息失败');
    }
    
    return success;
  }

  /**
   * 发送带协议头的消息
   */
  sendProtocolMessage(message: string): boolean {
    if (!this.sconn) {
      console.error('SConn未初始化');
      return false;
    }

    // 使用2字节头部，big endian格式
    const success = this.sconn.sendMsg(message, 2, 'big');
    if (success) {
      console.log(`发送协议消息: ${message}`);
      console.log(`累计发送字节数: ${this.sconn.vSendNumber}`);
    } else {
      console.error('发送协议消息失败');
    }
    
    return success;
  }

  /**
   * 开始状态管理循环
   */
  private startStateLoop(): void {
    this.isRunning = true;
    this.stateLoop();
  }

  /**
   * 状态管理循环
   */
  private async stateLoop(): Promise<void> {
    while (this.isRunning && this.sconn) {
      try {
        // 更新SConn状态
        const updateResult = this.sconn.update();
        
        // 处理状态变化
        this.handleStateChange(updateResult.success, updateResult.error, updateResult.status);
        
        // 接收消息
        this.receiveMessages();
        
        // 短暂延迟
        await this.sleep(50);
        
      } catch (error) {
        console.error(`状态循环错误: ${error}`);
        await this.sleep(1000);
      }
    }
  }

  /**
   * 处理状态变化
   */
  private handleStateChange(success: boolean, error?: string, status?: string): void {
    const currentState = this.sconn?.curState();
    
    if (!success) {
      if (status === 'connect_break') {
        console.log('检测到连接断开，准备重连...');
        this.handleReconnect();
      } else if (error) {
        console.error(`状态错误: ${error}, 状态: ${status}`);
        
        // 如果是连接错误，尝试重连
        if (currentState === 'reconnect_error' || currentState === 'newconnect') {
          this.handleReconnect();
        }
      }
    } else {
      // 连接成功，重置重连计数
      if (currentState === 'forward' && this.reconnectAttempts > 0) {
        console.log('连接恢复正常');
        this.reconnectAttempts = 0;
      }
    }
  }

  /**
   * 处理重连逻辑
   */
  private async handleReconnect(): Promise<void> {
    if (!this.sconn) return;
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`重连失败次数过多 (${this.maxReconnectAttempts})，停止重连`);
      this.disconnect();
      return;
    }

    this.reconnectAttempts++;
    console.log(`第 ${this.reconnectAttempts} 次重连尝试...`);

    const reconnectResult = this.sconn.reconnect((reconnectSuccess: boolean) => {
      if (reconnectSuccess) {
        console.log('重连成功！');
        this.reconnectAttempts = 0;
      } else {
        console.log('重连失败，将继续尝试...');
      }
    });

    if (!reconnectResult.success) {
      console.error(`重连启动失败: ${reconnectResult.error}`);
      await this.sleep(2000 * this.reconnectAttempts); // 指数退避
    }
  }

  /**
   * 接收消息
   */
  private receiveMessages(): void {
    if (!this.sconn) return;

    // 接收普通消息
    const messages: string[] = [];
    const count = this.sconn.recv(messages);
    
    if (count > 0) {
      messages.forEach(msg => {
        console.log(`收到消息: ${msg}`);
        console.log(`累计接收字节数: ${this.sconn!.vRecvNumber}`);
        this.handleReceivedMessage(msg);
      });
    }

    // 接收协议消息
    const protocolMessages: string[] = [];
    const protocolCount = this.sconn.recvMsg(protocolMessages, 2, 'big');
    
    if (protocolCount > 0) {
      protocolMessages.forEach(msg => {
        console.log(`收到协议消息: ${msg}`);
        this.handleReceivedProtocolMessage(msg);
      });
    }
  }

  /**
   * 处理收到的普通消息
   */
  private handleReceivedMessage(message: string): void {
    // Echo处理
    if (message.startsWith('echo:')) {
      const response = `回复: ${message.substring(5)}`;
      this.sendMessage(response);
    }
    
    // Ping-Pong处理
    if (message === 'ping') {
      this.sendMessage('pong');
    }
    
    // 心跳处理
    if (message === 'heartbeat') {
      this.sendMessage('heartbeat_ack');
    }
  }

  /**
   * 处理收到的协议消息
   */
  private handleReceivedProtocolMessage(message: string): void {
    console.log(`处理协议消息: ${message}`);
    
    // 可以在这里处理特定的协议消息
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'command':
          this.handleCommand(data.payload);
          break;
        case 'notification':
          this.handleNotification(data.payload);
          break;
        default:
          console.log(`未知协议消息类型: ${data.type}`);
      }
    } catch (error) {
      console.log(`非JSON协议消息: ${message}`);
    }
  }

  /**
   * 处理命令
   */
  private handleCommand(payload: any): void {
    console.log(`执行命令:`, payload);
    
    // 发送命令执行结果
    const response = {
      type: 'command_result',
      success: true,
      result: `命令 ${payload.cmd} 执行成功`
    };
    
    this.sendProtocolMessage(JSON.stringify(response));
  }

  /**
   * 处理通知
   */
  private handleNotification(payload: any): void {
    console.log(`收到通知:`, payload);
  }

  /**
   * 获取连接统计信息
   */
  getStats(): any {
    if (!this.sconn) return null;

    return {
      state: this.sconn.curState(),
      sendBytes: this.sconn.vSendNumber,
      recvBytes: this.sconn.vRecvNumber,
      reconnectIndex: this.sconn.vReconnectIndex,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    console.log('正在断开SConn连接...');
    this.isRunning = false;
    
    if (this.sconn) {
      console.log(`最终状态: ${this.sconn.curState()}`);
      console.log(`统计信息:`, this.getStats());
      
      this.sconn.close();
      this.sconn = null;
    }
    
    console.log('SConn连接已断开');
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.sconn?.curState() === 'forward';
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
  const client = new SConnExample();

  try {
    // 连接到WebSocket服务器
    const connected = await client.connect('ws://localhost:8080', 'game-server');
    
    if (!connected) {
      console.error('无法连接到服务器');
      return;
    }

    // 等待连接建立
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 发送各种类型的消息
    client.sendMessage('Hello from SConn!');
    client.sendMessage('echo:SConn测试消息');
    client.sendMessage('ping');

    // 发送协议消息
    client.sendProtocolMessage(JSON.stringify({
      type: 'command',
      payload: { cmd: 'get_status', params: {} }
    }));

    client.sendProtocolMessage(JSON.stringify({
      type: 'notification',
      payload: { event: 'user_login', userId: 12345 }
    }));

    // 定期输出统计信息
    const statsInterval = setInterval(() => {
      const stats = client.getStats();
      if (stats) {
        console.log('=== 连接统计 ===');
        console.log(`状态: ${stats.state}`);
        console.log(`发送字节: ${stats.sendBytes}`);
        console.log(`接收字节: ${stats.recvBytes}`);
        console.log(`重连次数: ${stats.reconnectAttempts}`);
        console.log('================');
      }
    }, 5000);

    // 运行30秒后断开
    setTimeout(() => {
      clearInterval(statsInterval);
      client.disconnect();
      process.exit(0);
    }, 30000);

  } catch (error) {
    console.error(`示例运行错误: ${error}`);
  }
}

// 如果直接运行此文件，则执行示例
if (require.main === module) {
  console.log('=== WebSocket客户端示例 (使用SConn) ===');
  console.log('连接到 ws://localhost:8080');
  console.log('目标服务器: game-server');
  console.log('支持断线重连和状态管理');
  console.log('确保你有一个WebSocket服务器在运行...');
  
  runExample().catch(console.error);
}

export { SConnExample };