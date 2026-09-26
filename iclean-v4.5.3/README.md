# iClean · Chrome 浏览器数据清理工具

一键清理当前站点或全局的 Cookie、缓存、Storage、Service Worker 等浏览数据。

## 功能

- 🧹 **清理当前页面** —— 仅清除当前标签页所属站点的数据（Cookie / localStorage / IndexedDB / 缓存 / Service Worker）
- 🗑 **清理全部** —— 按时间范围（1 小时 / 24 小时 / 7 天 / 30 天 / 全部）全局清理
- 🎛 **数据类型选择** —— 勾选要清理的类型，支持「快速 / 标准 / 彻底」三档预设，手动勾选会被记住
- 🛡 **白名单保护** —— 在设置里保护常用站点，避免误清登录态
- 🖱 **右键菜单** —— 在任意页面右键即可「清理此站点」
- ⌨️ **快捷键** —— `Ctrl/Cmd + Shift + K` 快速清理当前页
- 🖐 **鼠标手势与超级拖拽** —— 右键划动前进/后退；拖文字搜索、拖链接前台新标签打开
- 🔖 **书签在新标签页打开** —— 点书签时前台新标签打开，原页面完全不动（默认关闭，需在设置里开启）

### 书签在新标签页打开（实现说明与注意事项）

Chrome 没有「书签被点击」事件，因此该功能通过改写书签地址实现：

1. 用 `webNavigation` 的 `transitionType === 'auto_bookmark'` 识别「通过书签打开」的导航
   —— **不改写任何书签地址**，书签的收藏状态、收藏位置、书签管理器操作全部保持原生行为
2. 识别到书签点击后：在当前标签右侧新开一个前台标签打开，原标签恢复到导航前的地址
   （导航刚发起、通常尚未渲染，基本无感）

- 原标签若是空标签页（新建标签页 / about:blank），直接在该标签打开，不再多开一张
- 依赖 Chrome 内置的导航类型，不需要任何外部端点或网络请求

## 安装（开发模式）

1. 打开 Chrome，进入 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点击「加载已解压的扩展」
4. 选择本文件夹 `chrome-cleaner/`
5. 扩展图标出现在工具栏，点击即可使用

> 如需清理本地 `file://` 页面，请在扩展详情页开启「允许访问文件网址」。

## 目录说明

```
chrome-cleaner/
├── manifest.json               # 扩展清单（MV3）
├── icons/                      # 扩展图标（16/32/48/128）
├── src/
│   ├── background/background.js # Service Worker：接收指令、执行清理
│   ├── shared/                  # 共享脚本（类型表 / 配置 / 清理核心）
│   ├── popup/                   # 点击图标弹出的主界面
│   └── options/                 # 设置页（白名单 / 历史 / 预设）
└── docs/开发文档.md              # 完整开发文档
```

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `browsingData` | 清理浏览数据（核心） |
| `tabs` / `activeTab` | 获取当前页面 origin |
| `scripting` | 注入脚本清 sessionStorage、估算存储占用 |
| `storage` | 保存勾选状态与白名单 |
| `contextMenus` | 右键菜单「清理此站点」 |
| `alarms` | 预留：定时清理（v1.2） |

## 注意事项

- **清理不可撤销**，清理前会二次确认。
- 部分数据类型（浏览历史 / 下载记录 / 密码 / 表单）**不支持按站点清理**，仅在「清理全部」时生效。
- `chrome://`、`edge://`、`about:` 等浏览器内部页面不支持清理。
- 本扩展**不上传任何数据**，所有操作均在本地完成。

## 后续规划

- [ ] 定时自动清理
- [ ] 清理后自动刷新页面
- [ ] 多语言支持
- [ ] 清理历史图表

## 参考

- [chrome.browsingData API](https://developer.chrome.com/docs/extensions/reference/api/browsingData)
- [Manifest V3 迁移指南](https://developer.chrome.com/docs/extensions/develop/migrate)

## 第三方代码与许可（重要）

本扩展内置的**鼠标手势与超级拖拽**功能来自开源项目 FlowMouse
（Chrome 扩展 ID `fnldhkfidchnjiokpoemdhoejmaojkgp`，作者 Hmily[LCG] & Coxxs），
以 **GNU GPL v3** 授权原样引入：

- 引入路径：`js/`、`pages/`、`css/`、`_locales/`
- 许可证全文：`LICENSE-flowmouse-GPLv3.txt`；第三方组件声明：`THIRD_PARTY_LICENSES.md`

集成方式：
- 内容脚本（`js/constants.js`、`js/gesture-visual.js`、`js/gesture-recognizer.js`、`js/content.js`）按原样注入所有页面
- 后台动作执行器 `js/background.js` 由本扩展的 Service Worker 通过 `importScripts` 加载
- 本扩展的清理功能走独立的 `chrome.runtime.onConnect` 长连接通道（`port.name = 'cc-clean'`），
  与手势模块的消息监听互不干扰
- 手势/拖拽配置存于 `chrome.storage.sync`，键名沿用 FlowMouse 的默认设置结构
  （`enableGesture`、`distanceThreshold`、`enableTextDrag`、`enableLinkDrag`、`enableImageDrag`、
  `textDragIgnoreInput`、`linkDropIgnoreInput`）

**本扩展对引入代码所做的修改**（遵循 GPL v3 第 5 条，修改处已标注）：
1. `js/background.js` 的 `updateBadge()` 改为直接返回，不再在图标上显示蓝色/橙色 `!` 角标
2. 已删除 FlowMouse 自带的设置/欢迎界面（`pages/options|popup|about|css-editor|permission|tutorial.html`、
   `js/components/`、`css/`），本扩展使用自己的 popup 与设置页
3. 精简 `_locales`，仅保留 `en` 与 `zh_CN`，并进一步裁剪为代码实际引用的 139 个键
   （164KB → 16KB）
4. `manifest.json` 的 `all_frames` 由 `true` 改为 `false`（避免每个 iframe 注入一份脚本导致 CPU 占用高）
5. 已删除「自定义右键菜单」模块（`js/context-menu.js`、`js/lib/`、`pages/context-menu.html`）
   —— 该功能仅在绑定 `menuShowTabs` / `menuShowBookmarks` / `menuRecentlyClosed` /
   自定义菜单等手势动作时才会用到（默认均未绑定）；因其为懒加载，正常手势与拖拽不受影响
6. `js/background.js`：移除「安装/首次加载时自动打开 `pages/tutorial.html`」的行为
   （该教程页已删除，否则每次加载扩展都会弹出空白页）；两处「打开设置页」改为指向
   本扩展的设置页 `src/options/options.html`
7. 移除 `optional_permissions`（`clipboardRead` / `downloads` / `pageCapture`）：
   它们对应的动作（保存图片 / 另存页面 / 粘贴剪贴板）需要绑定入口与权限请求页，
   而两者均已删除，实际不可达。若将来需要这些功能，需恢复权限并重建绑定 UI

> ⚠️ **由于 GPL v3 的传染性，本扩展整体需以 GPL v3 分发。**
> 如需上架 Chrome 应用商店，必须一并提供完整源码并保留上述版权与许可声明。
> 仅个人本机使用（加载已解压的扩展、不再分发）则不受分发条款约束。

