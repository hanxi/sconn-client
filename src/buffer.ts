/**
 * Buffer缓冲区类（基于Uint8Array）
 */

export const endianFormat = {
  "little": "<",
  "big": ">"
};

/**
 * 缓冲区类（处理Uint8Array二进制数据）
 */
export class Buffer {
  private data: Uint8Array[] = [];

  /**
   * 添加Uint8Array数据到缓冲区
   */
  push(arr: Uint8Array): void {
    console.trace("buffer push", arr);
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
   * 根据包头信息弹出一段消息
   */
  popMsg(headerLen?: number, headerEndian?: string): Uint8Array | null {
    const len = headerLen;
    const endian = headerEndian;
    
    const current = this.popAll(); // 先合并所有数据
    if (current.length < len) {
      // 数据不足包头长度，放回缓冲区
      if (current.length > 0) this.data.push(current);
      return null;
    }

    // 解析包头
    let sz = 0;
    const header = current.subarray(0, len);
    if (endian === 'big') {
      for (let i = 0; i < len; i++) {
        sz = (sz << 8) + header[i];
      }
    } else {
      for (let i = 0; i < len; i++) {
        sz += header[i] << (i * 8);
      }
    }

    // 检查数据是否足够
    const totalNeeded = len + sz;
    if (current.length < totalNeeded) {
      // 数据不足，放回缓冲区
      this.data.push(current);
      return null;
    }

    // 提取消息和剩余数据
    const message = current.subarray(len, totalNeeded);
    const remaining = current.subarray(totalNeeded);
    if (remaining.length > 0) {
      this.data.push(remaining);
    }
    return message;
  }

  /**
   * 弹出所有消息到数组
   */
  popAllMsg(out: Uint8Array[], headerLen?: number, headerEndian?: string): number {
    let count = 0;
    let msg = this.popMsg(headerLen, headerEndian);
    while (msg !== null) {
      out.push(msg);
      count++;
      msg = this.popMsg(headerLen, headerEndian);
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
  static create(): Buffer {
    return new Buffer();
  }
}