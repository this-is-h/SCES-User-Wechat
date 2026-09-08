const { subscribeTheme } = require('../../utils/theme');

let unsubscribeTheme = null;

Page({
  data: {
    themeVar: {},
    imgfile: '',
    imgwidth: 0,
    imgheight: 0
  },
  onLoad() {
    unsubscribeTheme = subscribeTheme((snapshot) => {
      this.setData({ themeVar: snapshot.themeVars });
    });
    this.hasSynced = false;
    const eventChannel = this.getOpenerEventChannel();
    this.eventChannel = eventChannel;
    eventChannel.on('setSignatureData', (data) => {
      this.setData({
        imgfile: data.imgfile || '',
        imgwidth: data.imgwidth || 0,
        imgheight: data.imgheight || 0
      });
    });
  },
  onUnload() {
    if (unsubscribeTheme) {
      unsubscribeTheme();
      unsubscribeTheme = null;
    }
    if (!this.hasSynced) {
      this.emitSignatureData();
    }
  },
  emitSignatureData() {
    if (!this.eventChannel) {
      return;
    }
    this.hasSynced = true;
    this.eventChannel.emit('signatureChanged', {
      imgfile: this.data.imgfile,
      imgwidth: this.data.imgwidth,
      imgheight: this.data.imgheight
    });
  },
  confirmTap(e) {
    const imgfile = e.detail.path;
    const width = e.detail.width;
    const height = e.detail.height;
    this.setData({
      imgfile: imgfile,
      imgwidth: width,
      imgheight: height
    });
    this.emitSignatureData();
    wx.navigateBack();
  },
  cancelTap(e) {
    const discardSign = !!(e && e.detail && e.detail.discardSign);
    if (discardSign) {
      this.hasSynced = true;
      wx.navigateBack();
      return;
    }
    this.emitSignatureData();
    wx.navigateBack();
  }
});
