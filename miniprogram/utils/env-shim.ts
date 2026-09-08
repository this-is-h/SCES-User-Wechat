/**
 * 小程序环境补丁 —— 必须在任何 `node-forge` 模块加载之前执行。
 *
 * 问题：node-forge 通过 `self`/`window` 探测全局对象（`util.globalScope`），
 * 小程序中二者均未定义，导致 `globalScope` 为 undefined，`random.js` 加载时
 * 访问 `globalScope.crypto` 抛 `TypeError: Cannot read property 'crypto' of undefined`。
 *
 * 方案：
 * 1. **根治**：`scripts/patch-node-forge.mjs` 已为 node-forge 的 util/random/prng 打防御补丁
 *    （globalScope 回退 globalThis、crypto 访问判空），本 shim 仅作第二道防线；
 * 2. 将 `globalThis` 挂载到 `self`（Web Worker 式全局，node-forge 明确支持的形态），
 *    使 `util.globalScope` 指向有效对象；
 * 3. 导出 `envShimmed` 常量并**在消费方（utils/crypto.ts）引用**，防止打包器将
 *    副作用导入视为可丢弃（`import './env-shim'` 可能被 tree-shaking 移除）。
 *
 * 用法：在 import node-forge 的模块中，将本模块置于**最前**并引用 envShimmed：
 *   import { envShimmed } from './env-shim'
 *   import forge from 'node-forge'
 */
const globalObject = globalThis as unknown as Record<string, unknown>
if (typeof globalObject.self === 'undefined') {
  globalObject.self = globalThis
}

/** 环境补丁已生效标记（消费方引用它，确保本模块先于 node-forge 被求值）。 */
export const envShimmed = true
