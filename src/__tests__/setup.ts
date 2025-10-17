/**
 * Jest测试环境设置
 */

// 全局测试设置
beforeAll(() => {
  // 设置全局WebSocket常量
  Object.defineProperty(global, 'WebSocket', {
    writable: true,
    value: class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
    }
  });
});

// 每个测试前的清理
beforeEach(() => {
  // 清理所有模拟
  jest.clearAllMocks();
});

// 每个测试后的清理
afterEach(() => {
  // 恢复所有模拟
  jest.restoreAllMocks();
});