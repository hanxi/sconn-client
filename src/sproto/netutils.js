const netutils = (() => {
    const utils = {};

    // 数组转 ArrayBuffer，使用 Uint8Array 提升性能
    utils.array2arraybuffer = (array) => {
        if (!Array.isArray(array)) {
            throw new TypeError('Expected an array');
        }
        const buffer = new ArrayBuffer(array.length);
        const view = new Uint8Array(buffer);
        view.set(array);
        return buffer;
    };

    // ArrayBuffer 转数组，使用 Uint8Array 提升性能
    utils.arraybuffer2array = (buffer) => {
        if (!(buffer instanceof ArrayBuffer)) {
            throw new TypeError('Expected an ArrayBuffer');
        }
        return Array.from(new Uint8Array(buffer));
    };

    // 字符串转 UTF-8 字节数组，优化性能
    utils.string2utf8 = (str) => {
        if (typeof str !== 'string') {
            throw new TypeError('Expected a string');
        }
        
        const result = [];
        
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            
            if (code <= 0x7f) {
                result.push(code);
            } else if (code <= 0x7ff) {
                result.push(
                    0xc0 | (code >> 6),
                    0x80 | (code & 0x3f)
                );
            } else if ((code >= 0x800 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xffff)) {
                result.push(
                    0xe0 | (code >> 12),
                    0x80 | ((code >> 6) & 0x3f),
                    0x80 | (code & 0x3f)
                );
            }
        }
        
        return result;
    };

    // UTF-8 字节数组转字符串，优化性能和错误处理
    utils.utf82string = (arr) => {
        if (typeof arr === 'string') {
            return null;
        }
        
        if (!Array.isArray(arr)) {
            throw new TypeError('Expected an array');
        }

        let result = '';
        let i = 0;
        
        while (i < arr.length && arr[i] != null) {
            const byte1 = arr[i];
            
            if (byte1 < 0x80) {
                // 单字节字符
                result += String.fromCharCode(byte1);
                i++;
            } else if ((byte1 & 0xe0) === 0xc0) {
                // 双字节字符
                if (i + 1 >= arr.length) break;
                const byte2 = arr[i + 1];
                const codePoint = ((byte1 & 0x1f) << 6) | (byte2 & 0x3f);
                result += String.fromCharCode(codePoint);
                i += 2;
            } else if ((byte1 & 0xf0) === 0xe0) {
                // 三字节字符
                if (i + 2 >= arr.length) break;
                const byte2 = arr[i + 1];
                const byte3 = arr[i + 2];
                const codePoint = ((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f);
                result += String.fromCharCode(codePoint);
                i += 3;
            } else {
                // 无效字节，跳过
                i++;
            }
        }
        
        return result;
    };

    // 数组连接，使用现代语法
    utils.arrayconcat = (a1, a2) => {
        if (!Array.isArray(a1) || !Array.isArray(a2)) {
            throw new TypeError('Both arguments must be arrays');
        }
        return [...a1, ...a2];
    };

    return utils;
})();

module.exports = netutils;