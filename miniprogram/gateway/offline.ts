/**
 * 离线网关实现:数据来源为构建期编译进包的 offline/**(决策 #42)。
 * - 单位树:offline/units.js(module.exports;微信 require 不支持 .json)
 * - 批次+配置:offline/index.ts 的静态 OFFLINE_INDEX(微信不支持 require(变量) 与目录→index 回退,决策 #8)
 * 离线无注册对象:本地即权威,registerApply 直接确认;getApplyStatus 恒为 unknown。
 */
import type {
  StudentGateway,
  UnitTreeNode,
  ActiveBatchResult,
  RegisterApplyInput,
  RegisterApplyResult,
  ApplyStatusResult
} from './types'
import { OFFLINE_INDEX } from '../offline/index'

const unitsFile = require('../offline/units') as { units: UnitTreeNode[] }

export const gateway: StudentGateway = {
  mode: 'offline',

  async listUnits(): Promise<UnitTreeNode[]> {
    return unitsFile.units
  },

  async getActiveBatch(unitId: string): Promise<ActiveBatchResult> {
    const entry = OFFLINE_INDEX[unitId]
    if (!entry) {
      return { batch: null, config: null, authority: 'local' }
    }
    return { batch: entry.batch, config: entry.config, authority: 'local' }
  },

  async registerApply(input: RegisterApplyInput): Promise<RegisterApplyResult> {
    return { status: 'submitted', latestRevision: input.revision, authority: 'local' }
  },

  async getApplyStatus(applyId: string): Promise<ApplyStatusResult> {
    return {
      applyId,
      status: 'unknown',
      reviewRound: null,
      latestRevision: null,
      importedRevision: null,
      importedAt: null,
      updatedAt: null,
      authority: 'local'
    }
  }
}
