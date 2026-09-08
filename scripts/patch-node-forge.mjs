#!/usr/bin/env node
/**
 * 修补 node-forge，使其在无 window/self/process 的微信小程序环境可加载。
 *
 * 背景（真机报错）：node-forge `util.globalScope` 通过 `self`/`window` 探测全局对象，
 * 小程序中二者均未定义 → `globalScope` 为 undefined → `random.js`/`prng.js` 加载时
 * 执行 `globalScope.crypto` 抛 `TypeError: Cannot read property 'crypto' of undefined`。
 *
 * 修补内容（全部为防御性兜底，不改变有 window/self 环境的任何行为）：
 * 1. `util.js`：globalScope 计算增加 `globalThis`/`{}` 回退；
 * 2. `random.js` / `prng.js`：`globalScope.crypto` 访问前判空。
 *
 * 目标：
 * - `user/wechat/miniprogram/node_modules/node-forge/lib/*.js`（源码，供下次「构建 npm」使用）
 * - `user/wechat/miniprogram/miniprogram_npm/node-forge/index.js`（已构建产物，立即生效）
 *
 * 幂等：已修补（含 DMS patch 标记）则跳过。npm install 后需重新执行本脚本。
 *
 * 用法：
 *   node scripts/patch-node-forge.mjs
 *   node scripts/patch-node-forge.mjs --check
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const LIB_FILES = [
  path.join(ROOT, 'miniprogram', 'node_modules', 'node-forge', 'lib', 'util.js'),
  path.join(ROOT, 'miniprogram', 'node_modules', 'node-forge', 'lib', 'random.js'),
  path.join(ROOT, 'miniprogram', 'node_modules', 'node-forge', 'lib', 'prng.js'),
]

const BUNDLE = path.join(
  ROOT,
  'miniprogram',
  'miniprogram_npm',
  'node-forge',
  'index.js',
)

/** 补丁 1：util.globalScope 增加 globalThis 回退。 */
const GLOBAL_SCOPE_OLD =
  "  return typeof self === 'undefined' ? window : self;\n})();"
const GLOBAL_SCOPE_NEW =
  "  var globalScope = typeof self === 'undefined' ? window : self;\n" +
  "  if(typeof globalScope === 'undefined') {\n" +
  '    // DMS patch: 小程序等无 window/self 环境回退 globalThis（防 random.js 加载崩溃）\n' +
  "    globalScope = typeof globalThis !== 'undefined' ? globalThis : {};\n" +
  '  }\n' +
  '  return globalScope;\n' +
  '})();'

/** 补丁 2：`globalScope.crypto` 访问前判空（random.js / prng.js 相同的两行模式）。 */
const CRYPTO_OLD = 'var _crypto = globalScope.crypto || globalScope.msCrypto;'
const CRYPTO_NEW =
  '// DMS patch: globalScope 缺失时避免加载崩溃（无 window/self 环境）\n' +
  'var _crypto = (globalScope && (globalScope.crypto || globalScope.msCrypto)) || null;'

const CHECK = process.argv.includes('--check')

function applyPatch(filePath, oldText, newText, label) {
  if (!existsSync(filePath)) {
    if (CHECK) {
      console.error(`[patch-node-forge] 校验失败：文件不存在 ${filePath}`)
      process.exitCode = 1
      return
    }
    console.warn(`[patch-node-forge] 跳过（不存在）：${filePath}`)
    return
  }
  const source = readFileSync(filePath, 'utf8')
  if (source.includes('DMS patch')) {
    console.log(`[patch-node-forge] 已修补，跳过：${filePath}`)
    return
  }
  const next = source.split(oldText).join(newText)
  if (next === source) {
    if (CHECK) {
      console.error(`[patch-node-forge] 校验失败：${filePath} 未找到待修补代码（${label}）`)
      process.exitCode = 1
    } else {
      console.warn(`[patch-node-forge] 未找到待修补代码（${label}）：${filePath}`)
    }
    return
  }
  if (!CHECK) {
    writeFileSync(filePath, next, 'utf8')
    console.log(`[patch-node-forge] 已修补（${label}）：${filePath}`)
  } else {
    console.log(`[patch-node-forge] 校验通过：${filePath} 将包含 ${label} 补丁`)
  }
}

// 补丁 1：util.js / bundle
applyPatch(LIB_FILES[0], GLOBAL_SCOPE_OLD, GLOBAL_SCOPE_NEW, 'globalScope')
applyPatch(BUNDLE, GLOBAL_SCOPE_OLD, GLOBAL_SCOPE_NEW, 'globalScope')

// 补丁 2：random.js / prng.js / bundle（同一两行模式，replaceAll）
for (const file of [LIB_FILES[1], LIB_FILES[2], BUNDLE]) {
  applyPatch(file, CRYPTO_OLD, CRYPTO_NEW, 'globalScope.crypto 判空')
}

if (CHECK && process.exitCode) {
  console.error('[patch-node-forge] 校验失败，请运行 node scripts/patch-node-forge.mjs')
} else if (!CHECK) {
  console.log('[patch-node-forge] 完成。注意：npm install / 重新安装依赖后需重新执行本脚本。')
}
