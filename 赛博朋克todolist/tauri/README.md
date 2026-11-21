# neon-tasks · Tauri 桌面壳

同一个单文件前端（`../standalone/todo.html`）装进原生窗口（Windows 上是 WebView2），
没有 Node、没有 dev server、没有网络请求。

## 现状

已在本机构建出可交付产物（2026-11-21）：

- `src-tauri/target/release/neon-tasks.exe`（8.5 MB，免安装）
- `src-tauri/target/release/bundle/nsis/neon-tasks_1.0.0_x64-setup.exe`（1.84 MB，NSIS 安装包）
- 截图：`../tools/preview/app-window.png`（真实窗口 434×838）

静态校验 24/24 通过（配置、图标容器、前端字节一致、内联脚本可解析、窗口参数）。
本机 Rust 1.100.0 + MSVC（VS 2022 Community）+ WebView2 157 均已就绪。

## 目录

```
tauri/
├── README.md
├── src/index.html          ← 前端产物（由 tools/sync-frontend.js 生成，勿手改）
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json      ← 窗口尺寸/标题/图标/打包参数
    ├── capabilities/default.json
    ├── icons/               ← 32/128/256/512 png + 6 帧 ico（tools/make-icons.js 生成）
    └── src/main.rs
```

## 前置（Windows）

1. **Rust**：`winget install Rustlang.Rustup`（或 rustup.rs），然后 `rustup default stable`。
2. **MSVC 生成工具**（链接器必需，仅装 rustup 不够）：
   ```bat
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```
   没装它的典型报错：`link.exe not found` / `error: linker 'link.exe' not found`。
3. **WebView2**：Win11 自带；Win10 一般已随 Edge 安装。缺了会白屏，装 Evergreen Runtime。

验证：`rustc -V`、`cargo -V`。

## 构建

本仓库提供了两条封装好的脚本（内部先 `vcvars64` 注入 MSVC 环境再调 cargo/npx）：

```bat
tools\build-tauri.bat    :: cargo build --release → target\release\neon-tasks.exe
tools\build-nsis.bat     :: npx @tauri-apps/cli build --bundles nsis → NSIS 安装包
```

等价的手工命令：

```bat
cd tauri\src-tauri
cargo run --release          :: 直接开窗口，最快
cargo build --release        :: exe: target\release\neon-tasks.exe

npx --yes @tauri-apps/cli@^2 build --bundles nsis   :: 只要 exe 安装器
npx --yes @tauri-apps/cli@^2 build                  :: nsis + msi（需 WiX，Tauri 会自行下载）
```

从本仓库的 MSYS bash 调这两个 `.bat` 必须带 `MSYS_NO_PATHCONV=1`：

```bash
MSYS_NO_PATHCONV=1 cmd /c "$PWD/tools/build-nsis.bat"
```

首次构建会下载数百 MB crates 并编译数分钟，正常。后续增量构建只重编本项目，约 1 分钟。

## 日常维护

```bat
node tools\sync-frontend.js    :: 前端改了以后同步进 tauri\src
node tools\verify-tauri.js     :: 静态校验（24 项）
node tools\make-icons.js       :: 重新生成全部图标
node tools\standalone-check.js :: 前端行为回归（31 项，DOM shim）
node tools\browser-check.js    :: 真实浏览器回归（10 项，需 Chrome/Edge）
```

`verify-tauri.js` 里有一项是**字节级一致性**：`tauri/src/index.html` 必须和
`standalone/todo.html` 完全相同，忘了 sync 会直接红。

## 窗口与外观

窗口在 `src/main.rs` 的 `setup` 里编程创建（label `main`，标题「赛博朋克 · Todo list」，
420×800 竖版，最小 340×560，居中）。改尺寸/标题就改 `main.rs`；`tauri.conf.json` 里
`app.windows` 留空 `[]`（避免与编程建窗重复）。

`csp: null` 是单文件内联脚本的硬要求；这个 app 不加载任何远程内容，风险面就是本地文件。

## 数据位置

前端用 `localStorage`，在 WebView2 的用户数据目录里（默认
`%LOCALAPPDATA%\com.neontasks.client\EBWebView`）。删掉该目录 = 清空数据；
换机/备份用面板底部的 ↓导出 / ↑导入。

设环境变量 `NEON_TASKS_DATA_DIR` 可覆盖 WebView2 数据目录（非空才生效），
用于沙箱烟测等场景。

## 已知边界

- 图标是我用零依赖 PNG/ICO 编码器现画的（深底 + 绿环带黄弧 + 绿勾），不是设计公司出品，
  但 16px 下仍可辨认。
- `bundle.targets: "all"` 会尝试 MSI；没装 WiX 时会由 Tauri 自动下载，失败就退回
  `--bundles nsis`。
- **DSH 沙箱内运行 exe 会失败**：DSH 给未白名单的子进程套受限令牌（只可写工作区），
  导致 WebView2 写 `%LOCALAPPDATA%` 时报 `拒绝访问 (os error 5)`。真实用户双击 exe
  （完整令牌）不受影响；在沙箱里烟测时用 `NEON_TASKS_DATA_DIR` 指向工作区即可。
- **安装器在 DSH 沙箱里启动会闪退**：NSIS 启动第一步是把载荷解压到 `%TEMP%`
  （=`%LOCALAPPDATA%\Temp`），受限令牌写不进去，安装器瞬间退出（exit 2，无任何提示）。
  实测：`TEMP/TMP` 指到工作区后同一个安装器 exit 0 完整安装。解决：从 Windows
  资源管理器双击安装（完整令牌），不要在 DSH 会话里启动它。
