/**
 * legacy file 元素路径/元数据提取（url/localPath/tempFilePath/path/字符串/data-url）。
 *
 * 统一入口：local-vault（迁移）、pages/main（导出前可读性校验）、pages/main/score（导出序列化）
 * 三处此前各自实现，收敛到本模块避免漂移。ES2017 目标（无 ?. / ??）。
 */

/** 从 legacy file 元素提取文件路径（path object / string / base64 data-url）。 */
export function resolveFileEntryPath(fileItem: unknown): string {
  if (typeof fileItem === "string") {
    return fileItem;
  }
  if (!fileItem || typeof fileItem !== "object" || Array.isArray(fileItem)) {
    return "";
  }
  const fileRecord = fileItem as Record<string, unknown>;
  return String(
    fileRecord.url ||
      fileRecord.localPath ||
      fileRecord.tempFilePath ||
      fileRecord.path ||
      ""
  );
}

/** 从 legacy file 元素提取展示元数据。 */
export function fileEntryMeta(fileItem: unknown): {
  name: string;
  size: number;
  mime: string;
} {
  const record =
    fileItem && typeof fileItem === "object" && !Array.isArray(fileItem)
      ? (fileItem as Record<string, unknown>)
      : null;
  return {
    name: String((record && record.name) || ""),
    size: Number(record && record.size) || 0,
    mime: String(
      (record && (record.mimeType || record.type || record.mime)) || ""
    ),
  };
}
