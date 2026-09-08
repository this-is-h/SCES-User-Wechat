// 本文件由 scripts/build-profile.mjs 生成，请勿手改（来源：deploy/profile.json）
import type { UnitConfig } from '../shared/types/index'
import type { OfflineBatch } from '../gateway/types'

const testTest1Batch = require('./batches/testTest1') as OfflineBatch
const testTest1Config = require('./configs/test-1') as UnitConfig
const nxuLxBatch = require('./batches/nxuLx') as OfflineBatch
const nxuLxConfig = require('./configs/lixing-shuyuan') as UnitConfig

export const OFFLINE_INDEX: Record<string, { batch: OfflineBatch; config: UnitConfig }> = {
  testTest1: { batch: testTest1Batch, config: testTest1Config },
  nxuLx: { batch: nxuLxBatch, config: nxuLxConfig }
}
