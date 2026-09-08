// components/signature/index.js
Component({
  properties: {
    fullScreen: {
      type: Boolean,
      value: false
    }
  },

  data: {
    _color: '#000000', // 颜色
    _size: 6, // 笔记倍数
    imgfile:'',
    imgwidth:0,
    imgheight:0
  },

  lifetimes: {
    attached: function() {
    this.isSign = false;
    wx.createSelectorQuery().in(this)
        .select('#handWriting')
        .fields({
            node: true,
            size: true,
            rect: true
        })
        .exec(res => {
            this.canvas = res[0].node;
            this.ctx = this.canvas.getContext('2d');
            this.systemInfo = wx.getWindowInfo();
            const dpr = this.systemInfo.pixelRatio;
            this.canvasCssWidth = res[0].width || 0;
            this.canvasCssHeight = res[0].height || 0;
            this.canvas.width = this.canvasCssWidth * dpr;
            this.canvas.height = this.canvasCssHeight * dpr;
            this.ctx.scale(dpr, dpr);
            this.ctx.strokeStyle = this.data._color;
            this.ctx.lineWidth = this.data._size;
            this.ctx.lineCap = "round";
            this.ctx.lineJoin = "round";
            this.canvasRect = {
              left: res[0].left || 0,
              top: res[0].top || 0,
              width: res[0].width || 0,
              height: res[0].height || 0
            };
        });
    },
    detached: function() {
      // 在组件实例被从页面节点树移除时执行
    },
  },
  methods: {  
    refreshCanvasRect() {
      wx.createSelectorQuery().in(this)
        .select('#handWriting')
        .boundingClientRect()
        .exec((res) => {
          const rect = Array.isArray(res) ? res[0] : null;
          if (!rect) {
            return;
          }
          this.canvasRect = {
            left: rect.left || 0,
            top: rect.top || 0,
            width: rect.width || 0,
            height: rect.height || 0
          };
        });
    },
    getTouchPoint(e) {
      const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (!touch) {
        return null;
      }
      const left = this.canvasRect && typeof this.canvasRect.left === 'number' ? this.canvasRect.left : 0;
      const top = this.canvasRect && typeof this.canvasRect.top === 'number' ? this.canvasRect.top : 0;
      const width = this.canvasRect && typeof this.canvasRect.width === 'number' ? this.canvasRect.width : this.canvas.width;
      const height = this.canvasRect && typeof this.canvasRect.height === 'number' ? this.canvasRect.height : this.canvas.height;
      const hasLocalPoint = typeof touch.x === 'number' && typeof touch.y === 'number';
      const isLocalValid = hasLocalPoint && touch.x >= 0 && touch.x <= width && touch.y >= 0 && touch.y <= height;
      const rawX = isLocalValid
        ? touch.x
        : (typeof touch.clientX === 'number'
          ? touch.clientX - left
          : (typeof touch.pageX === 'number' ? touch.pageX - left : 0));
      const rawY = isLocalValid
        ? touch.y
        : (typeof touch.clientY === 'number'
          ? touch.clientY - top
          : (typeof touch.pageY === 'number' ? touch.pageY - top : 0));
      const x = Math.max(0, Math.min(width, rawX));
      const y = Math.max(0, Math.min(height, rawY));
      return { x, y };
    },
    // 笔迹开始
    uploadScaleStart(e) {
      // debugger
      if (e.type != 'touchstart') return false;
      this.refreshCanvasRect();
      const point = this.getTouchPoint(e);
      if (!point) {
        return false;
      }
      this.ctx.beginPath();
      this.ctx.moveTo(point.x, point.y);
    },
    // 笔迹移动
    uploadScaleMove(e) {
        if (e.type != 'touchmove') return false;
        if (e.cancelable) {
            // 判断默认行为是否已经被禁用
            if (!e.defaultPrevented) {
                e.preventDefault();
            }
        }
        const point = this.getTouchPoint(e);
        if (!point) {
          return false;
        }
        this.ctx.lineTo(point.x, point.y);
        this.ctx.stroke();
        this.isSign = true;
    },
    // 笔迹结束
    uploadScaleEnd(e) {
      // debugger
      // this.ctx.closePath();
    },
    // 重写
    retDraw() {
      if (this.hasClick()) {
          wx.showToast({
              title: '点击太频繁了',
              icon: 'none'
          });
          return;
      }
      this.setCanvasBg(this.data._boardColor);
      this.setData({
        imgfile:''
      })
    },
    /**
     * 确定
     */
    confirmTap() {
      if (this.hasClick()) {
          wx.showToast({
              title: '点击太频繁了',
              icon: 'none'
          });
          return;
      }
      if (!this.isSign) {
          wx.showToast({
              title: '您未签字',
              icon: "none"
          });
          return;
      }
      wx.showLoading({
        title: '生成签名..',
      })
      setTimeout(() => {
        wx.hideLoading();
      }, 2000);
      
      var that=this;
      wx.canvasToTempFilePath({
          x: 0,
          y: 0,
          width: this.canvasCssWidth,
          height: this.canvasCssHeight,
          destWidth: this.canvasCssWidth * this.systemInfo.pixelRatio,
          destHeight: this.canvasCssHeight * this.systemInfo.pixelRatio,
          canvas: this.canvas,
          fileType: this.data.fileType,
          quality: this.data.quality,
          success: res => {
              var width=100;
              var height = width*(this.canvas.height/this.canvas.width);
              that.setData({
                imgfile:res.tempFilePath,
                imgwidth:width,
                imgheight:height
              })
              this.$emit("confirm", {
                path: res.tempFilePath,
                width: width,
                height: height
              });
              wx.hideLoading();
          }
      });
    },
    //设置画板背景并重写
    setCanvasBg(color = "#ffffff") {
      this.isSign = false;
      this.ctx.fillStyle = color;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    },
    
    $emit: function (name, detail, options) {
      this.triggerEvent(name, detail, options);
    },
    hasClick() {
      if(this.HAS_CLICK) return true;
      this.HAS_CLICK = true;
      this.HAS_CLICK_TIMER && clearTimeout(this.HAS_CLICK_TIMER);
      this.HAS_CLICK_TIMER = setTimeout(() => {
          this.HAS_CLICK = false;
      }, 1000);
      return false;
    },
    /**
     * 取消
     */
    cancelTap() {
      if (this.hasClick()) {
          wx.showToast({
              title: '点击太频繁了',
              icon: 'none'
          });
          return;
      }
      if (this.properties.fullScreen && this.isSign) {
        wx.showModal({
          title: '提示',
          content: '返回后会丢失签名信息，是否确认返回？',
          success: (res) => {
            if (res.confirm) {
              this.$emit("cancel", {
                discardSign: true
              });
            }
          }
        });
        return;
      }
      this.$emit("cancel");
    },
  }
})
