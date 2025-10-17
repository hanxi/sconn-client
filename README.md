# SConn Client

一个基于状态机的 TypeScript WebSocket 客户端库，支持自动重连和数据缓存功能。该库为浏览器环境提供了强大的 WebSocket 连接管理解决方案。

## 特性

- 🔄 **自动重连**: 基于状态管理的智能重连机制
- 📦 **数据缓存**: 自动数据缓存和重连时重传
- 🔐 **DH 密钥交换**: 内置 Diffie-Hellman 密钥交换，确保通信安全
- 🔒 **HMAC-MD5 认证**: 使用 HMAC-MD5 进行消息认证
- 🎯 **状态机**: 清晰的基于状态的连接管理
- 🌐 **浏览器兼容**: 专为现代浏览器环境设计
- 📝 **TypeScript**: 完整的 TypeScript 支持和类型定义
- ✅ **完善测试**: 使用 Jest 的全面测试套件

## 安装

```bash
npm install sconn-client
```

## 快速开始

### 基础 WebSocket 连接

```typescript
import { connect } from 'sconn-client';

// 创建基础 WebSocket 连接
const result = connect('ws://localhost:8080');
if (result.connection) {
  const conn = result.connection;
  
  // 发送数据
  conn.send('Hello World');
  
  // 接收数据
  const messages: string[] = [];
  const count = conn.recv(messages);
  console.log('接收到的消息:', messages);
}
```

### 带状态管理的 SConn

```typescript
import { connectHostSConn } from 'sconn-client';

// 创建带状态管理的 SConn 连接
const result = connectHostSConn('ws://localhost:8080', 'target-server', 0);
if (result.connection) {
  const sconn = result.connection;
  
  // 发送带自动打包的消息
  sconn.sendMsg('Hello SConn');
  
  // 处理连接状态
  const state = sconn.curState();
  console.log('当前状态:', state);
  
  // 自动重连
  sconn.reconnect((success) => {
    console.log('重连结果:', success);
  });
}
```

## API 参考

### 连接管理

#### `connect(url: string): ConnectResult`

创建基础 WebSocket 连接。

- `url`: WebSocket 服务器 URL
- 返回: `{ connection: IWSConnection | null, error?: string }`

#### `connectHostSConn(url: string, targetServer?: string, flag?: number): ConnectResult`

创建具有高级功能的 SConn 连接。

- `url`: WebSocket 服务器 URL
- `targetServer`: 目标服务器标识符（可选）
- `flag`: 连接标志（可选）
- 返回: `{ connection: SConn | null, error?: string }`

### SConn 类方法

#### 状态管理

- `curState(): string` - 获取当前连接状态
- `update(): StateDisposeResult` - 更新连接状态
- `close(): void` - 关闭连接

#### 数据传输

- `send(data: string): boolean` - 发送原始数据
- `sendMsg(data: string, headerLen?: number, endian?: string): boolean` - 发送带包头的消息
- `recv(out: string[]): number` - 接收原始数据
- `recvMsg(outMsg: string[], headerLen?: number, endian?: string): number` - 接收消息

#### 重连

- `reconnect(cb?: (success: boolean) => void): ReconnectResult` - 启动重连

### 加密功能

该库包含内置的加密功能：

- **DH 密钥交换**: 符合 RFC 3526 的 2048 位 MODP 群
- **HMAC-MD5**: 消息认证和完整性验证
- **自动密钥管理**: 连接建立期间的无缝密钥交换

## 连接状态

SConn 使用状态机，包含以下状态：

- `newconnect` - 初始连接建立
- `forward` - 正常数据转发
- `reconnect` - 重连进行中
- `reconnect_error` - 重连失败
- `reconnect_match_error` - 数据同步错误
- `reconnect_cache_error` - 缓存不足无法恢复
- `close` - 连接已关闭

## 配置

### 消息格式

默认情况下，消息使用：
- 包头长度: 2 字节
- 字节序: 小端序

您可以自定义这些设置：

```typescript
sconn.sendMsg('data', 4, 'big'); // 4 字节包头，大端序
```

### 缓存

库会自动缓存发送的数据以供重连恢复：
- 最大缓存条目: 100
- 自动清理旧条目
- 高效的数据检索用于重传

## 测试

运行测试套件：

```bash
npm test
```

运行带覆盖率的测试：

```bash
npm run test:coverage
```

监视模式运行测试：

```bash
npm run test:watch
```

## 示例

查看 `examples/` 目录获取完整的使用示例：

```bash
npm run example:conn    # 基础连接示例
npm run example:sconn   # 带状态管理的 SConn 示例
```

## 开发

### 构建

```bash
npm run build
```

### 类型检查

```bash
npm run type-check
```

### 开发服务器

```bash
npm run server:dev
```

## 相关项目

本项目受以下项目启发并与之兼容：

- [sconn_clienth](https://github.com/lvzixun/sconn_clienth) - 原始 C 语言实现
- [goscon](https://github.com/hanxi/goscon) - Go 语言服务器实现

## 浏览器兼容性

- Chrome/Edge 88+
- Firefox 78+
- Safari 14+

需要支持：
- WebSocket API
- Web Crypto API（用于 DH 密钥交换）
- BigInt（用于加密操作）

## 许可证

MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 贡献

1. Fork 本仓库
2. 创建您的功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交您的更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开一个 Pull Request

## 更新日志

### v1.0.0
- 初始发布
- DH 密钥交换实现
- HMAC-MD5 认证
- 自动重连
- 数据缓存和恢复
- TypeScript 支持
- 全面的测试套件