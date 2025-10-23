# SConn Client

一个基于状态机的 TypeScript WebSocket 客户端库，支持自动重连和数据缓存功能。该库为浏览器环境提供了强大的 WebSocket 连接管理解决方案。是 [goscon](https://github.com/hanxi/goscon) 的客户端实现。

## 特性

- 🔄 **自动重连**: 基于状态管理的智能重连机制
- 📦 **数据缓存**: 自动数据缓存和重连时重传
- 🔐 **DH 密钥交换**: 内置 Diffie-Hellman 密钥交换，确保通信安全
- 🔒 **HMAC-MD5 认证**: 使用 HMAC-MD5 进行消息认证
- 🎯 **状态机**: 清晰的基于状态的连接管理
- 🌐 **浏览器兼容**: 专为现代浏览器环境设计
- 📝 **TypeScript**: 完整的 TypeScript 支持和类型定义
- 🚀 **Sproto 协议**: 基于 sproto 协议的高效消息编解码
- ✅ **完善测试**: 使用 Jest 的全面测试套件

## 安装

```bash
npm install sconn-client
```

或使用 yarn:

```bash
yarn add sconn-client
```

或使用 bun:

```bash
bun add sconn-client
```

## 快速开始

### 基本使用

```typescript
import { Network } from 'sconn-client';
import { readFileSync } from 'fs';
import { join } from 'path';

// 创建协议缓冲区（从 .sproto 文件编译生成的二进制数据）
const protocolPath = join(__dirname, 'sproto.spb');
const protocolData = readFileSync(protocolPath);
const protocolBuffer = new Uint8Array(protocolData);

// 创建 Network 实例
const network = new Network(protocolBuffer);

// 获取协议校验码
const checksum = network.checksumValue();
console.log('协议校验码:', checksum);

// 连接到服务器
const connectResult = network.connect('ws://localhost:1249', 'game1');
if (!connectResult.success) {
  console.error('连接失败:', connectResult.error);
  return;
}

// 注册消息处理器
network.register('login.login', (request) => {
  console.log('处理登录请求:', request);
  return {
    success: true,
    userId: 12345,
    username: request.username,
    token: 'mock_token_' + Date.now()
  };
});

// 启动网络更新循环
const updateInterval = setInterval(() => {
  const updateResult = network.update();
  if (!updateResult.success) {
    console.error('网络更新错误:', updateResult.error);
    if (updateResult.status === 'connect_break') {
      console.log('连接断开，尝试重连...');
      // 处理重连逻辑
    }
  }
}, 50); // 每50ms更新一次

// 发送登录请求
try {
  const ctx = {
    rid: 0,
    proto_checksum: checksum,
  };
  const loginData = {
    token: 'your_jwt_token_here',
    ctx,
  };
  const response = await network.call('login.login', loginData);
  console.log('登录成功:', response);
} catch (error) {
  console.error('登录失败:', error);
}
```

## API 参考

### Network 类

主要的网络通信管理器，提供高级 API 用于 WebSocket 连接管理和消息处理。

#### 构造函数

```typescript
constructor(protocolBuffer: number[], packageName?: string)
```

- `protocolBuffer`: 协议二进制数据数组
- `packageName`: 协议包名，默认为 "base.package"

#### 主要方法

##### connect(url: string, targetServer: string): ConnectionResult

连接到 WebSocket 服务器。

```typescript
const result = network.connect('ws://localhost:8080', 'game1');
if (result.success) {
  console.log('连接成功');
} else {
  console.error('连接失败:', result.error);
}
```

##### register(name: string, handler: ResponseHandler): void

注册消息处理器。

```typescript
network.register('chat.message', (message) => {
  console.log('收到聊天消息:', message);
  return { received: true };
});
```

##### call(name: string, data: any): Promise<any>

发送请求并等待响应。

```typescript
try {
  const response = await network.call('user.info', { userId: 123 });
  console.log('用户信息:', response);
} catch (error) {
  console.error('请求失败:', error);
}
```

##### update(): UpdateResult

更新网络连接状态，处理接收到的消息。

```typescript
const result = network.update();
if (!result.success) {
  console.error('更新失败:', result.error);
  if (result.status === 'connect_break') {
    // 处理连接断开
  }
}
```

##### close(): void

关闭网络连接。

```typescript
network.close();
```

##### isConnected(): boolean

检查连接状态。

```typescript
if (network.isConnected()) {
  console.log('连接正常');
}
```

##### checksumValue(): string

获取协议校验码，用于验证客户端和服务器使用的协议版本一致性。

```typescript
const checksum = network.checksumValue();
console.log('协议校验码:', checksum);

// 在登录时使用校验码
const loginData = {
  token: 'your_jwt_token',
  ctx: {
    rid: 0,
    proto_checksum: checksum
  }
};
```

## 示例

查看 `examples/` 目录获取完整的使用示例：

```bash
# 运行网络示例
bun run example:network
```

## 协议支持

本库基于 [sproto](https://github.com/cloudwu/sproto) 协议，需要使用 [sprotodump](https://github.com/lvzixun/sprotodump) 预先编译协议文件为二进制格式。

### 协议文件示例

```sproto
.package {
  type 0 : integer
  session 1 : integer
}

login {
  request {
    token 0 : string
    ctx 1 : *package
  }
  response {
    success 0 : boolean
    userId 1 : integer
    username 2 : string
  }
}
```

## 相关项目

本项目受以下项目启发并与之兼容：

- [sconn_client](https://github.com/lvzixun/sconn_client) - 原始 C 语言实现
- [goscon](https://github.com/hanxi/goscon) - Go 语言服务器实现
- [sproto](https://github.com/cloudwu/sproto) - 协议定义和编解码库
- [sprotodump](https://github.com/lvzixun/sprotodump) - 协议编译工具

## 许可证

MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 贡献

1. Fork 本仓库
2. 创建您的功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交您的更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开一个 Pull Request

## 支持

如果您在使用过程中遇到问题，请：

1. 查看 [示例代码](examples/)
2. 检查 [API 文档](#api-参考)
3. 提交 [Issue](https://github.com/hanxi/sconn-client.ts/issues)
