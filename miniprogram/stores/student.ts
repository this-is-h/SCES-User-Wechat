/**
 * 学生填报本地状态(MobX 单一数据源,架构 05 §3)。
 *
 * 配置来源改为 UnitConfig(经 gateway 取当前批次的配置,stores/config.ts 展开为 ResolvedConfig):
 * - classInfo  = ClassCascader(班级级联)
 * - studentInfo = StudentField[](个人信息字段,顺序即渲染顺序)
 * - scoreInfo  = ApplicableCategory[](学生端可申请德育项:分类→组→RenderItem)
 * - itemIndex  = itemCode → RenderItem
 * 页面 storeBindings 仍绑定 classInfo/studentInfo/scoreInfo(名称不变,形状升级)。
 *
 * 重置判据(§3.3):
 * - 同学期测试→正式：迁移基本信息、分数与证明材料；跨学期：保留基本信息，重置分数与申请;
 * - 配置 version/revision 变化 → 保留同 itemCode 分数、丢弃已删项、补齐新增默认值,提示已更新;
 * 存储键:unit / classValue / info / student / score(apply 见 stores/apply.ts)。
 */
import { observable, action } from "mobx-miniprogram";
import type { StudentField, ClassCascader } from "../shared/types/index";
import type { OfflineBatch } from "../gateway/types";
import { gateway } from "../gateway/active";
import { setCurrentBatch, clearBatch } from "./batch";
import { resolveConfig, familyKeyFor } from "./config";
import type { RenderItem, ApplicableCategory } from "./config";
import { draftStorageKey, readStored, writeStored } from "../utils/local-vault";

type PathNode = { text: string; value: string; [key: string]: unknown };

type ScoreEntry = {
  score: number;
  file?: unknown[];
};
type ScoreMap = Record<string, ScoreEntry>;

type ScoreDetailItem = {
  number: string;
  description: string;
  score: number;
  isDeduction: boolean;
  finalScore: number;
  groupName: string;
  typeName: string;
};

type NotifyType = "warning" | "primary" | "success" | "danger";
type InitNotify = {
  type: NotifyType;
  msg: string;
  modalTitle?: string;
  toast?: boolean;
};

type BatchHistoryEntry = {
  batchId: string;
  year: number;
  semester: number;
  isTest: boolean;
  seenAt: number;
};

type StudentInfoData = {
  /** = 配置 version(变更检测)。 */
  version: number;
  /** = 配置 revision。 */
  revision: number;
  /** = 当前批次 batchId(变更检测)。 */
  batchId: string;
  time: {
    student: { start: number; change: number; confirm: number; export: number };
    class: { import: number; change: unknown[]; export: number };
    grade: { import: number; change: unknown[]; export: number };
  };
  times: {
    student: { readTimes: number; confirmTimes: number; exportTimes: number };
  };
  lifecycle: {
    enteredAt: number;
    exports: Array<{ revision: number; exportedAt: number; fileHash?: string }>;
  };
};

const updateDebounceDelay = 500;
const updatePersistTimers: Record<string, ReturnType<typeof setTimeout>> = {};

/**
 * 安全持久化：写 storage 失败不静默——记日志并 Toast 提示，避免学生填写的草稿
 * 在配额超限/随机池异常时悄悄丢失（重启后无迹可查）。
 */
function persistStored(key: string, value: unknown): void {
  writeStored(key, value).catch(function (error) {
    console.error('[student] 草稿保存失败', key, error);
    wx.showToast({
      title: '保存失败，请检查手机存储空间后重试',
      icon: 'none'
    });
  });
}

const debouncePersist = (key: string, value: unknown): void => {
  clearTimeout(updatePersistTimers[key]);
  updatePersistTimers[key] = setTimeout(() => {
    persistStored(key, value);
  }, updateDebounceDelay);
};

const deepClone = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

const toTimestamp = (value: unknown): number => {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) {
    return 0;
  }
  return nextValue;
};

const toCounter = (value: unknown): number => {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue) || nextValue < 0) {
    return 0;
  }
  return Math.floor(nextValue);
};

const toNumber = (value: unknown): number => {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) {
    return 0;
  }
  return nextValue;
};

const nowTimestamp = (): number => Date.now();

const buildDefaultInfo = (): StudentInfoData => ({
  version: 0,
  revision: 0,
  batchId: "",
  time: {
    student: { start: 0, change: 0, confirm: 0, export: 0 },
    class: { import: 0, change: [], export: 0 },
    grade: { import: 0, change: [], export: 0 },
  },
  times: {
    student: { readTimes: 0, confirmTimes: 0, exportTimes: 0 },
  },
  lifecycle: { enteredAt: 0, exports: [] },
});

/** 从存储值归一化 info(缺失字段以默认补齐,容错历史脏数据)。 */
const normalizeInfo = (value: unknown): StudentInfoData => {
  const result = buildDefaultInfo();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return result;
  }
  const incoming = value as Record<string, unknown>;
  if (typeof incoming.version === "number") {
    result.version = incoming.version;
  }
  if (typeof incoming.revision === "number") {
    result.revision = incoming.revision;
  }
  if (typeof incoming.batchId === "string") {
    result.batchId = incoming.batchId;
  }

  const incomingTime =
    incoming.time &&
    typeof incoming.time === "object" &&
    !Array.isArray(incoming.time)
      ? (incoming.time as Record<string, unknown>)
      : null;
  const readGroup = (key: string): Record<string, unknown> | null => {
    if (!incomingTime) {
      return null;
    }
    const group = incomingTime[key];
    if (group && typeof group === "object" && !Array.isArray(group)) {
      return group as Record<string, unknown>;
    }
    return null;
  };
  const studentTime = readGroup("student");
  if (studentTime) {
    result.time.student.start = toTimestamp(studentTime.start);
    result.time.student.change = toTimestamp(studentTime.change);
    result.time.student.confirm = toTimestamp(
      studentTime.confirm == null ? studentTime.comfirm : studentTime.confirm,
    );
    result.time.student.export = toTimestamp(studentTime.export);
  }
  const classTime = readGroup("class");
  if (classTime) {
    result.time.class.import = toTimestamp(classTime.import);
    result.time.class.change = Array.isArray(classTime.change)
      ? deepClone(classTime.change)
      : [];
    result.time.class.export = toTimestamp(classTime.export);
  }
  const gradeTime = readGroup("grade");
  if (gradeTime) {
    result.time.grade.import = toTimestamp(gradeTime.import);
    result.time.grade.change = Array.isArray(gradeTime.change)
      ? deepClone(gradeTime.change)
      : [];
    result.time.grade.export = toTimestamp(gradeTime.export);
  }

  const incomingTimes =
    incoming.times &&
    typeof incoming.times === "object" &&
    !Array.isArray(incoming.times)
      ? (incoming.times as Record<string, unknown>)
      : null;
  const studentTimes =
    incomingTimes &&
    incomingTimes.student &&
    typeof incomingTimes.student === "object" &&
    !Array.isArray(incomingTimes.student)
      ? (incomingTimes.student as Record<string, unknown>)
      : null;
  if (studentTimes) {
    result.times.student.readTimes = toCounter(studentTimes.readTimes);
    result.times.student.confirmTimes = toCounter(studentTimes.confirmTimes);
    result.times.student.exportTimes = toCounter(studentTimes.exportTimes);
  }
  const lifecycle = incoming.lifecycle;
  if (lifecycle && typeof lifecycle === "object" && !Array.isArray(lifecycle)) {
    result.lifecycle.enteredAt = toTimestamp((lifecycle as Record<string, unknown>).enteredAt);
    const exports = (lifecycle as Record<string, unknown>).exports;
    if (Array.isArray(exports)) {
      result.lifecycle.exports = exports
        .filter((item) => item && typeof item === "object" && !Array.isArray(item))
        .map((item) => item as Record<string, unknown>)
        .map((item) => ({
          revision: Math.floor(toNumber(item.revision)),
          exportedAt: toTimestamp(item.exportedAt),
          fileHash: typeof item.fileHash === "string" ? item.fileHash : undefined,
        }))
        .filter((item) => item.revision > 0 && item.exportedAt > 0)
        .sort((a, b) => a.revision - b.revision);
    }
  }
  return result;
};

const resetStudentTimes = (info: StudentInfoData): StudentInfoData => {
  const nextInfo = deepClone(info);
  nextInfo.times.student.readTimes = 0;
  nextInfo.times.student.confirmTimes = 0;
  nextInfo.times.student.exportTimes = 0;
  nextInfo.lifecycle = { enteredAt: 0, exports: [] };
  return nextInfo;
};

/** 个人信息默认结构:每个字段 code → 空串(避免 null 传入 van-field 触发渲染层空引用)。 */
const buildStudentDefault = (
  fields: StudentField[],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    out[field.code] = "";
  }
  return out;
};

/** 单项默认分:radio 取首个候选值,其余取 min(缺省 0)。 */
const defaultItemScore = (item: RenderItem): number => {
  if (item.kind === "radio" && item.options && item.options.length > 0) {
    return item.options[0].value;
  }
  if (typeof item.min === "number") {
    return item.min;
  }
  return 0;
};

/** 德育分默认结构:每个可申请 itemCode → { score: 默认分, file?: [] }。 */
const buildScoreDefault = (itemIndex: Record<string, RenderItem>): ScoreMap => {
  const out: ScoreMap = {};
  for (const code of Object.keys(itemIndex)) {
    const item = itemIndex[code];
    const entry: ScoreEntry = { score: defaultItemScore(item) };
    if (item.needSupport) {
      entry.file = [];
    }
    out[code] = entry;
  }
  return out;
};

/** 合并本地已填个人信息:仅覆盖当前配置存在的字段,丢弃已删字段。 */
const mergeStudent = (
  base: Record<string, unknown>,
  storage: unknown,
): { value: Record<string, unknown>; restored: boolean } => {
  const out: Record<string, unknown> = { ...base };
  let restored = false;
  if (storage && typeof storage === "object" && !Array.isArray(storage)) {
    const record = storage as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        out[key] = record[key];
        restored = true;
      }
    }
  }
  return { value: out, restored };
};

/** 合并本地已填分数:仅覆盖当前配置存在的 itemCode,丢弃已删项。 */
const mergeScore = (
  base: ScoreMap,
  storage: unknown,
): { value: ScoreMap; restored: boolean } => {
  const out: ScoreMap = {};
  for (const key of Object.keys(base)) {
    out[key] = { ...base[key] };
  }
  let restored = false;
  if (storage && typeof storage === "object" && !Array.isArray(storage)) {
    const record = storage as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) {
        continue;
      }
      const value = record[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const item = value as { score?: unknown; file?: unknown[] };
        const merged: ScoreEntry = { ...out[key] };
        if (typeof item.score === "number") {
          merged.score = item.score;
        }
        if (Array.isArray(item.file)) {
          merged.file = item.file;
        }
        out[key] = merged;
        restored = true;
      }
    }
  }
  return { value: out, restored };
};

/** 汇总非零分明细(供确认单展示与总分计算);isDeduction = 分类惩罚 || 单项取负。
 * 决策 #? 取最高分规则:分类启用 takeHighest 时,同族内多个已填项只取最大分(按分值绝对值,
 * 奖励取最高一档、惩罚取最重一档),较低项不入明细/材料/总分;族外项不受影响。
 */
const collectScoreDetail = (
  tree: ApplicableCategory[],
  scoreMap: ScoreMap,
): ScoreDetailItem[] => {
  const familyMax = new Map<string, number>();
  const familyWinner = new Map<string, string>();
  for (const cat of tree) {
    const hasTakeHighest = !!(
      cat.category.takeHighest || cat.groups.some((g) => g.takeHighest)
    );
    if (!hasTakeHighest) {
      continue;
    }
    for (const group of cat.groups) {
      for (const item of group.items) {
        const entry = scoreMap[item.code];
        const scoreValue = toNumber(entry ? entry.score : 0);
        if (scoreValue === 0) {
          continue;
        }
        const key = familyKeyFor(cat.category, group, {
          categoryCode: cat.category.code,
          groupCode: group.code,
          itemCode: item.code,
        });
        if (!key) {
          continue;
        }
        const current = familyMax.get(key);
        if (typeof current !== "number" || scoreValue > current) {
          familyMax.set(key, scoreValue);
          familyWinner.set(key, item.code);
        }
      }
    }
  }
  const result: ScoreDetailItem[] = [];
  for (const cat of tree) {
    for (const group of cat.groups) {
      for (const item of group.items) {
        const entry = scoreMap[item.code];
        const scoreValue = toNumber(entry ? entry.score : 0);
        if (scoreValue === 0) {
          continue;
        }
        const isDeduction = cat.category.penalty || item.negative;
        const key = familyKeyFor(cat.category, group, {
          categoryCode: cat.category.code,
          groupCode: group.code,
          itemCode: item.code,
        });
        if (
          key !== null &&
          familyWinner.has(key) &&
          familyWinner.get(key) !== item.code
        ) {
          continue;
        }
        result.push({
          number: item.code,
          description: item.description,
          score: scoreValue,
          isDeduction,
          finalScore: isDeduction ? -scoreValue : scoreValue,
          groupName: cat.category.name,
          typeName: group.name,
        });
      }
    }
  }
  return result;
};

/** 供导出二次确认提示:返回启用 takeHighest 的分类下,同族内多个已填项的族列表(仅族内填了 2+ 项)。 */
const collectTakeHighestWarnings = (
  tree: ApplicableCategory[],
  scoreMap: ScoreMap,
): Array<{ categoryName: string; groupName: string; items: string[] }> => {
  const result: Array<{
    categoryName: string;
    groupName: string;
    items: string[];
  }> = [];
  for (const cat of tree) {
    const hasTakeHighest = !!(
      cat.category.takeHighest || cat.groups.some((g) => g.takeHighest)
    );
    if (!hasTakeHighest) {
      continue;
    }
    const familyMap = new Map<
      string,
      { groupName: string; itemCodes: string[] }
    >();
    for (const group of cat.groups) {
      for (const item of group.items) {
        const entry = scoreMap[item.code];
        const scoreValue = toNumber(entry ? entry.score : 0);
        if (scoreValue === 0) {
          continue;
        }
        const key = familyKeyFor(cat.category, group, {
          categoryCode: cat.category.code,
          groupCode: group.code,
          itemCode: item.code,
        });
        if (!key) {
          continue;
        }
        const bucket = familyMap.get(key) || {
          groupName: group.name,
          itemCodes: [],
        };
        bucket.itemCodes.push(item.code);
        familyMap.set(key, bucket);
      }
    }
    for (const bucket of familyMap.values()) {
      if (bucket.itemCodes.length > 1) {
        result.push({
          categoryName: cat.category.name,
          groupName: bucket.groupName,
          items: bucket.itemCodes,
        });
      }
    }
  }
  return result;
};

const EMPTY_CASCADER: ClassCascader = { titles: [], options: [] };

type CommitInitInput = {
  unitId: string;
  unit: PathNode[];
  classValue: Record<string, unknown>;
  batch: OfflineBatch;
  configName: string;
  classInfo: ClassCascader;
  studentInfo: StudentField[];
  scoreInfo: ApplicableCategory[];
  itemIndex: Record<string, RenderItem>;
  version: number;
  revision: number;
  student: Record<string, unknown>;
  score: ScoreMap;
  info: StudentInfoData;
};

function scopedKey(unitId: string, batchId: string, key: string): string {
  return draftStorageKey(unitId, batchId, key);
}

function batchHistoryKey(unitId: string): string {
  return `draft-batches:${encodeURIComponent(unitId)}`;
}

function readBatchHistory(unitId: string): BatchHistoryEntry[] {
  const raw = wx.getStorageSync(batchHistoryKey(unitId));
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry) =>
      entry && typeof entry === "object" && typeof entry.batchId === "string",
  ) as BatchHistoryEntry[];
}

function rememberBatch(unitId: string, batch: OfflineBatch): void {
  const history = readBatchHistory(unitId).filter(
    (entry) => entry.batchId !== batch.batchId,
  );
  history.push({
    batchId: batch.batchId,
    year: batch.year,
    semester: batch.semester,
    isTest: batch.isTest === true,
    seenAt: Date.now(),
  });
  history.sort((a, b) => b.seenAt - a.seenAt);
  wx.setStorageSync(batchHistoryKey(unitId), history.slice(0, 20));
}

async function migrationSource(
  unitId: string,
  batch: OfflineBatch,
): Promise<{
  entry: BatchHistoryEntry;
  mode: "test-to-formal" | "new-semester";
} | null> {
  const history = readBatchHistory(unitId).filter(
    (entry) => entry.batchId !== batch.batchId,
  );
  if (!batch.isTest) {
    const test = history.find(
      (entry) =>
        entry.isTest &&
        entry.year === batch.year &&
        entry.semester === batch.semester,
    );
    if (test) return { entry: test, mode: "test-to-formal" };
  }
  const previousTerm = history.find(
    (entry) => entry.year !== batch.year || entry.semester !== batch.semester,
  );
  return previousTerm ? { entry: previousTerm, mode: "new-semester" } : null;
}

function currentScopedKey(
  unit: PathNode[],
  batch: OfflineBatch | null,
  key: string,
): string | null {
  const unitId =
    unit.length > 0 ? String(unit[unit.length - 1].value || "") : "";
  if (!unitId || !batch) return null;
  return scopedKey(unitId, batch.batchId, key);
}

export const studentStore = observable({
  unit: [] as PathNode[],
  info: normalizeInfo(null) as StudentInfoData,
  student: {} as Record<string, unknown>,
  classValue: {} as Record<string, unknown>,
  score: {} as ScoreMap,
  batch: null as OfflineBatch | null,
  classInfo: EMPTY_CASCADER as ClassCascader,
  studentInfo: [] as StudentField[],
  scoreInfo: [] as ApplicableCategory[],
  itemIndex: {} as Record<string, RenderItem>,
  configVersion: 0,
  configRevision: 0,
  configName: "",
  configLoaded: false,

  get unitTitle() {
    if (this.unit.length === 0) {
      return "";
    }
    return this.unit.map((item: PathNode) => item.text).join(" ");
  },

  get unitValue() {
    if (this.unit.length === 0) {
      return "";
    }
    return this.unit[this.unit.length - 1].value;
  },

  get yearText() {
    return this.batch ? `${this.batch.year} 学年` : "";
  },

  get semesterText() {
    return this.batch ? `第${this.batch.semester}学期` : "";
  },

  get batchIsTest() {
    return this.batch ? this.batch.isTest === true : false;
  },

  get scoreDetailList() {
    return collectScoreDetail(this.scoreInfo, this.score);
  },

  /** 学生端确认单与页面展示使用的最终德育分总分。 */
  get totalScore() {
    return Number(
      this.scoreDetailList
        .reduce(
          (sum: number, item: ScoreDetailItem) => sum + item.finalScore,
          0,
        )
        .toFixed(2),
    );
  },

  /** 取最高分去重族告警(决策 #?):启用 takeHighest 的分类下,同族内多个已填项(导出确认时提示)。 */
  get takeHighestWarnings() {
    return collectTakeHighestWarnings(this.scoreInfo, this.score);
  },

  /**
   * 加载当前单位的配置与批次并重建填报状态。
   * 无存储单位 → null;加载失败/无活跃批次 → danger 提示;正常 → 变更提示或 null。
   */
  init: async function (): Promise<InitNotify | null> {
    const unitStorage = wx.getStorageSync("unit");
    if (!Array.isArray(unitStorage) || unitStorage.length === 0) {
      return null;
    }
    const unit = unitStorage as PathNode[];
    const unitValue = unit[unit.length - 1].value;

    let active;
    try {
      active = await gateway.getActiveBatch(unitValue);
    } catch (e) {
      return { type: "danger", msg: "配置加载失败,请稍后重试" };
    }
    if (!active.batch || !active.config) {
      this.markUnitOnly(unit);
      return { type: "danger", msg: "未找到该单位的活跃批次或配置" };
    }

    const resolved = resolveConfig(active.config);
    const infoKey = scopedKey(unitValue, active.batch.batchId, "info");
    const classValueKey = scopedKey(
      unitValue,
      active.batch.batchId,
      "classValue",
    );
    const studentKey = scopedKey(unitValue, active.batch.batchId, "student");
    const scoreKey = scopedKey(unitValue, active.batch.batchId, "score");

    const scopedInfoRaw = wx.getStorageSync(infoKey);
    const legacyInfoRaw = wx.getStorageSync("info");
    const legacyInfo = normalizeInfo(legacyInfoRaw);
    const canMigrateLegacy =
      !scopedInfoRaw && legacyInfo.batchId === active.batch.batchId;
    let infoStorage =
      scopedInfoRaw || (canMigrateLegacy ? legacyInfoRaw : undefined);
    let classValueStorage =
      wx.getStorageSync(classValueKey) ||
      (canMigrateLegacy ? wx.getStorageSync("classValue") : undefined);
    let studentStorage =
      (await readStored(studentKey)) ||
      (canMigrateLegacy ? await readStored("student") : undefined);
    let scoreStorage =
      (await readStored(scoreKey)) ||
      (canMigrateLegacy ? await readStored("score") : undefined);
    let migratedMode: "test-to-formal" | "new-semester" | null = null;

    if (
      !infoStorage &&
      !classValueStorage &&
      !studentStorage &&
      !scoreStorage
    ) {
      const source = await migrationSource(unitValue, active.batch);
      if (source) {
        const sourceBatchId = source.entry.batchId;
        infoStorage = wx.getStorageSync(
          scopedKey(unitValue, sourceBatchId, "info"),
        );
        classValueStorage = wx.getStorageSync(
          scopedKey(unitValue, sourceBatchId, "classValue"),
        );
        studentStorage = await readStored(
          scopedKey(unitValue, sourceBatchId, "student"),
        );
        if (source.mode === "test-to-formal") {
          scoreStorage = await readStored(
            scopedKey(unitValue, sourceBatchId, "score"),
          );
        }
        migratedMode = source.mode;
      }
    }
    const classValue =
      classValueStorage &&
      typeof classValueStorage === "object" &&
      !Array.isArray(classValueStorage)
        ? (classValueStorage as Record<string, unknown>)
        : {};

    const storedInfo = normalizeInfo(infoStorage);
    const studentDefault = buildStudentDefault(resolved.studentFields);
    const scoreDefault = buildScoreDefault(resolved.itemIndex);

    const batchChanged = storedInfo.batchId !== active.batch.batchId;
    const configChanged =
      storedInfo.version !== resolved.version ||
      storedInfo.revision !== resolved.revision;
    const hasStored =
      (studentStorage &&
        typeof studentStorage === "object" &&
        !Array.isArray(studentStorage)) ||
      (scoreStorage &&
        typeof scoreStorage === "object" &&
        !Array.isArray(scoreStorage));

    let student: Record<string, unknown>;
    let score: ScoreMap;
    let info = storedInfo;
    let notify: InitNotify | null = null;

    if (batchChanged) {
      student = mergeStudent(studentDefault, studentStorage).value;
      score =
        migratedMode === "test-to-formal"
          ? mergeScore(scoreDefault, scoreStorage).value
          : scoreDefault;
      info = resetStudentTimes(storedInfo);
      info.time.student.start = nowTimestamp();
      if (migratedMode === "test-to-formal") {
        notify = {
          type: "warning",
          msg: "测试批次中填写的基本信息、分数和证明材料已迁移到正式批次。请重新核对并认真提交。",
          modalTitle: "已进入正式批次",
        };
      } else if (migratedMode === "new-semester") {
        notify = {
          type: "primary",
          msg: "已进入新学期，基本信息已保留，分数和申请记录已重置",
          toast: true,
        };
      } else if (hasStored && storedInfo.batchId !== "") {
        notify = { type: "warning", msg: "检测到新批次,本地填写已重置" };
      }
    } else {
      const mergedStudent = mergeStudent(studentDefault, studentStorage);
      const mergedScore = mergeScore(scoreDefault, scoreStorage);
      student = mergedStudent.value;
      score = mergedScore.value;
      if (configChanged) {
        notify = { type: "primary", msg: "德育分办法已更新,部分项目已调整" };
      } else if (mergedStudent.restored || mergedScore.restored) {
        notify = { type: "success", msg: "数据已恢复" };
      }
    }

    info.version = resolved.version;
    info.revision = resolved.revision;
    info.batchId = active.batch.batchId;
    if (!info.lifecycle.enteredAt) {
      const enteredAt = nowTimestamp();
      info.lifecycle.enteredAt = enteredAt;
      info.time.student.start = enteredAt;
    }

    this.commitInit({
      unitId: unitValue,
      unit,
      classValue,
      batch: active.batch,
      configName: resolved.raw.name,
      classInfo: resolved.classCascader,
      studentInfo: resolved.studentFields,
      scoreInfo: resolved.applicableTree,
      itemIndex: resolved.itemIndex,
      version: resolved.version,
      revision: resolved.revision,
      student,
      score,
      info,
    });
    rememberBatch(unitValue, active.batch);
    return notify;
  },

  /** 提交 init 计算结果(唯一在 action 内落 observable + 持久化)。 */
  commitInit: action(function (data: CommitInitInput) {
    this.unit = data.unit;
    this.classValue = data.classValue;
    this.batch = data.batch;
    this.classInfo = data.classInfo;
    this.studentInfo = data.studentInfo;
    this.scoreInfo = data.scoreInfo;
    this.itemIndex = data.itemIndex;
    this.configVersion = data.version;
    this.configRevision = data.revision;
    this.configName = data.configName;
    this.configLoaded = true;
    this.student = data.student;
    this.score = data.score;
    this.info = data.info;
    setCurrentBatch(data.batch);
    wx.setStorageSync(
      scopedKey(data.unitId, data.batch.batchId, "classValue"),
      data.classValue,
    );
    wx.setStorageSync(
      scopedKey(data.unitId, data.batch.batchId, "info"),
      data.info,
    );
    persistStored(
      scopedKey(data.unitId, data.batch.batchId, "student"),
      data.student,
    );
    persistStored(
      scopedKey(data.unitId, data.batch.batchId, "score"),
      data.score,
    );
  }),

  /** 仅设置单位(无可用配置时):清空配置派生态,避免展示旧单位配置。 */
  markUnitOnly: action(function (unit: PathNode[]) {
    this.unit = unit;
    this.batch = null;
    this.classInfo = EMPTY_CASCADER;
    this.studentInfo = [];
    this.scoreInfo = [];
    this.itemIndex = {};
    this.configLoaded = false;
    this.configName = "";
    this.configVersion = 0;
    this.configRevision = 0;
    clearBatch();
  }),

  markStudentStart: action(function () {
    const startedAt = nowTimestamp();
    const nextInfo = normalizeInfo(this.info);
    if (!nextInfo.lifecycle.enteredAt) {
      nextInfo.lifecycle.enteredAt = startedAt;
      nextInfo.time.student.start = startedAt;
    }
    this.info = nextInfo;
    const key = currentScopedKey(this.unit, this.batch, "info");
    if (key) wx.setStorageSync(key, nextInfo);
  }),

  markStudentRead: action(function () {
    const nextInfo = normalizeInfo(this.info);
    nextInfo.times.student.readTimes += 1;
    this.info = nextInfo;
    const key = currentScopedKey(this.unit, this.batch, "info");
    if (key) wx.setStorageSync(key, nextInfo);
  }),

  markStudentConfirm: action(function () {
    const confirmedAt = nowTimestamp();
    const nextInfo = normalizeInfo(this.info);
    nextInfo.time.student.confirm = confirmedAt;
    nextInfo.times.student.confirmTimes += 1;
    this.info = nextInfo;
    const key = currentScopedKey(this.unit, this.batch, "info");
    if (key) wx.setStorageSync(key, nextInfo);
  }),

  markStudentExport: action(function (revision?: number, fileHash?: string, occurredAt?: number) {
    const exportedAt = occurredAt === null || occurredAt === undefined
      ? nowTimestamp()
      : occurredAt;
    const nextInfo = normalizeInfo(this.info);
    nextInfo.time.student.export = exportedAt;
    nextInfo.times.student.exportTimes += 1;
    if (Number.isInteger(revision) && Number(revision) > 0) {
      nextInfo.lifecycle.exports = [
        ...nextInfo.lifecycle.exports.filter((item) => item.revision !== Number(revision)),
        { revision: Number(revision), exportedAt, ...(fileHash ? { fileHash } : {}) },
      ].sort((a, b) => a.revision - b.revision);
    }
    this.info = nextInfo;
    const key = currentScopedKey(this.unit, this.batch, "info");
    if (key) wx.setStorageSync(key, nextInfo);
  }),

  update: action(function (observableKey: string, value: unknown) {
    if (!observableKey) {
      return;
    }
    const store = this as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(store, observableKey)) {
      return;
    }

    if (observableKey === "unit") {
      const previousUnit = JSON.stringify(this.unit || []);
      const nextUnit = JSON.stringify((value as PathNode[]) || []);
      this.unit = value as PathNode[];
      wx.setStorageSync(observableKey, this.unit);
      if (previousUnit !== nextUnit) {
        // 单位切换:清空配置派生态与批次缓存,由目标页 init() 重新加载并按 batchId 重置。
        this.batch = null;
        this.classInfo = EMPTY_CASCADER;
        this.studentInfo = [];
        this.scoreInfo = [];
        this.itemIndex = {};
        this.configLoaded = false;
        clearBatch();
        const unitChangedAt = nowTimestamp();
        // 只清空内存态；旧单位草稿保留在 unitId + batchId 分区中，切回后可恢复。
        this.classValue = {};
        this.student = {};
        this.score = {};
        this.configName = "";
        this.configVersion = 0;
        this.configRevision = 0;
        const nextInfo = resetStudentTimes(normalizeInfo(this.info));
        nextInfo.time.student.start = unitChangedAt;
        this.info = nextInfo;
      }
      return;
    }

    if (observableKey === "classValue") {
      this.classValue = value as Record<string, unknown>;
      const key = currentScopedKey(this.unit, this.batch, observableKey);
      if (key) wx.setStorageSync(key, this.classValue);
      return;
    }

    if (observableKey === "score") {
      const currentScore = store.score as Record<string, unknown>;
      const nextScore = value as Record<string, unknown>;
      const mergedScore: Record<string, unknown> = { ...currentScore };
      Object.keys(nextScore).forEach((key) => {
        const currentItem = currentScore[key];
        const nextItem = nextScore[key];
        const canMergeScoreItem =
          currentItem !== null &&
          typeof currentItem === "object" &&
          !Array.isArray(currentItem) &&
          nextItem !== null &&
          typeof nextItem === "object" &&
          !Array.isArray(nextItem);
        if (canMergeScoreItem) {
          mergedScore[key] = {
            ...(currentItem as Record<string, unknown>),
            ...(nextItem as Record<string, unknown>),
          };
          return;
        }
        mergedScore[key] = nextItem;
      });
      this.score = mergedScore as ScoreMap;
      const scoreKey = currentScopedKey(this.unit, this.batch, observableKey);
      if (scoreKey) debouncePersist(scoreKey, this.score);
      const scoreChangedAt = nowTimestamp();
      const nextInfo = normalizeInfo(this.info);
      nextInfo.time.student.change = scoreChangedAt;
      this.info = nextInfo;
      const infoKey = currentScopedKey(this.unit, this.batch, "info");
      if (infoKey) debouncePersist(infoKey, nextInfo);
      return;
    }

    const currentValue = store[observableKey];
    const canMerge =
      currentValue !== null &&
      typeof currentValue === "object" &&
      !Array.isArray(currentValue) &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value);
    if (canMerge) {
      store[observableKey] = {
        ...(currentValue as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      };
    } else {
      store[observableKey] = value;
    }
    const valueKey = currentScopedKey(this.unit, this.batch, observableKey);
    if (valueKey) debouncePersist(valueKey, store[observableKey]);
    if (observableKey === "student") {
      const studentChangedAt = nowTimestamp();
      const nextInfo = normalizeInfo(this.info);
      nextInfo.time.student.change = studentChangedAt;
      this.info = nextInfo;
      const infoKey = currentScopedKey(this.unit, this.batch, "info");
      if (infoKey) debouncePersist(infoKey, nextInfo);
    }
  }),
});
