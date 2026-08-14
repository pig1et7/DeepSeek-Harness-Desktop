# DeepSeek Harness Desktop

把 DeepSeek Harness 的 Web GUI（`dsh web`）打包成 Windows 桌面应用：
**双击即用**，无需在终端输入 `npx @deepseek-ai/dsh web`。

## 特性

- 🚀 双击启动：自动查找/启动 `dsh web` 服务，并在原生窗口打开界面
- 🔄 智能端口处理：
  - 若 `127.0.0.1:3080` 已有 DSH 实例在运行 → 直接复用，不重复启动
  - 否则在 3080 起依次找空闲端口自行启动服务
- 🧹 生命周期自管理：关闭窗口即退出应用并停止**自己启动**的服务（复用别人的服务时不会误杀）
- 📄 服务日志写入 `%APPDATA%\DeepSeek Harness Desktop\logs\server.log`
- 🔍 启动失败时给出错误页 + 日志 + 重试按钮
- 📦 可打包为免安装的单文件 portable exe

## 工作原理

DeepSeek Harness（DSH）本身是命令行工具：`dsh web` 会在本机启动一个 Web
服务器（默认 `http://127.0.0.1:3080`），托管整个 GUI（前端页面 + 后端 API +
Agent 会话）。平时你需要手动执行命令、再开浏览器访问。本应用是一个
**Electron 壳**，把整个过程自动化：

1. **查找 dsh CLI**：按优先级查找（见下文「dsh 的查找顺序」），找不到时自动
   回退 `npx --yes @deepseek-ai/dsh` 下载；
2. **端口探测**：从 3080 起逐个检查，若已有 DSH 实例在运行则**复用**，否则在
   空闲端口**自行启动**服务（`node <bin.js> web --port <n>`）；
3. **等待就绪**：轮询页面，直到出现 DSH 的启动标记（`__DSH_BOOT__`）；
4. **打开原生窗口**：先显示加载页，就绪后加载真实 GUI；
5. **退出清理**：关闭窗口即退出应用，并只停掉「自己启动」的服务，复用的服务
   不会误杀。

exe 本身**不包含 dsh 本体**，只负责「查找 + 启动 + 装壳」。dsh 升级无需重新
打包；但新主机**首次运行需要联网**（通过 npx 自动获取 dsh 包）。

## 快速开始（本机开发）

```powershell
cd dsh-desktop
npm install          # 安装 electron + electron-builder（含 Electron 二进制下载）
npm start            # 开发模式直接运行
```

## 打包成桌面应用

```powershell
npm run dist         # 生成 dist\DeepSeek-Harness-Desktop-1.0.0-portable.exe
```

然后运行 `scripts\创建桌面快捷方式.cmd`，桌面上就会出现
“DeepSeek Harness Desktop” 快捷方式，以后双击即可使用。
（也可以直接把 portable exe 复制到任何位置双击运行。）

## 在另一台主机上使用

### 前置条件

| 条件 | 说明 |
| --- | --- |
| Windows x64 | 预编译的 portable exe 仅支持 Windows x64 |
| Node.js 18+ | 启动 dsh 服务需要 node（到 nodejs.org 安装 LTS 版） |
| 网络 | 首次运行需要联网，通过 npx 获取 dsh 包 |
| Edge 浏览器（仅方式 C） | Windows 10/11 自带 |

> **macOS / Linux** 不能用现成 exe，请按「方式 B」在对应系统上重新构建。

### 方式 A：直接拷贝 exe（最简单）

1. 把 `dist\DeepSeek-Harness-Desktop-1.0.0-portable.exe`（约 70MB）拷到新主机；
2. 新主机上先安装 Node.js（nodejs.org 下载 LTS 版，一路下一步即可）；
3. 双击 exe：首次运行会自动 `npx --yes @deepseek-ai/dsh` 下载并启动服务，
   稍候即弹出窗口，即可使用。

提示：
- 首次 npx 下载 dsh 需要等待一会儿；之后 dsh 会缓存在 npx 缓存里，启动变快；
- 若新主机访问 npm 缓慢，先执行 `npm config set registry https://registry.npmmirror.com`；
- 想要桌面快捷方式：运行 `scripts\创建桌面快捷方式.cmd`。

### 方式 B：从 GitHub 克隆源码构建（推荐）

```powershell
git clone https://github.com/pig1et7/DeepSeek-Harness-Desktop
cd DeepSeek-Harness-Desktop

npm install      # 安装 electron + electron-builder（含 Electron 二进制下载，较慢）
npm start        # 开发模式直接运行
npm run dist     # 打包：生成 dist\DeepSeek-Harness-Desktop-1.0.0-portable.exe
```

注意事项：
- **非管理员账户**打包时若报 `Cannot create symbolic link`（winCodeSign
  解压失败），先运行一次再打包：
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\install-7za-wrapper.ps1
  ```
  详见下文「重新打包的注意事项」；
- 想跟随 dsh 新版本：**无需改动项目**。应用运行时会自动使用 npx 缓存中的
  最新 dsh；也可以在该目录执行 `npm i @deepseek-ai/dsh`，应用会优先使用它。

### 方式 C：零依赖轻量版（不装 Electron）

只需拷贝 `scripts\启动-零依赖版.cmd` 和 `scripts\launch-edge-appmode.ps1`
两个文件：

- 双击 .cmd → 后台启动 `dsh web` + 用 Edge「应用模式」窗口打开 GUI
  （无地址栏，类似桌面应用）；
- 关闭窗口时自动停止自己启动的服务；
- 同样需要 Node.js 和 Edge（Win10/11 自带），不需要 Electron。

## 配置（可选）

在 exe（或项目）同目录放一个 `config.json`（参照 `config.example.json`）：

```json
{
  "port": 3080,
  "workspaceDir": "D:\\my-projects",
  "dshBin": "",
  "nodeBin": ""
}
```

| 键 | 说明 |
| --- | --- |
| `port` | 起始端口，默认 3080；被占用时自动向后找空闲端口 |
| `workspaceDir` | dsh 服务的工作目录，默认 exe 所在目录 |
| `dshBin` | 手动指定 `@deepseek-ai/dsh/lib/bin.js` 的绝对路径（通常无需设置） |
| `nodeBin` | 手动指定 node 可执行文件路径（通常无需设置） |
| `npmCache` | 手动指定 npm 缓存目录（用于搜索 npx 缓存中的 dsh） |

## dsh 的查找顺序

1. `config.json` 中的 `dshBin`
2. 应用目录内的 `node_modules\@deepseek-ai\dsh`（若在应用目录里 `npm i @deepseek-ai/dsh`）
3. npm/npx 缓存中的 `_npx\*\node_modules\@deepseek-ai\dsh`（本机已存在）
4. PATH 上的 `dsh`
5. 兜底：`npx --yes @deepseek-ai/dsh web --port <n>`

## 开发/验证

```powershell
npm run smoke                        # 复用 3080 已有实例并截图（smoke.png）
npx electron . --smoke-test --smoke-port=3188 --smoke-out=smoke-spawn.png
                                     # 自行启动服务（3188 端口）并截图
```

## 重新打包的注意事项（本机）

`node_modules\7zip-bin\win\x64\7za.exe` 已被替换为一个透明包装器
（源码在 `scripts\7za-wrapper.cs`），用于解决**非管理员账户**下
electron-builder 解压 winCodeSign 时“无法创建符号链接”的报错。

- 如果重新执行过 `npm install`（node_modules 被重装），先运行一次：
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\install-7za-wrapper.ps1
  ```
  然后再 `npm run dist`。
- 如果你有管理员权限或已开启“开发者模式”，可以不用包装器，直接删掉
  `node_modules\7zip-bin\win\x64\7za-real.exe` 并把 `7za.exe` 改回来即可。

## 常见问题

- **端口被非 DSH 程序占用**：应用会自动向后找空闲端口，无需手动处理。
- **想手动换端口**：改 `config.json` 的 `port`。
- **日志在哪**：`%APPDATA%\DeepSeek Harness Desktop\logs\server.log`。
- **换主机后会话/数据在哪**：DSH 的配置与会话数据存放在用户目录
  （`$DSH_HOME`），换主机是一套全新的，与本项目无关。
- **首次运行很慢或像卡住**：正在通过 npx 下载 dsh 包；网络慢时可先配置 npm
  镜像（见「方式 A」提示）。
- **关闭窗口后服务还在吗**：应用关闭时会停掉自己启动的服务；如果复用了别的
  DSH 实例（例如你手动 `dsh web` 启动的），那个实例不受影响。
