/**
 * 本地数据保护（决策 #47）。
 *
 * 把落盘内容变成密文串，避免用户 PII 与证明材料以明文存在于 storage / 文件系统。
 * 密钥 = sha256(派生域 ‖ per-install 密钥 ‖ 首启生成的 deviceSalt)。
 *
 * 安全边界（务必如实告知）：能防明文落盘、storage 导出、误分享、手机备份泄露；
 * 不能防「拿到小程序包 + 设备存储」的定向攻击者——密钥存于本地 storage，理论可提取。
 *
 * 派生：
 *   appSecret  : 32B 随机，per-install 生成（首启 randomBytes(32)）→ storage key 'vaultSecret'
 *   deviceSalt : 32B 随机，首启 randomBytes(32) → storage key 'vaultSalt'（非机密）
 *   vaultKey   = sha256( utf8('dys-local-vault-v1:') ‖ appSecret ‖ deviceSalt )
 *   密文串     = `1.<base64 iv(12B)>.<base64 AES-256-GCM(vaultKey, utf8(json))>`
 *
 * - 单次 sha256 而非 HKDF/PBKDF2：IKM 是 32 字节高熵随机串，不是低熵口令，拉伸无意义。
 * - deviceSalt 使不同设备的密文互不通用：即便密钥泄露，也需逐设备取 salt 才能解。
 * - openJson / openBytes 失败返回 null 而不抛：密钥轮换、或用户清了 storage，
 *   草稿解不开是预期情况，必须优雅退化为「没有草稿」。
 * - 离线版（beta）曾用编译进包的固定常量作 appSecret；该版本已下线，旧密文不再可解（视为作废）。
 *
 * ES2017 目标：不用 `?.` / `??` / `catch {}`（见 shared/nullish.ts）。
 */
import { getCryptoProvider } from '../shared/crypto/index'
import { aesGcmEncrypt, aesGcmDecrypt } from '../shared/crypto/aes'
import { sha256Bytes, sha256Hex } from '../shared/crypto/hash'
import { bytesToBase64, base64ToBytes, utf8ToBytes, bytesToUtf8 } from '../shared/crypto/encoding'
import { ensureRandomPool } from './crypto'
import { fileEntryMeta, resolveFileEntryPath } from './file-entry'

/** 存储密钥版本号（0 = 旧明文；1 = 当前密封）。 */
export const VAULT_VERSION_KEY = 'vaultVersion'
/** deviceSalt 的 storage key（非机密，仅用于派生密钥）。 */
const DEVICE_SALT_KEY = 'vaultSalt'
/** per-install 保护密钥的 storage key（32B base64，首启生成，不随代码分发）。 */
const VAULT_SECRET_KEY = 'vaultSecret'
/** 密封串版本前缀（与决策 #47 一致）。 */
const SEAL_VERSION = '1'
/** 密钥派生域分隔常量。 */
const VAULT_DOMAIN = 'dys-local-vault-v1:'
/** vault 根目录（USER_DATA_PATH/vault）。 */
export const VAULT_ROOT = 'vault'
/** 证据密文目录（vault/evidence）。 */
export const VAULT_EVIDENCE_DIR = 'vault/evidence'
/** 临时预览目录（vault/tmp）。 */
export const VAULT_TMP_DIR = 'vault/tmp'
/** 证据密文文件后缀。 */
const EVIDENCE_EXT = '.bin'

/** 证据引用（score[item].file 中不再存 base64 / 临时路径，只存引用）。 */
export interface EvidenceRef {
  /** 内容哈希（sha256Hex of 明文 base64），即文件名 `<id>.bin`。 */
  id: string
  /** 原文件名（展示用）。 */
  name: string
  /** 明文字节数（展示用）。 */
  size: number
  /** 'image/jpeg' 等。 */
  mime: string
}

let cachedVaultKey: Uint8Array | null = null
let vaultKeyPromise: Promise<Uint8Array> | null = null

/** 读取（或首启生成并落盘）本机保护密钥（32B）。 */
function getAppSecret(): Uint8Array {
  const stored = wx.getStorageSync(VAULT_SECRET_KEY)
  if (stored && typeof stored === 'string') {
    try {
      const bytes = base64ToBytes(stored)
      if (bytes.length === 32) {
        return bytes
      }
    } catch (error) {
      // 损坏的密钥：走重新生成路径
    }
  }
  if (stored && typeof stored === 'string') {
    console.warn('[vault] 本地保护密钥损坏，本机已加密的草稿可能无法恢复；将重新生成密钥')
  }
  const fresh = getCryptoProvider().randomBytes(32)
  wx.setStorageSync(VAULT_SECRET_KEY, bytesToBase64(fresh))
  return fresh
}

/** 读取（或首启生成并落盘）deviceSalt（32B）。 */
function getDeviceSalt(): Uint8Array {
  const stored = wx.getStorageSync(DEVICE_SALT_KEY)
  if (stored && typeof stored === 'string') {
    try {
      const bytes = base64ToBytes(stored)
      if (bytes.length === 32) {
        return bytes
      }
    } catch (error) {
      // 损坏的 salt：走重新生成路径
    }
  }
  // 损坏/缺失的 salt：不能静默重置——重置会改变 vaultKey，使既有密封草稿永久不可解。
  // 记录损坏证据 + 显式告警，让用户知晓本机已保存的草稿可能无法恢复。
  if (stored && typeof stored === 'string') {
    console.warn('[vault] vaultSalt 损坏或被截断，本机已加密的草稿可能无法恢复；将重新生成 salt')
  }
  const fresh = getCryptoProvider().randomBytes(32)
  wx.setStorageSync(DEVICE_SALT_KEY, bytesToBase64(fresh))
  return fresh
}

/** 异步派生并缓存 vaultKey（幂等、并发安全）。 */
export function ensureDerivedKey(): Promise<Uint8Array> {
  if (cachedVaultKey) {
    return Promise.resolve(cachedVaultKey)
  }
  if (!vaultKeyPromise) {
    vaultKeyPromise = (async () => {
      const prefix = utf8ToBytes(VAULT_DOMAIN)
      const appSecret = getAppSecret()
      const deviceSalt = getDeviceSalt()
      const input = new Uint8Array(prefix.length + appSecret.length + deviceSalt.length)
      input.set(prefix, 0)
      input.set(appSecret, prefix.length)
      input.set(deviceSalt, prefix.length + appSecret.length)
      const key = await sha256Bytes(input)
      cachedVaultKey = key
      return key
    })()
  }
  return vaultKeyPromise
}

/** 判断存储值是否为密封密文串（`1.<iv>.<ct>`）。 */
export function isSealed(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false
  }
  const first = value.indexOf('.')
  if (first <= 0) {
    return false
  }
  return value.slice(0, first) === SEAL_VERSION
}

/** 需要密封落盘的 PII storage key（决策 #47：student/score/apply；info/unit/classValue 低敏保持明文）。 */
const SEALED_KEYS: Array<string> = ['student', 'score', 'apply']

/** Unit/batch scoped storage key. IDs are encoded so delimiters cannot collide. */
export function draftStorageKey(unitId: string, batchId: string, key: string): string {
  return `draft:${encodeURIComponent(unitId)}:${encodeURIComponent(batchId)}:${key}`
}

function shouldSealStorageKey(key: string): boolean {
  if (SEALED_KEYS.indexOf(key) >= 0) return true
  const tail = key.slice(key.lastIndexOf(':') + 1)
  return SEALED_KEYS.indexOf(tail) >= 0
}

/** 从 storage 读取：PII key 若为密封串则解封为对象，否则返回原值（兼容旧明文）。 */
export async function readStored(key: string): Promise<unknown> {
  const raw = wx.getStorageSync(key)
  if (shouldSealStorageKey(key) && isSealed(raw)) {
    return openJson(String(raw))
  }
  return raw
}

/** 写入 storage：PII key 密封后落盘，低敏 key 原样落盘。 */
export async function writeStored(key: string, value: unknown): Promise<void> {
  if (shouldSealStorageKey(key)) {
    const sealed = await sealJson(value)
    wx.setStorageSync(key, sealed)
  } else {
    wx.setStorageSync(key, value)
  }
}

/** 序列化对象 → 密封密文串。 */
export async function sealJson(value: unknown): Promise<string> {
  const text = JSON.stringify(value)
  if (text == null) {
    return text
  }
  return sealUtf8(text)
}

/** 解封密文串 → 对象；失败返回 null（不抛）。 */
export async function openJson(text: string): Promise<unknown | null> {
  try {
    const utf8 = await openUtf8(text)
    if (utf8 == null) {
      return null
    }
    return JSON.parse(utf8)
  } catch (error) {
    return null
  }
}

/** 密封 base64 字符串（证明材料字节）。 */
export async function sealBytes(base64Text: string): Promise<string> {
  const text = String(base64Text == null ? '' : base64Text)
  return sealUtf8(text)
}

/** 解封 base64 字符串；失败返回 null（不抛）。 */
export async function openBytes(text: string): Promise<string | null> {
  try {
    const utf8 = await openUtf8(text)
    if (utf8 == null) {
      return null
    }
    return utf8
  } catch (error) {
    return null
  }
}

/** 密封 UTF-8 文本 → 密文串。 */
async function sealUtf8(text: string): Promise<string> {
  await ensureRandomPool()
  const key = await ensureDerivedKey()
  const iv = getCryptoProvider().randomBytes(12)
  const result = await aesGcmEncrypt(key, utf8ToBytes(text), { iv })
  return [
    SEAL_VERSION,
    bytesToBase64(iv),
    bytesToBase64(result.ciphertext)
  ].join('.')
}

/** 解封密文串 → UTF-8 文本；损坏输入返回 null。 */
async function openUtf8(text: string): Promise<string | null> {
  const sealed = String(text == null ? '' : text)
  const dot1 = sealed.indexOf('.')
  if (dot1 <= 0) {
    return null
  }
  if (sealed.slice(0, dot1) !== SEAL_VERSION) {
    return null
  }
  const dot2 = sealed.indexOf('.', dot1 + 1)
  if (dot2 <= dot1 + 1) {
    return null
  }
  const ivB64 = sealed.slice(dot1 + 1, dot2)
  const ctB64 = sealed.slice(dot2 + 1)
  if (!ivB64 || !ctB64) {
    return null
  }
  const key = await ensureDerivedKey()
  const plain = await aesGcmDecrypt(key, base64ToBytes(ivB64), base64ToBytes(ctB64))
  return bytesToUtf8(plain)
}

/** 取证据密文文件绝对路径。 */
function evidencePath(id: string): string {
  return `${wx.env.USER_DATA_PATH}/${VAULT_EVIDENCE_DIR}/${String(id)}${EVIDENCE_EXT}`
}

/** 密封明文 base64 → 落盘 vault/evidence/<hash>.bin → 返回 EvidenceRef（内容哈希去重）。 */
export function writeEvidence(
  base64Text: string,
  meta: { name?: string; size?: number; mime?: string }
): Promise<EvidenceRef> {
  const raw = String(base64Text == null ? '' : base64Text)
  return sealBytes(raw).then(function (sealed) {
    return sha256Hex(utf8ToBytes(raw)).then(function (id) {
      const fs = wx.getFileSystemManager()
      const dir = `${wx.env.USER_DATA_PATH}/${VAULT_EVIDENCE_DIR}`
      const filePath = evidencePath(id)
      return new Promise<EvidenceRef>((resolve, reject) => {
        const mkAndWrite = () => {
          fs.writeFile({
            filePath,
            data: sealed,
            encoding: 'utf8',
            success: () => {
              resolve({
                id,
                name: String(meta.name == null ? '' : meta.name),
                size: Number(meta.size) || 0,
                mime: String(meta.mime == null ? '' : meta.mime),
              })
            },
            fail: (error) => reject(error)
          })
        }
        fs.mkdir({
          dirPath: dir,
          recursive: true,
          success: () => mkAndWrite(),
          fail: (error) => {
            if (error && typeof error.errMsg === 'string' && error.errMsg.indexOf('already exists') >= 0) {
              mkAndWrite()
              return
            }
            reject(error)
          }
        })
      })
    })
  })
}

/** 读证据密文文件 → 解封 → 返回明文 base64；文件缺失/损坏返回 null。 */
export function readEvidenceBase64(ref: EvidenceRef): Promise<string | null> {
  const fs = wx.getFileSystemManager()
  return new Promise<string | null>((resolve) => {
    fs.readFile({
      filePath: evidencePath(ref.id),
      encoding: 'utf8',
      success: (result) => {
        const sealed = String(result.data || '')
        openBytes(sealed).then(function (plain) {
          resolve(plain)
        }).catch(function () {
          resolve(null)
        })
      },
      fail: () => resolve(null)
    })
  })
}

/** 删除证据密文文件（不存在视为成功，幂等）。 */
export function deleteEvidence(ref: EvidenceRef): Promise<void> {
  const fs = wx.getFileSystemManager()
  return new Promise<void>((resolve) => {
    fs.unlink({
      filePath: evidencePath(ref.id),
      success: () => resolve(),
      fail: () => resolve()
    })
  })
}

/** 解封证据到临时预览文件，返回其绝对路径（用于 previewImage）。页面卸载时须调 cleanTmp()。 */
export function openEvidenceToTmp(ref: EvidenceRef): Promise<string | null> {
  return readEvidenceBase64(ref).then(function (plain) {
    if (plain == null) {
      return null
    }
    const fs = wx.getFileSystemManager()
    const dir = `${wx.env.USER_DATA_PATH}/${VAULT_TMP_DIR}`
    const safeName = String(ref.name || ref.id).replace(/[\\/:*?"<>|\r\n]+/g, '_') || ref.id
    const extension = evidenceExtensionForMime(ref.mime)
    const baseName = extension
      ? safeName.replace(/\.[A-Za-z0-9]+$/, '')
      : safeName
    const filePath = `${dir}/${extension ? `${baseName}.${extension}` : baseName}`
    return new Promise<string | null>((resolve) => {
      const mkAndWrite = () => {
        fs.writeFile({
          filePath,
          data: plain,
          encoding: 'base64',
          success: () => resolve(filePath),
          fail: () => resolve(null)
        })
      }
      fs.mkdir({
        dirPath: dir,
        recursive: true,
        success: () => mkAndWrite(),
        fail: (error) => {
          if (error && typeof error.errMsg === 'string' && error.errMsg.indexOf('already exists') >= 0) {
            mkAndWrite()
            return
          }
          resolve(null)
        }
      })
    })
  })
}

function evidenceExtensionForMime(mime: string): string {
  switch (String(mime || '').toLowerCase()) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return ''
  }
}

/** 清理临时预览目录（vault/tmp）下全部文件（页面卸载时调用）。 */
export function cleanTmp(): Promise<void> {
  const fs = wx.getFileSystemManager()
  const dir = `${wx.env.USER_DATA_PATH}/${VAULT_TMP_DIR}`
  return new Promise<void>((resolve) => {
    fs.readdir({
      dirPath: dir,
      success: (result) => {
        const files = Array.isArray(result.files) ? result.files : []
        let remaining = files.length
        if (remaining === 0) {
          resolve()
          return
        }
        files.forEach((name) => {
          fs.unlink({
            filePath: `${dir}/${String(name)}`,
            success: () => { remaining -= 1; if (remaining <= 0) resolve() },
            fail: () => { remaining -= 1; if (remaining <= 0) resolve() }
          })
        })
      },
      fail: () => resolve()
    })
  })
}

/** 判断一个 file 元素是否为 EvidenceRef（vs legacy 路径对象/字符串）。 */
export function isEvidenceRef(value: unknown): value is EvidenceRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && record.id.length > 0
}

/** 清空 storage 全部 key + 删 vault/ 与 dyfMaterial/ 目录（设置页「清除本机数据」）。 */
export function wipeAll(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      const fs = wx.getFileSystemManager()
      const dirs = [VAULT_ROOT, 'dyfMaterial']
      let remaining = dirs.length
      const done = () => {
        remaining -= 1
        if (remaining <= 0) {
          resolve()
        }
      }
      dirs.forEach((dir) => {
        fs.rmdir({
          dirPath: `${wx.env.USER_DATA_PATH}/${dir}`,
          recursive: true,
          success: () => done(),
          fail: () => done()
        })
      })
      const info = wx.getStorageInfoSync()
      const keys = Array.isArray(info.keys) ? info.keys : []
      keys.forEach((key) => {
        try {
          wx.removeStorageSync(String(key))
        } catch (error) {
          // 单个 key 删除失败不阻断整体清空
        }
      })
      cachedVaultKey = null
      vaultKeyPromise = null
      resolve()
    } catch (error) {
      reject(error)
    }
  })
}

/** 幂等初始化：确保随机池与 vaultKey 就绪（app.ts onLaunch 早期调用一次）。 */
export function initLocalVault(): Promise<void> {
  return ensureRandomPool().then(function () {
    return ensureDerivedKey().then(function () {})
  })
}

/** 读文件（任意路径）→ base64 字符串；失败返回空串。 */
function readFileBase64(filePath: string): Promise<string> {
  const fs = wx.getFileSystemManager()
  return new Promise<string>((resolve) => {
    if (filePath.indexOf('data:') === 0) {
      const splitIndex = filePath.indexOf(',')
      resolve(splitIndex >= 0 ? filePath.slice(splitIndex + 1) : '')
      return
    }
    fs.readFile({
      filePath,
      encoding: 'base64',
      success: (result) => resolve(String(result.data || '')),
      fail: () => resolve('')
    })
  })
}

/**
 * 一次性迁移（决策 #47）：
 * 1. 生成并写入 deviceSalt（若无）。
 * 2. 密封 PII 键（student/score/apply）。
 * 3. score[*].file 的 legacy path 元素 → 读 base64 → sealBytes 落 vault/evidence/ → 换 EvidenceRef。
 * 4. 写 vaultVersion = 1。
 * 任一步失败 → 不写 version，保留明文（可用性优先于保密性；下次启动重试），并 console.warn。
 * 幂等、可中断重入。readStored/openJson 对明文与密文皆可处理，故无需与页面初始化强同步。
 */
export function migrateLocalVault(): Promise<void> {
  const currentVersion = wx.getStorageSync(VAULT_VERSION_KEY)
  if (currentVersion === 1) {
    return Promise.resolve()
  }
  return initLocalVault()
    .then(function () {
      return (async () => {
        // 2. 密封 PII 键
        const keys = ['student', 'score', 'apply']
        for (const key of keys) {
          const raw = wx.getStorageSync(key)
          if (raw == null || raw === '') {
            continue
          }
          if (isSealed(raw)) {
            continue
          }
          if (typeof raw !== 'object' || Array.isArray(raw)) {
            continue
          }
          await writeStored(key, raw)
        }
        // 3. 迁移 score 文件
        const score = await readStored('score')
        if (score && typeof score === 'object' && !Array.isArray(score)) {
          const scoreRecord = score as Record<string, unknown>
          let changed = false
          for (const id of Object.keys(scoreRecord)) {
            const item = scoreRecord[id]
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
              continue
            }
            const record = item as Record<string, unknown>
            if (!Array.isArray(record.file)) {
              continue
            }
            const refs: Array<unknown> = []
            let itemChanged = false
            for (const fileItem of record.file) {
              if (isEvidenceRef(fileItem)) {
                refs.push(fileItem)
                continue
              }
              const filePath = resolveFileEntryPath(fileItem)
              if (!filePath) {
                refs.push(fileItem)
                continue
              }
              const base64Text = await readFileBase64(filePath)
              if (!base64Text) {
                refs.push(fileItem)
                continue
              }
              const ref = await writeEvidence(base64Text, fileEntryMeta(fileItem))
              refs.push(ref)
              itemChanged = true
            }
            if (itemChanged) {
              record.file = refs
              changed = true
            }
          }
          if (changed) {
            await writeStored('score', score)
          }
        }
        // 4. 写 version
        wx.setStorageSync(VAULT_VERSION_KEY, 1)
      })()
    })
    .catch(function (error) {
      console.warn('本地数据迁移失败，保留明文，下次启动重试', error)
    })
}
