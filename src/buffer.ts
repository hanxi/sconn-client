/**
 * Buffer缓冲区类
 */

export const endianFormat = {
  "little": "<",
  "big": ">"
};

const DEFAULT_HEADER_LENGTH = 2;
const DEFAULT_HEADER_ENDIAN = "big";

/**
 * 缓冲区类
 */
export class Buffer {
  private data: string[] = [];
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
   * 根据设置的header编码格式，编码sz
   */
  packHeader(sz: number): string {
    const hex = sz.toString(16).padStart(this.headerLen * 2, '0');
    return String.fromCharCode(...hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  }

  /**
   * 添加字符串到缓冲区
   */
  push(str: string): void {
    this.data.push(str);
  }



  /**
   * 弹出所有数据
   */
  popAll(): string {
    const result = this.data.join('');
    this.data = [];
    return result;
  }

  /**
   * 添加消息（包含header）
   */
  pushMsg(str: string): void {
    const len = str.length;
    const header = this.packHeader(len);
    this.push(header + str);
  }

  /**
   * 根据包头信息弹出一段消息
   */
  popMsg(): string | null {
    const current = this.data.join('');
    if (current.length < this.headerLen) return null;
    
    const headerBytes = current.slice(0, this.headerLen);
    let sz = 0;
    
    if (this.headerEndian === 'big') {
      for (let i = 0; i < headerBytes.length; i++) {
        sz = (sz << 8) + headerBytes.charCodeAt(i);
      }
    } else {
      for (let i = 0; i < headerBytes.length; i++) {
        sz += headerBytes.charCodeAt(i) << (i * 8);
      }
    }
    
    if (current.length < this.headerLen + sz) return null;
    
    const message = current.slice(this.headerLen, this.headerLen + sz);
    const remaining = current.slice(this.headerLen + sz);
    this.data = remaining ? [remaining] : [];
    return message;
  }

  /**
   * 弹出所有消息到数组
   */
  popAllMsg(out: string[]): number {
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
    return this.data.reduce((sum, str) => sum + str.length, 0);
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