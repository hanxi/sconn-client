/**
 * SConn WebSocket Client Library
 * 
 * 一个基于状态机的WebSocket连接管理库，支持断线重连和数据缓存
 */

// 导出Buffer类
export { Buffer, endianFormat } from './buffer';

// 导出基础WebSocket连接类
export { WSClient, WSConnection, connect as connConnect, type IWSConnection } from './conn';

// 导出高级状态机连接类
export { SConn, connect as sconnConnect, Cache } from './sconn';

// 导出Network类
export { Network } from './network';