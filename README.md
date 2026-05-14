# 灵犀 AI 对话助手（仿 WPS 灵犀）

> 姓名：钟颖 
---

## 一、项目基本信息

- **项目名称**：灵犀 AI 对话助手（仿 WPS 灵犀风格）
- **技术栈**：HTML + CSS（Tailwind CDN + 自定义 CSS）+ 原生 JavaScript
- **大模型平台**：阿里云百炼 DashScope  
- **主要特性**：
  - 支持真实 AI 对话（文本 & 图文对话）
  - 支持深色 / 浅色主题切换，刷新后保持
  - 支持图片上传预览
  - 支持流式回复 + Markdown 渲染 + 代码高亮 + 一键复制

## 二、开发任务索引

- 1. 首页
  - 顶部导航+标题、副标题，标题使用渐变文字效果。
  - 下方有 4 张快捷建议卡片，横向排列，图标颜色各不相同。
  - 点击任意卡片，会自动将提示发送给 AI 开始对话，并隐藏欢迎区。

- 2. 对话功能
  - 接入阿里云百炼 DashScope 的 **OpenAI 兼容 chat/completions 接口**，使用类似 `qwen-plus` 的对话模型。
  - 用户消息靠右显示，AI 消息靠左显示。
  - 通过浏览器 `fetch + ReadableStream` 实现 **SSE 流式输出**，AI 回复逐块推送，并在界面中实时更新，呈现打字机式的逐字显示效果。
  - 进入对话后，首页欢迎区和快捷卡片会被隐藏。
  - 清除对话时可中断当前生成并回到首页。

- 3. Markdown 渲染
  - 使用 `markdown-it` 将 AI 返回的 Markdown 文本解析成 HTML。
  - 支持标题、列表、表格、引用、代码块等常见 Markdown 语法。

- 4. 代码块语法高亮 & 复制
  - 使用 `highlight.js` 对代码块进行语法高亮。
  - 在每个代码块右上角添加「复制」按钮，点击后将代码复制到剪贴板，并短暂显示「已复制」反馈。

- 5. 主题切换 
  - 支持浅色 / 深色主题切换，按钮在右上角。
  - 使用 Tailwind CSS 的 `dark` 模式，真实切换作用在 `html` 根节点上。
  - 当前主题会保存在 `localStorage` 中，刷新页面后仍能保持上次的选择。

- 6. 底部输入区
  - 输入区域固定在页面底部（使用 `fixed`），消息区域有额外底部内边距防止被遮挡。
  - 文本框支持自动增高，`Enter` 发送、`Shift + Enter` 换行。
  - **有内容时才显示发送按钮**：输入框为空时隐藏发送按钮，有文字时自动显示并可点击。
  - 支持图片上传预览，使用回形针图标触发。
  - AI 正在响应时显示「停止生成」按钮，可中断当前回答。
  - 提供「清除全部对话」按钮，清空历史消息并恢复到首页欢迎状态。

- 7. 图文对话
  - 支持上传图片并与文字一起发送给模型。
  - 仅发送图片时也可发起对话，默认提示模型「请描述或分析这张图片」。

## 三、核心技术实现说明

1. 阿里云百炼 API 接入
  - 使用 OpenAI 兼容接口 调用通义千问模型：文本对话：model: 
    "qwen-plus"；图文对话：model:  "qwen-vl-plus"（视觉理解）。
  
  - API Key 获取与存储：
    首次打开页面时，通过 prompt 让用户输入自己的百炼 API Key；使用 localStorage.setItem('LINGXI_API_KEY', key) 本地持久化；之后每次从 localStorage.getItem('LINGXI_API_KEY') 读取，不会写死在代码里。

2. 流式输出 & 打字机效果
  - 通过 fetch 获取响应的 ReadableStream，使用 response.body.getReader() 循环读取 chunk。
    服务端按 SSE 格式返回，每一行以 data: 开头：把 chunk 按行拆分，筛选出 data: 开头的内容；遇到 data: [DONE] 结束循环；对每个 JSON 块解析 choices[0].delta.content，将增量文本追加到一个字符串中；每追加一次就调用 updateStreamingOutput，用 markdown-it 重新渲染，这样用户会看到类似「打字机」的逐字效果。
    
3. Markdown 渲染 & 代码高亮 + 复制
  - 使用 markdown-it 把模型返回的 Markdown 文本转换为 HTML。
    在 highlight 回调中使用 highlight.js 对代码进行语法高亮。渲染完成后，遍历所有 pre code：在外层 pre 上添加一个绝对定位的「复制」按钮（copy-btn）。点击按钮，使用 navigator.clipboard.writeText 把代码复制到剪贴板，并短暂显示「已复制」反馈。自定义 CSS 中对滚动条、复制按钮悬浮显示等进行了样式优化。

4. 主题切换与持久化
  - 使用 Tailwind Play CDN，并设置：
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
    tailwind.config = {
    darkMode: 'class'
    };
    </script>
  - 通过 JS 操作 document.documentElement.classList：
    有 dark 类时启用深色主题；点击按钮时切换 dark 类，同时切换太阳 / 月亮图标。
    使用 localStorage.setItem('theme', 'dark' | 'light') 持久化主题，页面加载时恢复上一次选择。
5. 图片上传预览 & 图文对话
  - 通过 input type="file" accept="image/*" + 回形针 label 触发文件选择。
  - 选择文件后使用 FileReader.readAsDataURL 读取为 base64，并存入 pendingImageDataUrls：
    一方面在输入框下方展示缩略图预览；
    另一方面在发送时一并发送给大模型。
  - 发送时的处理逻辑：
    若存在 imageDataUrls：model 切换为 qwen-vl-plus；user.content 构造成一个数组：前几项是 { type: "image_url", image_url: { url: dataUrl } }（使用 dataURL）；最后一项是 { type: "text", text: 用户输入 or 默认提示 }。
  - 若只输入文字则仍按纯文本对话处理。

 

