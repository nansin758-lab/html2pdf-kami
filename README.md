# html2pdf-kami

将 HTML 文件高保真转换为 PDF 的命令行工具。

## 特性

- 🎨 **完美还原** — 使用截图方式生成 PDF，100% 保留 CSS 渐变、阴影、emoji 等效果
- 📐 **智能检测** — 自动识别 slide 布局（1280×720）或全页面 HTML
- 🖱️ **拖拽支持** — Windows 下可直接拖拽 HTML 文件到 EXE 上
- ⚡ **开箱即用** — 内置 Chromium，无需额外安装

## 使用方法

```bash
# 基本用法（PDF 输出到同一目录）
html2pdf-kami.exe 你的文件.html

# 指定输出路径
html2pdf-kami.exe input.html output.pdf
```

也可以直接将 `.html` 文件拖拽到 `html2pdf-kami.exe` 上，PDF 会自动生成在 HTML 文件所在目录。

## 开发

```bash
npm install
node index.js test.html
```

## 构建 Windows EXE

通过 GitHub Actions 自动构建，推送代码到 `main` 分支即可触发。

构建产物为 `html2pdf-kami.zip`，包含：
- `html2pdf-kami.exe` — 主程序
- `chrome-win/` — 内置 Chromium 浏览器

## License

MIT
