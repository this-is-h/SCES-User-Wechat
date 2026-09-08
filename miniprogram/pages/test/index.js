// pages/hetongsignature/index.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    imgfile:'',
    imgwidth:0,
    imgheight:0,
    allimgfile:''
  },
  confirmTap(e) {
    //this.updateSignData(e.detail);
    var imgfile = e.detail.path;
    var width = e.detail.width;
    var height = e.detail.height;
    this.applySignatureData({
      imgfile: imgfile,
      imgwidth: width,
      imgheight: height
    });
    //wx.navigateBack();
  },
  cancelTap() {
    wx.navigateTo({
      url: '/components/signaturehetong/fullScreen',
      success: (res) => {
        res.eventChannel.emit('setSignatureData', {
          imgfile: this.data.imgfile,
          imgwidth: this.data.imgwidth,
          imgheight: this.data.imgheight
        });
        res.eventChannel.on('signatureChanged', (data) => {
          this.applySignatureData(data);
        });
      }
    });
  },
  applySignatureData(data) {
    this.setData({
      imgfile: data.imgfile || '',
      imgwidth: data.imgwidth || 0,
      imgheight: data.imgheight || 0
    });
    this.drawtext();
  },
  retDraw(){
    this.setData({
      imgfile:'',
      imgwidth:0,
      imgheight:0
    })
    this.drawtext();
  },
  OkDraw(){
    var context = wx.createCanvasContext('secondCanvas');
    var systemInfo = wx.getWindowInfo();
    const dpr = systemInfo.pixelRatio;
    var that=this;
    wx.canvasToTempFilePath({
      x: 0,
      y: 0,
      width: context.width,
      height: context.height,
      destWidth: context.width * dpr,
      destHeight: context.height * dpr,
      canvasId: 'secondCanvas',
      //fileType: 'png',//这点选jpg截屏后是全黑
      //quality: 1,
      success(res) {
        console.log(res.tempFilePath)
        that.setData({
          allimgfile:res.tempFilePath,
        })
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success(res) {
              wx.showToast({
                  title: '已保存到相册',
                  duration: 2000
              });
          }
      });
        // that.setData({
        //   allimgfile:res.tempFilePath,
        // })
        
      },
      fail(res){
        console.log('fail:'+res);
      }
    });
  },
  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
  },
  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {
  },
  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    this.drawtext();
  },
  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },
  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },
  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },
  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
  },
  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
  },
  drawtext(){
    let info = [
      {
        "text": "授权委托书",
        "bold":true,
        "align":"center"
      },
      {
        "text": "委托人：【***】",
        "bold":false,
        "align":"left"
      },
      {
        "text": "公民身份号码：【4***********X】",
        "bold":false,
        "align":"left"
      },
      {
        "text": "居住地：【居住地*****】",
        "bold":false,
        "align":"left"
      },
      {
        "text": "受托人：***********************",
        "bold":false,
        "align":"left"
      },
      {
        "text": "　　本人【***】与【*****机构】******，因个人原因无法亲自处理相关事务，现特委托上列受托人作为本人代理人代本人办理前述****相关事务，委托期限自本授权委托书签署之日起至委托事项完成之日止，委托事项及权限范围如下：",
        "bold":false,
        "align":"left"
      },
      {
        "text": "　　1.某某事某某事某某事某某事某某事某某事某某事某某事某某事某某事；",
        "bold":false,
        "align":"left"
      },
      {
        "text": "　　2.某某事某某事某某事某某事某某事某某事某某；",
        "bold":false,
        "align":"left"
      },
      {
        "text": "　　3.某某事某某事某某事某某事某某事某某事某某；",
        "bold":false,
        "align":"left"
      },
      {
        "text": "　　4.代为签署委托事务相关各类文件和法律文书等；",
        "bold":false,
        "align":"left"
      },
      {
        "text": "　　5.同意受托人为处理委托事务转委托。",
        "bold":false,
        "align":"left"
      },
      {
        "text": "　　某某事某某事某某事某某事某某事某某事某某。",
        "bold":false,
        "align":"left"
      },
      {
        "text": "　　特此委托",
        "bold":false,
        "align":"left"
      },
      {
        "text": "委托人：　　　　　　　",
        "bold":false,
        "align":"right"
      },
      {
        "text": "2025年11月10日",
        "bold":false,
        "align":"right"
      }
    ];
    this.drawInit(info);
  },
  drawInit(info){
    var that = this;
    var res = wx.getWindowInfo();
    var canvasWidth = res.windowWidth;
    // 获取canvas的的宽  自适应宽（设备宽/750) px
    var Rpx = (canvasWidth / 375).toFixed(2);
    //画布高度 -底部按钮高度
    var canvasHeight = res.windowHeight - Rpx * 59;
    
    // 使用 wx.createContext 获取绘图上下文 context
    var context = wx.createCanvasContext('secondCanvas');
    //设置行高
    var lineHeight = Rpx * 28;
    //左边距
    var paddingLeft = Rpx * 10;
    //右边距
    var paddingRight = Rpx * 10;
    //当前行高
    var currentLineHeight = Rpx * 20;
    var result;
    context.save();
    var font = '';
    
    for (var i=0;i<info.length;i++){
      var font='';
      if (info[i].bold) {//判断加粗
        font=`bold ${(Rpx * 14).toFixed(0)}px PingFangSC-Regular`;
      } else {
        font=`${(Rpx * 14).toFixed(0)}px PingFangSC-Regular`;
      }
      result = this.breakLinesForCanvas(context, info[i].text || '无内容', canvasWidth - paddingLeft - paddingRight, font);
      //字体颜色
      context.fillStyle = '#000000';
      //this.ctx.fillStyle = "white";  
      var txtX = 0;
      if(info[i].align=="left"){
        txtX=paddingLeft;
      }
      if(info[i].align=="center"){
        txtX=(canvasWidth - paddingLeft - paddingRight - context.measureText(info[i].text).width)*0.5+paddingLeft;
      }
      if(info[i].align=="right"){
        txtX=(canvasWidth - paddingLeft - paddingRight - context.measureText(info[i].text).width)+paddingRight;
      }
      
      result.forEach(function (line, index) {
        currentLineHeight += Rpx * 30;
        context.fillText(line, txtX, currentLineHeight);  // currentLineHeight 表示文字在整个页面的位置：currentLineHeight + 300 表示整体下移 300px
      });
    }
    /**绑定签名*/
    var imgfile=that.data.imgfile;
    if(imgfile!=''){
      // 填充小程序码
      context.drawImage(
        that.data.imgfile,
        canvasWidth - paddingLeft - paddingRight - that.data.imgwidth,
        currentLineHeight-Rpx * 30 - that.data.imgheight*0.7,
        that.data.imgwidth,
        that.data.imgheight
      );
    }
    /*绑定签名结束*/
    context.draw();
    context.restore();
  },
  findBreakPoint(text, width, context){
    var min = 0;
    var max = text.length - 1;
    while (min <= max) {
      var middle = Math.floor((min + max) / 2);
      var middleWidth = context.measureText(text.substr(0, middle)).width;
      var oneCharWiderThanMiddleWidth = context.measureText(text.substr(0, middle + 1)).width;
      if (middleWidth <= width && oneCharWiderThanMiddleWidth > width) {
        return middle;
      }
      if (middleWidth < width) {
        min = middle + 1;
      } else {
        max = middle - 1;
      }
    }
    return -1;
  },
  breakLinesForCanvas(context, text, width, font) {
    var result = [];
    if (font) {
       context.font = font;
     }
    var textArray = text.split('\r\n');
    for (let i = 0; i < textArray.length; i++) {
      let item = textArray[i];
      var breakPoint = 0;
      while ((breakPoint = this.findBreakPoint(item, width, context)) !== -1) {
        result.push(item.substr(0, breakPoint));
        item = item.substr(breakPoint);
      }
      if (item) {
        result.push(item);
      }
    }
    return result;
  },
})
