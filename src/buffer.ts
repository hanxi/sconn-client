/**
 * Buffer缓冲区类
 * 
 * 基于Uint8Array的二进制数据缓冲区，支持：
 * - 数据追加和合并
 * - 基于包头的消息分割
 * - 大端/小端字节序支持
 */

function hexdump(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    let ascii = '';
    
    for (let i = 0; i < bytes.length; i++) {
        // 每16字节换行
        if (i % 16 === 0) {
            if (i !== 0) {
                hex += ' ' + ascii + '\n';
                ascii = '';
            }
            // 打印偏移地址
            hex += i.toString(16).padStart(8, '0') + ': ';
        }
        
        // 转换为16进制
        hex += bytes[i].toString(16).padStart(2, '0') + ' ';
        
        // 生成ASCII部分
        ascii += (bytes[i] >= 32 && bytes[i] <= 126) ? 
                 String.fromCharCode(bytes[i]) : '.';
    }
    
    // 处理最后一行
    while (ascii.length < 16) {
        hex += '   ';
        ascii += ' ';
    }
    hex += ' ' + ascii;
    
    return hex;
}

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
   * 添加数据到缓冲区
   * @param arr 要添加的字节数组
   */
  push(arr: Uint8Array|ArrayBuffer): void {
    if (arr instanceof ArrayBuffer) {
      arr = new Uint8Array(arr);
    }
    this.data.push(arr);
  }

  /**
   * 弹出并合并所有缓冲数据
   * @returns 合并后的字节数组
   */
  popAll(): Uint8Array {
    // 计算总长度
    const totalLength = this.getSize();
    if (totalLength === 0) return new Uint8Array(0);

    const result = new Uint8Array(totalLength);
    let offset = 0;
    // 合并所有数组
    for (const arr of this.data) {
      result.set(arr, offset);
      offset += arr.length;
    }
    this.data = [];

  console.log("popAll", result.length);
  console.log(hexdump(result.buffer));
    
    return result;
  }

  /**
   * 根据包头信息解析并弹出一条完整消息
   * @param headerLen 包头长度（字节）
   * @param headerEndian 包头字节序（'big' 或 'little'）
   * @returns 解析出的消息，如果数据不足则返回null
   */
  popMsg(headerLen: number, headerEndian: string): Uint8Array | null {
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
   * 解析并弹出所有完整消息
   * @param out 输出消息数组
   * @param headerLen 包头长度
   * @param headerEndian 包头字节序
   * @returns 解析出的消息数量
   */
  popAllMsg(out: Uint8Array[], headerLen: number, headerEndian: string): number {
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
   * 获取缓冲区中数据的总字节数
   * @returns 总字节数
   */
  getSize(): number {
    return this.data.reduce((sum, arr) => sum + arr.length, 0);
  }

  /**
   * 清空缓冲区中的所有数据
   */
  clear(): void {
    this.data = [];
  }

  /**
   * 创建新的Buffer实例
   * @returns 新的Buffer实例
   */
  static create(): Buffer {
    return new Buffer();
  }
}