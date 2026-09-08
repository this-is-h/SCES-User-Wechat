# miniprogram/shared — shared 源码镜像（生成物，勿手改）

本目录由 `scripts/sync-shared.mjs` 从 `shared/src` 自动生成（决策 #8），
已排除测试文件（`*.test.ts`），纳入 git 版本控制。

与 `shared/src` 的唯一差异：**微信兼容的导入路径重写**——微信模块解析
不支持“目录 → index.js”回退（`require('../shared/crypto')` 只解析为
`shared/crypto.js`），故指向目录的相对导入被改写为显式 `X/index`。

修改 shared 源码后请重新同步：

```sh
node scripts/sync-shared.mjs
```

校验镜像是否最新：

```sh
node scripts/sync-shared.mjs --check
```
