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

## 快速开始

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

## 零依赖轻量方案（不需要 Electron）

如果你不想下载 Electron，也可以双击 `scripts\启动-零依赖版.cmd`：
用 Edge 的“应用模式”窗口打开 GUI（同样无地址栏、类似桌面应用），
关闭窗口时自动停止自己启动的服务。

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
