# 产品官网执行记录

## Plan 评审

当前工作区 iclaude 唯一一次只读评审已完成，session `f174ee03-f10b-4690-9180-7bbe59d4e506`，2026-09-30 15:10–15:12（Asia/Shanghai），exit 0、success。原件 `.dev-smoke/reviews/product-website/review.md`。主 agent 复核后沿持续授权执行，不新增人工门禁。

- 采纳单包命令内嵌 hash，并同时核对发行的 SHA-512/SHA256SUMS，保留独立校验下载。
- 采纳 UTF-8 HTML 完整手册参考，明确与官网单包安装的区别；不修改已冻结包内 docs/usage.md。
- 采纳宿主与机器/runtime/Agent 职责区分、runtime ID 来源、首次 local 路径、PATH 持久化和后置 Hub 章节。
- 采纳浏览器真实下载校验、子路径部署、从 DOM 原样执行 Linux 安装命令与部署时保持 tgz 字节的要求。
- 采纳无 JS 下载表及逐平台实际验证状态；预览仅需 GET/HEAD，保持实现简单。校验说明聚焦操作，不额外堆叠与本次使用无关的安全提示。
