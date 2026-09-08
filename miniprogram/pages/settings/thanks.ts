// pages/settings/thanks.ts
const themeBehavior = require('../../behaviors/theme/theme')

Component({
  behaviors: [themeBehavior],
  properties: {
  },
  data: {
    dialogH: false
  }, // 私有数据，可用于模板渲染

  lifetimes: {
    // 生命周期函数，可以为函数，或一个在methods段中定义的方法名
    created: function () { },
    attached: function () { },
  },

  pageLifetimes: {
  },

  methods: {
    onBack() {
      wx.navigateBack()
    },
    dialogHShow() {
      this.setData({
        dialogH: true
      })
    }
  }

})