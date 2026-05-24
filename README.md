# Pornhub Shorties Downloader Helper

一个浏览器扩展（Chromium 内核通用），在 Pornhub Shorties 页面上加一个
"一键 yt-dlp 下载" 按钮。实际下载由一个 **native messaging host** 完成，
host 内置了 `yt-dlp` 和 `ffmpeg`，所以**最终用户不需要自己装 Python /
yt-dlp / ffmpeg**。

| 组件 | 跑在哪 | 技术栈 |
|---|---|---|
| 浏览器扩展（`manifest.json`、`background.js`、`popup.*`、`content.*`） | Chrome / Edge / Brave / Vivaldi / Opera / Chromium | MV3 + 原生 JS |
| Native host（`native_host.py` → 编译成 `shorties_host[.exe]`） | 操作系统进程，通过 stdio 跟浏览器对话 | Python + PyInstaller 打包 |

扩展通过 `manifest.json` 里的 `key` 字段锁定了**固定 ID** `djnbhglpkggbgibmdnngpklojeepikil`，
不管用什么方式加载、装哪台机器上 ID 永远一样，native host 的 `allowed_origins`
也就能匹配。

---

## 支持的系统

| OS / 架构 | 状态 |
|---|---|
| Windows 10 / 11 (x64) | ✅ |
| macOS Apple Silicon (arm64) | ✅ |
| macOS Intel (x86_64) | ✅ |
| Linux x86_64 | ✅ |
| Linux arm64 | ⚠️ 构建能过，未做日常验证 |

---

## 安装（最终用户）

### 共同前置条件

- 一个 Chromium 内核浏览器（Edge / Chrome / Brave / Vivaldi / Opera / Chromium）
- **Python 3.7+**（仅用于跑 `install_host.py` 注册脚本；host 本身已经打成独立
  可执行，运行时不依赖 Python）
  - macOS：自带 `/usr/bin/python3`，无需额外装
  - Windows：[python.org 安装包](https://www.python.org/downloads/) 或 `winget install Python.Python.3.13`
  - Linux：`sudo apt install python3` / `sudo dnf install python3` 等

### 第 1 步：下载并解压 host bundle

到 [Releases](https://github.com/MetaLoan/pornhub-shorties-download/releases) 下载对应平台的压缩包：

| 平台 | 文件 | 解压后包含 |
|---|---|---|
| Windows x64 | `shorties_host-windows-x64.zip` | `shorties_host-windows-x64/shorties_host.exe` + `_internal/` |
| macOS Apple Silicon | `shorties_host-macos-arm64.tar.gz` | `shorties_host-macos-arm64/shorties_host` + `_internal/` |
| macOS Intel | `shorties_host-macos-x64.tar.gz` | 同上 |
| Linux x64 | `shorties_host-linux-x64.tar.gz` | 同上 |

> **注意**：`_internal/` 文件夹必须跟主程序在一起，里面有 `Python3.framework`、
> 内嵌的 `yt-dlp` 库、`ffmpeg` 等。不要单独拷主程序。

也可以 clone 仓库自己编译（见下面"开发者构建"一节）。

### 第 2 步：跑 install_host.py 注册到浏览器

#### macOS

```sh
# 解压
tar -xzf shorties_host-macos-arm64.tar.gz
cd shorties_host-macos-arm64

# 清掉 Gatekeeper 隔离属性（从浏览器/airdrop 拿到的文件会被打 quarantine）
xattr -cr .

# 跑安装器（用解压后的目录作为 --bundle 参数）
python3 install_host.py --bundle .
```

安装器会：
- 把整个 bundle 拷贝到 `~/Library/Application Support/ShortiesDownloader/host/`
- 在 Chrome / Edge / Brave / Vivaldi / Opera / Chromium 的 `NativeMessagingHosts/` 目录写入注册文件

#### Windows

```powershell
# 解压（资源管理器里右键解压，或 PowerShell）
Expand-Archive shorties_host-windows-x64.zip -DestinationPath .
cd shorties_host-windows-x64

# 跑安装器
python install_host.py --bundle .
```

安装器会：
- 把整个 bundle 拷贝到 `%LOCALAPPDATA%\ShortiesDownloader\host\`
- 在 `HKEY_CURRENT_USER\Software\<浏览器>\NativeMessagingHosts\com.shorties.downloader` 写注册表项

> Windows 不需要管理员权限（写的是 `HKCU`，不是 `HKLM`）。
> 首次运行 `shorties_host.exe` 时可能弹 SmartScreen，点"更多信息 → 仍要运行"即可——一次性的。

#### Linux

```sh
tar -xzf shorties_host-linux-x64.tar.gz
cd shorties_host-linux-x64

python3 install_host.py --bundle .
```

安装器会：
- 把整个 bundle 拷贝到 `~/.local/share/ShortiesDownloader/host/`
- 在 `~/.config/<浏览器>/NativeMessagingHosts/` 写注册文件

### 第 3 步：在浏览器里加载扩展

**方案 A — 已发布版本（推荐）**：从 Chrome Web Store / Edge Add-ons 装（待上架）。

**方案 B — 开发者模式加载未打包扩展**：
1. clone 本仓库或下载源码 zip
2. 打开 `edge://extensions/` 或 `chrome://extensions/`
3. 右上角打开"开发人员模式"
4. 点"加载解压缩的扩展"，选仓库根目录
5. 由于 manifest 里有 `key` 字段，加载后扩展 ID 必定是 `djnbhglpkggbgibmdnngpklojeepikil`，跟 host 的 `allowed_origins` 一致

### 第 4 步：测试

1. 打开任意 Pornhub Shorties 页面（`https://*.pornhub.com/shorties/*`）
2. 右下角应该出现橙色悬浮按钮
3. 点击 → 点"一键本地下载 (yt-dlp)"
4. 视频会下载到系统 Downloads 文件夹
5. 也可以点工具栏上的扩展图标，在 popup 里看下载队列、取消任务

### 卸载

```sh
python3 install_host.py --uninstall
```

会移除所有浏览器的注册条目和安装的 host 文件。**浏览器扩展本身需要在
`edge://extensions/` 里手动移除**。

---

## 故障排查

### macOS：弹"Python3.framework / Python.framework 已损坏"

**原因**：bundle 目录被打了 `com.apple.quarantine` xattr（从浏览器、
AirDrop、解压器 → 都可能附加这个标记），macOS Gatekeeper 检查到内嵌 framework
没有 Apple 信任的签名就拒绝加载。

**修法**：

```sh
xattr -cr ~/Library/Application\ Support/ShortiesDownloader/host
```

然后**完全退出并重启浏览器**（不只是关窗口；用 ⌘Q 退出 Edge/Chrome 整体进程），
再触发一次下载。

如果你是从源码自己 build 的，`build_host.py` 已经会自动 ad-hoc 签名并加上
Hardened Runtime entitlements，从 GitHub Releases 下载的也已经签过。
quarantine 是文件系统层的额外标记，跟签名无关，需要单独清。

### Windows：弹 SmartScreen / 提示"无法启动应用"

**原因**：没有付费 Authenticode 代码签名证书的可执行文件，Windows 首次运行会拦。

**修法**：点"更多信息" → "仍要运行"。只在第一次启动时拦一次，之后不再提示。

### "宿主连接断开 / Specified native messaging host not found"

**原因**：浏览器找不到 host 注册文件，或者 `allowed_origins` 跟当前扩展 ID 不匹配。

**排查**：
1. 确认 host 注册成功 — 跑 `install_host.py` 时输出应该有 `[ok]` 对应你用的浏览器
2. 确认扩展 ID 是 `djnbhglpkggbgibmdnngpklojeepikil` — 在 `edge://extensions/` 看
3. macOS / Linux：`cat ~/Library/Application\ Support/<browser>/NativeMessagingHosts/com.shorties.downloader.json`（macOS）或对应 `~/.config/` 路径（Linux），检查 `path` 指向的文件存在且可执行
4. Windows：在注册表编辑器看 `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.shorties.downloader`（或 Edge 对应键）

### 下载卡在 "正在启动…" 或 "下载中 0%"

**原因**：通常是 host 在等代理 / 提取元数据，或者视频源真的下不下来。

**排查**：

1. 看 host 日志：
   - macOS：`~/Library/Application Support/ShortiesDownloader/native_debug.log`
   - Linux：`~/.local/share/ShortiesDownloader/native_debug.log`
   - Windows：`%LOCALAPPDATA%\ShortiesDownloader\native_debug.log`
2. 用相同 URL 在命令行直接跑 `yt-dlp "<embed_url>"` 对照，如果 CLI 也下不下来就是上游
   视频问题
3. 在 popup 「网络代理与高级设置」里填写你的代理（`http://127.0.0.1:7890` 之类），
   host 会优先用 popup 填的；popup 留空时 host 自动尝试用 macOS / Windows 系统代理

### 下载报 "yt-dlp 退出码: 1" 或 "fragment not found"

通常是 yt-dlp 版本过旧（上游 extractor 失效）。从 GitHub Releases 下最新版本，
或自己 build 时确保用的是 Python 3.10+（Python 3.9 上 pip 装到的 yt-dlp 会卡
在已弃用的老版本）。

---

## 开发者：自己构建 host

> ⚠️ **必须用 Python 3.10 以上**。macOS 系统自带的 `/usr/bin/python3` 是
> 3.9，pip 装到的 yt-dlp 会卡在老版本，Pornhub extractor 不工作。**推荐 Python 3.13**。

### macOS

```sh
# 1. 装 Python 3.13（Homebrew）+ expat
brew install python@3.13 expat

# 2. 在仓库下做 venv
python3.13 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install pyinstaller yt-dlp

# 3. build（自动下 ffmpeg、ad-hoc 签名、打 tar.gz）
python build_host.py
# → dist/shorties_host-macos-arm64/
#   dist/shorties_host-macos-arm64.tar.gz

# 4. 安装到本机浏览器
python install_host.py
```

### Windows

```powershell
# 1. 装 Python（如果没装）
winget install Python.Python.3.13

# 2. venv
py -3.13 -m venv .venv
.venv\Scripts\activate
pip install --upgrade pip
pip install pyinstaller yt-dlp

# 3. build（自动下 ffmpeg、打 zip）
python build_host.py
# → dist\shorties_host-windows-x64\
#   dist\shorties_host-windows-x64.zip

# 4. 安装到本机浏览器
python install_host.py
```

### Linux

```sh
# 1. 装 Python 3.10+（多数发行版自带 3.10+）
sudo apt install python3 python3-venv python3-pip   # Debian/Ubuntu
# 或 sudo dnf install python3 python3-venv          # Fedora

# 2. venv
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install pyinstaller yt-dlp

# 3. build（自动下 ffmpeg static build）
python build_host.py

# 4. 安装到本机浏览器
python install_host.py
```

`build_host.py` 必须**在每个目标 OS 上分别运行** — PyInstaller 不能交叉
编译。要做正式发布最好用 GitHub Actions matrix（Windows / macOS-13 Intel /
macOS-14 arm64 / Ubuntu）。

### bundle 里包了什么

- PyInstaller 静态打包的 Python 3.13 运行时（macOS 上是 `Python3.framework`）
- `yt-dlp` 作为 **Python 库**集成（不是单独 binary —— 见下方架构注解）
- `ffmpeg` 静态构建二进制（Windows 来自 BtbN，Linux 来自 johnvansickle，
  macOS 来自 osxexperts）

`native_host.py` 找 ffmpeg 的顺序：先 `sys._MEIPASS`、再 `_internal/`、再 PATH —— 这样开发模式（直接跑 .py）也能 work。

---

## 仓库目录

```
.
├── manifest.json              # 扩展 manifest（含固定 key）
├── background.js              # service worker：任务队列 + native bridge
├── content.js, content.css    # 页面内悬浮面板 + 队列 UI
├── popup.html / popup.js / popup.css  # 工具栏 popup + 队列 UI
├── icons/                     # 扩展图标
├── native_host.py             # native messaging host 源码
├── shorties_host.spec         # PyInstaller 配方
├── build_host.py              # 下载 ffmpeg → 跑 PyInstaller → 签名 → 打压缩包
├── install_host.py            # 跨平台安装器 / 卸载器
├── macos_entitlements.plist   # macOS Hardened Runtime entitlements
├── vendor/<platform>/         # 缓存的 ffmpeg（gitignored）
├── dist/                      # PyInstaller 输出（gitignored）
└── ~/.config/shorties-downloader/extension.key.pem  # 私钥（用户家目录、gitignored）
```

### 签名密钥

扩展的 RSA-2048 私钥放在仓库**外面**：
`~/.config/shorties-downloader/extension.key.pem`（避免浏览器加载未打包时
警告"私钥在扩展目录里"）。

公钥（base64-encoded SPKI DER）烧在 `manifest.json` 的 `key` 字段里，
把扩展 ID 固定为 `djnbhglpkggbgibmdnngpklojeepikil`。

**`.pem` 是机密** — 拿到它就能伪造身份发布更新。将来要上架商店时用同一对
key 打包，ID 保持不变：

```sh
# Chrome.exe 打包成 .crx（Windows）
chrome.exe --pack-extension=./ --pack-extension-key=~/.config/shorties-downloader/extension.key.pem
```

---

## 架构注解

- **任务队列**在 `background.js` 里：按完整 URL 去重，最大并发 3 个
  yt-dlp host，状态写入 `chrome.storage.session`，popup 关掉再开能看到当前队列
- 每个 task 有 60s **看门狗**：host 60s 内不发任何 progress/success/error 就
  强制标记失败，UI 永远不会卡死
- popup 和页面内悬浮窗**共享同一份队列**，靠 `queue-update` 广播驱动。fan-out
  同时用 `chrome.runtime.sendMessage`（给扩展页面）+ `chrome.tabs.sendMessage`（给 content script）
- Native host 每次下载完就退出 — 下次下载 `connectNative` 时浏览器会拉起新
  的 host 进程，避免僵尸进程堆积
- macOS bundle：onedir 布局 + ad-hoc codesign + Hardened Runtime entitlements
  (`disable-library-validation`、`allow-unsigned-executable-memory`、
  `allow-dyld-environment-variables`)。原因：Edge sandbox spawn 子进程时
  macOS 会严格校验子进程加载的 framework，没有这些 entitlements 就报
  "Python3.framework 已损坏"
