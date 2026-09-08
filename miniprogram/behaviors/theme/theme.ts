import { subscribeTheme } from '../../utils/theme'

const unsubscribeByInstance = new WeakMap<object, () => void>()

module.exports = Behavior({
  data: {
    themeVar: {},
    themeMode: 'system',
    resolvedTheme: 'light',
    statusBarHeight: 0,
  },
  lifetimes: {
    attached: function () {
      const unsubscribe = subscribeTheme((snapshot) => {
        this.setData({
          themeVar: snapshot.themeVars,
          themeMode: snapshot.mode,
          resolvedTheme: snapshot.resolvedTheme,
        })
      })
      unsubscribeByInstance.set(this, unsubscribe)
      this.setData({
        statusBarHeight: getApp().globalData.statusBarHeight,
      })
    },
    detached: function () {
      const unsubscribe = unsubscribeByInstance.get(this)
      if (unsubscribe) {
        unsubscribe()
        unsubscribeByInstance.delete(this)
      }
    },
  }
})
