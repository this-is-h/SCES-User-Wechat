// 学生端运行时常量（仓库拆分后自持默认值，保留当前联调发布档）。
// 切换在线模式/换发档：改 CAPABILITIES/SERVER_BASE_URL/PROFILE_ID；VAULT_SECRET 轮换见 CLAUDE。
export const MODE = 'offline'
export const PROFILE_ID = 'offline-2026s1'
export const SERVER_BASE_URL = ''
export const CAPABILITIES = {
  mode: 'offline',
  profileId: 'offline-2026s1',
  source: 'bundled',
  deadlineAuthority: 'local-advisory',
  statusQuery: false,
  rankingView: false,
  remoteLock: false,
  localVault: true
}
export const VAULT_SECRET = 'bE1ONk9o+cVyB0JwF4PPWH3YKcE1yPxCfN3XdnxId8E='
