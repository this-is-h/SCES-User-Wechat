/**
 * 网关选择（在线版唯一实现）。数据面仍为本地加密 + .dyf 文件交付；
 * 单位/批次/配置/状态由服务端接口提供，实现见 ./online。
 */
export { gateway } from './online'
