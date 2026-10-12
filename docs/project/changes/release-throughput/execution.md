# 执行证据

## 准备与基线

独立 worktree：`/home/tiger/workspace/runweft-release-throughput`。分支 rebase main 后文件树与原 0e1fd6e 一致，归档保留；重排使用显式 force-with-lease 同步远端。Bun 1.4.2、固定 HAPI 8f774b9、root/HAPI frozen 依赖及 build:hapi 已就绪。实际提交触发 SpecTrail hook 通过；check-setup 的 ready 只表示准备条件。

实现前 typecheck、260 项根测试、26 项发布 Node 测试和 15 项官网测试通过。所有证据保存在 `.dev-smoke/release-throughput/`；未触发真实发布、模型或生产部署。

## T1 公共候选读取可在总预算内恢复

下载中五包元数据、主包/本平台 tarball 共享十分钟截止时间；请求及完整响应流均受剩余预算约束。传播/限流/服务端/网络故障按白名单恢复，鉴权、410、地址、manifest 和摘要错误直接失败；临时文件完整核验后替换，失败清理 partial。元数据/标签读最多五个并发，上传和晋级写入顺序保持既有门禁。日志记录读取次数及累计耗时。

验证：`node --test scripts/tests/npm-release.test.mjs scripts/tests/npm-publish.test.mjs` 28 项通过，包含真实 HTTP 夹具的 404、429/Retry-After、响应流中断及受限重试；拒绝 403/410/非法地址/摘要错误、超预算 Retry-After、跨读取总预算耗尽和真正不结束的响应流。最后一项暴露 Node pipeline 的 AggregateError 包装，已按底层网络/超时错误识别并复验。workflow 41 项 Change 及 diff 检查通过。没有重新运行真实 npm 上传或安装，收益未实测。
