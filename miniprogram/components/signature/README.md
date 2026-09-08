# signature 组件说明

## 组件结构

- `index.js / index.wxml / index.wxss`：签名面板主体，支持局部模式与全屏模式。
- `fullScreen.js / fullScreen.wxml / fullScreen.json`：全屏签名页，横屏展示，负责与打开页同步签名结果。

## 组件属性

- `fullScreen`：`Boolean`，默认 `false`。
  - `false`：普通模式，显示为页面内签名框。
  - `true`：全屏模式，按钮文案会从“放大”变为“缩小”。

## 组件事件

- `confirm`
  - 触发时机：点击“提交签字”且确实完成签名后。
  - `detail` 字段：
    - `path`：签名图片临时路径
    - `width`：建议展示宽度
    - `height`：建议展示高度
- `cancel`
  - 触发时机：点击“放大/缩小”按钮，或在全屏模式下确认返回。
  - 全屏模式下若用户确认放弃当前未提交签名，会携带 `detail.discardSign = true`。

## 页面接入方式

### 1) 页面 JSON 注册

```json
{
  "usingComponents": {
    "signaturehetong": "../../components/signature/index"
  }
}
```

### 2) 页面 WXML 使用

```xml
<signaturehetong bindconfirm="confirmTap" bindcancel="cancelTap"></signaturehetong>
```

### 3) 页面逻辑处理

- `confirmTap(e)`：读取 `e.detail.path/width/height`，保存签名图并刷新页面展示。
- `cancelTap()`：通过 `wx.navigateTo('/components/signature/fullScreen')` 打开全屏签名页，并通过 `eventChannel` 双向同步签名数据。

## 全屏页与调用页数据同步

- 调用页进入全屏页时通过 `setSignatureData` 传入已有签名。
- 全屏页在确认提交或返回时通过 `signatureChanged` 回传最新签名。
- 全屏页 `onUnload` 中有兜底同步，避免异常返回导致签名丢失。
