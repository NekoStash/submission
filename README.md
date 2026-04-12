# REARStore Submission

![icon](./icons/cozy_vector.svg)
![icon2](./icons/compact_vector.svg)

这里是REAREye的官方组件仓库。

## 组件仓库提交

- 请在您的 GitHub 仓库根目录创建 `widget_info.json`，并使用以下格式填写组件信息：

```json
{
  // Support widget (default) or wallpaper
  // 支持 widget (默认) 和 wallpaper
  "type": "widget",
  "name": "Example Widget",
  "business_setup": {
    "id": "example_widget",
    "renameable": false
  },
  // Card setup is optional
  // 卡片设置是可选的
  "card_setup": {
    "name": "Example Widget Card",
    "package": "hk.uwu.reareye",
    "priority": 500,
    "sticky": true,
    "renameable": false
  }
}
```

### 关于 `widget_info.json` 的相关参数解析

* **name**：组件名称，中英文均可
* **id**：组件唯一 ID。仅允许小写英文字母、数字、`-`、`_`
* **renameable**：是否可以修改组件相关配置，`true` 为允许，`false` 为禁止
* **package**：目标包名
* **priority**：默认优先级
* **sticky**：常驻卡片，`true` 为是，`false` 为否

## 提交方式

如需提交组件，请前往 Issues 页面提交。
在提交时，您需要填写：

* **组件名称**：请勿去掉前面的 `[Widget Submission]`
* **Widget ID**：组件唯一 ID，仅允许小写英文字母、数字、`-`、`_`
* **Repository URL**：组件 GitHub 仓库地址，必须是仓库根地址
* **Widget Type**：卡片类型，分为 `card`（卡片）、`enhanced`（增强）、`notification`（通知）、`wallpaper`（壁纸）
    * `card` 为普通卡片
    * `enhanced` 为替换掉官方的卡片
    * `notification` 为动态通知类卡片
    * `wallpaper` 为壁纸类型
