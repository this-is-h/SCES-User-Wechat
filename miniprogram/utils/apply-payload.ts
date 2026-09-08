/**
 * 申请导出 payload 构造(架构 §3.3 / §5.1,决策 #9)。
 *
 * .dyf 加密前 payload 的规范结构(shared/types/import.ts ImportPayload):
 *   { applyId, revision, batchId, personal, dyf: { itemCode: { score, evidence[] } }, confirmSlip?, exportedAt? }
 *
 * - `personal` 字段名 = UnitConfig.student[].code(name/studentId/phone/grade/major/className),
 *   与管理端导入解析侧(import.ts:151/375)对齐;year/semester 由批次透传(字符串)。
 * - `dyf` 仅包含非零分数项,`evidence` 为证明材料 base64 数组。
 * - `exportedAt` 为导出时刻(决策 #48):管理端据此判定是否申请期外导出。
 * 纯函数,便于单元测试与三端对齐。
 */
/** dyf 明细项(.dyf payload 内的结构,与 shared ImportDyfEntry 同型)。 */
export interface DyfExportEntry {
  score: number
  /** 证明材料 base64 数组。 */
  evidence?: string[]
}

/**
 * `??` 空值合并替代(微信 DevTools 解析器不支持 ES2020 `??`,见 shared/nullish.ts 与架构决策 #12)。
 */
function nz<T>(value: T | null | undefined, fallback: T): T {
  return value === null || value === undefined ? fallback : value
}

/** 构建申请 payload。student 为小程序 store 中的学生记录(键 = studentField.code)。 */
export function buildApplyPayload(options: {
  applyId: string
  revision: number
  batchId: string
  student: Record<string, unknown>
  dyf: Record<string, DyfExportEntry>
  year?: number | string | null
  semester?: number | string | null
  confirmSlip?: string
  exportedAt?: number
  lifecycle?: {
    enteredAt?: number
    exports?: Array<{ revision: number; exportedAt: number; fileHash?: string }>
  }
  timeline?: Array<{
    eventId: string
    action: 'student.entered' | 'student.exported'
    occurredAt: number
    revision?: number
    sourceFileHash?: string
  }>
}): Record<string, unknown> {
  const { applyId, revision, batchId, student, dyf, year, semester, confirmSlip, exportedAt, lifecycle, timeline } = options
  const personal: Record<string, unknown> = {}
  for (const key of Object.keys(student)) {
    if (key === 'legacy') {
      continue
    }
    personal[key] = nz(student[key], '')
  }
  if (year !== undefined && year !== null) {
    personal.year = String(year)
  }
  if (semester !== undefined && semester !== null) {
    personal.semester = String(semester)
  }
  const payload: Record<string, unknown> = {
    documentType: 'student-application',
    applyId,
    revision,
    batchId,
    personal,
    dyf,
  }
  if (confirmSlip) {
    payload.confirmSlip = confirmSlip
  }
  if (exportedAt !== undefined && exportedAt !== null) {
    payload.exportedAt = exportedAt
  }
  if (lifecycle) payload.lifecycle = lifecycle
  if (timeline && timeline.length) payload.timeline = timeline
  return payload
}

/**
 * 将小程序 score map 转换为 .dyf payload 的 dyf 结构:
 * 跳过 legacy 与零分项,`file`(base64 数组)映射为 `evidence`。
 */
export function toDyfExportMap(
  score: Record<string, { score?: unknown; file?: unknown[] }>,
): Record<string, DyfExportEntry> {
  const result: Record<string, DyfExportEntry> = {}
  for (const key of Object.keys(score)) {
    if (key === 'legacy') {
      continue
    }
    const item = score[key]
    if (!item || typeof item !== 'object') {
      continue
    }
    const scoreValue = Number(item.score)
    if (!Number.isFinite(scoreValue) || scoreValue === 0) {
      continue
    }
    const entry: DyfExportEntry = { score: scoreValue }
    if (Array.isArray(item.file)) {
      const evidence = item.file.map((file) => String(file)).filter(Boolean)
      if (evidence.length > 0) {
        entry.evidence = evidence
      }
    }
    result[key] = entry
  }
  return result
}
