# user/wechat — 学生端（微信小程序，正式版）

## 项目概述

学生端正式版，位于 `user/wechat/`，微信小程序 + vant-weapp。当前与目标有差距，仍需优化改进。核心目标：学生填写德育分申请、上传证明材料、导出加密申请文件、查询审核状态与排名。

## 技术栈

微信小程序 + vant-weapp + mobx-miniprogram + TypeScript

## 目录结构

```
miniprogram/
├── pages/
│   ├── main/            # 申请页（index）+ 确认单（score）
│   ├── privacyAndUnit/  # 隐私与单位选择
│   ├── settings/        # 设置
│   └── test/            # 测试页
├── stores/
│   ├── student.ts       # 数据流核心（mobx store）
│   ├── apply.ts         # 申请实体本地状态（applyId/revision/status）
│   └── data/nxu/lx/     # 硬编码配置（config/student/score/class/info）
│   └── data/testBatch.ts# M2 内置测试批次（含管理端预生成 RSA 公钥）
├── shared/              # shared 源码镜像（生成物，勿手改，见 scripts/sync-shared.mjs）
├── components/
│   └── signature/       # 签名组件
├── behaviors/           # 主题等行为
└── utils/
    ├── env-shim.ts      # 环境补丁：self=globalThis（node-forge 加载依赖，须最先执行）
    ├── crypto.ts        # 小程序加密引导（CryptoProvider + 随机池 + forge 种子覆盖 + UUID）
    ├── apply-payload.ts # .dyf payload 构造（纯函数）
    └── util.ts
```

## 核心模块

| 文件 | 职责 |
|------|------|
| `stores/student.ts` | mobx store：管理 unit/student/score/info，本地存储 `wx.setStorageSync`，配置合并/学期切换/分数重置 |
| `stores/apply.ts` | 申请实体：applyId 生成（UUID v4）、revision 递增、导出后置 submitted、只读锁定预留（M5 接入服务端状态） |
| `stores/data/testBatch.ts` | M2 内置测试批次（决策 #6）：batchId/公钥/计算配置，M5 改为服务端下发 |
| `utils/crypto.ts` | 可移植 CryptoProvider 注入（node-forge + @noble，随机源 wx.getRandomValues 异步预热池）；覆盖 forge PRNG 种子；uuidV4 |
| `utils/apply-payload.ts` | 构建 `.dyf` 加密前 payload（`{applyId, revision, batchId, personal, dyf:{itemCode:{score, evidence}}}`, confirmSlip?） |
| `pages/main/index.ts` | 申请表单、班级级联、证明材料上传、导出入口 |
| `pages/main/score.ts` | 确认单、签名、canvas 截图、**加密生成 `.dyf` 文件**、`wx.shareFileMessage` 发送 |

## 数据流

- **本地存储**：`wx.setStorageSync`（`student`/`score`/`info`/`unit`/`classValue`/`apply`）。
- **配置**：`stores/data/nxu/lx/` 下硬编码（config/student/score/class/info），按单位（unit）选择（决策 #7，M5 改造）。
- **批次**：M2 用内置测试批次 `stores/data/testBatch.ts`（决策 #6，M5 改为服务端下发）。
- **导出**：`shared` 混合加密（AES-256-GCM + RSA-OAEP + SHA-256 完整性）生成 `.dyf`，内含 `applyId`/`revision`/`hash`；每次导出 revision +1（决策 #9）。
- **证明材料**：`USER_DATA_PATH/supportImage/<year>/<semester>/`，导出时 base64 编码为 `evidence` 嵌入。

## 与目标的差距（M2 后）

1. ~~**导出文件未加密**~~：✅ 已实现混合加密 + 内容哈希（`encryptPayload`，架构 §5.1），与管理端互通由 shared `m2-test-batch.test.ts` 验证。
2. **配置硬编码**：部分完成——批次改用内置测试批次（`testBatch.ts`）；UnitConfig 联网拉取留待 M5。
3. ~~**无 `applyId`/`revision` 概念**~~：✅ 已引入（`stores/apply.ts`，架构 §3.3）。
4. **无审核状态查询**：需接入服务端状态同步，`imported` 起只读（M5；本地 `canEditApply` 已预留）。
5. **无排名展示**：需展示班级/专业/年级排名（M5+）。

## 开发

- 使用微信开发者工具打开 `user/wechat/` 目录。
- `project.config.json` 已配置；`miniprogram_npm` 为构建产物。
- **新增 npm 依赖（node-forge 等）后需在开发者工具执行「工具 → 构建 npm」，且 node-forge 需先运行 `node scripts/patch-node-forge.mjs` 打环境补丁（npm install 后重跑，幂等）**。
- **@noble 不使用 npm 依赖**（微信「构建 npm」不支持子路径导入，且 @noble 主入口故意抛错）：所需原语已由 `scripts/build-noble-vendor.mjs` 用 esbuild 预打包为 `shared/src/crypto/vendor/noble.js`，随镜像进入小程序。
- **微信模块解析不支持"目录 → index.js"回退**：导入 shared 时必须显式写文件路径（`'../shared/crypto/index'` 而非 `'../shared/crypto'`）；镜像由 sync 脚本自动重写，小程序自身代码需手动遵守。
- **tsconfig `target` 为 ES2017，且源码不使用 ES2020 语法**：微信开发者工具「自动预览/上传」的 JS 解析器不支持 `?.`（可选链）/`??`（空值合并），报 `Unexpected token: punc (.)`；且预览管线可能不按项目 tsconfig 降级。因此 shared 源与小程序代码**一律不写 `?.`/`??`**——用 `shared/src/nullish.ts` 的 `nz`（`??`）/`opt`（`?.`）替代（带副作用的后备值如随机数生成用内联三元短路）；`catch {}` 写 `catch (e)`。`lib` 可保持 ES2020（仅类型层）。
- 修改 `shared/src` 后运行 `node scripts/sync-shared.mjs` 同步镜像；改完用 `--check` 校验。
- 修改 `stores/data/nxu/lx/` 下配置需同步更新对应 `.js` 与 `.json`。

## 与正式版架构的关系

学生端是正式版三端之一，共享逻辑（加密、数据模型、状态机）应收敛到 `shared/` 包（未创建）。开发时参考 `docs/ARCHITECTURE.md`。