/**
 * 在线网关实现（路径以 SCES-Server/contracts/openapi.yaml 为准），在线版唯一数据源。
 * 错误策略:业务错误(中文)直接透传,否则按状态码翻译。
 */
import type {
  StudentGateway,
  UnitTreeNode,
  OfflineBatch,
  ActiveBatchResult,
  RegisterApplyInput,
  RegisterApplyResult,
  ApplyStatusResult,
  ApplyLifecycle
} from './types'
import type { UnitConfig, Jwk } from '../shared/types/index'
import { SERVER_BASE_URL } from '../config/runtime'

interface ApiEnvelope<T> {
  ok?: boolean
  data?: T
  error?: string
}

/** 接口 11 的 BatchPublic(在线全字段),映射到 OfflineBatch 前的原始形状。 */
interface RawBatchPublic {
  batchId: string
  unitId: string
  year: number
  semester: number
  isTest: boolean
  applyStartAt: number | null
  applyEndAt: number | null
  keyId: string
  publicKeyJwk: Jwk
  configTemplateId: string
  configTemplateVersion: number
  configTemplateRevision: number
}

function mapHttpError(status: number): string {
  if (status === 0) return '网络连接失败,请检查网络后重试'
  if (status === 429) return '请求过于频繁,请稍后再试'
  if (status >= 500) return '服务暂时不可用,请稍后再试'
  if (status === 404) return '资源不存在'
  return '请求失败(' + status + ')'
}

function req<T>(method: 'GET' | 'POST', path: string, data?: Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: SERVER_BASE_URL + path,
      method,
      data,
      header: { 'content-type': 'application/json' },
      success: (res) => {
        const body = res.data as ApiEnvelope<T>
        if (res.statusCode >= 200 && res.statusCode < 300 && body && body.ok === true) {
          resolve(body.data as T)
          return
        }
        reject(new Error(body && body.error ? body.error : mapHttpError(res.statusCode)))
      },
      fail: () => reject(new Error('网络连接失败,请检查网络后重试'))
    })
  })
}

export const gateway: StudentGateway = {
  mode: 'online',

  async listUnits(): Promise<UnitTreeNode[]> {
    return req<UnitTreeNode[]>('GET', '/api/v1/units/public')
  },

  async getActiveBatch(unitId: string): Promise<ActiveBatchResult> {
    const data = await req<{ batch: RawBatchPublic | null; configTemplate?: UnitConfig | null }>(
      'GET',
      '/api/v1/batches/active?unitId=' + encodeURIComponent(unitId)
    )
    if (!data.batch) {
      return { batch: null, config: null, authority: 'server' }
    }
    const b = data.batch
    const batch: OfflineBatch = {
      batchId: b.batchId,
      unitId: b.unitId,
      year: b.year,
      semester: b.semester,
      isTest: b.isTest,
      applyStartAt: b.applyStartAt,
      applyEndAt: b.applyEndAt,
      keyId: b.keyId,
      publicKeyJwk: b.publicKeyJwk,
      configId: b.configTemplateId,
      configVersion: b.configTemplateVersion,
      configRevision: b.configTemplateRevision
    }
    return { batch, config: data.configTemplate ? data.configTemplate : null, authority: 'server' }
  },

  async registerApply(input: RegisterApplyInput): Promise<RegisterApplyResult> {
    const data = await req<{ status: ApplyLifecycle; latestRevision: number | null }>(
      'POST',
      '/api/v1/applies/' + encodeURIComponent(input.applyId) + '/register',
      { batchId: input.batchId, revision: input.revision }
    )
    return { status: data.status, latestRevision: data.latestRevision, authority: 'server' }
  },

  async getApplyStatus(applyId: string): Promise<ApplyStatusResult> {
    const data = await req<{
      status: ApplyLifecycle
      reviewRound: number | null
      latestRevision: number | null
      importedRevision: number | null
      importedAt: number | null
      updatedAt: number | null
    }>('GET', '/api/v1/applies/' + encodeURIComponent(applyId))
    return {
      applyId,
      status: data.status,
      reviewRound: data.reviewRound,
      latestRevision: data.latestRevision,
      importedRevision: data.importedRevision,
      importedAt: data.importedAt,
      updatedAt: data.updatedAt,
      authority: 'server'
    }
  }
}
