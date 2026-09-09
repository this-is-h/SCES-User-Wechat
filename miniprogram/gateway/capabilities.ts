/**
 * 能力位:UI 降级只依据 capabilities,不依据 MODE。
 * CAPABILITIES 定义于 config/runtime.ts(在线版自持常量),此处仅补类型。
 */
import { CAPABILITIES } from '../config/runtime'

export interface Capabilities {
  mode: 'offline' | 'online'
  profileId: string
  /** 单位来源:bundled 包内 / server 服务端。 */
  source: 'bundled' | 'server'
  /** 截止时间权威:local-advisory 仅本地提示 / server 服务端强制。 */
  deadlineAuthority: 'local-advisory' | 'server'
  /** 审核进度查询(离线关闭)。 */
  statusQuery: boolean
  /** 排名展示入口(离线关闭)。 */
  rankingView: boolean
  /** 远端锁定重复导出(离线关闭,本地始终可重导)。 */
  remoteLock: boolean
  /** 本地数据保护(local-vault)是否启用。 */
  localVault: boolean
}

export const capabilities = CAPABILITIES as Capabilities
