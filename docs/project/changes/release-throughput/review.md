# 独立整体评审

评审者为隔离上下文 subagent `/root/release_review`，只读检查相对 main 的完整差异、Requirement、验收对应和实际证据；未发布、部署或调用模型。

- P1：verifyPublicRelease 把 `{ signal }` 传给晋级默认 metadata(entry, version)，真实 URL 成为 `[object Object]`。评审者以内存 fetch 拦截复现，五包无法晋级。追加 T4 修正默认路径并直接验证实际 URL。
- P2：摘要仅读取当前官网 run，官网 A 失败后重跑 B 会遗漏 A。T3 已从发布全部 attempt 的 RELEASE_WEBSITE 回执收集 run，夹具核对 A/B 的日志、结果和总时长。
- 测试建议：补充正式 CLI 在唯一 URL 通过而生产域名内容不符时失败。T3 已加入失败和成功对照，失败仍保留上传回执。
- 主 Agent 补充：错误响应体取消若抛出网络错误，会遮蔽不可重试的 HTTP 状态。归入 T4，需保留原状态并覆盖鉴权错误。

新 dispatch、完整四平台 CI 及新流水线耗时尚未远端实测；不以历史证据或夹具替代。
