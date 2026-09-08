import { ComponentWithStore } from "mobx-miniprogram-bindings";
import { studentStore } from "../../stores/student";
import {
  base64ToBytes,
  encryptDyfContainer,
  sha256Hex,
} from "../../shared/crypto/index";
import { validateApplyPayload } from "../../shared/validate/index";
import { getCurrentBatch } from "../../stores/batch";
import { ensureRandomPool } from "../../utils/crypto";
import {
  getOrCreateApply,
  getCurrentApply,
  markApplyExported,
  canEditApply,
  syncApplyStatus,
} from "../../stores/apply";
import { gateway } from "../../gateway/active";
import { buildApplyPayload, toDyfExportMap } from "../../utils/apply-payload";
import { formatApplyWindowHint } from "../../config/messages";
import { isEvidenceRef, readEvidenceBase64 } from "../../utils/local-vault";
import { capabilities } from "../../gateway/capabilities";

const themeBehavior = require("../../behaviors/theme/theme");

import Notify from "@vant/weapp/notify/notify";
import Toast from "@vant/weapp/toast/toast";

type ScoreItemDisplay = {
  number: string;
  description: string;
  score: number;
  finalScore: number;
  isDeduction: boolean;
};

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function mimeFromBase64(value: string): string {
  if (value.startsWith("/9j/")) return "image/jpeg";
  if (value.startsWith("iVBORw0KGg")) return "image/png";
  if (value.startsWith("R0lGOD")) return "image/gif";
  if (value.startsWith("UklGR")) return "image/webp";
  return "application/octet-stream";
}

/** Moves evidence bodies out of JSON and replaces them with content-addressed refs. */
async function externalizeStudentAssets(payload: Record<string, unknown>): Promise<{
  payload: Record<string, unknown>;
  assets: Array<{ assetId: string; sha256: string; mimeType: string; size: number; bytes: Uint8Array }>;
}> {
  const next = deepClone(payload);
  const assets = new Map<string, { assetId: string; sha256: string; mimeType: string; size: number; bytes: Uint8Array }>();
  const register = async (base64: string) => {
    const bytes = base64ToBytes(base64);
    if (!bytes.length) throw new Error("证明材料为空或格式无效");
    const sha256 = await sha256Hex(bytes);
    const assetId = `sha256:${sha256}`;
    if (!assets.has(assetId)) {
      assets.set(assetId, { assetId, sha256, mimeType: mimeFromBase64(base64), size: bytes.length, bytes });
    }
    return assetId;
  };
  const dyf = next.dyf;
  if (dyf && typeof dyf === "object" && !Array.isArray(dyf)) {
    for (const entry of Object.values(dyf as Record<string, Record<string, unknown>>)) {
      if (!entry || !Array.isArray(entry.evidence)) continue;
      const refs: string[] = [];
      for (const value of entry.evidence) refs.push(await register(String(value)));
      entry.evidenceRefs = refs;
      delete entry.evidence;
    }
  }
  if (typeof next.confirmSlip === "string" && next.confirmSlip) {
    next.confirmSlipRef = await register(next.confirmSlip);
    delete next.confirmSlip;
  }
  return { payload: next, assets: Array.from(assets.values()) };
}

ComponentWithStore({
  behaviors: [themeBehavior],
  properties: {},
  data: {
    scoreLoading: true,
    titleText: "综测分数确认单",
    applyText: "",
    commitmentText: "",
    dateText: "",
    scoreItems: [] as ScoreItemDisplay[],
    totalScoreDisplay: "0",
    imgfile: "",
    imgwidth: 0,
    imgheight: 0,
    allimgfile: "",
    previewDialogShow: false,
    snapshotCanvasWidth: 375,
    snapshotCanvasHeight: 2200,
    applyId: "",
    currentRevision: 0,
    revisionText: "",
    materialFilePath: "",
    materialFileName: "",
    exportStatusText: "",
    takeHighestWarningText: "",
  }, // 私有数据，可用于模板渲染
  storeBindings: {
    store: studentStore,
    fields: [
      "unit",
      "classInfo",
      "studentInfo",
      "scoreInfo",
      "scoreDetailList",
      "student",
      "score",
      "classValue",
      "totalScore",
      "info",
      "takeHighestWarnings",
      "batchIsTest",
    ] as const,
    actions: {
      initStore: "init",
      updateStudentStore: "update",
      markStudentExport: "markStudentExport",
    } as const,
  },

  lifetimes: {
    attached: async function () {
      Toast.loading({
        message: "核算分数中...",
        forbidClick: true,
        duration: 0,
      });
      await this.initializePage();
    },
  },

  pageLifetimes: {},

  methods: {
    initializePage: async function () {
      try {
        await this.initStore();
        // 在线模式下先同步远端审核状态，再决定页面是否允许编辑/重新导出。
        await syncApplyStatus();
        this.updateStoreBindings();
        if (!Array.isArray(this.data.unit) || this.data.unit.length === 0) {
          Toast.clear();
          wx.redirectTo({
            url: "/pages/privacyAndUnit/index",
          });
          return;
        }
        const onlyMaxResult = this.buildOnlyMaxScoreUpdate();
        const reservedScoreUpdate = this.applyReservedScoreOperations(
          onlyMaxResult.updateData,
        );
        if (Object.keys(reservedScoreUpdate).length > 0) {
          this.updateStudentStore("score", reservedScoreUpdate);
          this.updateStoreBindings();
        }
        await this.buildRenderData();
        if (onlyMaxResult.notifyMessages.length > 0) {
          Notify({
            type: "primary",
            message: onlyMaxResult.notifyMessages.join("\n"),
            safeAreaInsetTop: true,
            top: 46,
          });
        }
      } catch (error) {
        Notify({
          type: "danger",
          message: "分数核算失败",
          safeAreaInsetTop: true,
          top: 46,
        });
      } finally {
        Toast.clear();
        this.setData({
          scoreLoading: false,
        });
      }
    },
    buildOnlyMaxScoreUpdate: function () {
      const scoreInfo = Array.isArray(this.data.scoreInfo)
        ? this.data.scoreInfo
        : [];
      const currentScore = (this.data.score || {}) as Record<
        string,
        { score?: unknown; file?: unknown[] }
      >;
      const nextUpdate: Record<string, { score?: number; file?: unknown[] }> =
        {};
      const notifyMessageSet = new Set<string>();
      const walkNode = (node) => {
        if (!node || typeof node !== "object") {
          return;
        }
        const onlyMax = !!(node.onlyMax || node.onlymax);
        const children = Array.isArray(node.data) ? node.data : [];
        const isLeafScoreList =
          children.length > 0 &&
          children.every((item) => item && item.number != null);
        if (onlyMax && isLeafScoreList) {
          let hasNodeUpdated = false;
          let maxScore = Number.NEGATIVE_INFINITY;
          let maxIndex = -1;
          const scoreValues: number[] = [];
          children.forEach((scoreItem, index) => {
            const scoreId = String(
              scoreItem && scoreItem.number == null ? "" : scoreItem.number,
            );
            const scoreValue = Number(
              (currentScore[scoreId] && currentScore[scoreId].score) || 0,
            );
            const normalizedScore = Number.isFinite(scoreValue)
              ? scoreValue
              : 0;
            scoreValues.push(normalizedScore);
            if (normalizedScore > maxScore) {
              maxScore = normalizedScore;
              maxIndex = index;
            }
          });
          children.forEach((scoreItem, index) => {
            const scoreId = String(
              scoreItem && scoreItem.number == null ? "" : scoreItem.number,
            );
            if (!scoreId || index === maxIndex) {
              return;
            }
            const rawMin =
              scoreItem && scoreItem.score_type && scoreItem.score_type.min;
            const minScore = typeof rawMin === "number" ? rawMin : 0;
            const existedItem = currentScore[scoreId] || {};
            if (
              scoreValues[index] === minScore &&
              (!Array.isArray(existedItem.file) ||
                existedItem.file.length === 0)
            ) {
              return;
            }
            nextUpdate[scoreId] = {
              ...existedItem,
              score: minScore,
              ...(scoreItem && scoreItem.support && scoreItem.support.need
                ? { file: [] }
                : {}),
            };
            hasNodeUpdated = true;
          });
          if (
            hasNodeUpdated &&
            typeof node.onlyMaxMessage === "string" &&
            node.onlyMaxMessage.trim()
          ) {
            notifyMessageSet.add(node.onlyMaxMessage.trim());
          }
        }
        children.forEach((item) => {
          walkNode(item);
        });
      };
      scoreInfo.forEach((group) => {
        walkNode(group);
      });
      return {
        updateData: nextUpdate,
        notifyMessages: Array.from(notifyMessageSet),
      };
    },
    applyReservedScoreOperations: function (
      nextScore: Record<string, { score?: number; file?: unknown[] }>,
    ) {
      return nextScore;
    },
    getScoreFilePath: function (fileItem: unknown) {
      if (typeof fileItem === "string") {
        return fileItem;
      }
      if (
        !fileItem ||
        typeof fileItem !== "object" ||
        Array.isArray(fileItem)
      ) {
        return "";
      }
      const fileRecord = fileItem as Record<string, unknown>;
      return String(
        fileRecord.url ||
          fileRecord.localPath ||
          fileRecord.tempFilePath ||
          fileRecord.path ||
          "",
      );
    },
    readLocalFileBase64: function (filePath: string) {
      return new Promise<string>((resolve) => {
        const path = String(filePath || "");
        if (!path) {
          resolve("");
          return;
        }
        if (path.startsWith("data:")) {
          const splitIndex = path.indexOf(",");
          resolve(splitIndex >= 0 ? path.slice(splitIndex + 1) : "");
          return;
        }
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: path,
          encoding: "base64",
          success: (result) => {
            resolve(String(result.data || ""));
          },
          fail: () => {
            resolve("");
          },
        });
      });
    },
    serializeScoreForMaterial: async function (
      rawScore: Record<string, unknown>,
    ) {
      const nextScore = deepClone(rawScore) as Record<string, unknown>;
      for (const scoreId of Object.keys(nextScore)) {
        const scoreItem = nextScore[scoreId];
        if (
          !scoreItem ||
          typeof scoreItem !== "object" ||
          Array.isArray(scoreItem)
        ) {
          continue;
        }
        const scoreRecord = scoreItem as Record<string, unknown>;
        if (!Array.isArray(scoreRecord.file)) {
          continue;
        }
        const base64Files: string[] = [];
        for (const fileItem of scoreRecord.file) {
          if (isEvidenceRef(fileItem)) {
            const sealedBase64 = await readEvidenceBase64(fileItem);
            if (sealedBase64) {
              base64Files.push(sealedBase64);
            }
            continue;
          }
          const filePath = this.getScoreFilePath(fileItem);
          if (!filePath) {
            continue;
          }
          const base64Text = await this.readLocalFileBase64(filePath);
          if (base64Text) {
            base64Files.push(base64Text);
          }
        }
        scoreRecord.file = base64Files;
      }
      return nextScore;
    },
    generateMaterialFile: async function (confirmSlipBase64 = "") {
      if (!(await canEditApply())) {
        Notify({
          type: "warning",
          message: "申请已进入审核阶段，无法修改或重新导出",
          safeAreaInsetTop: true,
          top: 46,
        });
        return null;
      }
      // 确保 wx 随机池就绪（uuidV4 / AES 密钥与 IV / forge OAEP 种子都依赖它）
      await ensureRandomPool();
      const batch = getCurrentBatch();
      if (!batch) {
        Toast({ message: "批次未就绪" });
        return null;
      }
      // 申请窗口提示(offline 时 deadlineAuthority='local-advisory'):窗口外仍允许导出,
      // 但给出黄色提示(决策 #48,强制点在管理端)。
      const windowHint = formatApplyWindowHint(batch);
      if (windowHint) {
        Notify({
          type: "warning",
          message: windowHint,
          safeAreaInsetTop: true,
          top: 46,
        });
      }
      const student = (this.data.student || {}) as Record<string, unknown>;
      const studentId = String(
        student.studentId == null ? "" : student.studentId,
      );
      const apply = await getOrCreateApply(studentId, batch.batchId);
      const revision = apply.currentRevision + 1;
      const serializedDyf = await this.serializeScoreForMaterial(
        (this.data.score || {}) as Record<
          string,
          { score?: unknown; file?: unknown[] }
        >,
      );
      const dyf = toDyfExportMap(
        serializedDyf as Record<string, { score?: unknown; file?: unknown[] }>,
      );
      const exportedAt = Date.now();
      const lifecycle = this.data.info && typeof this.data.info === "object"
        ? (this.data.info.lifecycle || undefined)
        : undefined;
      const nextLifecycle = {
        enteredAt: lifecycle && typeof lifecycle.enteredAt === "number" ? lifecycle.enteredAt : 0,
        exports: [
          ...(lifecycle && Array.isArray(lifecycle.exports) ? lifecycle.exports : []).filter(
            (item) => item.revision !== revision,
          ),
          { revision, exportedAt },
        ],
      };
      const timeline = lifecycle
        ? [
            ...(lifecycle.enteredAt
              ? [{ eventId: `student.entered:${apply.applyId}`, action: "student.entered" as const, occurredAt: lifecycle.enteredAt }]
              : []),
            ...(Array.isArray(lifecycle.exports) ? lifecycle.exports : []).map((item) => ({
              eventId: `student.exported:${apply.applyId}:${item.revision}`,
              action: "student.exported" as const,
              occurredAt: item.exportedAt,
              revision: item.revision,
              sourceFileHash: item.fileHash,
            })),
          ]
        : [{ eventId: `student.exported:${apply.applyId}:${revision}`, action: "student.exported" as const, occurredAt: exportedAt, revision }];
      if (!timeline.some((event) => event.action === "student.exported" && event.revision === revision)) {
        timeline.push({ eventId: `student.exported:${apply.applyId}:${revision}`, action: "student.exported", occurredAt: exportedAt, revision, sourceFileHash: undefined });
      }
      const payload = buildApplyPayload({
        applyId: apply.applyId,
        revision,
        batchId: batch.batchId,
        student,
        dyf,
        year: batch.year,
        semester: batch.semester,
        confirmSlip: confirmSlipBase64 || undefined,
        exportedAt,
        lifecycle: nextLifecycle,
        timeline,
      });
      const validation = validateApplyPayload(payload, { requireDyf: true });
      if (!validation.ok) {
        Notify({
          type: "warning",
          message: validation.errors[0] || "申请内容校验失败，请检查后重试",
          safeAreaInsetTop: true,
          top: 46,
        });
        return null;
      }
      // 混合加密生成 .dyf：AES-256-GCM 加密 payload + RSA-OAEP 加密会话密钥 + SHA-256 完整性（架构 §5.1）
      const material = await externalizeStudentAssets(payload);
      const fileData = await encryptDyfContainer({
        payload: material.payload,
        publicKeyJwk: batch.publicKeyJwk,
        type: "apply",
        documentType: "student-application",
        schemaVersion: 2,
        applyId: apply.applyId,
        revision,
        batchId: batch.batchId,
        keyId: batch.keyId,
        assets: material.assets,
      });
      const fileHash = await sha256Hex(fileData);
      const binaryBuffer = new ArrayBuffer(fileData.byteLength);
      new Uint8Array(binaryBuffer).set(fileData);
      const fileName = this.buildMaterialFileName(revision);
      const filePath = await this.writeScoreMaterialFile(
        binaryBuffer,
        fileName,
      );
      try {
        await markApplyExported(apply.applyId, revision, fileHash, exportedAt);
        this.markStudentExport(revision, fileHash, exportedAt);
      } catch (error) {
        void error;
        // 文件已经写入但本地 revision 未提交时删除文件，避免出现“有文件但状态仍为旧版本”的分叉。
        try {
          await new Promise<void>((resolve) => {
            wx.getFileSystemManager().unlink({
              filePath,
              success: () => resolve(),
              fail: () => resolve(),
            });
          });
        } catch (error) {
          void error;
          // 删除失败不再覆盖原始导出错误，避免向用户暴露底层文件系统异常。
        }
        throw new Error("导出状态保存失败，请重试");
      }
      try {
        await gateway.registerApply({
          applyId: apply.applyId,
          revision,
          batchId: batch.batchId,
        });
      } catch (error) {
        void error;
        Notify({
          type: "warning",
          message: "文件已生成，但在线登记未完成，请稍后重试",
          safeAreaInsetTop: true,
          top: 46,
        });
      }
      this.setData({
        materialFilePath: filePath,
        materialFileName: fileName,
        applyId: apply.applyId,
        currentRevision: revision,
        revisionText: `第 ${revision} 版`,
      });
      return {
        filePath,
        fileName,
      };
    },
    buildRenderData: async function () {
      // 分数明细直接取自 store 的 scoreDetailList(已按 ApplicableCategory→组→RenderItem 归一,
      // isDeduction = 分类惩罚 || 单项取负),避免在页面重复展开配置树。
      const detail = Array.isArray(this.data.scoreDetailList)
        ? this.data.scoreDetailList
        : [];
      const scoreItems: ScoreItemDisplay[] = detail.map(
        (item: ScoreItemDisplay) => ({
          number: item.number,
          description: item.description,
          score: item.score,
          isDeduction: item.isDeduction,
          finalScore: item.finalScore,
        }),
      );
      const batch = getCurrentBatch();
      const year = batch ? String(batch.year == null ? "" : batch.year) : "";
      const semester = batch
        ? String(batch.semester == null ? "" : batch.semester)
        : "";
      const currentApply = await getCurrentApply();
      const revisionText =
        currentApply && currentApply.currentRevision > 0
          ? `已导出第 ${currentApply.currentRevision} 版`
          : "";
      // 导出状态提示:离线(remoteLock=false)学生端不锁定,文案为「已生成申请文件,请发送给班级负责人」;
      // 在线(remoteLock=true)导入后锁定,文案为「导出后学生端将锁定本次申请内容」。
      const exportStatusText = capabilities.remoteLock
        ? "导出后学生端将锁定本次申请内容"
        : "已生成申请文件，请导出并发送给班级负责人";
      const warnings = Array.isArray(this.data.takeHighestWarnings)
        ? this.data.takeHighestWarnings
        : [];
      const takeHighestWarningText = warnings.length
        ? `以下同类项目导出时将自动只计最高分：${warnings
            .map((warning) => {
              const family = Array.isArray(warning.items)
                ? warning.items
                : [];
              return `「${warning.categoryName}-${warning.groupName}」${family.join("、")}`;
            })
            .join("；")}`
        : "";
      this.setData({
        scoreItems,
        totalScoreDisplay: this.formatScore(this.data.totalScore),
        applyText: `本人申请 ${year} 学年 第${semester}学期 综测分数，分数明细如下。`,
        commitmentText: `本人承诺：以上申请分数及提交证明材料真实、完整、有效，已做到应申尽申，并愿承担相应责任。`,
        dateText: this.getCurrentDateText(),
        revisionText,
        exportStatusText,
        takeHighestWarningText,
      });
    },
    getCurrentDateText: function () {
      const date = new Date();
      const year = date.getFullYear();
      const month = `${date.getMonth() + 1}`.padStart(2, "0");
      const day = `${date.getDate()}`.padStart(2, "0");
      return `${year}年${month}月${day}日`;
    },
    getCurrentFileTimeText: function () {
      const date = new Date();
      const year = `${date.getFullYear()}`;
      const month = `${date.getMonth() + 1}`.padStart(2, "0");
      const day = `${date.getDate()}`.padStart(2, "0");
      const hour = `${date.getHours()}`.padStart(2, "0");
      const minute = `${date.getMinutes()}`.padStart(2, "0");
      const second = `${date.getSeconds()}`.padStart(2, "0");
      return `${year}${month}${day}${hour}${minute}${second}`;
    },
    normalizeFileNamePart: function (value: unknown) {
      const raw = String(value == null ? "" : value).trim();
      const safe = raw.replace(/[\\/:*?"<>|\r\n]+/g, "_");
      return safe || "未命名";
    },
    buildMaterialFileName: function (revision: number) {
      const studentName = this.normalizeFileNamePart(
        this.data.student && this.data.student.name,
      );
      const timeText = this.getCurrentFileTimeText();
      // revision 进文件名：同秒重复导出不会覆盖已分享的旧文件（旧文件作废由提示告知）。
      return `${studentName}_德育分材料_${timeText}_r${revision}.dyf`;
    },
    writeScoreMaterialFile: async function (
      materialData: string | ArrayBuffer,
      fileName: string,
    ) {
      const fs = wx.getFileSystemManager();
      const batch = getCurrentBatch();
      const year = batch ? String(batch.year == null ? "" : batch.year) : "";
      const semester = batch
        ? String(batch.semester == null ? "" : batch.semester)
        : "";
      const saveDir = `${wx.env.USER_DATA_PATH}/dyfMaterial/${year}/${semester}`;
      const filePath = `${saveDir}/${fileName}`;
      await new Promise<void>((resolve, reject) => {
        fs.mkdir({
          dirPath: saveDir,
          recursive: true,
          success: () => resolve(),
          fail: (error) => {
            if (
              error &&
              typeof error.errMsg === "string" &&
              error.errMsg.includes("file already exists")
            ) {
              resolve();
              return;
            }
            reject(error);
          },
        });
      });
      await new Promise<void>((resolve, reject) => {
        fs.writeFile({
          filePath,
          data: materialData,
          ...(typeof materialData === "string" ? { encoding: "utf8" as const } : {}),
          success: () => resolve(),
          fail: (error) => reject(error),
        });
      });
      return filePath;
    },
    formatScore: function (value: unknown) {
      const num = Number(value || 0);
      if (!Number.isFinite(num)) {
        return "0";
      }
      const fixed = num.toFixed(2);
      return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    },
    confirmTap: async function (event) {
      const sourcePath = String(
        (event && event.detail && event.detail.path) || "",
      );
      const imgwidth = Number(
        (event && event.detail && event.detail.width) || 0,
      );
      const imgheight = Number(
        (event && event.detail && event.detail.height) || 0,
      );
      const imgfile = await this.persistSignatureImage(sourcePath);
      this.setData({
        imgfile,
        imgwidth,
        imgheight,
        allimgfile: "",
      });
    },
    cancelTap: function () {
      wx.navigateTo({
        url: "/components/signature/fullScreen",
        success: (res) => {
          res.eventChannel.emit("setSignatureData", {
            imgfile: this.data.imgfile,
            imgwidth: this.data.imgwidth,
            imgheight: this.data.imgheight,
          });
          res.eventChannel.on("signatureChanged", async (data) => {
            const sourcePath = String(data.imgfile || "");
            const imgfile = await this.persistSignatureImage(sourcePath);
            this.setData({
              imgfile: imgfile || "",
              imgwidth: data.imgwidth || 0,
              imgheight: data.imgheight || 0,
              allimgfile: "",
            });
          });
        },
        fail: () => {
          Notify({
            type: "danger",
            message: "全屏签名打开失败",
            safeAreaInsetTop: true,
            top: 46,
          });
        },
      });
    },
    retDraw: function () {
      this.setData({
        imgfile: "",
        imgwidth: 0,
        imgheight: 0,
        allimgfile: "",
        previewDialogShow: false,
      });
    },
    submitSign: async function () {
      if (!this.data.imgfile) {
        Notify({
          type: "warning",
          message: "请先签名",
          safeAreaInsetTop: true,
          top: 46,
        });
        return;
      }
      const snapshotPath = await this.captureWholeSnapshot();
      if (snapshotPath) {
        const confirmSlipBase64 = await this.readLocalFileBase64(snapshotPath);
        let generated: { filePath: string; fileName: string } | null = null;
        try {
          generated = await this.generateMaterialFile(confirmSlipBase64);
        } catch (error) {
          console.error(error);
          Notify({
            type: "danger",
            message: "材料生成失败，请重试",
            safeAreaInsetTop: true,
            top: 46,
          });
          return;
        }
        if (!generated) {
          return;
        }
        this.setData({
          allimgfile: snapshotPath,
          previewDialogShow: true,
        });
        console.log("scoreSnapshot", snapshotPath);
      }
    },
    closePreviewDialog: function () {
      this.setData({
        previewDialogShow: false,
      });
    },
    onPreviewSnapshot: function () {
      if (!this.data.allimgfile) {
        return;
      }
      wx.previewImage({
        current: this.data.allimgfile,
        urls: [this.data.allimgfile],
      });
    },
    exportScoreMaterial: async function () {
      this.setData({
        previewDialogShow: false,
      });
      if (!(await canEditApply())) {
        Notify({
          type: "warning",
          message: "申请已进入审核阶段，无法修改或重新导出",
          safeAreaInsetTop: true,
          top: 46,
        });
        return;
      }
      const filePath = String(this.data.materialFilePath || "");
      const fileName = String(this.data.materialFileName || "");
      if (!filePath || !fileName) {
        Notify({
          type: "warning",
          message: "请先提交确认单",
          safeAreaInsetTop: true,
          top: 46,
        });
        return;
      }
      if (typeof wx.shareFileMessage !== "function") {
        Notify({
          type: "warning",
          message: "当前微信版本不支持发送文件",
          safeAreaInsetTop: true,
          top: 46,
        });
        return;
      }
      wx.shareFileMessage({
        filePath,
        fileName,
        success: () => {
          Notify({
            type: "success",
            message: "个人材料已发送",
            safeAreaInsetTop: true,
            top: 46,
          });
        },
        fail: () => {
          Notify({
            type: "warning",
            message: "发送已取消，可稍后再次发送",
            safeAreaInsetTop: true,
            top: 46,
          });
        },
        complete: () => {
          wx.navigateBack({
            delta: 1,
          });
        },
      });
    },
    persistSignatureImage: function (sourcePath: string) {
      return new Promise<string>((resolve) => {
        const src = String(sourcePath || "");
        if (!src) {
          resolve("");
          return;
        }
        if (src.startsWith(wx.env.USER_DATA_PATH)) {
          resolve(src);
          return;
        }
        const fs = wx.getFileSystemManager();
        const signatureDir = `${wx.env.USER_DATA_PATH}/signature`;
        fs.mkdir({
          dirPath: signatureDir,
          recursive: true,
          success: () => {
            const fileName = `sign_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
            const targetPath = `${signatureDir}/${fileName}`;
            fs.copyFile({
              srcPath: src,
              destPath: targetPath,
              success: () => resolve(targetPath),
              fail: () => resolve(src),
            });
          },
          fail: () => resolve(src),
        });
      });
    },
    captureWholeSnapshot: function () {
      return new Promise<string>((resolve) => {
        const systemInfo = wx.getWindowInfo();
        const canvasWidth = systemInfo.windowWidth;
        const baseHeight = 980 + this.data.scoreItems.length * 68;
        const canvasHeight = Math.max(baseHeight, 1400);
        this.setData({
          snapshotCanvasWidth: canvasWidth,
          snapshotCanvasHeight: canvasHeight,
        });
        wx.nextTick(() => {
          wx.createSelectorQuery()
            .in(this)
            .select("#scoreSnapshotCanvas")
            .fields({ node: true, size: true })
            .exec((res) => {
              const canvasInfo = Array.isArray(res) ? res[0] : null;
              if (!canvasInfo || !canvasInfo.node) {
                resolve("");
                return;
              }
              const canvasNode = canvasInfo.node;
              const context = canvasNode.getContext("2d");
              const dpr = systemInfo.pixelRatio || 1;
              canvasNode.width = canvasWidth * dpr;
              canvasNode.height = canvasHeight * dpr;
              context.scale(dpr, dpr);

              const pxWidth = canvasWidth;
              const paddingLeft = 16;
              const paddingRight = 16;
              const tableWidth = pxWidth - paddingLeft - paddingRight;
              const noWidth = Math.floor(tableWidth * 0.22);
              const scoreWidth = Math.floor(tableWidth * 0.22);
              const descWidth = tableWidth - noWidth - scoreWidth;
              let currentY = 30;
              const student = (this.data.student || {}) as Record<
                string,
                unknown
              >;
              const scoreItems = Array.isArray(this.data.scoreItems)
                ? this.data.scoreItems
                : [];

              context.fillStyle = "#ffffff";
              context.fillRect(0, 0, pxWidth, canvasHeight);
              context.fillStyle = "#111111";

              context.font = "bold 18px sans-serif";
              const titleText = this.data.titleText;
              context.fillText(
                titleText,
                (pxWidth - context.measureText(titleText).width) / 2,
                currentY + 24,
              );
              currentY += 50;

              context.font = "14px sans-serif";
              const baseInfoLines = [
                `姓名：${String(student.name == null ? "" : student.name)}`,
                `学号：${String(student.studentId == null ? "" : student.studentId)}`,
                `专业：${String(student.major == null ? "" : student.major)}`,
                `班级：${String(student.className == null ? "" : student.className)}`,
              ];
              baseInfoLines.forEach((line) => {
                currentY += 30;
                context.fillText(line, paddingLeft, currentY);
              });

              currentY += 18;
              const applyLines = this.breakLinesForCanvas(
                context,
                `　　${this.data.applyText}`,
                tableWidth,
                "14px sans-serif",
              );
              applyLines.forEach((line) => {
                currentY += 28;
                context.fillText(line, paddingLeft, currentY);
              });

              currentY += 20;
              const rowHeight = 38;
              const drawTableRow = (
                numberText: string,
                descText: string,
                scoreText: string,
                rowType: "header" | "normal" | "total",
              ) => {
                const rowTop = currentY;
                if (rowType === "header") {
                  context.fillStyle = "#f7f8fa";
                  context.fillRect(paddingLeft, rowTop, tableWidth, rowHeight);
                } else if (rowType === "total") {
                  context.fillStyle = "#ecf9ff";
                  context.fillRect(paddingLeft, rowTop, tableWidth, rowHeight);
                }
                context.strokeStyle = "#ebedf0";
                context.strokeRect(paddingLeft, rowTop, tableWidth, rowHeight);
                context.strokeRect(paddingLeft, rowTop, noWidth, rowHeight);
                context.strokeRect(
                  paddingLeft + noWidth,
                  rowTop,
                  descWidth,
                  rowHeight,
                );
                context.strokeRect(
                  paddingLeft + noWidth + descWidth,
                  rowTop,
                  scoreWidth,
                  rowHeight,
                );

                context.fillStyle = "#323233";
                context.font =
                  rowType === "header" || rowType === "total"
                    ? "bold 13px sans-serif"
                    : "13px sans-serif";
                const textY = rowTop + 24;
                const safeNo = this.trimTextToWidth(
                  context,
                  numberText,
                  noWidth - 16,
                );
                context.fillText(
                  safeNo,
                  paddingLeft +
                    (noWidth - context.measureText(safeNo).width) / 2,
                  textY,
                );
                const safeDesc = this.trimTextToWidth(
                  context,
                  descText,
                  descWidth - 16,
                );
                context.fillText(safeDesc, paddingLeft + noWidth + 8, textY);
                context.fillStyle = "#1989fa";
                context.font =
                  rowType === "total"
                    ? "bold 16px sans-serif"
                    : rowType === "header"
                      ? "bold 13px sans-serif"
                      : "13px sans-serif";
                const safeScore = this.trimTextToWidth(
                  context,
                  scoreText,
                  scoreWidth - 16,
                );
                context.fillText(
                  safeScore,
                  paddingLeft +
                    noWidth +
                    descWidth +
                    (scoreWidth - context.measureText(safeScore).width) / 2,
                  textY,
                );
                currentY += rowHeight;
              };

              drawTableRow("编号", "说明", "分数", "header");
              if (scoreItems.length > 0) {
                scoreItems.forEach((item) => {
                  drawTableRow(
                    item.number,
                    item.description,
                    this.formatScore(item.finalScore),
                    "normal",
                  );
                });
              } else {
                drawTableRow("-", "暂无已申请分数", "-", "normal");
              }
              drawTableRow("总分", "", this.data.totalScoreDisplay, "total");

              currentY += 26;
              context.fillStyle = "#323233";
              context.font = "14px sans-serif";
              const commitmentLines = this.breakLinesForCanvas(
                context,
                `　　${this.data.commitmentText}`,
                tableWidth,
                "14px sans-serif",
              );
              commitmentLines.forEach((line) => {
                currentY += 28;
                context.fillText(line, paddingLeft, currentY);
              });

              currentY += 16;
              const signText = "签名：";
              const dateText = `日期：${this.data.dateText}`;
              const signTextWidth = context.measureText(signText).width;
              const dateTextWidth = context.measureText(dateText).width;
              const closingWidth = Math.max(signTextWidth + 140, dateTextWidth);
              const closingX = pxWidth - paddingRight - closingWidth;
              const signY = currentY + 26;
              const dateY = signY + 36;
              context.fillStyle = "#111111";
              context.fillText(signText, closingX, signY);

              const exportCanvas = () => {
                setTimeout(() => {
                  wx.canvasToTempFilePath(
                    {
                      canvas: canvasNode,
                      x: 0,
                      y: 0,
                      width: pxWidth,
                      height: currentY,
                      destWidth: pxWidth * dpr,
                      destHeight: currentY * dpr,
                      success: (result) => {
                        resolve(result.tempFilePath);
                      },
                      fail: () => {
                        resolve("");
                      },
                    },
                    this,
                  );
                }, 30);
              };

              if (this.data.imgfile) {
                const rawWidth = this.data.imgwidth || 120;
                const rawHeight = this.data.imgheight || 60;
                const ratio = rawHeight > 0 ? rawWidth / rawHeight : 2;
                const targetHeight = 42;
                const targetWidth = Math.min(
                  120,
                  Math.max(80, targetHeight * ratio),
                );
                const drawX = closingX + signTextWidth + 6;
                const drawY = signY - targetHeight + 10;
                const signImage = canvasNode.createImage();
                signImage.onload = () => {
                  context.drawImage(
                    signImage,
                    drawX,
                    drawY,
                    targetWidth,
                    targetHeight,
                  );
                  context.fillText(dateText, closingX, dateY);
                  currentY = dateY + 24;
                  exportCanvas();
                };
                signImage.onerror = () => {
                  context.fillText(
                    "________________",
                    closingX + signTextWidth + 6,
                    signY,
                  );
                  context.fillText(dateText, closingX, dateY);
                  currentY = dateY + 24;
                  exportCanvas();
                };
                signImage.src = this.data.imgfile;
                return;
              }
              context.fillText(
                "________________",
                closingX + signTextWidth + 6,
                signY,
              );
              context.fillText(dateText, closingX, dateY);
              currentY = dateY + 24;
              exportCanvas();
            });
        });
      });
    },
    trimTextToWidth: function (context, text, width) {
      const source = String(text == null ? "" : text);
      if (context.measureText(source).width <= width) {
        return source;
      }
      let next = source;
      while (
        next.length > 0 &&
        context.measureText(`${next}...`).width > width
      ) {
        next = next.slice(0, -1);
      }
      return `${next}...`;
    },
    drawJustifiedText: function (context, text, x, y, width) {
      const content = String(text == null ? "" : text);
      if (content.length <= 1) {
        context.fillText(content, x, y);
        return;
      }
      const textWidth = context.measureText(content).width;
      if (textWidth >= width) {
        context.fillText(content, x, y);
        return;
      }
      const gap = (width - textWidth) / (content.length - 1);
      let currentX = x;
      for (let i = 0; i < content.length; i++) {
        const char = content[i];
        context.fillText(char, currentX, y);
        currentX += context.measureText(char).width + gap;
      }
    },
    findBreakPoint: function (text, width, context) {
      let min = 0;
      let max = text.length - 1;
      while (min <= max) {
        const middle = Math.floor((min + max) / 2);
        const middleWidth = context.measureText(text.substr(0, middle)).width;
        const nextWidth = context.measureText(text.substr(0, middle + 1)).width;
        if (middleWidth <= width && nextWidth > width) {
          return middle;
        }
        if (middleWidth < width) {
          min = middle + 1;
        } else {
          max = middle - 1;
        }
      }
      return -1;
    },
    breakLinesForCanvas: function (context, text, width, font) {
      const result: string[] = [];
      if (font) {
        context.font = font;
      }
      const textArray = String(text || "").split("\r\n");
      for (let i = 0; i < textArray.length; i++) {
        let currentText = textArray[i];
        let breakPoint = 0;
        while (
          (breakPoint = this.findBreakPoint(currentText, width, context)) !== -1
        ) {
          result.push(currentText.substr(0, breakPoint));
          currentText = currentText.substr(breakPoint);
        }
        if (currentText) {
          result.push(currentText);
        }
      }
      return result;
    },
    onBack() {
      if (this.data.scoreLoading) {
        Notify({
          type: "warning",
          message: "正在核算分数，请稍后",
          safeAreaInsetTop: true,
          top: 46,
        });
        return;
      }
      wx.navigateBack();
    },
  },
});
