#!/usr/bin/env node
/**
 * 受控镜像脚本：将 shared/src 复制到 SCES-User-Wechat/miniprogram/shared/（决策 #8）。
 *
 * 背景：微信小程序不在 pnpm workspace，无法直接引用 @sces/shared 包；
 * 通过本脚本把 shared 源码镜像进小程序工程，纳入 git 版本控制。
 *
 * 规则：
 * - 复制 shared/src/** 下所有非测试文件（排除 *.test.ts）；
 * - 目标目录每次整体重建（删除旧镜像，保证与源码严格一致）；
 * - **微信兼容的导入路径重写**：微信小程序模块解析不支持“目录 → index.js”
 *   （`require('../shared/crypto')` 只解析为 `shared/crypto.js`，不会回退到
 *   `shared/crypto/index.js`，官方模块化文档约定 require 到具体文件）。
 *   因此镜像内所有指向目录的相对导入（目标为目录且含 index.ts）改写为
 *   显式 `X/index`（如 `'../types'` → `'../types/index'`）；文件级导入不变。
 * - 生成 miniprogram/shared/README.md（标记为生成物，勿手改）；
 * - `--check` 模式：不写文件，校验镜像是否与“重写后的源码”一致（CI 用），不一致退出码 1。
 *
 * 用法：
 *   node scripts/sync-shared.mjs          # 同步
 *   node scripts/sync-shared.mjs --check  # 校验
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 镜像源：SCES-Shared 独立仓库。开发机默认取同级目录 ../SCES-Shared/src，
// 可用环境变量 DMS_SHARED_SRC 覆盖（如 CI 从 git 拉取指定 tag 后指向解包目录）。
// 注意：SCES-Shared 的 build-noble-vendor 预打包产物随源一起镜像。
const SRC = process.env.DMS_SHARED_SRC ?? path.join(ROOT, '..', 'SCES-Shared', 'src')
const DST = path.join(ROOT, 'miniprogram', 'shared')

const CHECK = process.argv.includes('--check')

/** 递归收集目录下所有文件（相对路径 + 绝对路径）。 */
async function collectFiles(dir, rel = '') {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(abs, relPath)))
    } else {
      out.push({ relPath, abs })
    }
  }
  return out
}

/**
 * 镜像排除的 Node-only 路径（相对 shared/src）。shared 0.2.0 起离线授权模块
 * （license/、fingerprint.ts、crypto/sign.ts）与 ids/ 已从源中移除，
 * 无 Node-only 路径需再排除；镜像仅排除测试文件与 esbuild 打包入口（见 mirrorFiles）。
 */
const NODE_ONLY_EXCLUDES = []

/** 相对导入目标是否落在被排除路径内（文件精确匹配 / 目录前缀匹配）。 */
function isExcluded(relPath) {
  return NODE_ONLY_EXCLUDES.some((ex) => relPath === ex || relPath.startsWith(`${ex}/`))
}

/** 镜像文件列表（排除测试文件、esbuild 打包入口与 Node-only 路径）。 */
function mirrorFiles(files) {
  return files.filter(
    (f) => !/\.test\.ts$/.test(f.relPath) && !f.relPath.includes('vendor/noble-entry.ts') && !isExcluded(f.relPath),
  )
}

/** 解析相对导入 → 源文件绝对路径（目录→index.ts，否则补 .ts）。不存在返回 null。 */
function resolveImportSource(fromDir, request) {
  const base = path.resolve(fromDir, request)
  if (existsSync(base) && statSync(base).isDirectory() && existsSync(path.join(base, 'index.ts'))) {
    return path.join(base, 'index.ts')
  }
  if (existsSync(`${base}.ts`)) return `${base}.ts`
  return null
}

/**
 * 悬空导入守卫：shared/src/index.ts 不 re-export 被排除的 Node-only 模块，
 * 正常情况下不会产生悬空引用；但若将来某镜像内文件直接相对 import 到
 * license/、fingerprint.ts 或 crypto/sign.ts，镜像会产生解析不了的引用，
 * 小程序 tsc 编译期即失败。此守卫在 apply 与 --check 两种模式都运行，
 * 让这类错误尽早、响亮地暴露。
 */
async function assertNoDanglingImports(sourceMap) {
  const excludedAbs = NODE_ONLY_EXCLUDES.map((ex) => path.join(SRC, ex))
  const re = /((?:from|import|require)\s*\(\s*|(?:from|import)\s+)['"](\.[^'"]+)['"]/g
  for (const [relPath, abs] of sourceMap) {
    const text = normalize(await readFileUtf8(abs))
    const fromDir = path.dirname(abs)
    for (const m of text.matchAll(re)) {
      const request = m[2]
      const target = resolveImportSource(fromDir, request)
      if (!target) continue
      if (excludedAbs.some((ex) => target === ex || target.startsWith(`${ex}${path.sep}`))) {
        throw new Error(
          `镜像文件 ${relPath} 包含指向被排除的 Node-only 模块的相对导入 '${request}'，` +
            `镜像后将产生悬空引用。请移除该导入，或把目标模块移出 NODE_ONLY_EXCLUDES。`,
        )
      }
    }
  }
}

/** 归一化换行，避免 CRLF/LF 差异影响比对。 */
function normalize(text) {
  return text.replace(/\r\n/g, '\n')
}

/**
 * 判断相对导入目标：目录（含 index.ts）→ true；文件（X.ts）→ false。
 * 解析基准为源文件所在目录（镜像内相对结构不变，故重写结果对镜像同样成立）。
 */
function isDirIndexImport(fromDir, request) {
  const resolved = path.resolve(fromDir, request)
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    return false
  }
  return existsSync(path.join(resolved, 'index.ts'))
}

/**
 * 微信兼容重写：把 `from 'X'` / `import 'X'` / `require('X')` 中指向目录的
 * 相对导入改写为显式 `X/index`（微信模块解析不支持目录 → index.js）。
 * 仅处理 shared 源码使用的单引号风格，无匹配则原样返回。
 */
function rewriteWechatImports(source, absSourcePath) {
  const fromDir = path.dirname(absSourcePath)
  // 匹配 from/import/require 后的相对路径字符串（单引号）
  return source.replace(/((?:from|import|require)\s*\(\s*|(?:from|import)\s+)['"](\.[^'"]+)['"]/g, (match, prefix, request) => {
    if (isDirIndexImport(fromDir, request)) {
      return `${prefix}'${request}/index'`
    }
    return match
  })
}

/** 读取 UTF-8 文本。 */
async function readFileUtf8(filePath) {
  const { readFile } = await import('node:fs/promises')
  return readFile(filePath, 'utf8')
}

/** 源文件 → 镜像内容（含微信兼容重写）。 */
async function mirrorContentFor(srcAbs) {
  const text = normalize(await readFileUtf8(srcAbs))
  return rewriteWechatImports(text, srcAbs)
}

async function main() {
  if (!existsSync(SRC)) {
    throw new Error(`shared/src 不存在：${SRC}，请先确认 shared 包已初始化`)
  }

  const sourceFiles = mirrorFiles(await collectFiles(SRC))
  const sourceMap = new Map(sourceFiles.map((f) => [f.relPath, f.abs]))

  // 悬空导入守卫：apply 与 --check 都会执行
  await assertNoDanglingImports(sourceMap)

  const mirroredExists = existsSync(DST)

  if (CHECK) {
    if (!mirroredExists) {
      console.error(`[sync-shared] 校验失败：目标目录不存在 ${DST}`)
      process.exit(1)
    }
    const mirroredFiles = await collectFiles(DST)
    const mirroredMap = new Map(
      mirroredFiles
        .filter((f) => !f.relPath.startsWith('README.md'))
        .map((f) => [f.relPath, f.abs]),
    )
    const mismatches = []

    for (const [relPath, srcAbs] of sourceMap) {
      const dstAbs = mirroredMap.get(relPath)
      if (!dstAbs) {
        mismatches.push(`缺少文件：${relPath}`)
        continue
      }
      const srcText = await mirrorContentFor(srcAbs)
      const dstText = normalize(await readFileUtf8(dstAbs))
      if (srcText !== dstText) {
        mismatches.push(`内容不一致：${relPath}`)
      }
    }
    for (const relPath of mirroredMap.keys()) {
      if (!sourceMap.has(relPath)) {
        mismatches.push(`多余文件：${relPath}`)
      }
    }

    if (mismatches.length > 0) {
      console.error(`[sync-shared] 校验失败，镜像与重写后的 shared/src 不一致：`)
      for (const m of mismatches) console.error(`  - ${m}`)
      console.error(`[sync-shared] 请运行 node scripts/sync-shared.mjs 重新同步`)
      process.exit(1)
    }
    console.log(`[sync-shared] 校验通过：${sourceMap.size} 个文件与 shared/src（含微信路径重写）一致`)
    return
  }

  // 同步模式：整体重建目标目录
  await rm(DST, { recursive: true, force: true })
  await mkdir(DST, { recursive: true })

  for (const f of sourceFiles) {
    const dest = path.join(DST, f.relPath)
    await mkdir(path.dirname(dest), { recursive: true })
    const content = await mirrorContentFor(f.abs)
    await writeFile(dest, content, 'utf8')
  }

  await writeFile(
    path.join(DST, 'README.md'),
    [
      '# miniprogram/shared — shared 源码镜像（生成物，勿手改）',
      '',
      '本目录由 `scripts/sync-shared.mjs` 从 `shared/src` 自动生成（决策 #8），',
      '已排除测试文件（`*.test.ts`），纳入 git 版本控制。',
      '',
      '与 `shared/src` 的唯一差异：**微信兼容的导入路径重写**——微信模块解析',
      '不支持“目录 → index.js”回退（`require(\'../shared/crypto\')` 只解析为',
      '`shared/crypto.js`），故指向目录的相对导入被改写为显式 `X/index`。',
      '',
      '修改 shared 源码后请重新同步：',
      '',
      '```sh',
      'node scripts/sync-shared.mjs',
      '```',
      '',
      '校验镜像是否最新：',
      '',
      '```sh',
      'node scripts/sync-shared.mjs --check',
      '```',
      '',
    ].join('\n'),
    'utf8',
  )

  console.log(`[sync-shared] 同步完成：${sourceFiles.length} 个文件 → ${DST}`)
}

main().catch((error) => {
  console.error(`[sync-shared] 失败：${error.message}`)
  process.exit(1)
})
