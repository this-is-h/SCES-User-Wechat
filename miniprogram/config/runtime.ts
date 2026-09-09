// 学生端运行时常量（在线版）。数据面：本地密封存储 + .dyf 加密文件交付；
// 单位/批次/配置/状态经 gateway 与服务端同步（SCES-Server / SCES-Server-Vercel）。
// 本地保护密钥（local-vault）为 per-install 生成并落本地 storage，不随代码分发。
export const MODE = 'online'
export const PROFILE_ID = 'online-2026s1'
export const SERVER_BASE_URL = 'https://api.sces.thisish.cn'
export const CAPABILITIES = {
  mode: 'online',
  profileId: 'online-2026s1',
  source: 'server',
  deadlineAuthority: 'server',
  statusQuery: true,
  rankingView: false,
  remoteLock: true,
  localVault: true
}
