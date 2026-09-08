/**
 * 小程序加密环境引导（shared 平台适配层，决策 #5/#8）。
 *
 * 要点：
 * 1. shared 的 CryptoProvider 使用可移植实现（node-forge RSA-OAEP-SHA256 + @noble AES-GCM/SHA-256），
 *    与管理端（WebCrypto）完全互通（见 shared `crypto/interop.test.ts`）。
 * 2. `wx.getRandomValues` 是**异步** API（Promise），而 CryptoProvider.randomBytes / forge
 *    内部 PRNG 种子均为**同步**接口，故采用“异步预热随机池 + 同步取用”：
 *    - 启动时异步预热随机池；
 *    - 导出前调用 `ensureRandomPool()` 确保池就绪；
 *    - 池内字节由 `wx.getRandomValues` 提供（密码学安全）。
 * 3. node-forge 的 RSA-OAEP 种子取自 `forge.random`，在小程序环境默认退化为 Math.random
 *   （弱随机），必须在初始化时覆盖 `forge.random.seedFileSync` 指向强随机池；
 *   注意 forge 每次取随机字节会向 seedFileSync 索要 1024 字节，池需保留足够余量。
 * 4. node-forge 模块加载依赖 `self`/`window` 探测全局对象，小程序中均未定义，
 *    必须先执行 `env-shim`（见下方首个 import）。
 *
 * 必须在任何 shared 加密调用前初始化（app.ts onLaunch 调用一次）。
 */
import { envShimmed } from './env-shim'
import forge from 'node-forge'
// 注意：微信模块解析不支持“目录 → index.js”回退，目录导入须显式写 /index
import { setCryptoProvider, getCryptoProvider } from '../shared/crypto/index'
import { createPortableProvider } from '../shared/crypto/portable-provider'

let initialized = false

/**
 * 随机池大小（字节）。forge 每次 reseed 消耗 1024 字节（RSA-OAEP 种子），
 * 加上 AES 会话密钥 32 + IV 12，单次导出约 1068 字节。
 * 4096 可支撑 2~3 次导出；池余量低于 RESERVE 时 `ensureRandomPool()` 自动补充。
 */
const POOL_SIZE = 4096
/** 池余量警戒线：低于该值视为不足，下次 ensureRandomPool 时补充。 */
const RESERVE = 2048
let randomPool: Uint8Array | null = null
let randomPoolOffset = 0
let pendingRefill: Promise<void> | null = null

/** 从随机池同步取用 length 字节。 */
function takeRandomBytes(length: number): Uint8Array {
  if (!randomPool || randomPoolOffset + length > randomPool.length) {
    throw new Error('随机数池未就绪或已耗尽，请重试')
  }
  const out = randomPool.slice(randomPoolOffset, randomPoolOffset + length)
  randomPoolOffset += length
  return out
}

/** 字节 → “二进制字符串”（每字符一字节），forge 种子接口的输入格式。 */
function binaryStringFromBytes(bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]!)
  }
  return result
}

/** 异步填充随机池（wx.getRandomValues）。 */
async function refillRandomPool(): Promise<void> {
  const result = await wx.getRandomValues({ length: POOL_SIZE })
  randomPool = new Uint8Array(result.randomValues)
  randomPoolOffset = 0
}

/**
 * 确保随机池可用（加密/导出前调用）。
 * 池余量充足时立即返回；否则等待异步填充完成。并发调用共享同一次填充。
 */
export function ensureRandomPool(): Promise<void> {
  if (randomPool && randomPoolOffset + RESERVE <= randomPool.length) {
    return Promise.resolve()
  }
  if (!pendingRefill) {
    pendingRefill = refillRandomPool().finally(() => {
      pendingRefill = null
    })
  }
  return pendingRefill
}

/** 注册小程序 CryptoProvider（幂等，可重复调用）。 */
export function setupWechatCryptoProvider(): void {
  if (initialized) {
    return
  }
  // 引用 envShimmed 确保 env-shim 已先于 node-forge 求值（防打包器丢弃副作用导入）
  if (envShimmed !== true) {
    throw new Error('环境补丁未生效（env-shim 未加载），无法初始化加密环境')
  }
  // 覆盖 node-forge 内部 PRNG 种子源：OAEP 种子来自 forge.random，
  // 小程序环境默认退化为 Math.random（弱随机），必须指向 wx 强随机池
  // （@types/node-forge 未声明 seedFileSync，此处按运行时 API 类型断言）
  ;(forge.random as unknown as { seedFileSync: (needed: number) => string }).seedFileSync = (
    needed: number,
  ) => binaryStringFromBytes(takeRandomBytes(needed))
  setCryptoProvider(
    createPortableProvider({
      randomBytes: (length) => takeRandomBytes(length),
    }),
  )
  initialized = true
  // 启动即预热随机池，导出时通常已就绪（导出前仍应调用 ensureRandomPool 兜底）
  void ensureRandomPool()
}

/** 生成 UUID v4（RFC 4122），用于 applyId。随机源为 wx.getRandomValues 随机池。 */
export function uuidV4(): string {
  const bytes = getCryptoProvider().randomBytes(16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // 版本 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // 变体 10
  const hex: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    hex.push(bytes[i]!.toString(16).padStart(2, '0'))
  }
  const h = hex.join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
