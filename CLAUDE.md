# SCES-User-Wechat — 学生端（微信小程序）

学生综合素质测评管理系统（SCES）· 学生端。微信小程序 + vant-weapp + mobx-miniprogram + TypeScript。
核心：学生填写德育分申请、上传证明材料、导出加密申请文件（.dyf）、查询审核状态与排名。

## 开发规范（必读，新会话遵守）

本仓库采用**简化版 Git Flow** 与 **Conventional Commits（约定式提交）**，由 husky 钩子与 CI 强制落地。详情见 `CONTRIBUTING.md`。

### 分支模型
- 长期分支：`main`（生产，仅发布，禁直推）、`develop`（日常开发，默认分支，PR 指向这里）
- 短期分支：`feature/*`、`bugfix/*`、`hotfix/*`、`chore/*`、`release/*`（从 develop 创建，完成 PR 合并回 develop；hotfix 从 main 创建，合并回 main 与 develop）
- 分支名必须以前缀开头（CI 校验）；`main`/`develop` 开启保护（个人账号仓库暂无法强制，需自觉遵守）

### 提交规范（commit-msg 钩子强制）
格式：`<type>(<scope>): <subject>`
- `type` 必填：`feat` `fix` `docs` `style` `refactor` `perf` `test` `chore` `build` `ci` `revert`
- `scope` 可选、小写（本仓：miniprogram/pages/stores/utils/components/shared/scripts/docs/build/ci/deps）
- `subject` 必填：祈使句、首字母小写、**≤50 字符**、句尾无句号；header ≤72
- 违规提交会被 commitlint 直接拒绝

### 钩子与 CI 门禁
- `pre-commit`：`npm run type-check`（tsc，微信 ES2017 兼容约束）；`commit-msg`：commitlint
- CI：类型检查 + `npm audit`(high) + gitleaks + 分支名
- 编译门禁：小程序「构建 npm」由微信开发者工具执行（不支持 headless），开发者本地自测
- 单元测试/覆盖率：业务逻辑应收敛到 `@sces/shared`（其 CI 强制覆盖率 ≥80%），小程序为薄 UI 层

## 仓库结构

| 路径 | 职责 |
|------|------|
| `miniprogram/` | 小程序代码（pages/stores/components/behaviors/utils） |
| `miniprogram/shared/` | `@sces/shared` 源码镜像（**生成物**，`npm run sync:shared` 同步，勿手改） |
| `miniprogram/config/runtime.ts` | 运行时常量（在线版：SERVER_BASE_URL / CAPABILITIES，自持） |
| `miniprogram/gateway/` | 学生端数据网关（`active.ts → online.ts` 唯一实现；接口见 SCES-Server/contracts） |
| `scripts/` | sync-shared（镜像）、patch-node-forge（forge 环境补丁） |

## 微信端特有约束（重要）

- **无 WebCrypto**：RSA-OAEP 由 node-forge 提供（`utils/crypto.ts` 引导，覆盖 `forge.random` 种子指向 `wx.getRandomValues` 强随机池，构建 npm 前先跑 `npm run patch:node-forge`）；AES-GCM/SHA-256 由 shared 内 noble 预打包提供。
- **ES2017 语法上限**：微信解析器不支持 `?.`/`??`，用 `shared/src/nullish.ts` 的 `nz`/`opt` 替代。
- **目录导入**：微信不支持「目录 → index.js」回退，镜像由 sync 脚本自动重写，本仓自身代码手动遵守（显式 `/index`）。
- 在线化（现状）：单位/批次/配置/状态由服务端下发（gateway online 实现，`api.sces.thisish.cn`）；本地仅加密存储草稿与证明材料（.dyf 文件交付，服务端不存分数/材料）。离线资产、本地授权与硬编码密钥已移除，不再维护离线版。
- 本地保护：local-vault 的密钥 per-install 生成并落本地 storage（`utils/local-vault.ts`），无随包常量。

## 命令（仓库根）

```sh
npm ci --prefix miniprogram   # 小程序依赖
npm ci                        # 根工具依赖（husky/commitlint/typescript）
npm run patch:node-forge      # forge 补丁（构建 npm 前，幂等）
npm run sync:shared           # 从 ../SCES-Shared 同步 shared 镜像
npm run check:shared-mirror   # 校验镜像与源一致（--check）
npm run type-check            # tsc 类型检查
```

## 开发

微信开发者工具导入本仓库根目录（已配置 `project.config.json`）。