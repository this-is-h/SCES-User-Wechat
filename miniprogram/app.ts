// app.ts
// 必须先于 utils/crypto 加载：node-forge 依赖 self/window 探测全局对象（见 env-shim）
import './utils/env-shim'
import { setupWechatCryptoProvider } from './utils/crypto'
import { migrateLocalVault } from './utils/local-vault'

App<IAppOption>({
  globalData: {
    appVersion: 0,
    statusBarHeight: 0,
  },
  onLaunch() {
    // 注册小程序加密适配器（node-forge + @noble，注入 wx.getRandomValues），
    // 必须在任何 shared 加密调用（如导出 .dyf）之前初始化
    setupWechatCryptoProvider()
    // M-O4 一次性迁移：密封 PII 键 + 迁移 score 材料到 vault/evidence。
    // 幂等、失败不写 version（下次启动重试），与页面初始化无强同步需求（readStored 双模可读）。
    void migrateLocalVault()
    const { statusBarHeight } = wx.getWindowInfo()
    this.globalData.statusBarHeight = statusBarHeight
    const { miniProgram } = wx.getAccountInfoSync()
    this.globalData.appVersion = miniProgram.version
  },
})