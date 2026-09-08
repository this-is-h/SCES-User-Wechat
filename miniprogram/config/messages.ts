/**
 * 降级文案集中模块(dual-mode/05-student-client.md §5, 决策 #42/#57)。
 *
 * 所有因能力缺失(离线)产生的提示文案集中在此定义;页面只做能力判断
 * wx:if="{{caps.statusQuery}}" 等,不写模式分支(决策 #57 断言 2)。
 * 文案与日期格式化统一管理,避免各处漂移、便于在线档恢复时一并核对。
 */
import type { OfflineBatch } from '../gateway/types'

/** 审核状态卡片被隐藏时的说明文案(offline 时 statusQuery=false)。状态只存在于管理端本机。 */
export const STATUS_HINT = '本版本未联网，审核进度请咨询班级负责人'

/**
 * 重复导出前的强提示(offline 时 remoteLock=false,本地始终允许重导,
 * 但旧文件作废,必须重新发送,决策 #39 / 10-risks.md R8)。
 */
export const RE_EXPORT_WARNING = '重新导出将生成新版本，请务必重新发送，若管理端已导入，则以导入版本（旧）为准'

/** 无申请窗口时的提示(窗口未设置:applyStartAt/applyEndAt 均 null)。 */
export const NO_WINDOW_HINT = '本批次未设置申请时间，导出的文件可能不被接收'

/** 月份文本(用于窗口提示的 X 月 X 日)。 */
const MONTH_NAMES = ['一','二','三','四','五','六','七','八','九','十','十一','十二']

/**
 * 将 epoch ms 格式化为「X月X日」中文短日期。
 * 输入为 null/NaN 时返回 ''(表示无日期)。
 */
export function formatMonthDay(epochMs: number | null | undefined): string {
  const ts = Number(epochMs)
  if (!Number.isFinite(ts) || ts <= 0) {
    return ''
  }
  const date = new Date(ts)
  const month = MONTH_NAMES[date.getMonth()] || ''
  return `${month}月${date.getDate()}日`
}

/**
 * 当前批次是否处于申请窗口内。
 * - 窗口未设置(applyStartAt/applyEndAt 均 null)→ 视为不在窗口内(返回 false,触发提示)。
 * - 设备时钟不可信,此判断仅用于提示,不做硬拦(决策 #48)。
 */
export function isWithinApplyWindow(batch: OfflineBatch | null): boolean {
  if (!batch) {
    return false
  }
  const start = Number(batch.applyStartAt)
  const end = Number(batch.applyEndAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0) {
    return false
  }
  const now = Date.now()
  return now >= start && now <= end
}

/**
 * 窗口外导出提示文案(offline 时 deadlineAuthority='local-advisory')。
 * 在窗口内 → 返回 null(无需提示);窗口外/未设置窗口 → 返回黄色提示文案,仍允许导出(决策 #48)。
 */
export function formatApplyWindowHint(batch: OfflineBatch | null): string | null {
  if (!batch) {
    return NO_WINDOW_HINT
  }
  const start = Number(batch.applyStartAt)
  const end = Number(batch.applyEndAt)
  const hasWindow = Number.isFinite(start) && Number.isFinite(end) && start > 0 && end > 0
  if (!hasWindow) {
    return NO_WINDOW_HINT
  }
  if (isWithinApplyWindow(batch)) {
    return null
  }
  return `当前不在申请时间内（${formatMonthDay(start)} – ${formatMonthDay(end)}），导出的文件可能不被接收`
}