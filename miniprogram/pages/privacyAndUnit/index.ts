// index.ts
import { ComponentWithStore } from 'mobx-miniprogram-bindings'
import { studentStore } from '../../stores/student'

// 获取应用实例
const themeBehavior = require('../../behaviors/theme/theme')

import { gateway } from '../../gateway/active'
import type { UnitTreeNode } from '../../gateway/types'

import Notify from '@vant/weapp/notify/notify';
import Dialog from '@vant/weapp/dialog/dialog';

const privateHtml = `
<div class="welcome">
  <h2 class="welcome-title">✨欢迎使用智分数小程序</h2>
  <div class="welcome-info-subhead">
    为生成个人德育分材料，我们将收集您的学号、姓名、专业、班级、联系方式、图片材料等必要信息
  </div>

  <div class="privacy-highlight">
    <div class="privacy-item" style="margin-bottom: 14px;">
      <div class="privacy-text">
        <strong style="color:var(--van-doc-text-color-3)">🛡️ 最小限度信息收集</strong><br>
        我们仅收集生成分数材料的必要信息。
      </div>
    </div>
    <div class="privacy-item">
      <div class="privacy-text">
        <strong style="color:var(--van-doc-text-color-3)">🔒 数据完全本地处理</strong><br>
        所有信息完全在本地处理，不会上传至任何服务器。
      </div>
    </div>
  </div>
</div>
`

ComponentWithStore({
  behaviors: [themeBehavior],
  data: {
    privateHtml,
    unitShow: false,
    unitId: "",
    units: [] as UnitTreeNode[]
  },
  storeBindings: {
    store: studentStore,
    fields: ['unit', 'unitTitle', 'unitValue'] as const,
    actions: {
      initStore: 'init',
      updateStudentStore: 'update',
      markStudentStart: 'markStudentStart'
    } as const,
  },
  // 组件用作页面：页面/组件生命周期需放在 lifetimes/methods，顶层 onLoad 不会被调用。
  // 单位树在 attached 里经 gateway 加载（离线读包内 units.js，在线走接口 10）。
  lifetimes: {
    attached: async function () {
      const units = await gateway.listUnits()
      this.setData({ units })
      await this.initStore()
    }
  },
  methods: {
    handleOpenPrivacyContract() {
      // 打开隐私协议页面
      wx.openPrivacyContract({
        success: () => {}, // 打开成功
        fail: () => {}, // 打开失败
        complete: () => {}
      })
    },
    handleAgreePrivacyAuthorization() {
      // 用户同意隐私协议事件回调
      // 用户点击了同意，之后所有已声明过的隐私接口和组件都可以调用了
      Notify({
        type: 'success',
        message: '已同意隐私协议',
        safeAreaInsetTop: true,
        top: 46,
      })
      this.setData({
        unitShow: true
      })
    },
    onUnitClose() {
      this.setData({
        unitShow: false
      });
    },
    onUnitFinish(event) {
      const { selectedOptions } = event.detail;
      console.log(selectedOptions)
      const fieldValue = selectedOptions.map((option) => option.text || option.name)
      Dialog.confirm({
        title: '确认院校',
        message: `您选择的院校为：\n\n${fieldValue.join(' / ')}\n\n之后可在设置中修改，确认吗？`,
        zIndex: 110
      })
        .then(async () => {
          // on confirm
          delete selectedOptions[0].children;
          this.updateStudentStore('unit', selectedOptions)
          this.updateStoreBindings()
          await this.initStore()
          this.updateStoreBindings()
          this.markStudentStart()
          wx.reLaunch({
            url: '/pages/main/index'
          })
        })
        .catch((e) => {
          // on cancel
          console.log(e)
          Notify({
            type: 'primary',
            message: '请重新选择',
            safeAreaInsetTop: true,
            top: 46,
          })
          this.setData({
            unitShow: true
          })
        });
    },
  }
})
