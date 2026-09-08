# user/wechat 学生端 — Agents

本目录的 Claude Code 子代理定义位于根目录 `.claude/agents/`（Claude Code 实际加载的位置）。

## 可用代理

| 代理 | 用途 |
|------|------|
| `wechat-student-dev` | 学生端小程序开发与维护（页面、store、导出逻辑） |
| `wechat-student-review` | 学生端代码审查（与正式版架构对齐、加密、状态机） |
| `architect` | 架构评审（数据模型、加密方案、状态机一致性） |

## 使用方式

在 `user/wechat/` 目录下工作时，Claude Code 会按 `user/wechat/CLAUDE.md` 加载上下文。需要专项代理时调用对应代理。

## 当前重点（与目标的差距）

1. 导出文件加密（RSA+AES + 哈希）——见 `docs/ARCHITECTURE.md` §5。
2. 配置从服务端拉取（UnitConfig）——见 §3.2。
3. 引入 `applyId`/`revision` 概念——见 §3.3。
4. 审核状态查询与只读锁定——见 §4。
5. 排名展示（班级/专业/年级）——见 §8.4。