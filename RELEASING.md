# 发布流程

发布指在本公开仓库创建可下载的 GitHub Release。维护源先完成版本更新、产品与评测迁移记录、需求投影和 HTML 阅读页构建，以及受影响检查。

1. 从维护源构建独立 ARC-Bench task，将输出复制到 `arc-bench/figma/`。核对版本、节点与场景、manifest 文件哈希，以及生成输入和独立评测的分离。更新本仓库 README 和本发布流程，写明本版变化及实际验证范围。
2. 将任务打包为 `figma-arc-bench-<版本>.zip`，解压后的顶层目录为 `figma/`。归档可重建同一任务的维护源为 `source.tar.gz`。解包后逐文件核对，再从源码重建并比较任务 manifest。
3. 检查公开内容，提交任务和说明，推送主分支及 `v<版本>` 标签。保留旧版本。
4. 写 `release.json`，记录版本、基线、任务和 generation/evaluation 身份、归档哈希、源码文件清单、实际验证范围及目标 GitHub 提交。用 `SHA256SUMS.txt` 列出 ZIP、源码归档和清单的 SHA-256。
5. 从已推送的标签创建 GitHub Release 草稿，上传上述四个附件。正文说明变化、生成输入、评测入口和验证范围。核对附件后公开发布。技术指导继续作为可选参考；评测依据产品行为，不以指定 SVG 文件、库或技术栈作为通过条件。
6. 从已发布的 GitHub Release 下载附件，核对 SHA-256、解包内容与版本。交付公开 Release URL，并保存目标提交和下载核验结果。

任务使用和评测入口见 [arc-bench/figma/README.md](arc-bench/figma/README.md)。源码归档的完整维护流程见其中的 `source/docs/releases.md`。

## 当前版本 3.0.3

本版包含 185 个节点、142 个末端需求和 247 个公开场景，承接 3.0.2 全部 236 个场景身份。新增 Canvas 层级与编辑器输入规则，并补充字体预览换选退出和 FLOW-02 的输入及结果约束。生成者只接收 `arc-bench/figma/requirements/`；独立评测在 `arc-bench/figma/tests/`。

材料、构建、迁移、场景发现、阅读页和归档复建检查支持本次发布。候选应用尚未执行本版完整产品验收。版本清单与实际检查范围随 [v3.0.3 Release](https://github.com/xiaoland/arc-bench-figma/releases/tag/v3.0.3) 的附件提供。
