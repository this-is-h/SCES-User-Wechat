# SCES-User-Wechat — 学生端（微信小程序）

学生综合素质测评管理系统（SCES）· 学生端。微信小程序 + vant-weapp + mobx-miniprogram + TypeScript。
核心：学生填写德育分申请、上传证明材料、导出加密申请文件（.dyf）、查询审核状态与排名。

## 仓库结构

| 路径 | 职责 |
|---|---|
| `miniprogram/` | 小程序代码（pages / stores / components / behaviors / utils） |
| `miniprogram/shared/` | `@sces/shared` 源码镜像（生成物，`npm run sync:shared` 同步，勿手改） |
| `miniprogram/package.json` | 小程序 npm 依赖（vant-weapp、mobx、node-forge 等），开发者工具「构建 npm」 |
| `scripts/` | `sync-shared`（镜像同步）、`patch-node-forge`（forge 环境补丁） |

## 常用命令（仓库根）

```sh
npm ci --prefix miniprogram   # 小程序依赖
npm ci                        # 根工具依赖（husky/commitlint/typescript）
npm run patch:node-forge      # forge 补丁（构建 npm 前，幂等）
npm run sync:shared           # 从 ../SCES-Shared 同步 shared 镜像
npm run check:shared-mirror   # 校验镜像与源一致（--check）
npm run type-check            # tsc 类型检查（ES2017 兼容约束）
```

## 微信端特有约束

- **无 WebCrypto**：RSA-OAEP 由 node-forge 提供（`utils/crypto.ts` 引导，必须覆盖 `forge.random` 种子指向 `wx.getRandomValues` 强随机池）；AES-GCM/SHA-256 由 `@sces/shared` 内 noble 预打包提供。
- **ES2017 语法上限**：微信解析器不支持 `?.`/`??`，用 `shared/src/nullish.ts` 的 `nz`/`opt` 替代。
- **目录导入**：微信模块解析不支持"目录 → index.js"回退，shared 镜像由 sync 脚本自动重写，小程序自身代码手动遵守（显式 `/index`）。
- 在线化方向：内置单位配置与内测批次将随服务端（M5）上线改为服务端下发。

## 开发

- 微信开发者工具导入本仓库根目录（已配置 `project.config.json`）。
- 提交规范 / 分支模型 / CI / shared 镜像约定见 `CONTRIBUTING.md`。