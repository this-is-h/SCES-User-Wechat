/**
 * 学生端数据网关（Gateway）契约:两模式(offline/online)共用的唯一数据来源接缝。
 * 业务代码(pages/stores)只依赖本接口,不直接 require 包内 JSON,也不直接 wx.request。
 * 具体实现由 gateway/active.ts(构建期生成)在 ./offline 与 ./online 之间二选一导出。
 */
import type { UnitConfig, Jwk } from '../shared/types/index'

/** 单位树节点(离线 units.json / 在线接口 10 的形状一致)。 */
export interface UnitTreeNode {
  text: string
  value: string
  children?: UnitTreeNode[]
}

/**
 * 批次公开信息:两模式返回同型。
 * - offline:由 build-profile 的 buildBatchJson 产出(miniprogram/offline/batches/<unitId>.json)。
 * - online :由接口 11 的 BatchPublic 映射而来(seq 缺省)。
 * 学生端只消费其中加密与展示所需字段;私钥永不出现。
 */
export interface OfflineBatch {
  batchId: string
  unitId: string
  year: number
  semester: number
  isTest: boolean
  /** 离线派生序号(参与 batchId 派生);在线模式不返回,故可选。 */
  seq?: number
  /** 申请窗口开始(epoch ms);未设置为 null。 */
  applyStartAt: number | null
  /** 申请窗口结束(epoch ms);未设置为 null。 */
  applyEndAt: number | null
  /** 申请密钥 keyId(写入 .dyf,导入侧据此精确选私钥)。 */
  keyId: string
  /** 申请公钥(加密 .dyf 会话密钥用)。 */
  publicKeyJwk: Jwk
  configId: string
  configVersion: number
  configRevision: number
}

/** getActiveBatch 返回:批次公开信息 + 对应 UnitConfig(两模式同型)。 */
export interface ActiveBatchResult {
  batch: OfflineBatch | null
  config: UnitConfig | null
  authority: 'local' | 'server'
}

/** registerApply 输入(接口 12:不含任何个人信息)。 */
export interface RegisterApplyInput {
  applyId: string
  revision: number
  batchId: string
}

/** 申请生命周期状态(与服务端 ApplyStatusRecord.status 对齐)。 */
export type ApplyLifecycle = 'submitted' | 'imported' | 'reviewing' | 'confirmed' | 'unknown'

/** registerApply 返回。 */
export interface RegisterApplyResult {
  status: ApplyLifecycle
  latestRevision: number | null
  authority: 'local' | 'server'
}

/** getApplyStatus 返回(接口 13 的 ApplyStatusRecord + authority)。 */
export interface ApplyStatusResult {
  applyId: string
  status: ApplyLifecycle
  reviewRound: number | null
  latestRevision: number | null
  importedRevision: number | null
  importedAt: number | null
  updatedAt: number | null
  authority: 'local' | 'server'
}

/** 学生端网关接口:四个方法对应 docs/endpoint-guide.md 接口 10-13。 */
export interface StudentGateway {
  mode: 'offline' | 'online'
  listUnits(): Promise<UnitTreeNode[]>
  getActiveBatch(unitId: string): Promise<ActiveBatchResult>
  registerApply(input: RegisterApplyInput): Promise<RegisterApplyResult>
  getApplyStatus(applyId: string): Promise<ApplyStatusResult>
}
