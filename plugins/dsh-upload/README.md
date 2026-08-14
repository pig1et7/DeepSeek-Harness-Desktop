# dsh-upload

为 DeepSeek Harness Web GUI 增加**文件上传**能力：在输入框左侧出现 📎 按钮，
可上传图片、Word（.docx）、PDF、文本等文件；上传后 Agent 可通过工具读取
文件内容。

## 功能

- **上传 UI**：composer 输入框工具行新增 📎 上传按钮（支持多选、拖拽），
  上传成功后自动在输入框插入引用标记：`[上传附件: 名称 (id: sha256:...)]`
- **存储**：文件以内容寻址（sha256）方式保存在 `$DSH_HOME/uploads/` 下，
  同名文件自动去重
- **Agent 工具**：
  - `uploaded_files` —— 列出所有已上传文件（id / 名称 / 大小 / 类型 / 时间）
  - `read_uploaded_file` —— 按 id 或名称读取文件内容：
    - 文本类（txt/md/json/csv/代码等）→ 返回文本（截断到 60KB）
    - `.docx` → 提取正文文本
    - `.pdf` → 用 pdfjs 提取文本
    - 图片（png/jpg/gif/webp）→ 返回尺寸与类型等元信息
    - 其他二进制 → 返回提示，建议用 bash 处理
- **上传 API**：`POST /upload`（JSON + base64）与 `GET /upload`（列表），
  由 host 端 webServer 提供

## 安装

### Web profile（推荐，含上传按钮 UI + 工具）

```powershell
# 1. 进入你的 web profile 目录
cd $env:DSH_HOME\profiles\web        # 默认 C:\Users\<你>\.dsh\profiles\web

# 2. 安装插件（路径换成你 clone 下来的插件目录）
pnpm add D:\path\to\dsh-upload

# 3. 在 cordis.patch.yml（用户层）追加：
#    - insert:
#        - id: upload
#          name: 'dsh-upload'
```

然后**重启 `dsh web`** 生效。

### Headless / 其他 profile（仅 Agent 工具，无 UI）

同样的 `pnpm add` + patch 步骤（headless 没有 webServer，路由会自动跳过，
工具照常可用）。

## 使用

1. 双击输入框左侧的 📎 按钮（或把文件拖到按钮上），选择文件；
2. 上传完成后，输入框会自动插入 `[上传附件: 名称 (id: sha256:...)]`；
3. 直接发送消息，Agent 会（按系统提示引导）调用 `uploaded_files` 和
   `read_uploaded_file` 读取文件后回答。

## 配置

目前无额外配置项。上传大小上限 64 MiB / 个；文件存在 `$DSH_HOME/uploads/`
（`$DSH_HOME` 默认 `~/.dsh`）。

## 限制

- 仅 Windows/macOS/Linux 上的 **web 与 headless** profile 生效（tui 未测试）；
- 扫描件 / 纯图片型 PDF 提取不出文本（返回提示）；
- 图片本身不直接进入模型视觉通道（DeepSeek 文本模型），返回元信息；
  若模型支持视觉，可基于 `path` 扩展。

## 开发

```powershell
# 插件依赖（fflate 解 docx、pdfjs-dist 解 pdf）
cd plugins\dsh-upload && npm install
# host 端: lib/index.js   client 端: lib/client.js（手写 module-loader 格式）
```

host 端核心：`ctx.webServer.register()` 注册 `/upload` 路由；
`ctx.tools.register(defineTool({ execute }))` 注册工具。
client 端核心：`ctx.slots.inject("conversation.input.left", ...)` 挂载按钮。
