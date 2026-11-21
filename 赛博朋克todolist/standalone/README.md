# neon-tasks · 单文件客户端

`todo.html` 是一个文件：HTML + CSS + JS 全内联，零依赖、零构建、零网络。
双击就能用，也可以扔进任何静态托管。

## 打开方式

- 双击 `todo.html`（默认浏览器）
- 拖进任意浏览器窗口
- 想要"应用窗口"观感，用 Edge 的 app 模式（无地址栏、独立任务栏图标）：
  ```bat
  msedge --app="file:///D:/你的路径/neon-tasks/standalone/todo.html" --window-size=430,820
  ```
  右键任务栏图标 → 固定，就是一个伪客户端。要真安装包见 `../tauri/README.md`。

## 数据

- 存在 `localStorage`，键 `neon-tasks-standalone:v1`。
- 换浏览器、换机器、清站点数据都会丢，所以有导出。
- **备份**：面板底部 `↓ 导出` → 下载 `neon-tasks-YYYYMMDD-HHmm.json`。
- **恢复**：`↑ 导入`（第一次点击只是上膛，3.2 秒内再点才弹文件选择器）→ 选 JSON。
  导入是**整份替换**，不做合并；任务 id 重复的会被去重。
- 导入会保留当前窗口位置（`ui` 用本机的），任务、XP、等级、连击、BEST 全部来自文件。
- JSON 有 `app: "neon-tasks-standalone"` 标记；手改格式导致解析失败时，界面只提示
  "导入失败"，原数据不动。

## 和其它两处的关系

| 产物 | 数据在哪 | 说明 |
| --- | --- | --- |
| `standalone/todo.html` | 浏览器 localStorage | 本文件，双击即用 |
| `neon-tasks/`（DSH 插件） | 宿主 `neon_tasks.json` | 嵌在 DSH GUI 里的悬浮球 |
| `tauri/` | WebView2 localStorage | 同一份 todo.html 的原生壳 |

三者的 JSON 结构同源，但**存储互不相通**：DSH 插件走宿主 API，另外两个走 localStorage。
插件端目前没有导出按钮，别指望把插件数据直接 drag 进浏览器——需要的话得再加。

## 自检

```bat
node tools\standalone-check.js
```

用最小 DOM shim 在 vm 里跑真实页面脚本，31 项断言覆盖：启动渲染、固定定位、conic 进度环、
展开、标题/副标题、添加、击杀 +10 XP、连击加成、重复点击不加分、DDL 循环、优先级、
清空二次确认、导出 blob 内容、导入整份替换、坏 JSON 拒绝。

`node tools\browser-check.js` 用本机 Chrome/Edge 跑真实布局与 1 秒心跳（10 项）：
面板不越界、导出/导入按钮在玻璃卡内、无截止的已完成任务在 updateLive 之后仍显示"无截止"。
shim 看不到几何和真实定时器，这一层专门补那两个洞。
