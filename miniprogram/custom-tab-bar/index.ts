// custom-tab-bar/index.ts
import { getThemeSnapshot, subscribeTheme } from '../utils/theme'

const unsubscribeByInstance = new WeakMap<object, () => void>()

Component({
  data: {
    active: 0,
    themeVar: getThemeSnapshot().themeVars,
    list: [{
      pagePath: "/pages/main/index",
      icon: "records",
      text: "申请"
    }, {
      pagePath: "/pages/settings/index",
      icon: "setting",
      text: "设置"
    }]
  },
  lifetimes: {
    attached() {
      const unsubscribe = subscribeTheme((snapshot) => {
        this.setData({ themeVar: snapshot.themeVars })
      })
      unsubscribeByInstance.set(this, unsubscribe)
    },
    detached() {
      const unsubscribe = unsubscribeByInstance.get(this)
      if (unsubscribe) {
        unsubscribe()
        unsubscribeByInstance.delete(this)
      }
    },
  },
  methods: {
    onChange(event: { detail: number }) {
      // event.detail 的值为当前选中项的索引
      const item = this.data.list[event.detail]
      if (!item) {
        return
      }
      wx.switchTab({ url: item.pagePath })
      this.setData({ active: event.detail })
    }
  },
});
