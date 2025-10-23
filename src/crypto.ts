/**
 * 加密工具类
 * 
 * 提供DH密钥交换、MD5哈希、HMAC-MD5等加密功能的浏览器实现
 * 兼容goscon服务器的加密协议
 */
export class CryptUtils {
  /** DH参数 - RFC 3526 定义的2048位MODP群 */
  private static readonly DH_P = BigInt('0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF');
  private static readonly DH_G = BigInt(2);

  /**
   * 生成随机DH私钥
   * @returns 32字节的随机私钥
   */
  static generateRandomKey(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  /**
   * DH密钥交换 - 计算公钥
   * @param privateKey 客户端私钥
   * @returns 256字节的公钥
   */
  static dhExchange(privateKey: Uint8Array): Uint8Array {
    const privKeyBigInt = this.bytesToBigInt(privateKey);
    const publicKeyBigInt = this.modPow(this.DH_G, privKeyBigInt, this.DH_P);
    return this.bigIntToBytes(publicKeyBigInt, 256); // 2048 bits = 256 bytes
  }

  /**
   * DH密钥交换 - 计算共享密钥
   * @param serverPublicKey 服务器公钥
   * @param clientPrivateKey 客户端私钥
   * @returns 32字节的共享密钥
   */
  static dhSecret(serverPublicKey: Uint8Array, clientPrivateKey: Uint8Array): Uint8Array {
    const serverPubBigInt = this.bytesToBigInt(serverPublicKey);
    const clientPrivBigInt = this.bytesToBigInt(clientPrivateKey);
    const sharedSecretBigInt = this.modPow(serverPubBigInt, clientPrivBigInt, this.DH_P);
    return this.bigIntToBytes(sharedSecretBigInt, 32); // 取前32字节作为共享密钥
  }

  /**
   * 将字节数组转换为BigInt
   * @param bytes 字节数组
   * @returns 对应的BigInt值
   */
  private static bytesToBigInt(bytes: Uint8Array): bigint {
    let result = BigInt(0);
    for (let i = 0; i < bytes.length; i++) {
      result = (result << BigInt(8)) + BigInt(bytes[i]);
    }
    return result;
  }

  /**
   * 将BigInt转换为指定长度的字节数组
   * @param bigint 要转换的BigInt值
   * @param length 目标字节数组长度
   * @returns 字节数组
   */
  private static bigIntToBytes(bigint: bigint, length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let i = length - 1; i >= 0; i--) {
      bytes[i] = Number(bigint & BigInt(0xFF));
      bigint = bigint >> BigInt(8);
    }
    return bytes;
  }

  /**
   * 模幂运算 (base^exponent mod modulus)
   * @param base 底数
   * @param exponent 指数
   * @param modulus 模数
   * @returns 运算结果
   */
  private static modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    let result = BigInt(1);
    base = base % modulus;
    while (exponent > BigInt(0)) {
      if (exponent % BigInt(2) === BigInt(1)) {
        result = (result * base) % modulus;
      }
      exponent = exponent >> BigInt(1);
      base = (base * base) % modulus;
    }
    return result;
  }

  /**
   * Base64编码
   * @param data 要编码的字节数组
   * @returns Base64编码字符串
   */
  static base64Encode(data: Uint8Array): string {
    return btoa(String.fromCharCode(...data));
  }

  /**
   * Base64解码
   * @param str Base64编码字符串
   * @returns 解码后的字节数组
   */
  static base64Decode(str: string): Uint8Array {
    const binaryString = atob(str);
    return new Uint8Array(binaryString.length).map((_, i) => binaryString.charCodeAt(i));
  }

  /**
   * MD5哈希算法实现
   * @param data 要计算哈希的数据
   * @returns 16字节的MD5哈希值
   */
  static md5(data: Uint8Array): Uint8Array {
    // MD5算法实现
    const h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476];
    const k = [
      0xD76AA478, 0xE8C7B756, 0x242070DB, 0xC1BDCEEE, 0xF57C0FAF, 0x4787C62A, 0xA8304613, 0xFD469501,
      0x698098D8, 0x8B44F7AF, 0xFFFF5BB1, 0x895CD7BE, 0x6B901122, 0xFD987193, 0xA679438E, 0x49B40821,
      0xF61E2562, 0xC040B340, 0x265E5A51, 0xE9B6C7AA, 0xD62F105D, 0x02441453, 0xD8A1E681, 0xE7D3FBC8,
      0x21E1CDE6, 0xC33707D6, 0xF4D50D87, 0x455A14ED, 0xA9E3E905, 0xFCEFA3F8, 0x676F02D9, 0x8D2A4C8A,
      0xFFFA3942, 0x8771F681, 0x6D9D6122, 0xFDE5380C, 0xA4BEEA44, 0x4BDECFA9, 0xF6BB4B60, 0xBEBFBC70,
      0x289B7EC6, 0xEAA127FA, 0xD4EF3085, 0x04881D05, 0xD9D4D039, 0xE6DB99E5, 0x1FA27CF8, 0xC4AC5665,
      0xF4292244, 0x432AFF97, 0xAB9423A7, 0xFC93A039, 0x655B59C3, 0x8F0CCC92, 0xFFEFF47D, 0x85845DD1,
      0x6FA87E4F, 0xFE2CE6E0, 0xA3014314, 0x4E0811A1, 0xF7537E82, 0xBD3AF235, 0x2AD7D2BB, 0xEB86D391
    ];

    const s = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];

    // 预处理
    const originalLength = data.length;
    const paddedData = new Uint8Array(Math.ceil((originalLength + 9) / 64) * 64);
    paddedData.set(data);
    paddedData[originalLength] = 0x80;

    // 添加长度信息
    const lengthInBits = originalLength * 8;
    const view = new DataView(paddedData.buffer);
    view.setUint32(paddedData.length - 8, lengthInBits, true);
    view.setUint32(paddedData.length - 4, Math.floor(lengthInBits / 0x100000000), true);

    // 处理每个512位块
    for (let offset = 0; offset < paddedData.length; offset += 64) {
      const w = new Uint32Array(16);
      for (let i = 0; i < 16; i++) {
        w[i] = view.getUint32(offset + i * 4, true);
      }

      let [a, b, c, d] = h;

      for (let i = 0; i < 64; i++) {
        let f: number, g: number;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) % 16;
        }

        const temp = d;
        d = c;
        c = b;
        b = (b + this.leftRotate((a + f + k[i] + w[g]) >>> 0, s[i])) >>> 0;
        a = temp;
      }

      h[0] = (h[0] + a) >>> 0;
      h[1] = (h[1] + b) >>> 0;
      h[2] = (h[2] + c) >>> 0;
      h[3] = (h[3] + d) >>> 0;
    }

    // 转换为字节数组
    const result = new Uint8Array(16);
    const resultView = new DataView(result.buffer);
    for (let i = 0; i < 4; i++) {
      resultView.setUint32(i * 4, h[i], true);
    }
    return result;
  }

  /**
   * 32位整数左旋转操作
   * @param value 要旋转的值
   * @param amount 旋转位数
   * @returns 旋转后的值
   */
  private static leftRotate(value: number, amount: number): number {
    return ((value << amount) | (value >>> (32 - amount))) >>> 0;
  }

  /**
   * HMAC-MD5消息认证码计算
   * @param key 密钥
   * @param data 要认证的数据
   * @returns HMAC-MD5认证码
   */
  static hmacMd5(key: Uint8Array, data: Uint8Array): Uint8Array {
    const blockSize = 64;
    let keyArray = new Uint8Array(key);

    // 如果密钥长度大于块大小，先哈希密钥
    if (keyArray.length > blockSize) {
      keyArray = new Uint8Array(this.md5(keyArray));
    }

    // 填充密钥到块大小
    const paddedKey = new Uint8Array(blockSize);
    paddedKey.set(keyArray);

    // 创建内外填充
    const ipad = new Uint8Array(blockSize);
    const opad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      ipad[i] = paddedKey[i] ^ 0x36;
      opad[i] = paddedKey[i] ^ 0x5C;
    }

    // 计算内部哈希
    const innerData = new Uint8Array(blockSize + data.length);
    innerData.set(ipad);
    innerData.set(data, blockSize);
    const innerHash = this.md5(innerData);

    // 计算外部哈希
    const outerData = new Uint8Array(blockSize + 16);
    outerData.set(opad);
    outerData.set(innerHash, blockSize);
    return this.md5(outerData);
  }

  /**
   * 计算字符串的MD5哈希值
   * @param content 要计算哈希的字符串
   * @returns MD5哈希值
   */
  static hashKey(content: string): Uint8Array {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    return this.md5(data);
  }
}