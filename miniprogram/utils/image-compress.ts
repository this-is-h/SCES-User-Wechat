/**
 * 学生端证明材料压缩。
 *
 * 优先使用微信原生 2D Canvas 的 WebP Data URL；基础库或设备不支持时回退到
 * canvasToTempFilePath 的 JPEG/PNG。压缩只在图片较大或分辨率过高时触发，失败时返回原图。
 */

export interface CompressImageOptions {
  /** 原图本地路径。 */
  src: string
  /** 当前页面/组件实例，用于查找隐藏 canvas 和调用 canvasToTempFilePath。 */
  owner: unknown
  /** 上传组件已提供的原图大小；未知时传 0。 */
  originalSize?: number
}

export interface CompressImageResult {
  path: string
  compressed: boolean
  originalSize: number
  outputSize: number
  /** 实际输出格式；未压缩时表示原图格式。 */
  mimeType?: string
  /** 压缩生成的临时文件；调用方复制完成后应清理。 */
  temporaryPath?: string
}

interface ImageInfo {
  width: number
  height: number
  path: string
  orientation: string
  type: string
}

interface CanvasNode {
  width: number
  height: number
  getContext(type: '2d'): {
    clearRect(x: number, y: number, width: number, height: number): void
    fillRect(x: number, y: number, width: number, height: number): void
    fillStyle: string
    save(): void
    restore(): void
    translate(x: number, y: number): void
    rotate(angle: number): void
    scale(x: number, y: number): void
    drawImage(image: unknown, x: number, y: number, width: number, height: number): void
  }
  createImage(): {
    src: string
    onload: (() => void) | null
    onerror: (() => void) | null
  }
  /** 基础库 2.11+ 的 2D Canvas 导出能力；不支持时由回退路径处理。 */
  toDataURL?: (type: string, encoderOptions: number) => string
}

interface FileInfo {
  size: number
}

// 4096px 足以保留手机拍摄的证明文字；仅对更高分辨率图片做等比例缩放。
const MAX_DIMENSION = 4096
const REENCODE_THRESHOLD = 2 * 1024 * 1024

function getImageInfo(src: string): Promise<ImageInfo> {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: (result) => resolve(result as ImageInfo),
      fail: () => reject(new Error('无法读取图片信息'))
    })
  })
}

function getFileSize(src: string): Promise<number> {
  return new Promise((resolve) => {
    wx.getFileInfo({
      filePath: src,
      success: (result) => resolve(Number((result as FileInfo).size) || 0),
      fail: () => resolve(0)
    })
  })
}

function selectCanvas(owner: unknown): Promise<CanvasNode> {
  return new Promise((resolve, reject) => {
    const query = wx.createSelectorQuery()
    const scopedQuery = owner ? query.in(owner as never) : query
    scopedQuery
      .select('#evidenceCompressCanvas')
      .fields({ node: true, size: true })
      .exec((result: Array<{ node?: CanvasNode }> | undefined) => {
        const node = result && result[0] ? result[0].node : undefined
        if (!node) {
          reject(new Error('图片压缩画布未就绪'))
          return
        }
        resolve(node)
      })
  })
}

function loadImage(canvas: CanvasNode, src: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解码失败'))
    image.src = src
  })
}

function orientedSize(info: ImageInfo): { width: number; height: number } {
  const rotated = info.orientation === 'left' || info.orientation === 'right' ||
    info.orientation === 'left-mirrored' || info.orientation === 'right-mirrored'
  return rotated
    ? { width: info.height, height: info.width }
    : { width: info.width, height: info.height }
}

function drawOriented(
  context: ReturnType<CanvasNode['getContext']>,
  image: unknown,
  info: ImageInfo,
  width: number,
  height: number
): void {
  const rotated = info.orientation === 'left' || info.orientation === 'right' ||
    info.orientation === 'left-mirrored' || info.orientation === 'right-mirrored'
  const drawWidth = rotated ? height : width
  const drawHeight = rotated ? width : height
  context.save()
  switch (info.orientation) {
    case 'up-mirrored':
      context.translate(width, 0)
      context.scale(-1, 1)
      break
    case 'down':
      context.translate(width, height)
      context.rotate(Math.PI)
      break
    case 'down-mirrored':
      context.translate(width, height)
      context.rotate(Math.PI)
      context.scale(-1, 1)
      break
    case 'right':
      context.translate(width, 0)
      context.rotate(Math.PI / 2)
      break
    case 'left':
      context.translate(0, height)
      context.rotate(-Math.PI / 2)
      break
    case 'right-mirrored':
      context.translate(width, 0)
      context.rotate(Math.PI / 2)
      context.scale(-1, 1)
      break
    case 'left-mirrored':
      context.translate(0, height)
      context.rotate(-Math.PI / 2)
      context.scale(-1, 1)
      break
    default:
      break
  }
  context.drawImage(image, 0, 0, drawWidth, drawHeight)
  context.restore()
}

function drawToCanvas(
  canvas: CanvasNode,
  image: unknown,
  info: ImageInfo,
  width: number,
  height: number,
  fileType: 'jpg' | 'png' | 'webp'
): void {
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, width, height)
  if (fileType === 'jpg') {
    // JPEG 没有透明通道；白底比黑底更适合证明材料和扫描件。
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
  }
  drawOriented(context, image, info, width, height)
}

function renderToFile(
  canvas: CanvasNode,
  image: unknown,
  info: ImageInfo,
  width: number,
  height: number,
  fileType: 'jpg' | 'png',
  quality: number,
  owner: unknown
): Promise<string> {
  drawToCanvas(canvas, image, info, width, height, fileType)

  return new Promise((resolve, reject) => {
    const options = {
      canvas,
      x: 0,
      y: 0,
      width,
      height,
      destWidth: width,
      destHeight: height,
      fileType,
      quality,
      success: (result: { tempFilePath: string }) => resolve(result.tempFilePath),
      fail: () => reject(new Error('图片编码失败'))
    }
    // 等待本轮 2D 绘制提交后再导出，兼容开发者工具和真机。
    setTimeout(() => {
      if (owner) wx.canvasToTempFilePath(options, owner as never)
      else wx.canvasToTempFilePath(options)
    }, 0)
  })
}

function makeTemporaryPath(extension: 'webp'): string {
  return `${wx.env.USER_DATA_PATH}/evidence-compress-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`
}

function renderToWebpFile(
  canvas: CanvasNode,
  image: unknown,
  info: ImageInfo,
  width: number,
  height: number,
  quality: number
): Promise<string> {
  if (typeof canvas.toDataURL !== 'function') {
    return Promise.reject(new Error('当前基础库不支持 WebP 导出'))
  }
  drawToCanvas(canvas, image, info, width, height, 'webp')
  let dataUrl: string
  try {
    dataUrl = canvas.toDataURL('image/webp', quality)
  } catch (error) {
    void error
    return Promise.reject(new Error('WebP 图片编码失败'))
  }
  const marker = ';base64,'
  const markerIndex = dataUrl.indexOf(marker)
  const mime = markerIndex > 5 ? dataUrl.slice(5, markerIndex).toLowerCase() : ''
  const base64 = markerIndex >= 0 ? dataUrl.slice(markerIndex + marker.length) : ''
  // 不支持 WebP 的实现可能静默返回 PNG；必须检查 MIME，不能误把 PNG 命名为 WebP。
  if (mime !== 'image/webp' || !base64) {
    return Promise.reject(new Error('当前基础库未生成 WebP'))
  }
  const filePath = makeTemporaryPath('webp')
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath,
      data: base64,
      encoding: 'base64',
      success: () => resolve(filePath),
      fail: () => {
        void removeFile(filePath)
        reject(new Error('WebP 临时文件写入失败'))
      }
    })
  })
}

function qualityCandidates(size: number): number[] {
  if (size >= 8 * 1024 * 1024) return [0.94, 0.9, 0.86]
  if (size >= 4 * 1024 * 1024) return [0.96, 0.92, 0.88]
  return [0.97, 0.93, 0.89]
}

function webpQualityCandidates(size: number): number[] {
  // 先尝试较高质量，只有无法取得明显体积收益时才降低质量。
  if (size >= 8 * 1024 * 1024) return [0.86, 0.8, 0.74]
  if (size >= 4 * 1024 * 1024) return [0.88, 0.82, 0.76]
  return [0.9, 0.84, 0.78]
}

function removeFile(filePath: string): Promise<void> {
  return new Promise((resolve) => {
    wx.getFileSystemManager().unlink({ filePath, success: () => resolve(), fail: () => resolve() })
  })
}

interface EncodedImage {
  path: string
  size: number
  quality: number
}

async function findBestEncodedImage(
  candidates: number[],
  sourceSize: number,
  render: (quality: number) => Promise<string>
): Promise<EncodedImage | null> {
  let best: EncodedImage | null = null
  for (const quality of candidates) {
    let path: string
    try {
      path = await render(quality)
    } catch (error) {
      void error
      continue
    }
    const size = await getFileSize(path)
    const smallerThanSource = size > 0 && (sourceSize <= 0 || size < sourceSize)
    if (!smallerThanSource) {
      await removeFile(path)
      continue
    }
    if (!best || size < best.size || (quality > best.quality && size <= sourceSize * 0.9)) {
      if (best) await removeFile(best.path)
      best = { path, size: size || sourceSize, quality }
    } else {
      await removeFile(path)
    }
    if (sourceSize <= 0) {
      break
    }
    if (sourceSize > 0 && size > 0 && size <= sourceSize * 0.9) {
      break
    }
  }
  return best
}

function imageMimeType(type: string): string {
  switch (type) {
    case 'jpeg':
    case 'jpg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return ''
  }
}

/**
 * 对图片做温和压缩。原图较小/分辨率合理时直接返回原图；任何压缩失败都不影响上传。
 */
export async function compressImageForEvidence(options: CompressImageOptions): Promise<CompressImageResult> {
  const sourceSize = options.originalSize && options.originalSize > 0
    ? options.originalSize
    : await getFileSize(options.src)
  let info: ImageInfo
  try {
    info = await getImageInfo(options.src)
  } catch (error) {
    void error
    return { path: options.src, compressed: false, originalSize: sourceSize, outputSize: sourceSize }
  }

  // GIF/TIFF/未知格式不做有损转码，避免动画或特殊格式被破坏。
  if (info.type !== 'jpeg' && info.type !== 'png') {
    return {
      path: options.src,
      compressed: false,
      originalSize: sourceSize,
      outputSize: sourceSize,
      mimeType: imageMimeType(info.type)
    }
  }
  const sourceDimensions = orientedSize(info)
  if (
    !Number.isFinite(sourceDimensions.width) ||
    !Number.isFinite(sourceDimensions.height) ||
    sourceDimensions.width <= 0 ||
    sourceDimensions.height <= 0
  ) {
    return {
      path: options.src,
      compressed: false,
      originalSize: sourceSize,
      outputSize: sourceSize,
      mimeType: imageMimeType(info.type)
    }
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(sourceDimensions.width, sourceDimensions.height))
  const width = Math.max(1, Math.round(sourceDimensions.width * scale))
  const height = Math.max(1, Math.round(sourceDimensions.height * scale))
  if (sourceSize > 0 && sourceSize <= REENCODE_THRESHOLD && scale === 1) {
    return {
      path: options.src,
      compressed: false,
      originalSize: sourceSize,
      outputSize: sourceSize,
      mimeType: imageMimeType(info.type)
    }
  }

  let canvas: CanvasNode
  let image: unknown
  try {
    canvas = await selectCanvas(options.owner)
    image = await loadImage(canvas, info.path || options.src)
  } catch (error) {
    void error
    return { path: options.src, compressed: false, originalSize: sourceSize, outputSize: sourceSize }
  }

  const fileType: 'jpg' | 'png' = info.type === 'png' ? 'png' : 'jpg'
  let best: EncodedImage | null = null
  try {
    // WebP 优先：通过 MIME 检查和实际字节数双重确认，失败即走兼容回退。
    const webpBest = await findBestEncodedImage(
      webpQualityCandidates(sourceSize),
      sourceSize,
      (quality) => renderToWebpFile(canvas, image, info, width, height, quality)
    )
    if (webpBest) {
      return {
        path: webpBest.path,
        compressed: true,
        originalSize: sourceSize,
        outputSize: webpBest.size,
        mimeType: 'image/webp',
        temporaryPath: webpBest.path
      }
    }

    const candidates = fileType === 'jpg' ? qualityCandidates(sourceSize) : [1]
    best = await findBestEncodedImage(
      candidates,
      sourceSize,
      (quality) => renderToFile(canvas, image, info, width, height, fileType, quality, options.owner)
    )
  } catch (error) {
    void error
    if (best) await removeFile(best.path)
    best = null
  }
  if (!best) {
    return {
      path: options.src,
      compressed: false,
      originalSize: sourceSize,
      outputSize: sourceSize,
      mimeType: imageMimeType(info.type)
    }
  }
  return {
    path: best.path,
    compressed: true,
    originalSize: sourceSize,
    outputSize: best.size,
    mimeType: fileType === 'jpg' ? 'image/jpeg' : 'image/png',
    temporaryPath: best.path
  }
}

export async function cleanupCompressedImage(result: CompressImageResult): Promise<void> {
  if (result.temporaryPath) await removeFile(result.temporaryPath)
}
