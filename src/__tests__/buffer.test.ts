/**
 * buffer.ts 测试用例
 */

import { Buffer, endianFormat } from '../buffer';

describe('Buffer', () => {
  let buffer: Buffer;

  beforeEach(() => {
    buffer = Buffer.create();
  });

  describe('创建和初始化', () => {
    it('应该创建默认Buffer实例', () => {
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.getSize()).toBe(0);
      expect(buffer.headerLen).toBe(2);
      expect(buffer.headerEndian).toBe('big');
    });

    it('应该创建自定义头部长度的Buffer', () => {
      const customBuffer = Buffer.create(4, 'little');
      expect(customBuffer.headerLen).toBe(4);
      expect(customBuffer.headerEndian).toBe('little');
    });
  });

  describe('数据操作', () => {
    it('应该正确推入数据', () => {
      buffer.push('hello');
      expect(buffer.getSize()).toBe(5);
      
      buffer.push(' world');
      expect(buffer.getSize()).toBe(11);
    });

    it('应该正确弹出所有数据', () => {
      buffer.push('test data');
      const data = buffer.popAll();
      expect(data).toBe('test data');
      expect(buffer.getSize()).toBe(0);
    });

    it('应该处理空Buffer的弹出操作', () => {
      const data = buffer.popAll();
      expect(data).toBe('');
    });

    it('应该正确清空Buffer', () => {
      buffer.push('some data');
      expect(buffer.getSize()).toBe(9);
      
      buffer.clear();
      expect(buffer.getSize()).toBe(0);
    });
  });

  describe('头部设置', () => {
    it('应该正确设置头部参数', () => {
      buffer.setHeader(4, 'little');
      expect(buffer.headerLen).toBe(4);
      expect(buffer.headerEndian).toBe('little');
    });

    it('应该处理无效的头部长度', () => {
      buffer.setHeader(0, 'big');
      expect(buffer.headerLen).toBe(2); // 应该使用默认值
    });
  });

  describe('消息处理', () => {

    it('应该正确解包消息', () => {
      // 构造一个完整的消息包
      const message = 'hello';
      const packedData = '\x00\x05hello';
      buffer.push(packedData);
      
      const result = buffer.popMsg();
      expect(result).toBe(message);
    });

    it('应该处理不完整的消息包', () => {
      // 只推入头部，没有完整消息
      buffer.push('\x00\x05hel'); // 缺少2个字符
      
      const result = buffer.popMsg();
      expect(result).toBeNull();
      expect(buffer.getSize()).toBe(5); // 数据应该保留在buffer中
    });

    it('应该处理多个消息包', () => {
      const messages: string[] = [];
      
      // 推入两个完整的消息包
      buffer.push('\x00\x05hello\x00\x05world');
      
      const count = buffer.popAllMsg(messages);
      expect(count).toBe(2);
      expect(messages).toEqual(['hello', 'world']);
    });

    it('应该处理little endian的消息解包', () => {
      buffer.setHeader(2, 'little');
      
      // little endian: 长度5 = 0x0500
      const packedData = '\x05\x00hello';
      buffer.push(packedData);
      
      const result = buffer.popMsg();
      expect(result).toBe('hello');
    });
  });

  describe('边界情况', () => {
    it('应该处理空字符串消息', () => {
      const packed = '\x00\x00';
      
      buffer.push(packed);
      const result = buffer.popMsg();
      expect(result).toBe('');
    });

    it('应该处理大消息', () => {
      const largeMessage = 'a'.repeat(1000);
      // 手动构造消息包：长度1000 = 0x03E8
      const packed = '\x03\xE8' + largeMessage;
      
      buffer.push(packed);
      const result = buffer.popMsg();
      expect(result).toBe(largeMessage);
    });

    it('应该处理连续的push和pop操作', () => {
      buffer.push('part1');
      buffer.push('part2');
      
      const result = buffer.popAll();
      expect(result).toBe('part1part2');
    });

    it('应该正确处理头部长度超出数据的情况', () => {
      buffer.setHeader(4, 'big');
      buffer.push('\x00\x00'); // 只有2字节，但头部需要4字节
      
      const result = buffer.popMsg();
      expect(result).toBeNull();
    });
  });
});

describe('endianFormat', () => {
  it('应该包含正确的字节序格式', () => {
    expect(endianFormat.big).toBe('>');
    expect(endianFormat.little).toBe('<');
  });
});

