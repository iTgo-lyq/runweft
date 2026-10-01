# npm 首次公开发布执行记录

## Plan 评审

iclaude 在当前工作区完成一次只读评审，会话 `991da989-689b-478a-b679-baf7d0560cbe`，is_error=false；结果保存在 `.dev-smoke/reviews/npm-publication/review.json`。主 agent 采纳包内说明矛盾、显式 registry/专用配置、发布额外认证、部分发布保留与公共元数据检查。

未采纳“原样发布过时 README、下版更正”：首次发布前补正确说明，在干净源码重建并重跑包/安装检查；以四平台程序与 Skill hash 完全相同为复用已有模型验收的条件。Linux x64 为实际最大包（207306747 字节），与既定发布顺序一致，不调整顺序。仅本次专用 npm 登录凭据在完成后清理，不修改其他 npm 认证。

## T1 核对发行输入并补齐 npm 安装说明

- 结果：五个包名的公共 registry 查询均为 404；既有候选五个 tarball 与索引 SHA-512、SHA256SUMS、包内 manifest 和 Skill 一致；补公共 npm 安装命令。
- 验证：五个实际 tarball 的 npm publish --dry-run --ignore-scripts --json 均通过且 integrity 与索引相同，证据 `.dev-smoke/npm-publication/original-preflight.json`。临时检查脚本适配本机 npm 11 的按包名 JSON 输出后通过；未将预演当作真实发布。
- 验证：既有 GitHub CI 重跑通过，包括 build、macOS arm64/x64、Linux arm64 安装；run 36848637434，仍不等于四平台完整模型验收。
- 未解决：本机 npm 认证尚未完成；真实上传、包体积接受情况和公共安装仍未验证。
- Commit：`npm-publication T1: prepare public npm installation instructions and release procedure`。
