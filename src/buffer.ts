/**
 * Buffer缓冲区类（基于Uint8Array）
 */

export const endianFormat = {
  "little": "<",
  "big": ">"
};

const DEFAULT_HEADER_LENGTH = 2;
const DEFAULT_HEADER_ENDIAN = "big";

/**
 * 缓冲区类（处理Uint8Array二进制数据）
 */
export class Buffer {
  private data: Uint8Array[] = [];
  public headerLen: number = DEFAULT_HEADER_LENGTH;
  public headerEndian: string = DEFAULT_HEADER_ENDIAN;

  constructor(headerLen?: number, headerEndian?: string) {
    this.setHeader(headerLen, headerEndian);
  }

  /**
   * 设置header编码格式以及size大小
   */
  setHeader(headerLen?: number, headerEndian?: string): void {
    this.headerLen = headerLen || DEFAULT_HEADER_LENGTH;
    this.headerEndian = headerEndian || DEFAULT_HEADER_ENDIAN;
    if (!endianFormat[this.headerEndian as keyof typeof endianFormat]) {
      throw new Error(`Invalid headerEndian: ${this.headerEndian}`);
    }
  }

  /**
   * 根据设置的header编码格式，编码长度
   */
  packHeader(sz: number): Uint8Array {
    const header = new Uint8Array(this.headerLen);
    if (this.headerEndian === 'big') {
      // 大端模式：高位在前
      for (let i = 0; i < this.headerLen; i++) {
        const shift = (this.headerLen - 1 - i) * 8;
        header[i] = (sz >>> shift) & 0xFF;
      }
    } else {
      // 小端模式：低位在前
      for (let i = 0; i < this.headerLen; i++) {
        const shift = i * 8;
        header[i] = (sz >>> shift) & 0xFF;
      }
    }
    return header;
  }

  /**
   * 添加Uint8Array数据到缓冲区
   */
  push(arr: Uint8Array): void {
    this.data.push(arr);
  }

  /**
   * 弹出所有数据（合并为单个Uint8Array）
   */
  popAll(): Uint8Array {
    // 计算总长度
    const totalLength = this.getSize();
    const result = new Uint8Array(totalLength);
    let offset = 0;
    // 合并所有数组
    for (const arr of this.data) {
      result.set(arr, offset);
      offset += arr.length;
    }
    this.data = [];
    return result;
  }

  /**
   * 添加消息（包含header）
   */
  pushMsg(data: Uint8Array): void {
    const len = data.length;
    const header = this.packHeader(len);
    // 合并header和数据并添加到缓冲区
    const message = new Uint8Array(header.length + data.length);
    message.set(header);
    message.set(data, header.length);
    this.push(message);
  }

  /**
   * 根据包头信息弹出一段消息
   */
  popMsg(): Uint8Array | null {
    const current = this.popAll(); // 先合并所有数据
    if (current.length < this.headerLen) {
      // 数据不足包头长度，放回缓冲区
      if (current.length > 0) this.data.push(current);
      return null;
    }

    // 解析包头
    let sz = 0;
    const header = current.subarray(0, this.headerLen);
    if (this.headerEndian === 'big') {
      for (let i = 0; i < this.headerLen; i++) {
        sz = (sz << 8) + header[i];
      }
    } else {
      for (let i = 0; i < this.headerLen; i++) {
        sz += header[i] << (i * 8);
      }
    }

    // 检查数据是否足够
    const totalNeeded = this.headerLen + sz;
    if (current.length < totalNeeded) {
      // 数据不足，放回缓冲区
      this.data.push(current);
      return null;
    }

    // 提取消息和剩余数据
    const message = current.subarray(this.headerLen, totalNeeded);
    const remaining = current.subarray(totalNeeded);
    if (remaining.length > 0) {
      this.data.push(remaining);
    }
    return message;
  }

  /**
   * 弹出所有消息到数组
   */
  popAllMsg(out: Uint8Array[]): number {
    let count = 0;
    let msg = this.popMsg();
    while (msg !== null) {
      out.push(msg);
      count++;
      msg = this.popMsg();
    }
    return count;
  }

  /**
   * 获取缓冲区大小
   */
  getSize(): number {
    return this.data.reduce((sum, arr) => sum + arr.length, 0);
  }

  /**
   * 清空缓冲区
   */
  clear(): void {
    this.data = [];
  }

  /**
   * 静态创建方法
   */
  static create(headerLen?: number, headerEndian?: string): Buffer {
    return new Buffer(headerLen, headerEndian);
  }
}
