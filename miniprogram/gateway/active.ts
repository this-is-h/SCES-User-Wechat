/**
 * 网关选择（仓库拆分前由 sces-management build-profile.mjs 生成并 gitignore，
 * 拆分后本仓自持默认值）。offline 与 online 实现见 ./offline / ./online。
 *
 * 切换在线模式：改此文件为 './online'，并同步 config/runtime.ts 的 CAPABILITIES
 * 与 SERVER_BASE_URL。
 */
export { gateway } from './offline'