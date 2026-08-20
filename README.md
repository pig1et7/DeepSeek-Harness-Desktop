# DeepSeek Harness Desktop

把 DeepSeek Harness 的 Web GUI 变成 **Windows 桌面应用**：双击图标即用，无需在终端输入任何命令。

> 当前版本 **1.0.3** · 更新日志见 [CHANGELOG.md](CHANGELOG.md)

---

## 🚀 快速开始

1. 下载 **DeepSeek-Harness-Desktop-1.0.3-portable.exe**（[GitHub Releases](https://github.com/pig1et7/DeepSeek-Harness-Desktop/releases)，约 71MB，免安装）
2. 安装 [Node.js LTS](https://nodejs.org)（应用启动 dsh 服务需要）
3. **双击 exe** → 自动启动服务并打开界面，开始使用 ✅

> 首次运行会自动联网下载 dsh（约 1-3 分钟），之后秒开。
> 想要桌面快捷方式？运行 `scripts\创建桌面快捷方式.cmd`。

## ✨ 功能一览

- 🖱️ **双击即用**：自动查找/启动 `dsh web`，无需手动开终端和浏览器
- 🔄 **智能端口**：已有 DSH 实例则复用，否则自动找空闲端口启动
- 🧹 **干净退出**：关闭窗口即退出并停止自己启动的服务（不会误杀复用的）
- 📎 **文件上传**：内置上传插件，图片 / Word / PDF / 文本都能传，Agent 自动读取
- 📄 **出错可查**：启动失败显示错误页 + 日志 + 一键重试

## 📎 文件上传（内置插件）

输入框左侧的 **📎** 按钮可上传文件：

- 上传后输入框自动出现 `[上传附件: 名称 (id: sha256:...)]`
- 发送消息，Agent 会自动找到并读取文件（**docx / pdf 自动提取文本**）
- 文件以 sha256 储存于 `$DSH_HOME\uploads\`，同名自动去重，单文件上限 64MB

安装到其他主机的 dsh（已有 DSH 服务时）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-upload-plugin.ps1
```

## 🛠️ 在新主机上完整部署（桌面应用 + 插件，一键）

```powershell
git clone https://github.com/pig1et7/DeepSeek-Harness-Desktop
cd DeepSeek-Harness-Desktop

# 已有 portable exe（拷贝过来）：
powershell -ExecutionPolicy Bypass -File scripts\setup-desktop.ps1 -ExePath D:\下载\DeepSeek-Harness-Desktop-1.0.3-portable.exe
# 或从源码自动构建（需联网下载 Electron）：
powershell -ExecutionPolicy Bypass -File scripts\setup-desktop.ps1 -Build
```

脚本自动完成：检查/安装 Node.js → 安装 exe → 初始化 DSH → 装上传插件 → 创建桌面快捷方式。完成后双击桌面图标即可。

## 🔧 开发者：构建打包

```powershell
git clone https://github.com/pig1et7/DeepSeek-Harness-Desktop
cd DeepSeek-Harness-Desktop
npm install
npm run dist        # 生成 dist\*-portable.exe
```

> 非管理员账户打包若报 `Cannot create symbolic link`，先运行
> `scripts\install-7za-wrapper.ps1` 再打包。

## ❓ 常见问题

| 问题 | 解答 |
| --- | --- |
| 为什么需要 Node.js？ | 桌面应用负责「启动 dsh 服务」，服务由 node 运行 |
| 首次运行很慢？ | 正在联网下载 dsh，耐心等待即可 |
| 端口被占用？ | 自动换空闲端口（轮询 3080 起） |
| 上传的 .docx/.pdf 读不出文字？ | 扫描件/纯图片型 PDF 无法提取，可改用文本文件 |
| 配置在哪？ | `%APPDATA%\DeepSeek Harness Desktop\config.json`（如指定端口） |

---

**相关文档**：[插件说明](plugins/dsh-upload/README.md) · [更新日志](CHANGELOG.md)