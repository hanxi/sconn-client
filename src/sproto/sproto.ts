// sproto.ts 解析 - TypeScript 版本

// 类型定义
interface SprotoField {
    tag: number;
    type: number;
    name: string | null;
    st: number | null;
    key: number;
    extra: number;
}

interface SprotoType {
    name: string | null;
    n: number;
    base: number;
    maxn: number;
    f: SprotoField[] | null;
}

interface SprotoProtocol {
    name: string | null;
    tag: number;
    p: (SprotoType | null)[];
    confirm: number;
}

interface SprotoInstance {
    type_n: number;
    protocol_n: number;
    type: SprotoType[] | null;
    proto: SprotoProtocol[] | null;
    tcache: Map<string, SprotoType>;
    pcache: Map<string | number, any>;
    queryproto: (protocolName: string | number) => any;
    dump: () => void;
    objlen: (type: string | number | SprotoType, inbuf: number[]) => number | null;
    encode: (type: string | number | SprotoType, indata: any) => number[] | null;
    decode: (type: string | number | SprotoType, inbuf: number[]) => any | null;
    pack: (inbuf: number[]) => number[];
    unpack: (inbuf: number[]) => number[];
    pencode: (type: string | number | SprotoType, inbuf: any) => number[] | null;
    pdecode: (type: string | number | SprotoType, inbuf: number[]) => any | null;
    host: (packagename?: string) => any;
}

interface SprotoArgs {
    ud?: any;
    tagname?: string;
    tagid?: number;
    type?: number;
    subtype?: SprotoType | null;
    mainindex?: number;
    extra?: number;
    index?: number;
    value?: any;
    length?: number;
    buffer?: number[];
    buffer_idx?: number;
}

interface SprotoAPI {
    pack: (inbuf: number[]) => number[];
    unpack: (inbuf: number[]) => number[];
    createNew: (binsch: number[]) => SprotoInstance | null;
}

const sproto = ((): SprotoAPI => {
    const api: SprotoAPI = {} as SprotoAPI;
    const host: any = {};
    let headerTemp: any = {};

    // 常量定义
    const CONSTANTS = {
        SPROTO_REQUEST: 0,
        SPROTO_RESPONSE: 1,

        // type (sproto_arg.type)
        SPROTO_TINTEGER: 0,
        SPROTO_TBOOLEAN: 1,
        SPROTO_TSTRING: 2,
        SPROTO_TDOUBLE: 3,
        SPROTO_TSTRUCT: 4,

        // sub type of string (sproto_arg.extra)
        SPROTO_TSTRING_STRING: 0,
        SPROTO_TSTRING_BINARY: 1,

        SPROTO_CB_ERROR: -1,
        SPROTO_CB_NIL: -2,
        SPROTO_CB_NOARRAY: -3,

        SPROTO_TARRAY: 0x80,
        CHUNK_SIZE: 1000,
        SIZEOF_LENGTH: 4,
        SIZEOF_HEADER: 2,
        SIZEOF_FIELD: 2,

        ENCODE_BUFFERSIZE: 2050,
        ENCODE_MAXSIZE: 0x1000000,
        ENCODE_DEEPLEVEL: 64
    };

    // 工具函数
    const utils = {
        // js中只long只能表示到2^52-1, 0xFFFFFFFFFFFFF表示
        expand64: (v: number): number => {
            const value = v;
            if ((value & 0x80000000) !== 0) {
                return 0x0000000000000 + (value & 0xFFFFFFFF);
            }
            return value;
        },

        hiLowUint64: (low: number, hi: number): number => (hi & 0xFFFFFFFF) * 0x100000000 + low,

        // 64位整数位移操作会将64位截成32位有符号整数
        uint64Lshift: (num: number, offset: number): number => num * Math.pow(2, offset),

        uint64Rshift: (num: number, offset: number): number => Math.floor(num / Math.pow(2, offset)),

        toWord: (stream: number[]): number => (stream[0] & 0xff) | ((stream[1] & 0xff) << 8),

        toDword: (stream: number[]): number => (
            (stream[0] & 0xff) |
            ((stream[1] & 0xff) << 8) |
            ((stream[2] & 0xff) << 16) |
            ((stream[3] & 0xff) << 24)
        ) >>> 0,

        // 从 netutils.js 移动过来的接口
        // 字符串转 UTF-8 字节数组，优化性能
        string2utf8: (str: string): number[] => {
            if (typeof str !== 'string') {
                throw new TypeError('Expected a string');
            }
            
            const result: number[] = [];
            
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
        },

        // UTF-8 字节数组转字符串，优化性能和错误处理
        utf82string: (arr: number[]): string | null => {
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
        },

        // 数组连接，使用现代语法
        arrayconcat: (a1: number[], a2: number[]): number[] => {
            if (!Array.isArray(a1) || !Array.isArray(a2)) {
                throw new TypeError('Both arguments must be arrays');
            }
            return [...a1, ...a2];
        }
    };

    const countArray = (stream: number[]): number => {
        const length = utils.toDword(stream);
        let n = 0;
        let currentStream = stream.slice(CONSTANTS.SIZEOF_LENGTH);
        let remainingLength = length;

        while (remainingLength > 0) {
            if (remainingLength < CONSTANTS.SIZEOF_LENGTH) {
                return -1;
            }

            const nsz = utils.toDword(currentStream) + CONSTANTS.SIZEOF_LENGTH;
            if (nsz > remainingLength) {
                return -1;
            }

            n++;
            currentStream = currentStream.slice(nsz);
            remainingLength -= nsz;
        }

        return n;
    };

    const structField = (stream: number[], sz: number): number => {
        if (sz < CONSTANTS.SIZEOF_LENGTH) {
            return -1;
        }

        const fn = utils.toWord(stream);
        const header = CONSTANTS.SIZEOF_HEADER + CONSTANTS.SIZEOF_FIELD * fn;

        if (sz < header) {
            return -1;
        }

        const field = stream.slice(CONSTANTS.SIZEOF_HEADER);
        let remainingSz = sz - header;
        let currentStream = stream.slice(header);

        for (let i = 0; i < fn; i++) {
            const value = utils.toWord(field.slice(i * CONSTANTS.SIZEOF_FIELD + CONSTANTS.SIZEOF_HEADER));

            if (value !== 0) {
                continue;
            }

            if (remainingSz < CONSTANTS.SIZEOF_LENGTH) {
                return -1;
            }

            const dsz = utils.toDword(currentStream);
            if (remainingSz < CONSTANTS.SIZEOF_LENGTH + dsz) {
                return -1;
            }

            currentStream = currentStream.slice(CONSTANTS.SIZEOF_LENGTH + dsz);
            remainingSz -= CONSTANTS.SIZEOF_LENGTH + dsz;
        }

        return fn;
    };

    // 导入字符串 - stream 是arraybuffer
    const importString = (s: any, stream: number[]): string => {
        const sz = utils.toDword(stream);
        const arr = stream.slice(CONSTANTS.SIZEOF_LENGTH, CONSTANTS.SIZEOF_LENGTH + sz);
        return String.fromCharCode(...arr);
    };

    function calc_pow(base: number, exp: number): number {
        return Math.pow(base, exp);
    }

    function import_field(s: any, f: SprotoField, stream: number[]): number[] | null {
        let sz: number, result: number[], fn: number;
        let array = 0;
        let tag = -1;
        f.tag = -1;
        f.type = -1;
        f.name = null;
        f.st = null;
        f.key = -1;
        f.extra = 0;

        sz = utils.toDword(stream);
        stream = stream.slice(CONSTANTS.SIZEOF_LENGTH);
        result = stream.slice(sz);
        fn = structField(stream, sz);
        if (fn < 0) return null;

        stream = stream.slice(CONSTANTS.SIZEOF_HEADER);
        for (let i = 0; i < fn; i++) {
            let value: number;
            ++tag;
            value = utils.toWord(stream.slice(CONSTANTS.SIZEOF_FIELD * i));
            if ((value & 1) !== 0) {
                tag += Math.floor(value / 2);
                continue;
            }

            if (tag === 0) {
                if (value !== 0) return null;
                f.name = importString(s, stream.slice(fn * CONSTANTS.SIZEOF_FIELD));
                continue;
            }

            if (value === 0) return null;
            value = Math.floor(value / 2) - 1;
            switch (tag) {
                case 1:
                    if (value >= CONSTANTS.SPROTO_TSTRUCT) {
                        return null;
                    }
                    f.type = value;
                    break;
                case 2:
                    if (f.type === CONSTANTS.SPROTO_TINTEGER) {
                        f.extra = calc_pow(10, value);
                    } else if (f.type === CONSTANTS.SPROTO_TSTRING) {
                        f.extra = value;
                    } else {
                        if (value >= s.type_n) {
                            return null;
                        }

                        if (f.type >= 0) {
                            return null;
                        }

                        f.type = CONSTANTS.SPROTO_TSTRUCT;
                        f.st = value;
                    }
                    break;
                case 3:
                    f.tag = value;
                    break;
                case 4:
                    if (value !== 0) {
                        array = CONSTANTS.SPROTO_TARRAY;
                    }
                    break;
                case 5:
                    f.key = value;
                    break;
                default:
                    return null;
            }
        }
        if (f.tag < 0 || f.type < 0 || f.name === null) {
            return null;
        }
        f.type |= array;
        return result;
    }

    function import_type(s: any, t: SprotoType, stream: number[]): number[] | null {
        let result: number[], fn: number, n: number, maxn: number, last: number;
        const sz = utils.toDword(stream);
        stream = stream.slice(CONSTANTS.SIZEOF_LENGTH);
        result = stream.slice(sz);
        fn = structField(stream, sz);
        if (fn <= 0 || fn > 2) {
            return null;
        }

        for (let i = 0; i < fn * CONSTANTS.SIZEOF_FIELD; i += CONSTANTS.SIZEOF_FIELD) {
            const v = utils.toWord(stream.slice(CONSTANTS.SIZEOF_HEADER + i));
            if (v !== 0) return null;
        }

        t.name = null;
        t.n = 0;
        t.base = 0;
        t.maxn = 0;
        t.f = null;
        stream = stream.slice(CONSTANTS.SIZEOF_HEADER + fn * CONSTANTS.SIZEOF_FIELD);
        t.name = importString(s, stream);

        if (fn === 1) {
            return result;
        }

        stream = stream.slice(utils.toDword(stream) + CONSTANTS.SIZEOF_LENGTH);
        n = countArray(stream);
        if (n < 0) {
            return null;
        }

        stream = stream.slice(CONSTANTS.SIZEOF_LENGTH);
        maxn = n;
        last = -1;
        t.n = n;
        t.f = new Array<SprotoField>();
        for (let i = 0; i < n; i++) {
            let tag: number;
            t.f[i] = {} as SprotoField;
            const f = t.f[i];
            const newStream = import_field(s, f, stream);
            if (newStream === null) {
                return null;
            }
            stream = newStream;

            tag = f.tag;
            if (tag <= last) {
                return null;
            }
            if (tag > last + 1) {
                ++maxn;
            }
            last = tag;
        }
        t.maxn = maxn;
        t.base = t.f[0].tag;
        n = t.f[n - 1].tag - t.base + 1;
        if (n !== t.n) {
            t.base = -1;
        }
        return result;
    }

    /*
    .protocol {
        name 0 : string
        tag 1 : integer
        request 2 : integer
        response 3 : integer
    }
    */
    function import_protocol(s: any, p: SprotoProtocol, stream: number[]): number[] | null {
        let result: number[], sz: number, fn: number, tag: number;
        sz = utils.toDword(stream);
        stream = stream.slice(CONSTANTS.SIZEOF_LENGTH);
        result = stream.slice(sz);
        fn = structField(stream, sz);
        stream = stream.slice(CONSTANTS.SIZEOF_HEADER);
        p.name = null;
        p.tag = -1;
        p.p = new Array<SprotoType | null>();
        p.p[CONSTANTS.SPROTO_REQUEST] = null;
        p.p[CONSTANTS.SPROTO_RESPONSE] = null;
        p.confirm = 0;
        tag = 0;
        for (let i = 0; i < fn; i++, tag++) {
            let value = utils.toWord(stream.slice(CONSTANTS.SIZEOF_FIELD * i));
            if ((value & 1) !== 0) {
                tag += Math.floor(value - 1) / 2;
                continue;
            }
            value = Math.floor(value / 2) - 1;
            switch (i) {
                case 0:
                    if (value !== -1) {
                        return null;
                    }
                    p.name = importString(s, stream.slice(CONSTANTS.SIZEOF_FIELD * fn));
                    break;
                case 1:
                    if (value < 0) {
                        return null;
                    }
                    p.tag = value;
                    break;
                case 2:
                    if (value < 0 || value >= s.type_n)
                        return null;
                    p.p[CONSTANTS.SPROTO_REQUEST] = s.type[value];
                    break;
                case 3:
                    if (value < 0 || value > s.type_n)
                        return null;
                    p.p[CONSTANTS.SPROTO_RESPONSE] = s.type[value];
                    break;
                case 4:
                    p.confirm = value;
                    break;
                default:
                    return null;
            }
        }

        if (p.name === null || p.tag < 0) {
            return null;
        }
        return result;
    }

    function create_from_bundle(s: any, stream: number[], sz: number): any | null {
        let content: number[], typedata: number[], protocoldata: number[];
        const fn = structField(stream, sz);
        if (fn < 0 || fn > 2)
            return null;
        stream = stream.slice(CONSTANTS.SIZEOF_HEADER);
        content = stream.slice(fn * CONSTANTS.SIZEOF_FIELD);

        for (let i = 0; i < fn; i++) {
            const value = utils.toWord(stream.slice(i * CONSTANTS.SIZEOF_FIELD));
            if (value !== 0) {
                return null;
            }

            const n = countArray(content);
            if (n < 0) {
                return null;
            }

            if (i === 0) {
                typedata = content.slice(CONSTANTS.SIZEOF_LENGTH);
                s.type_n = n;
                s.type = new Array<SprotoType>();
            } else {
                protocoldata = content.slice(CONSTANTS.SIZEOF_LENGTH);
                s.protocol_n = n;
                s.proto = new Array<SprotoProtocol>();
            }
            content = content.slice(utils.toDword(content) + CONSTANTS.SIZEOF_LENGTH);
        }

        for (let i = 0; i < s.type_n; i++) {
            s.type[i] = {} as SprotoType;
            const newTypedata = import_type(s, s.type[i], typedata!);
            if (newTypedata === null) {
                return null;
            }
            typedata = newTypedata;
        }

        for (let i = 0; i < s.protocol_n; i++) {
            s.proto[i] = {} as SprotoProtocol;
            const newProtocoldata = import_protocol(s, s.proto[i], protocoldata!);
            if (newProtocoldata === null) {
                return null;
            }
            protocoldata = newProtocoldata;
        }

        return s;
    }

    function sproto_dump(s: any): void {
        console.log(s);
    }

    // query
    function sproto_prototag(sp: any, name: string): number {
        for (let i = 0; i < sp.protocol_n; i++) {
            if (name === sp.proto[i].name) {
                return sp.proto[i].tag;
            }
        }
        return -1;
    }

    // 二分查找
    function query_proto(sp: any, tag: number): SprotoProtocol | null {
        let begin = 0;
        let end = sp.protocol_n;
        while (begin < end) {
            const mid = Math.floor((begin + end) / 2);
            const t = sp.proto[mid].tag;
            if (t === tag) {
                return sp.proto[mid];
            }

            if (tag > t) {
                begin = mid + 1;
            } else {
                end = mid;
            }
        }
        return null;
    }

    function sproto_protoquery(sp: any, proto: number, what: number): SprotoType | null {
        if (what < 0 || what > 1) {
            return null;
        }

        const p = query_proto(sp, proto);
        if (p) {
            return p.p[what];
        }
        return null;
    }

    function sproto_protoresponse(sp: any, proto: number): boolean {
        const p = query_proto(sp, proto);
        return (p !== null && (p.p[CONSTANTS.SPROTO_RESPONSE] || p.confirm));
    }

    function sproto_protoname(sp: any, proto: number): string | null {
        const p = query_proto(sp, proto);
        if (p) {
            return p.name;
        }
        return null;
    }

    function sproto_type(sp: any, type_name: string): SprotoType | null {
        for (let i = 0; i < sp.type_n; i++) {
            if (type_name === sp.type[i].name) {
                return sp.type[i];
            }
        }
        return null;
    }

    function sproto_name(st: SprotoType): string | null {
        return st.name;
    }

    function findtag(st: SprotoType, tag: number): SprotoField | null {
        let begin: number, end: number;
        if (st.base >= 0) {
            tag -= st.base;
            if (tag < 0 || tag > st.n) {
                return null;
            }
            return st.f![tag];
        }

        begin = 0;
        end = st.n;
        while (begin < end) {
            const mid = Math.floor((begin + end) / 2);
            const f = st.f![mid];
            const t = f.tag;
            if (t === tag) {
                return f;
            }
            if (tag > t) {
                begin = mid + 1;
            } else {
                end = mid;
            }
        }
        return null;
    }

    function fill_size(data: number[], data_idx: number, sz: number): number {
        data[data_idx] = sz & 0xff;
        data[data_idx + 1] = (sz >> 8) & 0xff;
        data[data_idx + 2] = (sz >> 16) & 0xff;
        data[data_idx + 3] = (sz >> 24) & 0xff;
        return sz + CONSTANTS.SIZEOF_LENGTH;
    }

    function encode_integer(v: number, data: number[], data_idx: number, size: number): number {
        data[data_idx + 4] = v & 0xff;
        data[data_idx + 5] = (v >> 8) & 0xff;
        data[data_idx + 6] = (v >> 16) & 0xff;
        data[data_idx + 7] = (v >> 24) & 0xff;
        return fill_size(data, data_idx, 4);
    }

    function encode_uint64(v: number, data: number[], data_idx: number, size: number): number {
        data[data_idx + 4] = v & 0xff;
        data[data_idx + 5] = utils.uint64Rshift(v, 8) & 0xff;
        data[data_idx + 6] = utils.uint64Rshift(v, 16) & 0xff;
        data[data_idx + 7] = utils.uint64Rshift(v, 24) & 0xff;
        data[data_idx + 8] = utils.uint64Rshift(v, 32) & 0xff;
        data[data_idx + 9] = utils.uint64Rshift(v, 40) & 0xff;
        data[data_idx + 10] = utils.uint64Rshift(v, 48) & 0xff;
        data[data_idx + 11] = utils.uint64Rshift(v, 56) & 0xff;
        return fill_size(data, data_idx, 8);
    }

    function dec_to_bin_tail(dec: number, pad: number): string {
        let bin = "";
        for (let i = 0; i < pad; i++) {
            dec *= 2;
            if (dec >= 1) {
                dec -= 1;
                bin += "1";
            }
            else {
                bin += "0";
            }
        }
        return bin;
    }

    function dec_to_bin_head(data: number, len: number): string {
        let result = "";
        for (let i = len - 1; i >= 0; i--) {
            const mask = 1 << i;
            if ((mask & data) === 0) {
                result += "0";
            } else {
                result += "1";
            }
        }
        return result;
    }

    function get_double_hex(decString: string | number): string {
        let sign: number;
        let signString: string;
        let exponent: number;
        const decValue = parseFloat(Math.abs(Number(decString)).toString());
        if (decString.toString().charAt(0) === '-') {
            sign = 1;
            signString = "1";
        } else {
            sign = 0;
            signString = "0";
        }
        if (decValue === 0) {
            exponent = 0;
        } else {
            exponent = 1023;
            let tempDecValue = decValue;
            if (tempDecValue >= 2) {
                while (tempDecValue >= 2) {
                    exponent++;
                    tempDecValue /= 2;
                }
            } else if (tempDecValue < 1) {
                while (tempDecValue < 1) {
                    exponent--;
                    tempDecValue *= 2;
                    if (exponent === 0) {
                        break;
                    }
                }
            }
            if (exponent !== 0) tempDecValue -= 1; else tempDecValue /= 2;
            const fractionString = dec_to_bin_tail(tempDecValue, 52);
            const exponentString = dec_to_bin_head(exponent, 11);
            const doubleBinStr = signString + exponentString + fractionString;
            let doubleHexStr = "";
            for (let i = 0, j = 0; i < 8; i++, j += 8) {
                const m = 3 - (j % 4);
                const hexUnit = Number(doubleBinStr[j]) * Math.pow(2, m) + Number(doubleBinStr[j + 1]) * Math.pow(2, m - 1) + Number(doubleBinStr[j + 2]) * Math.pow(2, m - 2) + Number(doubleBinStr[j + 3]) * Math.pow(2, m - 3);
                const hexDecade = Number(doubleBinStr[j + 4]) * Math.pow(2, m) + Number(doubleBinStr[j + 5]) * Math.pow(2, m - 1) + Number(doubleBinStr[j + 6]) * Math.pow(2, m - 2) + Number(doubleBinStr[j + 7]) * Math.pow(2, m - 3);
                doubleHexStr = doubleHexStr + hexUnit.toString(16) + hexDecade.toString(16);
            }
            return doubleHexStr;
        }
        return "";
    }

    function double_to_binary(v: number, data: number[], data_idx: number): number {
        const str = Number(v).toString();
        const hexStr = get_double_hex(str);
        const arr: number[] = [];
        for (let i = 0, j = 0; i < 8; i++, j += 2) {
            const dec = parseInt(hexStr[j], 16) * 16 + parseInt(hexStr[j + 1], 16);
            arr.push(dec);
        }
        arr.reverse();
        for (let i = 0; i < 8; i++) {
            const dec = arr[i];
            data[data_idx + i + 4] = dec;
        }
        return fill_size(data, data_idx, 8);
    }

    function binary_to_double(data: number[]): number {
        const buf = new Uint8Array(data);
        // buf.reverse();
        const buf64 = new Float64Array(buf.buffer);
        return buf64[0];
    }

    function encode_object(cb: (args: SprotoArgs) => number, args: SprotoArgs, data: number[], data_idx: number): number {
        let sz: number;
        args.buffer = data;
        args.buffer_idx = data_idx + CONSTANTS.SIZEOF_LENGTH;
        sz = cb(args);
        if (sz < 0) {
            if (sz === CONSTANTS.SPROTO_CB_NIL) {
                return 0;
            }
            return -1;
        }
        return fill_size(data, data_idx, sz);
    }

    function uint32_to_uint64(negative: boolean, buffer: number[], buffer_idx: number): void {
        if (negative) {
            buffer[buffer_idx + 4] = 0xff;
            buffer[buffer_idx + 5] = 0xff;
            buffer[buffer_idx + 6] = 0xff;
            buffer[buffer_idx + 7] = 0xff;
        } else {
            buffer[buffer_idx + 4] = 0;
            buffer[buffer_idx + 5] = 0;
            buffer[buffer_idx + 6] = 0;
            buffer[buffer_idx + 7] = 0;
        }
    }

    function encode_integer_array(cb: (args: SprotoArgs) => number, args: SprotoArgs, buffer: number[], buffer_idx: number, noarray: { value: number }): number | null {
        let intlen: number, index: number;
        const header_idx = buffer_idx;

        buffer_idx++;
        intlen = 4;
        index = 1;
        noarray.value = 0;

        for (; ;) {
            let sz: number;
            args.value = null;
            args.length = 8;
            args.index = index;
            sz = cb(args);
            if (sz <= 0) {
                if (sz === CONSTANTS.SPROTO_CB_NIL) {
                    break;
                }

                if (sz === CONSTANTS.SPROTO_CB_NOARRAY) {
                    noarray.value = 1;
                    break;
                }

                return null;
            }

            if (sz === 4) {
                const v = args.value;
                buffer[buffer_idx] = v & 0xff;
                buffer[buffer_idx + 1] = (v >> 8) & 0xff;
                buffer[buffer_idx + 2] = (v >> 16) & 0xff;
                buffer[buffer_idx + 3] = (v >> 24) & 0xff;

                if (intlen === 8) {
                    uint32_to_uint64(v & 0x80000000, buffer, buffer_idx);
                }
            } else {
                if (sz !== 8) {
                    return null;
                }

                if (intlen === 4) {
                    buffer_idx += (index - 1) * 4;
                    for (let i = index - 2; i >= 0; i--) {
                        let negative: boolean;
                        for (let j = (1 + i * 8); j < (1 + i * 8 + 4); j++) {
                            buffer[header_idx + j] = buffer[header_idx + j - i * 4];
                        }
                        negative = (buffer[header_idx + 1 + i * 8 + 3] & 0x80) !== 0;
                        uint32_to_uint64(negative, buffer, header_idx + 1 + i * 8);
                    }
                    intlen = 8;
                }

                const v = args.value;
                buffer[buffer_idx] = v & 0xff;
                buffer[buffer_idx + 1] = utils.uint64Rshift(v, 8) & 0xff;
                buffer[buffer_idx + 2] = utils.uint64Rshift(v, 16) & 0xff;
                buffer[buffer_idx + 3] = utils.uint64Rshift(v, 24) & 0xff;
                buffer[buffer_idx + 4] = utils.uint64Rshift(v, 32) & 0xff;
                buffer[buffer_idx + 5] = utils.uint64Rshift(v, 40) & 0xff;
                buffer[buffer_idx + 6] = utils.uint64Rshift(v, 48) & 0xff;
                buffer[buffer_idx + 7] = utils.uint64Rshift(v, 56) & 0xff;
            }

            buffer_idx += intlen;
            index++;
        }

        if (buffer_idx === header_idx + 1) {
            return header_idx;
        }
        buffer[header_idx] = intlen & 0xff;
        return buffer_idx;
    }

    function encode_array(cb: (args: SprotoArgs) => number, args: SprotoArgs, data: number[], data_idx: number): number {
        let sz: number;
        const buffer = data;
        let buffer_idx = data_idx + CONSTANTS.SIZEOF_LENGTH;
        switch (args.type) {
            case CONSTANTS.SPROTO_TINTEGER:
                const noarray = { value: 0 };
                const result = encode_integer_array(cb, args, buffer, buffer_idx, noarray);
                if (result === null) {
                    return -1;
                }
                buffer_idx = result;

                if (noarray.value !== 0) {
                    return 0;
                }
                break;
            case CONSTANTS.SPROTO_TBOOLEAN:
                args.index = 1;
                for (; ;) {
                    const v = 0;
                    args.value = v;
                    args.length = 4;
                    sz = cb(args);
                    if (sz < 0) {
                        if (sz === CONSTANTS.SPROTO_CB_NIL)
                            break;
                        if (sz === CONSTANTS.SPROTO_CB_NOARRAY)
                            return 0;
                        return -1;
                    }

                    if (sz < 1) {
                        return -1;
                    }

                    buffer[buffer_idx] = (args.value === 1) ? 1 : 0;
                    buffer_idx++;
                    ++args.index!;
                }
                break;
            default:
                args.index = 1;
                for (; ;) {
                    args.buffer = buffer;
                    args.buffer_idx = buffer_idx + CONSTANTS.SIZEOF_LENGTH;
                    sz = cb(args);
                    if (sz < 0) {
                        if (sz === CONSTANTS.SPROTO_CB_NIL) {
                            break;
                        }

                        if (sz === CONSTANTS.SPROTO_CB_NOARRAY) {
                            return 0;
                        }

                        return -1;
                    }

                    fill_size(buffer, buffer_idx, sz);
                    buffer_idx += CONSTANTS.SIZEOF_LENGTH + sz;
                    ++args.index!;
                }
                break;
        }

        sz = buffer_idx - (data_idx + CONSTANTS.SIZEOF_LENGTH);
        // if (sz == 0) {
        //     return 0;
        // }

        return fill_size(buffer, data_idx, sz);
    }

    function decode_array_object(cb: (args: SprotoArgs) => number, args: SprotoArgs, stream: number[], sz: number): number {
        let hsz: number;
        let index = 1;
        while (sz > 0) {
            if (sz < CONSTANTS.SIZEOF_LENGTH) {
                return -1;
            }

            hsz = utils.toDword(stream);
            stream = stream.slice(CONSTANTS.SIZEOF_LENGTH);
            sz -= CONSTANTS.SIZEOF_LENGTH;
            if (hsz > sz) {
                return -1;
            }

            args.index = index;
            args.value = stream;
            args.length = hsz;
            if (cb(args) !== 0) {
                return -1;
            }

            sz -= hsz;
            stream = stream.slice(hsz);
            ++index;
        }
        return 0;
    }

    function hi_low_uint64(low: number, hi: number): number {
        return utils.hiLowUint64(low, hi);
    }

    function decode_array(cb: (args: SprotoArgs) => number, args: SprotoArgs, stream: number[]): number {
        const sz = utils.toDword(stream);
        const type = args.type;
        if (sz === 0) {
            args.index = -1;
            args.value = null;
            args.length = 0;
            cb(args);
            return 0;
        }

        stream = stream.slice(CONSTANTS.SIZEOF_LENGTH);
        switch (type) {
            case CONSTANTS.SPROTO_TINTEGER:
                const len = stream[0];
                stream = stream.slice(1);
                let remainingSz = sz - 1;
                if (len === 4) {
                    if (remainingSz % 4 !== 0) {
                        return -1;
                    }
                    for (let i = 0; i < Math.floor(remainingSz / 4); i++) {
                        const value = utils.expand64(utils.toDword(stream.slice(i * 4)));
                        args.index = i + 1;
                        args.value = value;
                        args.length = 8;
                        cb(args);
                    }
                } else if (len === 8) {
                    if (remainingSz % 8 !== 0) {
                        return -1;
                    }

                    for (let i = 0; i < Math.floor(remainingSz / 8); i++) {
                        const low = utils.toDword(stream.slice(i * 8));
                        const hi = utils.toDword(stream.slice(i * 8 + 4));
                        const value = hi_low_uint64(low, hi);
                        args.index = i + 1;
                        args.value = value;
                        args.length = 8;
                        cb(args);
                    }
                } else {
                    return -1;
                }
                break;
            case CONSTANTS.SPROTO_TBOOLEAN:
                for (let i = 0; i < sz; i++) {
                    const value = stream[i];
                    args.index = i + 1;
                    args.value = value;
                    args.length = 8;
                    cb(args);
                }
                break;
            case CONSTANTS.SPROTO_TSTRING:
            case CONSTANTS.SPROTO_TSTRUCT:
                return decode_array_object(cb, args, stream, sz);
            default:
                return -1;
        }
        return 0;
    }

    function pack_seg(src: number[], src_idx: number, buffer: number[], buffer_idx: number, sz: number, n: number): number {
        let header = 0;
        let notzero = 0;
        const obuffer_idx = buffer_idx;
        buffer_idx++;
        sz--;
        if (sz < 0) {
            return 10; // Return error size when buffer is too small
        }

        for (let i = 0; i < 8; i++) {
            if (src[src_idx + i] !== 0) {
                notzero++;
                header |= 1 << i;
                if (sz > 0) {
                    buffer[buffer_idx] = src[src_idx + i];
                    ++buffer_idx;
                    --sz;
                }
            }
        }

        if ((notzero === 7 || notzero === 6) && n > 0) {
            notzero = 8;
        }

        if (notzero === 8) {
            if (n > 0) {
                return 8;
            } else {
                return 10;
            }
        }

        buffer[obuffer_idx] = header;

        return notzero + 1;
    }

    function write_ff(src: number[], src_idx: number, des: number[], dest_idx: number, n: number): void {
        const align8_n = (n + 7) & (~7);
        des[dest_idx] = 0xff;
        des[dest_idx + 1] = Math.floor(align8_n / 8) - 1;

        for (let i = 0; i < n; i++) {
            des[dest_idx + i + 2] = src[src_idx + i];
        }

        for (let i = 0; i < align8_n - n; i++) {
            des[dest_idx + n + 2 + i] = 0;
        }
    }

    function sproto_pack(srcv: number[], src_idx: number, bufferv: number[], buffer_idx: number): number {
        const tmp = new Array<number>(8);
        let ff_srcstart: number[], ff_desstart: number[];
        let ff_srcstart_idx = 0;
        let ff_desstart_idx = 0;
        let ff_n = 0;
        let size = 0;
        let src = srcv;
        const buffer = bufferv;
        const srcsz = srcv.length;
        let bufsz = 1 << 30;

        for (let i = 0; i < srcsz; i += 8) {
            let n: number;
            const padding = i + 8 - srcsz;
            if (padding > 0) {
                for (let j = 0; j < 8 - padding; j++) {
                    tmp[j] = src[src_idx + j];
                }

                for (let j = 0; j < padding; j++) {
                    tmp[7 - j] = 0;
                }

                src = tmp;
                src_idx = 0;
            }

            n = pack_seg(src, src_idx, buffer, buffer_idx, bufsz, ff_n);
            bufsz -= n;
            if (n === 10) {
                ff_srcstart = src;
                ff_srcstart_idx = src_idx;
                ff_desstart = buffer;
                ff_desstart_idx = buffer_idx;
                ff_n = 1;
            } else if (n === 8 && ff_n > 0) {
                ++ff_n;
                if (ff_n === 256) {
                    if (bufsz >= 0) {
                        write_ff(ff_srcstart!, ff_srcstart_idx, ff_desstart!, ff_desstart_idx, 256 * 8);
                    }
                    ff_n = 0;
                }
            } else {
                if (ff_n > 0) {
                    if (bufsz >= 0) {
                        write_ff(ff_srcstart!, ff_srcstart_idx, ff_desstart!, ff_desstart_idx, ff_n * 8);
                    }
                    ff_n = 0;
                }
            }
            src_idx += 8;
            buffer_idx += n;
            size += n;
        }
        if (bufsz >= 0) {
            if (ff_n === 1) {
                write_ff(ff_srcstart!, ff_srcstart_idx, ff_desstart!, ff_desstart_idx, 8);
            } else if (ff_n > 1) {
                write_ff(ff_srcstart!, ff_srcstart_idx, ff_desstart!, ff_desstart_idx, srcsz - ff_srcstart_idx);
            }
            if (buffer.length > size) {
                for (let i = size; i < buffer.length; i++) {
                    buffer[i] = 0;
                }
            }
        }
        return size;
    }

    function sproto_unpack(srcv: number[], src_idx: number, bufferv: number[], buffer_idx: number): number {
        const src = srcv;
        const buffer = bufferv;
        let size = 0;
        let srcsz = srcv.length;
        let bufsz = 1 << 30;
        while (srcsz > 0) {
            const header = src[src_idx];
            --srcsz;
            ++src_idx;
            if (header === 0xff) {
                let n: number;
                if (srcsz < 0) {
                    return -1;
                }

                n = (src[src_idx] + 1) * 8;
                if (srcsz < n + 1)
                    return -1;

                srcsz -= n + 1;
                ++src_idx;
                if (bufsz >= n) {
                    for (let i = 0; i < n; i++) {
                        buffer[buffer_idx + i] = src[src_idx + i];
                    }
                }

                bufsz -= n;
                buffer_idx += n;
                src_idx += n;
                size += n;
            } else {
                for (let i = 0; i < 8; i++) {
                    const nz = (header >>> i) & 1;
                    if (nz !== 0) {
                        if (srcsz < 0)
                            return -1;

                        if (bufsz > 0) {
                            buffer[buffer_idx] = src[src_idx];
                            --bufsz;
                            ++buffer_idx;
                        }

                        ++src_idx;
                        --srcsz;
                    } else {
                        if (bufsz > 0) {
                            buffer[buffer_idx] = 0;
                            --bufsz;
                            ++buffer_idx;
                        }
                    }
                    ++size;
                }
            }
        }
        return size;
    }

    ///////////////////////导出方法///////////////////////////////

    api.pack = (inbuf: number[]): number[] => {
        const srcIdx = 0;
        const buffer = new Array<number>();
        const bufferIdx = 0;
        const size = sproto_pack(inbuf, srcIdx, buffer, bufferIdx);
        return buffer;
    };

    api.unpack = (inbuf: number[]): number[] => {
        const srcIdx = 0;
        const buffer = new Array<number>();
        const bufferIdx = 0;
        const size = sproto_unpack(inbuf, srcIdx, buffer, bufferIdx);
        return buffer;
    };

    api.createNew = (binsch: number[]): SprotoInstance | null => {
        const s: any = {};
        const result = new Object();
        const __session = new Array<any>();
        let enbuffer: number[];
        s.type_n = 0;
        s.protocol_n = 0;
        s.type = null;
        s.proto = null;
        s.tcache = new Map<string, SprotoType>();
        s.pcache = new Map<string | number, any>();
        const sp = create_from_bundle(s, binsch, binsch.length);
        if (sp === null) return null;

        function sproto_encode(st: SprotoType, buffer: number[], buffer_idx: number, cb: (args: SprotoArgs) => number, ud: any): number {
            const args: SprotoArgs = {} as SprotoArgs;
            const header_idx = buffer_idx;
            let data_idx = buffer_idx;
            const header_sz = CONSTANTS.SIZEOF_HEADER + st.maxn * CONSTANTS.SIZEOF_FIELD;
            let index: number, lasttag: number, datasz: number;

            args.ud = ud;
            data_idx = header_idx + header_sz;
            index = 0;
            lasttag = -1;
            for (let i = 0; i < st.n; i++) {
                const f = st.f![i];
                const type = f.type;
                let value = 0;
                let sz = -1;
                args.tagname = f.name!;
                args.tagid = f.tag;
                if (f.st !== null) {
                    args.subtype = sp.type[f.st];
                } else {
                    args.subtype = null;
                }

                args.mainindex = f.key;
                args.extra = f.extra;
                const type_ret = type & CONSTANTS.SPROTO_TARRAY;
                if ((type & CONSTANTS.SPROTO_TARRAY) !== 0) {
                    args.type = type & ~CONSTANTS.SPROTO_TARRAY;
                    sz = encode_array(cb, args, buffer, data_idx);
                } else {
                    args.type = type;
                    args.index = 0;
                    switch (type) {
                        case CONSTANTS.SPROTO_TDOUBLE:
                        case CONSTANTS.SPROTO_TINTEGER:
                        case CONSTANTS.SPROTO_TBOOLEAN:
                            args.value = 0;
                            args.length = 8;
                            args.buffer = buffer;
                            args.buffer_idx = buffer_idx;
                            sz = cb(args);
                            if (sz < 0) {
                                if (sz === CONSTANTS.SPROTO_CB_NIL)
                                    continue;
                                if (sz === CONSTANTS.SPROTO_CB_NOARRAY)
                                    return 0; // no array, don't encode it
                                return -1; // sz == CONSTANTS.SPROTO_CB_ERROR
                            }
                            if (sz === 4) {
                                if (args.value < 0x7fff) {
                                    value = (args.value + 1) * 2;
                                    sz = 2;
                                } else {
                                    sz = encode_integer(args.value, buffer, data_idx, sz);
                                }
                            } else if (sz === 8) {
                                if (type === CONSTANTS.SPROTO_TDOUBLE) {
                                    sz = double_to_binary(args.value, buffer, data_idx);
                                } else {
                                    sz = encode_uint64(args.value, buffer, data_idx, sz);
                                }
                            } else {
                                return -1;
                            }
                            break;
                        case CONSTANTS.SPROTO_TSTRUCT:
                        case CONSTANTS.SPROTO_TSTRING:
                            sz = encode_object(cb, args, buffer, data_idx);
                            break;
                    }
                }

                if (sz < 0)
                    return -1;

                if (sz > 0) {
                    let record_idx: number, tag: number;
                    if (value === 0) {
                        data_idx += sz;
                    }
                    record_idx = header_idx + CONSTANTS.SIZEOF_HEADER + CONSTANTS.SIZEOF_FIELD * index;
                    tag = f.tag - lasttag - 1;
                    if (tag > 0) {
                        tag = (tag - 1) * 2 + 1;
                        if (tag > 0xffff)
                            return -1;
                        buffer[record_idx] = tag & 0xff;
                        buffer[record_idx + 1] = (tag >> 8) & 0xff;
                        ++index;
                        record_idx += CONSTANTS.SIZEOF_FIELD;
                    }
                    ++index;
                    buffer[record_idx] = value & 0xff;
                    buffer[record_idx + 1] = (value >> 8) & 0xff;
                    lasttag = f.tag;
                }
            }

            buffer[header_idx] = index & 0xff;
            buffer[header_idx + 1] = (index >> 8) & 0xff;

            datasz = data_idx - (header_idx + header_sz);
            data_idx = header_idx + header_sz;
            if (index !== st.maxn) {
                const v = buffer.slice(data_idx, data_idx + datasz);
                for (let s = 0; s < v.length; s++) {
                    buffer[header_idx + CONSTANTS.SIZEOF_HEADER + index * CONSTANTS.SIZEOF_FIELD + s] = v[s];
                }
                const remove_size = buffer.length - (header_idx + CONSTANTS.SIZEOF_HEADER + index * CONSTANTS.SIZEOF_FIELD + v.length);
                buffer.splice(header_idx + CONSTANTS.SIZEOF_HEADER + index * CONSTANTS.SIZEOF_FIELD + v.length, buffer.length);
            }

            return CONSTANTS.SIZEOF_HEADER + index * CONSTANTS.SIZEOF_FIELD + datasz;
        }

        function encode(args: SprotoArgs): number {
            const self = args.ud;
            if (self.deep >= CONSTANTS.ENCODE_DEEPLEVEL) {
                alert("table is too deep");
                return -1;
            }

            if (self.indata[args.tagname!] === null || self.indata[args.tagname!] === undefined) {
                return CONSTANTS.SPROTO_CB_NIL;
            }

            let target: any = null;
            if (args.index! > 0) {
                if (args.tagname !== self.array_tag) {
                    self.array_tag = args.tagname;

                    const tagType = typeof (self.indata[args.tagname!]);
                    if (typeof (self.indata[args.tagname!]) !== "object") {
                        self.array_index = 0;
                        return CONSTANTS.SPROTO_CB_NIL;
                    }

                    if (self.indata[args.tagname!] === null || self.indata[args.tagname!] === undefined) {
                        self.array_index = 0;
                        return CONSTANTS.SPROTO_CB_NOARRAY;
                    }
                }
                target = self.indata[args.tagname!][args.index! - 1];
                if (target === null) {
                    return CONSTANTS.SPROTO_CB_NIL;
                }
            } else {
                target = self.indata[args.tagname!];
            }

            switch (args.type) {
                case CONSTANTS.SPROTO_TINTEGER:
                    {
                        let v: number, vh: number;
                        if (args.extra! > 0) {
                            const vn = target;
                            v = Math.floor(vn * args.extra! + 0.5);
                        } else {
                            v = target;
                        }
                        vh = utils.uint64Rshift(v, 31);
                        if (vh === 0 || vh === -1) {
                            args.value = v >>> 0;
                            return 4;
                        } else {
                            args.value = v;
                            return 8;
                        }
                    }
                case CONSTANTS.SPROTO_TDOUBLE:
                    {
                        args.value = target;
                        return 8;
                    }
                case CONSTANTS.SPROTO_TBOOLEAN:
                    {
                        if (target === true) {
                            args.value = 1;
                        } else if (target === false) {
                            args.value = 0;
                        }
                        return 4;
                    }
                case CONSTANTS.SPROTO_TSTRING:
                    {
                        let arr: number[];
                        if (args.extra) { //传数组进来
                            arr = target;
                        } else {
                            const str = target;
                            arr = utils.string2utf8(str);
                        }

                        const sz = arr.length;
                        if (sz > args.length!) {
                            args.length = sz;
                        }
                        for (let i = 0; i < arr.length; i++) {
                            args.buffer![args.buffer_idx! + i] = arr[i];
                        }
                        return sz;
                    }
                case CONSTANTS.SPROTO_TSTRUCT:
                    {
                        const sub: any = {};
                        sub.st = args.subtype;
                        sub.deep = self.deep + 1;
                        sub.indata = target;
                        const r = sproto_encode(args.subtype!, args.buffer!, args.buffer_idx!, encode, sub);
                        if (r < 0) {
                            return CONSTANTS.SPROTO_CB_ERROR;
                        }
                        return r;
                    }
                default:
                    alert("Invalid filed type " + args.type);
                    return CONSTANTS.SPROTO_CB_ERROR;
            }
        }

        function sproto_decode(st: SprotoType, data: number[], size: number, cb: (args: SprotoArgs) => number, ud: any): number {
            const args: SprotoArgs = {} as SprotoArgs;
            const total = size;
            let stream: number[], datastream: number[], fn: number, tag: number;
            if (size < CONSTANTS.SIZEOF_HEADER) return -1;
            stream = data.slice(0);
            fn = utils.toWord(stream);
            stream = stream.slice(CONSTANTS.SIZEOF_HEADER);
            size -= CONSTANTS.SIZEOF_HEADER;
            if (size < fn * CONSTANTS.SIZEOF_FIELD)
                return -1;
            datastream = stream.slice(fn * CONSTANTS.SIZEOF_FIELD);
            size -= fn * CONSTANTS.SIZEOF_FIELD;
            args.ud = ud;

            tag = -1;
            for (let i = 0; i < fn; i++) {
                let currentdata: number[] | null = null;
                let f: SprotoField | null = null;
                let value = utils.toWord(stream.slice(i * CONSTANTS.SIZEOF_FIELD));
                ++tag;
                if ((value & 1) !== 0) {
                    tag += Math.floor(value / 2);
                    continue;
                }
                value = Math.floor(value / 2) - 1;
                currentdata = datastream.slice(0);
                if (value < 0) {
                    let sz: number;
                    if (size < CONSTANTS.SIZEOF_LENGTH) {
                        return -1;
                    }
                    sz = utils.toDword(datastream);
                    if (size < sz + CONSTANTS.SIZEOF_LENGTH) {
                        return -1;
                    }
                    datastream = datastream.slice(sz + CONSTANTS.SIZEOF_LENGTH);
                    size -= sz + CONSTANTS.SIZEOF_LENGTH;
                }
                f = findtag(st, tag);
                if (f === null) {
                    continue;
                }
                args.tagname = f.name!;
                args.tagid = f.tag;
                args.type = f.type & ~CONSTANTS.SPROTO_TARRAY;
                if (f.st !== null) {
                    args.subtype = sp.type[f.st];
                } else {
                    args.subtype = null;
                }

                args.index = 0;
                args.mainindex = f.key;
                args.extra = f.extra;
                if (value < 0) {
                    if ((f.type & CONSTANTS.SPROTO_TARRAY) !== 0) {
                        if (decode_array(cb, args, currentdata)) {
                            return -1;
                        }
                    } else {
                        switch (f.type) {
                            case CONSTANTS.SPROTO_TDOUBLE:
                                {
                                    const sz = utils.toDword(currentdata);
                                    if (sz === 8) {
                                        const doubleBin = currentdata.slice(CONSTANTS.SIZEOF_LENGTH, CONSTANTS.SIZEOF_LENGTH + 8);
                                        args.value = binary_to_double(doubleBin);
                                        args.length = 8;
                                        cb(args);
                                    } else {
                                        return -1;
                                    }
                                    break;
                                }
                            case CONSTANTS.SPROTO_TINTEGER:
                                {
                                    const sz = utils.toDword(currentdata);
                                    if (sz === 4) {
                                        const v = utils.expand64(utils.toDword(currentdata.slice(CONSTANTS.SIZEOF_LENGTH)));
                                        args.value = v;
                                        args.length = 8;
                                        cb(args);
                                    } else if (sz === 8) {
                                        const low = utils.toDword(currentdata.slice(CONSTANTS.SIZEOF_LENGTH));
                                        const hi = utils.toDword(currentdata.slice(CONSTANTS.SIZEOF_LENGTH + 4));
                                        const v = utils.hiLowUint64(low, hi);
                                        args.value = v;
                                        args.length = 8;
                                        cb(args);
                                    } else {
                                        return -1;
                                    }
                                    break;
                                }
                            case CONSTANTS.SPROTO_TSTRING:
                            case CONSTANTS.SPROTO_TSTRUCT:
                                {
                                    const sz = utils.toDword(currentdata);
                                    args.value = currentdata.slice(CONSTANTS.SIZEOF_LENGTH);
                                    args.length = sz;
                                    if (cb(args) !== 0) {
                                        return -1;
                                    }
                                    break;
                                }
                            default:
                                return -1;
                        }
                    }
                } else if (f.type !== CONSTANTS.SPROTO_TINTEGER && f.type !== CONSTANTS.SPROTO_TBOOLEAN) {
                    return -1;
                } else {
                    args.value = value;
                    args.length = 8;
                    cb(args);
                }
            }
            return total - size;
        }

        function decode(args: SprotoArgs): number {
            const self = args.ud;
            let value: any;
            if (self.deep >= CONSTANTS.ENCODE_DEEPLEVEL) {
                alert("the table is too deep");
            }

            if (args.index !== 0) {
                if (args.tagname !== self.array_tag) {
                    self.array_tag = args.tagname;
                    self.result[args.tagname!] = new Array<any>();
                    if (args.index! < 0) {
                        return 0;
                    }
                }
            }

            switch (args.type) {
                case CONSTANTS.SPROTO_TINTEGER:
                    {
                        if (args.extra) {
                            const v = args.value;
                            const vn = v;
                            value = vn / args.extra;
                        } else {
                            value = args.value;
                        }
                        break;
                    }
                case CONSTANTS.SPROTO_TDOUBLE:
                    {
                        value = args.value;
                        break;
                    }
                case CONSTANTS.SPROTO_TBOOLEAN:
                    {
                        if (args.value === 1) {
                            value = true;
                        } else if (args.value === 0) {
                            value = false;
                        } else {
                            value = null;
                        }
                        break;
                    }
                case CONSTANTS.SPROTO_TSTRING:
                    {
                        const arr = new Array<number>();
                        for (let i = 0; i < args.length!; i++) {
                            arr.push(args.value[i]);
                        }
                        if (args.extra) {
                            value = arr;
                        } else {
                            value = utils.utf82string(arr);
                        }

                        break;
                    }
                case CONSTANTS.SPROTO_TSTRUCT:
                    {
                        const sub: any = {};
                        let r: number;
                        sub.deep = self.deep + 1;
                        sub.array_index = 0;
                        sub.array_tag = null;
                        sub.result = {};
                        if (args.mainindex! >= 0) {
                            sub.mainindex_tag = args.mainindex;
                            r = sproto_decode(args.subtype!, args.value, args.length!, decode, sub);
                            if (r < 0 || r !== args.length) {
                                return r;
                            }
                            value = sub.result;
                            break;
                        } else {
                            sub.mainindex_tag = -1;
                            sub.key_index = 0;
                            r = sproto_decode(args.subtype!, args.value, args.length!, decode, sub);
                            if (r < 0) {
                                return CONSTANTS.SPROTO_CB_ERROR;
                            }
                            if (r !== args.length!)
                                return r;
                            value = sub.result;
                            break;
                        }
                    }
                default:
                    alert("Invalid type");
            }

            if (args.index! > 0) {
                self.result[args.tagname!][args.index! - 1] = value;
            } else {
                self.result[args.tagname!] = value;
            }

            return 0;
        }

        function querytype(sp: any, typename: string): SprotoType | null {
            if (sp.tcache.has(typename)) {
                return sp.tcache.get(typename);
            }
            const typeinfo = sproto_type(sp, typename);
            if (typeinfo) {
                sp.tcache.set(typename, typeinfo);
                return typeinfo;
            }
            return null;
        }

        function protocol(sp: any, pname: string | number): any | null {
            let tag: number | null = null;
            let name: string | null = null;

            if (typeof (pname) === "number") {
                tag = pname;
                name = sproto_protoname(sp, pname);
                if (!name)
                    return null;
            } else {
                tag = sproto_prototag(sp, pname);
                name = pname;

                if (tag === -1) return null;
            }

            const request = sproto_protoquery(sp, tag, CONSTANTS.SPROTO_REQUEST);
            const response = sproto_protoquery(sp, tag, CONSTANTS.SPROTO_RESPONSE);
            return {
                tag: tag,
                name: name,
                request: request,
                response: response
            };
        }

        function queryproto(sp: any, pname: string | number): any | null {
            if (sp.pcache.has(pname)) {
                return sp.pcache.get(pname);
            }
            const protoinfo = protocol(sp, pname);
            if (protoinfo) {
                sp.pcache.set(protoinfo.name, protoinfo);
                sp.pcache.set(protoinfo.tag, protoinfo);
                return protoinfo;
            }
            return null;
        }

        sp.queryproto = function (protocolName: string | number): any {
            return queryproto(sp, protocolName);
        };
        sp.dump = function (): void {
            sproto_dump(this);
        };

        sp.objlen = function (type: string | number | SprotoType, inbuf: number[]): number | null {
            let st: SprotoType | null = null;
            if (typeof (type) === "string" || typeof (type) === "number") {
                st = querytype(sp, type as string);
                if (st === null) {
                    return null;
                }
            } else {
                st = type;
            }

            const ud: any = {};
            ud.array_tag = null;
            ud.deep = 0;
            ud.result = {};
            return sproto_decode(st, inbuf, inbuf.length, decode, ud);
        };

        sp.encode = function (type: string | number | SprotoType, indata: any): number[] | null {
            const self: any = {};

            let st: SprotoType | null = null;
            if (typeof (type) === "string" || typeof (type) === "number") {
                st = querytype(sp, type as string);
                if (st === null)
                    return null;
            } else {
                st = type;
            }

            const tbl_index = 2;
            const enbuffer = new Array<number>();
            const buffer_idx = 0;
            self.st = st;
            self.tbl_index = tbl_index;
            self.indata = indata;
            for (; ;) {
                self.array_tag = null;
                self.array_index = 0;
                self.deep = 0;
                self.iter_index = tbl_index + 1;
                const r = sproto_encode(st, enbuffer, buffer_idx, encode, self);
                if (r < 0) {
                    return null;
                } else {
                    return enbuffer;
                }
            }
        };

        sp.decode = function (type: string | number | SprotoType, inbuf: number[]): any | null {
            let st: SprotoType | null = null;
            if (typeof (type) === "string" || typeof (type) === "number") {
                st = querytype(sp, type as string);
                if (st === null) {
                    return null;
                }
            } else {
                st = type;
            }

            const buffer = inbuf;
            const sz = inbuf.length;
            const ud: any = {};
            ud.array_tag = null;
            ud.deep = 0;
            ud.result = {};
            const r = sproto_decode(st, buffer, sz, decode, ud);
            if (r < 0) {
                return null;
            }

            return ud.result;
        };

        sp.pack = function (inbuf: number[]): number[] {
            return api.pack(inbuf);
        };

        sp.unpack = function (inbuf: number[]): number[] {
            return api.unpack(inbuf);
        };

        sp.pencode = function (type: string | number | SprotoType, inbuf: any): number[] | null {
            const obuf = sp.encode(type, inbuf);
            if (obuf === null) {
                return null;
            }
            return sp.pack(obuf);
        };

        sp.pdecode = function (type: string | number | SprotoType, inbuf: number[]): any | null {
            const obuf = sp.unpack(inbuf);
            if (obuf === null) {
                return null;
            }
            return sp.decode(type, obuf);
        };

        sp.host = function (packagename?: string): any {
            function cla(packagename?: string): void {
                const pkgName = packagename ? packagename : "package";
                (this as any).proto = sp;
                (this as any).package = querytype(sp, pkgName);
                (this as any).package = (this as any).package ? (this as any).package : "package";
                (this as any).session = {};
            }
            cla.prototype = host;

            return new (cla as any)(packagename);
        };

        host.attach = function (sp: any): (name: string, args?: any, session?: any) => number[] {
            this.attachsp = sp;
            const self = this;
            return (name: string, args?: any, session?: any): number[] => {
                const proto = queryproto(sp, name);

                headerTemp.type = proto.tag;
                headerTemp.session = session;

                const headerbuffer = sp.encode(self.package, headerTemp);
                if (session) {
                    self.session[session] = proto.response ? proto.response : true;
                }

                if (args) {
                    const databuffer = sp.encode(proto.request, args);
                    return sp.pack(utils.arrayconcat(headerbuffer, databuffer));
                } else {
                    return sp.pack(headerbuffer);
                }
            };
        };

        function gen_response(self: any, response: SprotoType | null, session: any): (args?: any) => number[] {
            return function (args?: any): number[] {
                headerTemp.type = null;
                headerTemp.session = session;
                const headerbuffer = self.proto.encode(self.package, headerTemp);
                if (response) {
                    const databuffer = self.proto.encode(response, args);
                    return self.proto.pack(utils.arrayconcat(headerbuffer, databuffer));
                } else {
                    return self.proto.pack(headerbuffer);
                }
            };
        }

        host.dispatch = function (buffer: number[]): any {
            const sp = this.proto;
            const bin = sp.unpack(buffer);
            headerTemp.type = null;
            headerTemp.session = null;
            headerTemp = sp.decode(this.package, bin);

            const used_sz = sp.objlen(this.package, bin);
            const leftbuffer = bin.slice(used_sz, bin.length);
            if (headerTemp.type) {
                const proto = queryproto(sp, headerTemp.type);

                let result: any;
                if (proto.request) {
                    result = sp.decode(proto.request, leftbuffer);
                }

                if (headerTemp.session) {
                    return {
                        type: "REQUEST",
                        pname: proto.name,
                        result: result,
                        responseFunc: gen_response(this, proto.response, headerTemp.session),
                        session: headerTemp.session,
                    };
                } else {
                    return {
                        type: "REQUEST",
                        pname: proto.name,
                        result: result,
                    };
                }
            } else {
                const attachSp = this.attachsp;
                const session = headerTemp.session;
                const response = this.session[session];
                delete this.session[session];

                if (response === true) {
                    return {
                        type: "RESPONSE",
                        session: session,
                    };
                } else {
                    const result = attachSp.decode(response, leftbuffer);
                    return {
                        type: "RESPONSE",
                        session: session,
                        result: result,
                    };
                }
            }
        };

        return sp as SprotoInstance;
    };

    return api;
})();

export default sproto;