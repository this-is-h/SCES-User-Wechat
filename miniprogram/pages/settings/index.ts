// pages/settings/index.ts
import { ComponentWithStore } from 'mobx-miniprogram-bindings'
import { studentStore } from '../../stores/student'

const themeBehavior = require('../../behaviors/theme/theme')

import { getCurrentBatch } from '../../stores/batch'
import { gateway } from '../../gateway/active'
import type { UnitTreeNode } from '../../gateway/types'
import { PROFILE_ID } from '../../config/runtime'
import Notify from '@vant/weapp/notify/notify'
import Toast from '@vant/weapp/toast/toast'
import Dialog from '@vant/weapp/dialog/dialog'
import { wipeAll } from '../../utils/local-vault'
import { getThemeMode, setThemeMode, type ThemeMode } from '../../utils/theme'

const THEME_RADIO_TO_MODE: Record<string, ThemeMode> = {
  '1': 'light',
  '2': 'dark',
  '3': 'system',
}

const THEME_MODE_TO_RADIO: Record<ThemeMode, string> = {
  light: '1',
  dark: '2',
  system: '3',
}

ComponentWithStore({
  behaviors: [themeBehavior],
  properties: {
  },
  data: {
    appVersion: 0,
    radio: THEME_MODE_TO_RADIO[getThemeMode()],
    unitShow: false,
    unitValue: "",
    configName: "",
    configVersion: 0,
    configRevision: 0,
    keyId: "",
    units: [] as UnitTreeNode[],
    profileId: PROFILE_ID,
  }, // 私有数据，可用于模板渲染
  storeBindings: {
    store: studentStore,
    fields: ['unit', 'unitTitle', 'unitValue', 'configName', 'configVersion', 'configRevision'] as const,
    actions: {
      initStore: 'init',
      updateStudentStore: 'update'
    } as const,
  },
  lifetimes: {
    // 生命周期函数，可以为函数，或一个在methods段中定义的方法名
    created: function () { },
    attached: async function () {
      const batch = getCurrentBatch()
      const units = await gateway.listUnits()
      this.setData({
        radio: THEME_MODE_TO_RADIO[getThemeMode()],
        appVersion: getApp().globalData.appVersion,
        configName: this.data.configName,
        configVersion: this.data.configVersion,
        configRevision: this.data.configRevision,
        keyId: batch ? batch.keyId : "",
        units
      })
    },
    moved: function () { },
    detached: function () { },
  },

  pageLifetimes: {
    // 组件所在页面的生命周期函数
    show() {
      if (typeof this.getTabBar === 'function' &&
        this.getTabBar()) {
        this.getTabBar().setData({
          active: 1
        })
      }
    },
    hide: function () { },
    resize: function () { },
  },

  methods: {
    onUnitShow() {
      this.setData({
        unitShow: true
      });
    },
    onUnitClose() {
      this.setData({
        unitShow: false
      });
    },
    onUnitFinish(event) {
      const { selectedOptions } = event.detail;
      delete selectedOptions[0].children;
      this.updateStudentStore('unit', selectedOptions)
      this.setData({
        unitShow: false
      })
      this.reloadUnitConfig()
    },
    async reloadUnitConfig() {
      Toast.loading({
        message: '正在加载配置...',
        forbidClick: true,
        duration: 0
      })
      try {
        const notify = await this.initStore()
        this.updateStoreBindings()
        const batch = getCurrentBatch()
        this.setData({
          keyId: batch ? batch.keyId : ""
        })
        if (notify) {
          Notify({
            type: notify.type,
            message: notify.msg,
            safeAreaInsetTop: true,
            top: 46,
          })
        }
      } finally {
        Toast.clear()
      }
    },
    onWipeShow() {
      Dialog.confirm({
        title: '清除本机数据',
        message: '将删除本机全部填写内容、证明材料与已生成文件，且不可恢复。确定清除吗？',
        confirmButtonText: '清除',
        cancelButtonText: '取消',
      }).then(() => {
        this.onWipeConfirm()
      }).catch(() => {
        // 用户取消
      })
    },
    onChange(event: { detail?: unknown }) {
      this.updateThemeMode(event && event.detail)
    },
    onClick(event: {
      currentTarget?: { dataset?: Record<string, unknown> }
    }) {
      const name = event && event.currentTarget && event.currentTarget.dataset
        ? event.currentTarget.dataset.name
        : ''
      this.updateThemeMode(name)
    },
    updateThemeMode(value: unknown) {
      const radio = String(value == null ? '' : value)
      const mode = THEME_RADIO_TO_MODE[radio]
      if (!mode) {
        return
      }
      this.setData({ radio })
      if (getThemeMode() !== mode) {
        setThemeMode(mode)
      }
    },
    async onWipeConfirm() {
      try {
        await wipeAll()
        Toast({
          message: '已清除本机数据',
          duration: 1500,
        })
        setTimeout(function () {
          wx.reLaunch({
            url: '/pages/privacyAndUnit/index',
          })
        }, 1200)
      } catch (error) {
        console.error(error)
        Notify({
          type: 'danger',
          message: '清除数据失败，请重试',
          safeAreaInsetTop: true,
          top: 46,
        })
      }
    }
  }

})
