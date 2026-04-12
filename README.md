# 组件仓库提交
- 请在您的 GitHub 仓库根目录创建 `widget_info.json`，并使用以下格式填写组件信息：

```json
{
  "name": "Example Widget",
  "business_setup": {
    "id": "example_widget",
    "renameable": false
  },
  // Card setup is optional 卡片设置是可选的
  "card_setup": {
    "name": "Example Widget Card",
    "package": "hk.uwu.reareye",
    "priority": 500,
    "sticky": true,
    "renameable": false
  }
}
```

`wallpaper` refers to a wallpaper-type widget, i.e. 壁纸类型。
