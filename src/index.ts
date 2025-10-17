/**
 * SConn WebSocket Client Library
 * 
 * 一个基于状态机的WebSocket连接管理库，支持断线重连和数据缓存
 */

// 导出Buffer类
export { Buffer, endianFormat } from './buffer';

// 导出基础WebSocket连接类
export { WSClient, WSConnection, connect, type IWSConnection } from './conn';

// 导出高级状态机连接类
export { SConn, connectHostSConn, Cache } from './sconn';