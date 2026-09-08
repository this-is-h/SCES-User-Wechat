# 贡献指南（sces-user · 学生端微信小程序）

本仓库采用**简化版 Git Flow** 与 **Conventional Commits（约定式提交）**，由钩子与 CI 强制落地。

## 分支模型

| 分支 | 生命周期 | 用途 |
|---|---|---|
| `main` | 永久 | 生产分支，仅存放已发布稳定版本；**禁止直接提交/推送**，只接受 develop→main 的发布合并 |
| `develop` | 永久 | 日常开发主分支（默认分支），所有 PR 指向这里 |
| `feature/*` / `bugfix/*` / `chore/*` | 短期 | 功能 / 缺陷 / 杂务，从 develop 创建，完成后 PR 合并回 develop |
| `hotfix/*` | 短期 | 紧急修复，从 main 创建，完成后合并回 main 与 develop |

规则：分支名必须符合前缀（CI 拒绝违规分支）；`develop`/`main` 开启保护（强制 PR + 状态检查；`main` 禁止直推）。

## 提交规范（commit-msg 钩子强制）

格式：`<type>(<scope>): <subject>`

- `type` 必填：`feat` `fix` `docs` `style` `refactor` `perf` `test` `chore` `build` `ci` `revert`
- `scope` 可选，小写：本仓常用 `miniprogram` `pages` `stores` `utils` `components` `shared` `scripts` `docs` `build` `ci` `deps`
- `subject` 必填：祈使句、首字母小写、≤50 字符、句尾无句号；header ≤72

示例：`feat(stores): 接入服务端批次状态同步`、`fix(pages): 修正确认单截图阴影`

配套纪律：每提交单一问题；单次 ≤300 行；提交前 `npm run type-check` 自测。

## 钩子与 CI 门禁

- `pre-commit`：`npm run type-check`（tsc --noEmit，按微信 ES2017 兼容约束）；`commit-msg`：commitlint。
- CI：类型检查门禁 + `npm audit`（high 阻断）+ gitleaks + 分支名校验。
- 编译门禁：小程序「构建 npm」由微信开发者工具执行（不支持 headless），开发者本地自测为准；
  单元测试/覆盖率门禁：业务逻辑应收敛到 `@sces/shared`（其 CI 强制覆盖率 ≥80%），小程序为薄 UI 层。

## shared 镜像（重要）

`miniprogram/shared/` 是 `sces-shared` 源码的**受控镜像**（生成物，勿手改）：

- 来源：同级目录 `../sces-shared/src`（可用 `DMS_SHARED_SRC` 环境变量覆盖，供 CI 按 tag 拉取）；
- 同步：`npm run sync:shared`；校验：`npm run check:shared-mirror`；
- 镜像内含微信兼容重写（目录导入 → `/index`、ES2017）与 Node-only 路径排除；
- `node-forge` 需构建 npm 前执行 `npm run patch:node-forge`（幂等）。

## 发布流程

1. develop 成熟 → 合并 main 并打 tag（学生端后续对接服务端，走服务端下发配置，M5 细化）。