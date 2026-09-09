// pages/main/index.ts
import { ComponentWithStore } from "mobx-miniprogram-bindings";
import { studentStore } from "../../stores/student";
import { validateStudentFields } from "../../shared/validate/index";
import { getCurrentApply, syncApplyStatus } from "../../stores/apply";
import { capabilities } from "../../gateway/capabilities";
import { STATUS_HINT, RE_EXPORT_WARNING } from "../../config/messages";
import {
  cleanupCompressedImage,
  compressImageForEvidence,
} from "../../utils/image-compress";
import {
  isEvidenceRef,
  readEvidenceBase64,
} from "../../utils/local-vault";
import { resolveFileEntryPath } from "../../utils/file-entry";

import Notify from "@vant/weapp/notify/notify";
import Toast from "@vant/weapp/toast/toast";

const themeBehavior = require("../../behaviors/theme/theme");
let functionButtonObserver: WechatMiniprogram.IntersectionObserver | null =
  null;

/**
 * 校验单个证明材料条目是否真实可读（内容存在且非空）。
 * - EvidenceRef: 解封 vault/evidence 密文，失败/为空视为失效。
 * - legacy 路径: 文件存在且字节数 > 0；data URL 视为检查其内嵌内容是否为空。
 * 用于导出二次确认时识别"条目仍在但文件已被清理/误删"的失效图片。
 */
function isFileEntryReadable(fileItem: unknown): Promise<boolean> {
  if (isEvidenceRef(fileItem)) {
    return readEvidenceBase64(fileItem).then(
      (plainBase64) => Boolean(plainBase64),
    );
  }
  const filePath = resolveFileEntryPath(fileItem);
  if (!filePath) {
    return Promise.resolve(false);
  }
  if (filePath.indexOf("data:") === 0) {
    const splitIndex = filePath.indexOf(",");
    return Promise.resolve(
      splitIndex >= 0 && filePath.length > splitIndex + 1,
    );
  }
  return new Promise<boolean>((resolve) => {
    wx.getFileInfo({
      filePath,
      success: (result) => {
        resolve(Number(result.size) > 0);
      },
      fail: () => {
        resolve(false);
      },
    });
  });
}

ComponentWithStore({
  behaviors: [themeBehavior],

  properties: {},

  data: {
    classCascaderShow: false,
    exportConfirmShow: false,
    classValueErrorMessage: "",
    studentFieldErrors: {},
    scrollIntoViewId: "",
    showFloatingExportButton: true,
    skipNextShowReadMark: false,
    pageInitialized: false,
    caps: capabilities,
    statusHint: STATUS_HINT,
    applyStatusText: "",
    reExportWarning: "",
    configSignature: "",
  }, // 私有数据，可用于模板渲染

  storeBindings: {
    store: studentStore,
    fields: [
      "unit",
      "unitValue",
      "classInfo",
      "studentInfo",
      "scoreInfo",
      "student",
      "score",
      "classValue",
      "info",
      "configLoaded",
      "yearText",
      "semesterText",
      "batchIsTest",
      "configVersion",
      "configRevision",
    ] as const,
    actions: {
      initStore: "init",
      updateStudentStore: "update",
      markStudentRead: "markStudentRead",
      markStudentConfirm: "markStudentConfirm",
    } as const,
  },

  lifetimes: {
    // 生命周期函数，可以为函数，或一个在methods段中定义的方法名
    attached: async function () {
      Toast.loading({
        message: "正在加载配置...",
        forbidClick: true,
        duration: 0,
      });
      try {
        const notify = await this.initStore();
        await syncApplyStatus();
        this.updateStoreBindings();
        if (this.data.unit.length == 0) {
          wx.redirectTo({
            url: "/pages/privacyAndUnit/index",
          });
          return;
        }
        if (notify) {
          if (notify.modalTitle) {
            wx.showModal({
              title: notify.modalTitle,
              content: notify.msg,
              showCancel: false,
            });
          } else if (notify.toast) {
            Toast({ message: notify.msg, duration: 3500 });
          } else {
            Notify({
              type: notify.type,
              message: notify.msg,
              safeAreaInsetTop: true,
              top: 46,
            });
          }
        }
        const errorMap: Record<string, string> = {};
        const fields = (this.data.studentInfo || []) as Array<{ code: string }>;
        for (const field of fields) {
          errorMap[field.code] = "";
        }
        this.setData({ studentFieldErrors: errorMap });
        this.markStudentRead();
      } finally {
        Toast.clear();
        this.setData({
          skipNextShowReadMark: true,
          pageInitialized: true,
          configSignature: `${this.data.configVersion}-${this.data.configRevision}-${this.data.unitValue}`,
        });
      }
    },
    ready: function () {
      this.initFunctionButtonObserver();
    },
    moved: function () {},
    detached: function () {
      if (functionButtonObserver) {
        functionButtonObserver.disconnect();
        functionButtonObserver = null;
      }
    },
  },

  pageLifetimes: {
    // 组件所在页面的生命周期函数
    show() {
      if (typeof this.getTabBar === "function" && this.getTabBar()) {
        this.getTabBar().setData({
          active: 0,
        });
      }
      if (!this.data.pageInitialized || this.data.unit.length === 0) {
        return;
      }
      void this.refreshApplyStatus();
      // 单位/配置切换后重建校验错误表(字段集变化,旧错误不适用)。
      const signature = `${this.data.configVersion}-${this.data.configRevision}-${this.data.unitValue}`;
      if (signature !== this.data.configSignature) {
        const errorMap: Record<string, string> = {};
        const fields = (this.data.studentInfo || []) as Array<{ code: string }>;
        for (const field of fields) {
          errorMap[field.code] = "";
        }
        this.markStudentRead();
        this.setData({
          studentFieldErrors: errorMap,
          configSignature: signature,
          skipNextShowReadMark: false,
        });
        return;
      }
      if (this.data.skipNextShowReadMark) {
        this.setData({
          skipNextShowReadMark: false,
        });
        return;
      }
      this.markStudentRead();
    },
    hide: function () {},
    resize: function () {},
  },

  methods: {
    refreshApplyStatus: async function () {
      const apply = await syncApplyStatus();
      if (!apply) {
        this.setData({ applyStatusText: "" });
        return;
      }
      const labels: Record<string, string> = {
        draft: "尚未导出",
        submitted: "已导出，等待管理端导入",
        imported: "管理端审核中",
        reviewing: "管理端审核中",
        confirmed: "审核已确认",
      };
      this.setData({ applyStatusText: labels[apply.status] || "" });
    },
    syncFunctionButtonVisibilityByRect: function () {
      const query = this.createSelectorQuery();
      query.select("#function-button-anchor").boundingClientRect();
      query.exec((res) => {
        const rect = Array.isArray(res)
          ? (res[0] as { top?: number; bottom?: number })
          : null;
        if (
          !rect ||
          typeof rect.top !== "number" ||
          typeof rect.bottom !== "number"
        ) {
          this.setData({
            showFloatingExportButton: true,
          });
          return;
        }
        const windowHeight = wx.getWindowInfo().windowHeight;
        const isVisible = rect.bottom > 0 && rect.top < windowHeight;
        this.setData({
          showFloatingExportButton: !isVisible,
        });
      });
    },
    initFunctionButtonObserver: function () {
      this.syncFunctionButtonVisibilityByRect();
      wx.nextTick(() => {
        this.syncFunctionButtonVisibilityByRect();
      });
      setTimeout(() => {
        this.syncFunctionButtonVisibilityByRect();
      }, 80);
      if (functionButtonObserver) {
        functionButtonObserver.disconnect();
      }
      const nextObserver: WechatMiniprogram.IntersectionObserver =
        this.createIntersectionObserver({
          thresholds: [0, 0.05, 0.1, 0.5, 1],
        });
      functionButtonObserver = nextObserver;
      nextObserver.relativeToViewport();
      nextObserver.observe("#function-button-anchor", (res) => {
        const isVisible = !!res && res.intersectionRatio > 0;
        this.setData({
          showFloatingExportButton: !isVisible,
        });
      });
    },
    /** 按 itemCode 在 scoreInfo 树中查找 RenderItem。 */
    findScoreItem: function (code: string) {
      const scoreInfo = Array.isArray(this.data.scoreInfo)
        ? this.data.scoreInfo
        : [];
      for (const category of scoreInfo) {
        const groups = Array.isArray(category && category.groups)
          ? category.groups
          : [];
        for (const group of groups) {
          const items = Array.isArray(group && group.items) ? group.items : [];
          for (const item of items) {
            if (item && item.code === code) {
              return item;
            }
          }
        }
      }
      return null;
    },
    onClassCascaderShow: function () {
      this.setData({
        classCascaderShow: true,
      });
    },
    onClassCascaderClose: function () {
      this.setData({
        classCascaderShow: false,
      });
    },
    onClassCascaderFinish: function (event) {
      const { selectedOptions, value } = event.detail;
      this.updateStudentStore("classValue", {
        value: value,
        title: selectedOptions.map((option) => option.text).join(" "),
      });

      const studentInfo = Array.isArray(this.data.studentInfo)
        ? this.data.studentInfo
        : [];
      const fieldCodes = new Set<string>();
      for (const field of studentInfo) {
        if (field && field.code) {
          fieldCodes.add(field.code);
        }
      }

      const studentUpdate: Record<string, unknown> = {};
      const lastIndex = selectedOptions.length - 1;
      if (lastIndex >= 0) {
        const classNameValue = String(selectedOptions[lastIndex].value);
        if (fieldCodes.has("className")) {
          studentUpdate.className = classNameValue;
        }
        if (lastIndex >= 1) {
          const majorValue = String(selectedOptions[lastIndex - 1].value);
          if (fieldCodes.has("major")) {
            studentUpdate.major = majorValue;
          }
        }
      }
      this.updateStudentStore("student", studentUpdate);

      const clearErrorData: Record<string, unknown> = {
        classCascaderShow: false,
        classValueErrorMessage: "",
      };
      if (fieldCodes.has("className")) {
        clearErrorData["studentFieldErrors.className"] = "";
      }
      if (fieldCodes.has("major")) {
        clearErrorData["studentFieldErrors.major"] = "";
      }
      this.setData(clearErrorData);
    },
    onFeildChange: function (event) {
      const id = String(
        event.currentTarget.dataset.id == null
          ? ""
          : event.currentTarget.dataset.id,
      );
      const type = String(
        event.currentTarget.dataset.type == null
          ? ""
          : event.currentTarget.dataset.type,
      );
      if (!id) {
        return;
      }
      let rawValue = event.detail;
      if (rawValue && typeof rawValue === "object") {
        rawValue = (rawValue as { value?: unknown }).value;
      }
      if (type === "score") {
        let scoreValue = Number(rawValue);
        if (!Number.isFinite(scoreValue)) {
          scoreValue = 0;
        }
        const item = this.findScoreItem(id);
        if (item) {
          if (typeof item.min === "number" && scoreValue < item.min) {
            scoreValue = item.min;
          }
          if (typeof item.max === "number" && scoreValue > item.max) {
            scoreValue = item.max;
          }
          if (typeof item.decimals === "number") {
            scoreValue = Number(scoreValue.toFixed(item.decimals));
          }
        }
        this.updateStudentStore("score", { [id]: { score: scoreValue } });
      } else {
        this.updateStudentStore("student", { [id]: rawValue });
        this.setData({
          [`studentFieldErrors.${id}`]: "",
        });
      }
    },
    validateBasicInfo: function () {
      const studentInfo = Array.isArray(this.data.studentInfo)
        ? this.data.studentInfo
        : [];
      const studentData = (this.data.student || {}) as Record<string, unknown>;
      const studentFieldErrors: Record<string, string> = {};
      let classValueErrorMessage = "";
      let scrollIntoViewId = "";

      const classValueTitle = String(
        (this.data.classValue && this.data.classValue.title) == null
          ? ""
          : this.data.classValue.title,
      ).trim();
      if (!classValueTitle) {
        classValueErrorMessage = "请选择班级信息";
        scrollIntoViewId = "class-value-field";
      }

      const result = validateStudentFields(studentInfo, studentData);
      const errorSet = new Set(result.errors);

      for (const field of studentInfo) {
        if (!field || !field.code) {
          continue;
        }
        const code = field.code;
        const value = String(
          studentData[code] == null ? "" : studentData[code],
        ).trim();
        let message = "";
        if (value === "" && field.required) {
          message = String(
            field.message == null ? `${field.label}不能为空` : field.message,
          );
        } else if (
          value !== "" &&
          !field.fromClass &&
          typeof field.pattern === "string" &&
          field.pattern.length > 0
        ) {
          let matches = true;
          try {
            matches = new RegExp(field.pattern).test(value);
          } catch (error) {
            matches = true;
          }
          if (!matches) {
            message = String(
              field.message == null
                ? `${field.label}格式不正确`
                : field.message,
            );
          }
        }
        if (message && errorSet.has(message)) {
          studentFieldErrors[code] = message;
          if (!scrollIntoViewId) {
            scrollIntoViewId = `student-field-${code}`;
          }
        }
      }

      this.setData({
        classValueErrorMessage,
        studentFieldErrors,
        scrollIntoViewId,
      });
      return (
        !classValueErrorMessage && Object.keys(studentFieldErrors).length === 0
      );
    },
    afterReadSupportImage: async function (event) {
      try {
        const { file, name } = event.detail;
        const scoreId = String(name == null ? "" : name);
        if (!scoreId) {
          return;
        }
        const files = Array.isArray(file) ? file : [file];
        const currentScore = (this.data.score || {})[scoreId] as
          | {
              score?: number;
              file?: Array<{
                url: string;
                name?: string;
                size?: number;
                type?: string;
                mimeType?: string;
              }>;
            }
          | undefined;
        const nextFileList: Array<{
          url: string;
          name?: string;
          size?: number;
          type?: string;
          mimeType?: string;
        }> =
          currentScore && Array.isArray(currentScore.file)
            ? currentScore.file.slice()
            : [];
        const existedPathSet = new Set(
          nextFileList
            .map((item) => String((item && item.url) || ""))
            .filter(Boolean),
        );
        const fs = wx.getFileSystemManager();
        const supportImageDir = `${wx.env.USER_DATA_PATH}/supportImage`;
        await new Promise<void>((resolve, reject) => {
          fs.mkdir({
            dirPath: supportImageDir,
            recursive: true,
            success: () => resolve(),
            fail: (error) => {
              if (
                error &&
                typeof error.errMsg === "string" &&
                error.errMsg.indexOf("already exists") >= 0
              ) {
                resolve();
                return;
              }
              reject(error);
            },
          });
        });
        for (const sourceFile of files) {
          const sourcePath = String(
            (sourceFile &&
              (sourceFile.tempFilePath || sourceFile.url || sourceFile.path)) ||
              "",
          );
          if (!sourcePath || existedPathSet.has(sourcePath)) {
            continue;
          }
          const compression = await compressImageForEvidence({
            src: sourcePath,
            owner: this,
            originalSize: Number(sourceFile && sourceFile.size) || 0,
          });
          const sourceForCopy = compression.path;
          const extMatch = sourceForCopy.match(/\.[^./\\?]+(?=$|\?)/);
          const ext = extMatch ? extMatch[0] : ".jpg";
          const targetPath = `${supportImageDir}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
          try {
            await new Promise<void>((resolve, reject) => {
              fs.copyFile({
                srcPath: sourceForCopy,
                destPath: targetPath,
                success: () => resolve(),
                fail: (error) => reject(error),
              });
            });
          } finally {
            await cleanupCompressedImage(compression);
          }
          nextFileList.push({
            url: targetPath,
            name: String(
              (sourceFile && (sourceFile.name || sourceFile.fileName)) || "",
            ),
            size:
              compression.outputSize ||
              Number(sourceFile && sourceFile.size) ||
              0,
            type: String(
              (sourceFile && (sourceFile.type || sourceFile.mimeType)) ||
                "image",
            ),
            mimeType:
              compression.mimeType ||
              String((sourceFile && sourceFile.mimeType) || ""),
          });
          existedPathSet.add(targetPath);
        }
        this.updateStudentStore("score", {
          [scoreId]: {
            ...(currentScore || {}),
            file: nextFileList,
          },
        });
      } catch (error) {
        console.error(error);
        Notify({
          type: "danger",
          message: "图片保存失败，请重试",
          safeAreaInsetTop: true,
          top: 46,
        });
      }
    },
    onDeleteSupportImage: async function (event) {
      try {
        const { name, index, file } = event.detail;
        const scoreId = String(name == null ? "" : name);
        if (!scoreId) {
          return;
        }
        const currentScore = (this.data.score || {})[scoreId] as
          { score?: number; file?: Array<{ url: string }> } | undefined;
        const currentFileList: Array<{ url: string }> =
          currentScore && Array.isArray(currentScore.file)
            ? currentScore.file
            : [];
        const removeIndex = Number(index);
        const removedFile =
          Number.isInteger(removeIndex) &&
          removeIndex >= 0 &&
          removeIndex < currentFileList.length
            ? currentFileList[removeIndex]
            : file;
        const nextFileList = currentFileList.filter(
          (_, currentIndex) => currentIndex !== removeIndex,
        );
        this.updateStudentStore("score", {
          [scoreId]: {
            ...(currentScore || {}),
            file: nextFileList,
          },
        });
        const removedPath = String(
          (removedFile && (removedFile.url || removedFile.path)) || "",
        );
        if (!removedPath || removedPath.indexOf(wx.env.USER_DATA_PATH) !== 0) {
          return;
        }
        const stillUsed = nextFileList.some(
          (item) => String((item && item.url) || "") === removedPath,
        );
        if (stillUsed) {
          return;
        }
        const fs = wx.getFileSystemManager();
        await new Promise<void>((resolve, reject) => {
          fs.unlink({
            filePath: removedPath,
            success: () => resolve(),
            fail: (error) => {
              if (
                error &&
                typeof error.errMsg === "string" &&
                error.errMsg.indexOf("no such file") >= 0
              ) {
                resolve();
                return;
              }
              reject(error);
            },
          });
        });
      } catch (error) {
        console.error(error);
        Notify({
          type: "danger",
          message: "删除图片失败，请重试",
          safeAreaInsetTop: true,
          top: 46,
        });
      }
    },
    onPreviewSupportImage: async function (event) {
      const detail = (event && event.detail) || {};
      const detailRecord = detail as Record<string, unknown>;
      const url = String(detailRecord.url || detailRecord.thumb || "");
      if (!url) {
        return;
      }
      wx.previewImage({
        urls: [url],
        current: url,
      });
    },
    exportFile: async function () {
      const currentApply = await getCurrentApply();
      const reExportWarning =
        currentApply && currentApply.currentRevision > 0
          ? RE_EXPORT_WARNING
          : "";
      this.setData({
        exportConfirmShow: true,
        reExportWarning,
      });
    },
    // 排名入口(仅在线档 rankingView=true 时可见,离线档该入口被能力隐藏)
    onRankingTap: function () {
      Notify({
        type: "primary",
        message: "排名功能暂未开放",
        safeAreaInsetTop: true,
        top: 46,
      });
    },
    beforeExportDialogClose: function () {
      this.setData({
        exportConfirmShow: false,
      });
    },
    onExportDialogConfirm: async function () {
      this.setData({
        exportConfirmShow: false,
      });

      Toast.loading({
        message: "检查分数中...",
        forbidClick: true,
        duration: 0,
      });

      const basicInfoValid = this.validateBasicInfo();
      if (!basicInfoValid) {
        Toast.clear();
        return;
      }

      const scoreCategories = Array.isArray(this.data.scoreInfo)
        ? this.data.scoreInfo
        : [];
      const scoreData = (this.data.score || {}) as Record<
        string,
        { score?: unknown; file?: unknown[] }
      >;
      // 清理缓存/垃圾清理可能误删本地图片文件：条目仍在（file 非空）但实际文件已缺失
      // 或为空，缩略图仍显示已上传状态，导出却嵌入不到真实证明材料。二次确认时逐张
      // 校验可读性，失效条目直接移除（恢复为未上传状态），并阻止导出、提示用户。
      const nextScoreUpdate: Record<string, { file?: unknown[] }> = {};
      let hasBrokenSupportImage = false;
      let brokenSupportScrollId = "";
      let hasMissingSupportImage = false;
      let missingSupportScrollId = "";

      for (const category of scoreCategories) {
        const groups = Array.isArray(category && category.groups)
          ? category.groups
          : [];
        for (const group of groups) {
          const items = Array.isArray(group && group.items) ? group.items : [];
          for (const item of items) {
            const scoreId = String(item && item.code == null ? "" : item.code);
            if (!scoreId || !(item && item.needSupport)) {
              continue;
            }
            const currentScore = scoreData[scoreId];
            const scoreValue = currentScore && currentScore.score;
            const hasScore = Number(scoreValue || 0) !== 0;
            if (!hasScore) {
              continue;
            }
            const fileList =
              currentScore && Array.isArray(currentScore.file)
                ? currentScore.file
                : [];
            if (fileList.length === 0) {
              hasMissingSupportImage = true;
              if (!missingSupportScrollId) {
                missingSupportScrollId = `score-field-${scoreId}`;
              }
              continue;
            }
            const keptFileList: unknown[] = [];
            for (const fileItem of fileList) {
              if (await isFileEntryReadable(fileItem)) {
                keptFileList.push(fileItem);
                continue;
              }
              hasBrokenSupportImage = true;
              if (!brokenSupportScrollId) {
                brokenSupportScrollId = `support-field-${scoreId}`;
              }
            }
            if (keptFileList.length !== fileList.length) {
              nextScoreUpdate[scoreId] = {
                ...(currentScore || {}),
                file: keptFileList,
              };
            }
          }
        }
      }
      if (Object.keys(nextScoreUpdate).length > 0) {
        this.updateStudentStore("score", nextScoreUpdate);
      }
      if (hasBrokenSupportImage) {
        this.setData({
          scrollIntoViewId: brokenSupportScrollId,
        });
        Toast.clear();
        Notify({
          type: "danger",
          message: "部分证明材料图片文件已丢失，已移除失效图片，请重新上传后再导出",
          safeAreaInsetTop: true,
          top: 46,
        });
        return;
      }
      if (hasMissingSupportImage) {
        this.setData({
          scrollIntoViewId: missingSupportScrollId,
        });
        Toast.clear();
        Notify({
          type: "danger",
          message: "有项目未上传证明材料",
          safeAreaInsetTop: true,
          top: 46,
        });
        return;
      }
      Toast.clear();
      this.markStudentConfirm();
      wx.navigateTo({ url: "/pages/main/score" });
    },
  },
});
