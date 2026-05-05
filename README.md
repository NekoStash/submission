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
  // Minimum REAREye version required to install this widget (Optional)
  // 安装此组件所需要最低的REAREye版本 (可选)
  "minVersion": 99,
  // Maximum REAREye version supported by this widget (Optional)
  // 此小部件支持的最高 REAREye 版本 (可选)
  "maxVersion": 104,
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
  },
  // Only available on type is notification
  // 仅在类型为notification时可用 
  "scene_setup": {
    // Support regex prefix "re:" or "regex:"
    // 支持正则规则前缀 "re:" 或 "regex:"
    // Example: "re:.*", "re:CH:.*", "re:com.example.(.*)" or other else
    "scene": "messageCenter",
    // Also support regex rule
    // 同样支持正则规则
    "pkg": "com.example.app"
  },
  // Widget Requirements - Optional
  // 组件安装条件 - 可选
  "requirements": {
    // Required Apps (List - Match all) - Optional
    // 所需的App包名 (列表 - 匹配所有) - 可选
    "packages": [
      "com.Badnng.moe",
      "org.nsh07.pomodoro"
    ],
    // Required Config State (See below for grammar details) - Optional
    // 所需的配置状态 (语法查看下方内容) - 可选
    "configs": {
      "enable_allow_rear_focus_notices": true,
      "lyric_display_mode": ">= 1",
      "background_whitelist_apps": "== com.miHoYo.Nap"
    }
  },
  // Execute after installing this widget - Optional
  // 在此组件完成安装后执行 - 可选
  "postinstall": {
    // {id} - store id, {business} - business id, {card} - card id
    "uri": "content://open.some.example.uri?store_id={id}"
  }
}
```

### 配置状态 (Config State)
- **读取的配置节点必须在模块的 `ConfigKeys` 中存在**
- **Config key to read should be used on `ConfigKeys` file**

#### 表达式 - Expression
- `bool`
  - 只支持 `==` / `!=`
- `number`
  - 支持 `==` / `!=` / `>` / `<` / `>=` / `<=`
- `list / set`
  - `==` 表示包含 (Contains)
  - `!=` 表示不包含 (Not Contains)
- `string`
  - 只支持 `==` / `!=`

### 内容读取
- 提供ContentProvider `content://hk.uwu.reareye.archive.read`

* **mode** 模式: `store_id`, `business_id`
* **id** ID: 根据模式传入对应的ID, 如仓库ID或组件(Business)ID
* **entry** 文件(可选): 需要读取的文件路径, 留空获取文件列表

- 内容请读取Cursor: `json`

#### 返回内容
- 文件列表

```json
{
  "success": true,
  "error": null,
  "entries": [
    "a/b.json",
    "c/d.png"
  ],
  "contentBase64": null
}
```

- 读取内容

```json
{
  "success": true,
  "error": null,
  "mode": "store_id",
  "storeWidgetId": "demo_widget",
  "businessConfigId": "demo_business",
  "business": "demo_business",
  "card": "demo_card",
  "entry": "manifest.xml",
  "contentBase64": "eyJzdWNjZXNzIjp0cnVlLCJlcnJvciI6bnVsbH0="
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
