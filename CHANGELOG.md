# 更新日志 (Changelog)

本项目版本历史。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.3] - 2026-08-14

### 新增

- **文件上传插件 `dsh-upload`**（`plugins/dsh-upload/`）：
  - Web GUI 输入框左侧新增 📎 上传按钮（支持多选与拖拽），上传后自动在输入框
    插入 `[上传附件: 名称 (id: sha256:...)]` 引用标记
  - 支持上传图片（png/jpg/gif/webp）、Word（.docx）、PDF、文本及任意文件，
    单个文件上限 64 MiB
  - Agent 工具 `uploaded_files`（列出）与 `read_uploaded_file`（读取）：
    - 文本类文件返回内容（截断 60KB）
    - `.docx` 自动提取正文（fflate 解压）
    - `.pdf` 自动提取文本（pdfjs-dist）
    - 图片返回尺寸/类型元信息
  - 文件以内容寻址（sha256）存储于 `$DSH_HOME/uploads/`，同名自动去重
  - 上传 API：`POST /upload`（JSON+base64）、`GET /upload`（列表）
  - **一键安装脚本** `scripts/install-upload-plugin.ps1`：在任意主机上自动
    完成「复制插件 → 安装依赖 → 接入 profile → 写入配置」，幂等可重复执行
- 桌面应用支持从 `%APPDATA%\DeepSeek Harness Desktop\config.json` 读取配置
  （portable 模式下比 exe 同目录更可靠）
- 配置解析容忍 UTF-8 BOM（防止 PowerShell 写入的 BOM 导致 JSON 解析失败）

### 修复

- 修复 host 端 `webServer` 依赖注入顺序问题（`ctx.get` 可能在服务激活前返回
  undefined 导致路由静默不注册，改为声明式 inject 依赖）
- 修复上传成功/失败提示**永久显示并遮挡输入框**的问题：提示改为 2.5 秒自动
  消失，并显示在按钮下方
- 修复 portable 模式下 `PORTABLE_EXECUTABLE_DIR` 未注入时配置读取失败的
  问题（回退到用户数据目录）

## [1.0.2] - 2026-08-14

### 变更

- 应用图标更新为 DeepSeek 卡通娘形象（第二版）

## [1.0.1] - 2026-08-14

### 变更

- 应用图标更新为 DeepSeek 卡通娘形象

## [1.0.0] - 2026-08-14

### 新增

- 初始版本：DeepSeek Harness 桌面套壳应用
  - 双击启动：自动查找/启动 `dsh web` 服务并在原生窗口打开界面
  - 智能端口处理（复用已有实例 / 自动找空闲端口）
  - 生命周期自管理（只停止自己启动的服务）
  - 服务日志、错误页 + 重试、portable 单文件打包
  - 零依赖轻量启动器（Edge 应用模式）
