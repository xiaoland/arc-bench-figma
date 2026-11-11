# Minimal Figma Design · ARC-Bench task

这是一个复现 Figma Design 核心工作流的 ARC-Bench 任务。当前发布版本为 **3.0.2**，包含 183 个需求节点、140 个末端需求和 236 个公开验收场景。

从 [GitHub Release v3.0.2](https://github.com/xiaoland/arc-bench-figma/releases/tag/v3.0.2) 下载 `figma-arc-bench-3.0.2.zip`。解压后得到 `figma/`；将其中的 `requirements/` 作为生成者输入。技术说明与随包资产提供实现指导。启动候选应用后，从完整任务目录运行独立评测。

本仓库中的同一任务位于 `arc-bench/figma/`。详见[任务使用说明](arc-bench/figma/README.md)和[内容清单](arc-bench/figma/manifest.json)。

```text
arc-bench/figma/
├── requirements/       生成输入、参考图、资源与实现指导
├── tests/              独立评测
├── manifest.json       输入和评测的内容身份
├── package.json
├── package-lock.json
├── playwright.config.ts
└── README.md
```

Release 同时提供 `source.tar.gz`、`release.json` 和 `SHA256SUMS.txt`，用于重建和核对交付内容。源码归档以 `source/` 为根，其中包含需求阅读页 `site/index.html`。评测通过应用的实际行为判断结果，不以使用某个图标文件或技术栈作为验收条件。

3.0.2 修订产品概念、规则归属、样例与通则的边界、跨功能引用和实现指导，保留全部 236 个公开场景的身份与产品步骤。包、源码重建及场景发现检查通过；具体应用的产品结果由实际评测给出。

发布维护见[发布流程](RELEASING.md)。
