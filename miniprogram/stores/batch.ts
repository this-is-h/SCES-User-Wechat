/**
 * 当前批次缓存(架构 05 §3.2):batchId / 申请窗口 / publicKeyJwk / keyId / 配置版本三元组,
 * 供 stores/apply.ts 与导出页(pages/main/score)读取。
 *
 * 单一数据来源:studentStore.init() 经 gateway 取到当前批次后调用 setCurrentBatch 写入本缓存
 * (避免二次 gateway 往返)。之后同步的 getCurrentBatch() / getCurrentBatchId() 即可直接取用。
 */
import type { OfflineBatch } from '../gateway/types'

let currentBatch: OfflineBatch | null = null

/** 写入当前批次缓存(由 studentStore.init 调用)。 */
export function setCurrentBatch(batch: OfflineBatch | null): void {
  currentBatch = batch
}

/** 读取当前批次(可能为 null:尚未加载或无活跃批次)。 */
export function getCurrentBatch(): OfflineBatch | null {
  return currentBatch
}

/** 当前批次 id;未加载时返回 null。 */
export function getCurrentBatchId(): string | null {
  return currentBatch ? currentBatch.batchId : null
}

/** 清空缓存(单位切换/清除本机数据时调用)。 */
export function clearBatch(): void {
  currentBatch = null
}
