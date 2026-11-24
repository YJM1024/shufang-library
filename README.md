# 书房 · 本地图书阅读器

一个本地运行的三栏图书网站：左栏选书、中栏目录、右栏整本连续滚动。仓库只包含网站实现与构建工具，不含任何图书正文、封面、PDF 或阅读状态。

## 功能

- 三栏连续阅读，不做分页；左栏与目录栏可用鼠标拖动调宽，单栏上限为视口宽度的 25%。
- 目录层级由书稿数据决定：有题目的书显示模块与题目两级，普通书只显示章；二级条目可单章收起，收起状态跨刷新保存。
- 已读按目录条目记录覆盖区间：条目在可视区连续停留满 1 秒才累计，覆盖率达到 100% 才自动标已读；跳转和深链扫过的内容不计入。
- 一级和二级条目都能手动标已读或未读，一级标记连带其下所有二级条目；手动未读优先于自动判定。
- 阅读状态由本地服务端保存到 `state/library.json`，服务端不可用时退回浏览器 localStorage。
- 代码块在构建期高亮，支持 ts/js、python、csharp、go、bash、json、xml；封面可放大查看；带 PDF 的书提供下载入口。
- 字号、纸色/夜间、两栏宽度保存在浏览器本地设置。

## 运行

需要 Node.js 18 或更高版本。

```powershell
node tools/build.mjs
node serve.mjs
```

打开 <http://127.0.0.1:6187>。构建读取 `books/manifest.json`，所以运行前需要按下面的约定准备书稿；仓库本身不附带书。

## 书稿约定

`books/manifest.json` 是数组，每项至少包含 `id`、`title`、`category`，可选 `kind`、`pdf`、`accent` 等字段。每本书放在 `books/<id>/`：

- `body.md`：正文，`## ` 开头是章，`### ` 开头是题或小节，题号形如 `Q01`。
- `publish/front.md`：内容提要、序言、题库地图、封底等前置与后置内容。
- `publish/cover/`：封面图；`publish/figs/`：插图。构建时复制到 `site/assets/`。

构建只读 `books/`，产物写到 `site/`，不要手改 `site/`。

## 目录结构

- `src/`：阅读器页面、样式与前端逻辑。
- `tools/`：构建、高亮、导入与无头浏览器测试脚本。
- `serve.mjs`：静态站点与阅读状态 API，端口 6187。
- `books/`：书稿源，仓库中为空，需要自行放入。
- `site/`：构建产物，仓库中不包含。

## 测试

测试脚本通过 Chrome DevTools Protocol 驱动无头浏览器，需要先启动 `serve.mjs`，并在本地准备好对应的书稿数据：

- `node tools/test-highlight.mjs`：代码高亮标记配平与原文还原。
- `node tools/test-codeblock.mjs`：代码块结构、复制结果与窄屏布局。
- `node tools/test-lightbox.mjs`：封面浮窗的缩放、拖动与关闭。
- `node tools/test-interactions.mjs`：目录、书签、切书、字号、夜间模式与 430px 布局。
- `node tools/test-readstate.mjs`：两级目录、1 秒停留、100% 覆盖、手动标记与收起持久化。
- `node tools/test-resizers.mjs`：分栏拖动、25% 上限与窄屏隐藏。

## 说明

本仓库不包含任何图书内容，也不包含 `state/`、`.shots/`、浏览器测试配置或运行日志。图书与 PDF 由使用者自行提供，书籍内容的版权与保密责任不在本仓库范围内。
