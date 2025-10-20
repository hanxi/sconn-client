/**
 * WebSocket测试服务器
 * 用于测试conn.ts和sconn.ts客户端
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Buffer } from 'buffer';

interface ClientSession {
  id: number;
  ws: WebSocket;
  targetServer?: string;
  reconnectIndex: number;
  sendBytes: number;
  recvBytes: number;
  lastHeartbeat: number;
}

class WSTestServer {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, ClientSession> = new Map();
  private nextClientId = 1;
  private port: number;

  constructor(port: number = 8080) {
    this.port = port;
    this.wss = new WebSocketServer({ port });
    this.setupServer();
  }

  private setupServer(): void {
    console.log(`WebSocket测试服务器启动在端口 ${this.port}`);
    
    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientId = this.nextClientId++;
      const session: ClientSession = {
        id: clientId,
        ws,
        reconnectIndex: 0,
        sendBytes: 0,
        recvBytes: 0,
        lastHeartbeat: Date.now()
      };
      
      this.clients.set(ws, session);
      console.log(`客户端 ${clientId} 已连接，来自 ${req.socket.remoteAddress}`);

      // 设置消息处理
      ws.on('message', (data: Buffer) => {
        this.handleMessage(ws, data);
      });

      // 设置关闭处理
      ws.on('close', (code: number, reason: Buffer) => {
        console.log(`客户端 ${session.id} 断开连接: ${code} ${reason.toString()}`);
        this.clients.delete(ws);
      });

      // 设置错误处理
      ws.on('error', (error: Error) => {
        console.error(`客户端 ${session.id} 错误:`, error);
        this.clients.delete(ws);
      });

      // 发送欢迎消息
      this.sendMessage(ws, 'Welcome to WebSocket Test Server!');
    });

    // 启动心跳检测
    this.startHeartbeat();
  }

  private handleMessage(ws: WebSocket, data: Buffer): void {
    const session = this.clients.get(ws);
    if (!session) return;

    session.recvBytes += data.length;
    session.lastHeartbeat = Date.now();

    const message = data.toString();
    console.log(`客户端 ${session.id} 发送: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);

    // 检查是否是带头部的消息（SConn协议）
    if (this.isPackedMessage(data)) {
      this.handlePackedMessage(ws, data);
    } else {
      this.handlePlainMessage(ws, message);
    }
  }

  private isPackedMessage(data: Buffer): boolean {
    // 检查是否是带2字节头部的消息
    if (data.length < 2) return false;
    
    const headerLen = (data[0] << 8) | data[1]; // big endian
    return data.length === headerLen + 2;
  }

  private handlePackedMessage(ws: WebSocket, data: Buffer): void {
    const session = this.clients.get(ws);
    if (!session) return;

    // 解析头部（2字节，big endian）
    const contentLen = (data[0] << 8) | data[1];
    const content = data.subarray(2, 2 + contentLen).toString();
    
    console.log(`客户端 ${session.id} 发送打包消息: ${content}`);

    // 处理SConn协议消息
    if (this.isSConnMessage(content)) {
      this.handleSConnMessage(ws, content);
    } else {
      // 普通打包消息，直接echo
      this.sendPackedMessage(ws, `Echo: ${content}`);
    }
  }

  private isSConnMessage(content: string): boolean {
    // SConn消息通常以数字开头，后跟换行符
    const lines = content.split('\n');
    return lines.length >= 2 && /^\d+$/.test(lines[0]);
  }

  private handleSConnMessage(ws: WebSocket, content: string): void {
    const session = this.clients.get(ws);
    if (!session) return;

    const lines = content.split('\n');
    const firstLine = lines[0];

    // 新连接请求
    if (firstLine === '0') {
      this.handleNewConnection(ws, lines);
    } 
    // 重连请求
    else if (lines.length >= 3) {
      this.handleReconnection(ws, lines);
    }
    // 其他SConn消息
    else {
      console.log(`未知SConn消息: ${content}`);
    }
  }

  private handleNewConnection(ws: WebSocket, lines: string[]): void {
    const session = this.clients.get(ws);
    if (!session) return;

    // 解析新连接请求: 0\n\ntargetServer\nflag
    const targetServer = lines.length > 2 ? lines[2] : '';
    const flag = lines.length > 3 ? parseInt(lines[3]) || 0 : 0;

    session.targetServer = targetServer;
    console.log(`客户端 ${session.id} 新连接请求, 目标服务器: ${targetServer}, 标志: ${flag}`);

    // 发送连接成功响应: clientId\n
    const response = `${session.id}\n`;
    this.sendPackedMessage(ws, response);
    
    console.log(`客户端 ${session.id} 连接建立成功`);
  }

  private handleReconnection(ws: WebSocket, lines: string[]): void {
    const session = this.clients.get(ws);
    if (!session) return;

    const clientId = parseInt(lines[0]) || 0;
    const reconnectIndex = parseInt(lines[1]) || 0;
    const recvNumber = parseInt(lines[2]) || 0;

    console.log(`客户端 ${session.id} 重连请求: ID=${clientId}, 重连索引=${reconnectIndex}, 接收字节=${recvNumber}`);

    // 更新重连索引
    session.reconnectIndex = reconnectIndex;

    // 发送重连成功响应: recvNumber\n200\n
    const response = `${session.sendBytes}\n200\n`;
    this.sendPackedMessage(ws, response);
    
    console.log(`客户端 ${session.id} 重连成功`);
  }

  private handlePlainMessage(ws: WebSocket, message: string): void {
    const session = this.clients.get(ws);
    if (!session) return;

    // Echo处理
    if (message.startsWith('echo:')) {
      const echoContent = message.substring(5);
      this.sendMessage(ws, `回复: ${echoContent}`);
      return;
    }

    // Ping-Pong处理
    if (message === 'ping') {
      this.sendMessage(ws, 'pong');
      return;
    }

    // 心跳处理
    if (message === 'heartbeat') {
      this.sendMessage(ws, 'heartbeat_ack');
      return;
    }

    // JSON协议消息处理
    try {
      const data = JSON.parse(message);
      this.handleJSONMessage(ws, data);
    } catch (error) {
      // 不是JSON，当作普通消息处理
      this.sendMessage(ws, `服务器收到: ${message}`);
    }
  }

  private handleJSONMessage(ws: WebSocket, data: any): void {
    const session = this.clients.get(ws);
    if (!session) return;

    console.log(`客户端 ${session.id} JSON消息:`, data);

    switch (data.type) {
      case 'command':
        this.handleCommand(ws, data.payload);
        break;
      case 'notification':
        this.handleNotification(ws, data.payload);
        break;
      case 'command_result':
        console.log(`客户端 ${session.id} 命令结果:`, data);
        break;
      default:
        this.sendJSONMessage(ws, {
          type: 'error',
          message: `未知消息类型: ${data.type}`
        });
    }
  }

  private handleCommand(ws: WebSocket, payload: any): void {
    const session = this.clients.get(ws);
    if (!session) return;

    console.log(`执行命令:`, payload);

    let result: any;
    switch (payload.cmd) {
      case 'get_status':
        result = {
          clientId: session.id,
          targetServer: session.targetServer,
          sendBytes: session.sendBytes,
          recvBytes: session.recvBytes,
          reconnectIndex: session.reconnectIndex,
          uptime: Date.now() - session.lastHeartbeat
        };
        break;
      case 'get_time':
        result = { timestamp: Date.now(), time: new Date().toISOString() };
        break;
      default:
        result = { error: `未知命令: ${payload.cmd}` };
    }

    this.sendJSONMessage(ws, {
      type: 'command_result',
      success: !result.error,
      result
    });
  }

  private handleNotification(ws: WebSocket, payload: any): void {
    const session = this.clients.get(ws);
    if (!session) return;

    console.log(`收到通知:`, payload);

    // 广播通知给其他客户端
    this.broadcast({
      type: 'notification',
      from: session.id,
      payload
    }, ws);
  }

  private sendMessage(ws: WebSocket, message: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      const session = this.clients.get(ws);
      if (session) {
        session.sendBytes += Buffer.byteLength(message);
      }
      ws.send(message);
    }
  }

  private sendPackedMessage(ws: WebSocket, message: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      const contentBuffer = Buffer.from(message);
      const headerBuffer = Buffer.allocUnsafe(2);
      
      // 写入2字节头部（big endian）
      headerBuffer.writeUInt16BE(contentBuffer.length, 0);
      
      const packedBuffer = Buffer.concat([headerBuffer, contentBuffer]);
      
      const session = this.clients.get(ws);
      if (session) {
        session.sendBytes += packedBuffer.length;
      }
      
      ws.send(packedBuffer);
    }
  }

  private sendJSONMessage(ws: WebSocket, data: any): void {
    this.sendMessage(ws, JSON.stringify(data));
  }

  private broadcast(message: any, excludeWs?: WebSocket): void {
    const jsonMessage = JSON.stringify(message);
    
    this.clients.forEach((session, ws) => {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        this.sendMessage(ws, jsonMessage);
      }
    });
  }

  private startHeartbeat(): void {
    setInterval(() => {
      const now = Date.now();
      
      this.clients.forEach((session, ws) => {
        // 检查超时客户端（60秒无活动）
        if (now - session.lastHeartbeat > 60000) {
          console.log(`客户端 ${session.id} 心跳超时，断开连接`);
          ws.terminate();
          this.clients.delete(ws);
          return;
        }

        // 发送心跳
        if (ws.readyState === WebSocket.OPEN) {
          this.sendMessage(ws, 'heartbeat');
        }
      });
    }, 30000); // 每30秒发送心跳
  }

  public getStats(): any {
    const stats = {
      totalClients: this.clients.size,
      clients: Array.from(this.clients.values()).map(session => ({
        id: session.id,
        targetServer: session.targetServer,
        sendBytes: session.sendBytes,
        recvBytes: session.recvBytes,
        reconnectIndex: session.reconnectIndex,
        lastHeartbeat: new Date(session.lastHeartbeat).toISOString()
      }))
    };
    
    return stats;
  }

  public close(): void {
    console.log('关闭WebSocket服务器...');
    this.wss.close();
  }
}

// 启动服务器
function startServer(port: number = 8080) {
  const server = new WSTestServer(port);

  // 定期输出统计信息
  const statsInterval = setInterval(() => {
    const stats = server.getStats();
    console.log('=== 服务器统计 ===');
    console.log(`活跃客户端: ${stats.totalClients}`);
    if (stats.clients.length > 0) {
      stats.clients.forEach(client => {
        console.log(`  客户端 ${client.id}: 发送=${client.sendBytes}字节, 接收=${client.recvBytes}字节, 重连=${client.reconnectIndex}次`);
      });
    }
    console.log('==================');
  }, 10000);

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n收到关闭信号，正在关闭服务器...');
    clearInterval(statsInterval);
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n收到终止信号，正在关闭服务器...');
    clearInterval(statsInterval);
    server.close();
    process.exit(0);
  });

  return server;
}

// 如果直接运行此文件，则启动服务器
if (require.main === module) {
  const port = parseInt(process.argv[2]) || 8080;
  console.log('=== WebSocket测试服务器 ===');
  console.log(`端口: ${port}`);
  console.log('支持功能:');
  console.log('- 基本WebSocket连接');
  console.log('- SConn协议（新连接和重连）');
  console.log('- Echo消息处理');
  console.log('- Ping-Pong心跳');
  console.log('- JSON协议消息');
  console.log('- 带头部的打包消息');
  console.log('按 Ctrl+C 停止服务器');
  console.log('========================');
  
  startServer(port);
}

export { WSTestServer, startServer };