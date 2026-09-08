/**
 * 申请实体(apply)本地状态管理(架构 §3.3)。
 *
 * - `applyId`:学生×批次唯一,首次导出时生成(UUID v4),本地持久化;
 * - `revision`:每次导出递增,.dyf 文件内嵌当前版本号;
 * - `status`:本地状态 draft → submitted(导出后);reviewing 起由 gateway.getApplyStatus 同步(在线),
 *   离线恒 unknown,本地只读锁定逻辑已预留(canEditApply)。
 * 存储键:`apply`(wx storage)。
 * batchId 由 stores/batch.ts 提供(离线:包内批次;在线:接口 11),不再来自内置测试批次模块。
 *
 * M-O4:apply 含 studentId(PII),落盘走 local-vault 密封(readStored/writeStored),
 * 存储中为 `1.xxx.yyy` 密文串。所有读写为异步。
 */
import type { ApplyStatus } from "../shared/types/index";
import { uuidV4 } from "../utils/crypto";
import { draftStorageKey, readStored, writeStored } from "../utils/local-vault";
import { gateway } from "../gateway/active";
import { getCurrentBatch } from "./batch";

const LEGACY_APPLY_STORAGE_KEY = "apply";

/** 本地申请状态(与 shared Apply 类型对齐的子集)。 */
export interface LocalApplyState {
  applyId: string;
  batchId: string;
  studentId: string;
  /** 本地状态:draft/submitted;imported 起由服务端同步(M5)。 */
  status: ApplyStatus;
  /** 当前已导出版本号(0 = 尚未导出)。 */
  currentRevision: number;
  /** 最近一次导出文件的 SHA-256。 */
  lastFileHash?: string;
  lastExportedAt?: number;
  exportHistory: Array<{ revision: number; exportedAt: number; fileHash?: string }>;
  createdAt: number;
  updatedAt: number;
  reviewRound?: number | null;
  importedRevision?: number | null;
  importedAt?: number | null;
}

/** 从本地申请状态映射本地类型(容忍存储中缺失/类型脏字段)。 */
function normalizeApply(value: unknown): LocalApplyState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Partial<LocalApplyState>;
  if (typeof record.applyId !== "string" || !record.applyId) {
    return null;
  }
  return {
    applyId: record.applyId,
    batchId: String(record.batchId || ""),
    studentId: String(record.studentId || ""),
    status: record.status || "draft",
    currentRevision: Number(record.currentRevision) || 0,
    lastFileHash: record.lastFileHash,
    lastExportedAt: record.lastExportedAt,
    exportHistory: Array.isArray(record.exportHistory)
      ? record.exportHistory
          .map((item) => ({
            revision: Number(item ? item.revision : undefined) || 0,
            exportedAt: Number(item ? item.exportedAt : undefined) || 0,
            fileHash: typeof (item ? item.fileHash : undefined) === 'string' ? item.fileHash : undefined
          }))
          .filter((item) => item.revision > 0 && item.exportedAt > 0)
      : [],
    createdAt: Number(record.createdAt) || 0,
    updatedAt: Number(record.updatedAt) || 0,
    reviewRound: record.reviewRound == null ? null : Number(record.reviewRound),
    importedRevision:
      record.importedRevision == null ? null : Number(record.importedRevision),
    importedAt: record.importedAt == null ? null : Number(record.importedAt),
  };
}

function currentApplyStorageKey(batchId?: string): string | null {
  const batch = getCurrentBatch();
  if (!batch || (batchId && batch.batchId !== batchId)) return null;
  return draftStorageKey(batch.unitId, batch.batchId, "apply");
}

async function readApply(batchId?: string): Promise<LocalApplyState | null> {
  const key = currentApplyStorageKey(batchId);
  if (!key) return null;
  const scoped = normalizeApply(await readStored(key));
  if (scoped) return scoped;

  // One-time compatibility migration from the pre-partition global key.
  const legacy = normalizeApply(await readStored(LEGACY_APPLY_STORAGE_KEY));
  if (legacy && legacy.batchId === (batchId || getCurrentBatch()!.batchId)) {
    await writeStored(key, legacy);
    return legacy;
  }
  return null;
}

function writeApply(state: LocalApplyState): Promise<void> {
  const key = currentApplyStorageKey(state.batchId);
  if (!key)
    return Promise.reject(new Error("当前批次未就绪，无法保存申请状态"));
  return writeStored(key, state);
}

/**
 * 获取当前申请;不存在(或学号/批次变化)时创建新申请。
 * @param studentId 学生学号(studentField code = 'studentId')
 * @param batchId 当前批次 id(来自 stores/batch.ts)
 */
export async function getOrCreateApply(
  studentId: string,
  batchId: string,
): Promise<LocalApplyState> {
  const trimmedId = String(studentId == null ? "" : studentId).trim();
  if (!trimmedId) {
    throw new Error("缺少学号,无法创建申请");
  }
  if (!batchId) {
    throw new Error("缺少批次信息,无法创建申请");
  }
  const existing = await readApply(batchId);
  if (
    existing &&
    existing.batchId === batchId &&
    existing.studentId === trimmedId
  ) {
    return existing;
  }
  const now = Date.now();
  const created: LocalApplyState = {
    applyId: uuidV4(),
    batchId,
    studentId: trimmedId,
    status: "draft",
    currentRevision: 0,
    createdAt: now,
    updatedAt: now,
    exportHistory: [],
  };
  await writeApply(created);
  return created;
}

/** 读取当前申请(可能为 null)。 */
export async function getCurrentApply(): Promise<LocalApplyState | null> {
  return readApply();
}

/** 记录一次成功导出:revision 递增、状态置 submitted、记录文件哈希。 */
export async function markApplyExported(
  applyId: string,
  revision: number,
  fileHash: string,
  exportedAt = Date.now(),
): Promise<LocalApplyState> {
  const apply = await readApply();
  if (!apply || apply.applyId !== applyId) {
    throw new Error("申请不存在,无法记录导出");
  }
  const next: LocalApplyState = {
    ...apply,
    status: "submitted",
    currentRevision: revision,
    lastFileHash: fileHash,
    lastExportedAt: exportedAt,
    exportHistory: [
      ...(apply.exportHistory ? apply.exportHistory : []).filter((item) => item.revision !== revision),
      { revision, exportedAt, fileHash }
    ].sort((a, b) => a.revision - b.revision),
    updatedAt: exportedAt,
  };
  await writeApply(next);
  return next;
}

/** 从在线服务端同步申请状态；离线网关返回 unknown，不覆盖本地 submitted 状态。 */
export async function syncApplyStatus(): Promise<LocalApplyState | null> {
  const apply = await readApply();
  if (!apply || !apply.applyId || !apply.batchId) return apply;
  let remote;
  try {
    remote = await gateway.getApplyStatus(apply.applyId);
  } catch (error) {
    void error;
    return apply;
  }
  if (remote.status === "unknown") return apply;
  const rank: Record<string, number> = {
    draft: 0,
    submitted: 1,
    imported: 2,
    reviewing: 3,
    confirmed: 4,
  };
  const localRank = typeof rank[apply.status] === 'number' ? rank[apply.status] : 0;
  const remoteRank = typeof rank[remote.status] === 'number' ? rank[remote.status] : 0;
  if (remoteRank < localRank) return apply;
  const next: LocalApplyState = {
    ...apply,
    status: remote.status,
    reviewRound: remote.reviewRound,
    importedRevision: remote.importedRevision,
    importedAt: remote.importedAt,
    updatedAt: Date.now(),
  };
  await writeApply(next);
  return next;
}

/**
 * 是否允许编辑/重新导出。
 * draft/submitted 可编辑(submitted 允许重新导出,生成新 revision);
 * reviewing 起只读(本地状态离线不会出现,在线接入 gateway 同步后生效)。
 */
export async function canEditApply(): Promise<boolean> {
  const apply = await syncApplyStatus();
  if (!apply) {
    return true;
  }
  return apply.status === "draft" || apply.status === "submitted";
}
