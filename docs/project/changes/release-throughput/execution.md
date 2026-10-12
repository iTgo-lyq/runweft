# 执行证据

## 准备与基线

独立 worktree：`/home/tiger/workspace/runweft-release-throughput`。分支 rebase main 后文件树与原 0e1fd6e 一致，归档保留；重排使用显式 force-with-lease 同步远端。Bun 1.4.2、固定 HAPI 8f774b9、root/HAPI frozen 依赖及 build:hapi 已就绪。实际提交触发 SpecTrail hook 通过；check-setup 的 ready 只表示准备条件。

实现前 typecheck、260 项根测试、26 项发布 Node 测试和 15 项官网测试通过。所有证据保存在 `.dev-smoke/release-throughput/`；未触发真实发布、模型或生产部署。

## T1 公共候选读取可在总预算内恢复

下载中五包元数据、主包/本平台 tarball 共享十分钟截止时间；请求及完整响应流均受剩余预算约束。传播/限流/服务端/网络故障按白名单恢复，鉴权、410、地址、manifest 和摘要错误直接失败；临时文件完整核验后替换，失败清理 partial。元数据/标签读最多五个并发，上传和晋级写入顺序保持既有门禁。日志记录读取次数及累计耗时。

验证：`node --test scripts/tests/npm-release.test.mjs scripts/tests/npm-publish.test.mjs` 28 项通过，包含真实 HTTP 夹具的 404、429/Retry-After、响应流中断及受限重试；拒绝 403/410/非法地址/摘要错误、超预算 Retry-After、跨读取总预算耗尽和真正不结束的响应流。最后一项暴露 Node pipeline 的 AggregateError 包装，已按底层网络/超时错误识别并复验。workflow 41 项 Change 及 diff 检查通过。没有重新运行真实 npm 上传或安装，收益未实测。

## T2 稳定候选并行验收且完整门禁后才晋级

发布 workflow 根据五种模式选择上传前四组或 service-package，稳定版及所有恢复模式在公共候选上并行运行三组集成；只有 beta、全部安装及所需集成均成功才晋级，脚本再检查一次。预发行正常构建明确允许三组公共 job 跳过；其恢复仍重新验证三组。原日志恢复须同时取得原上传标记和成功的上传前集成步骤，原 1.1.4 beta job 114785075269 的这一证据已通过只读 API 核实。三组 runner 保留原环境的客户端发现工具，不启动模型；web 单独安装 Chromium。

新增解包入口再次核对 tarball SHA-512、manifest 和两程序 SHA-256。Linux x64 从实际网页 DOM 安装精确候选，核对程序摘要、README 和五份 Skill 文件。46 项发布/官网 Node 测试、两份 workflow 的 actionlint、workflow 及 diff 检查通过；新增夹具覆盖五模式、每种门禁失败/取消/跳过、预发行重跑全部 job 与 main/source-run-id 恢复、原检查缺失及程序摘要变更。

实际验证先误选本地历史 dirty 构建，descriptor 校验及程序摘要核对拒绝；该次 access 运行不计入候选证据。随后以原正式 descriptor 从公共 npm 下载两包，五包 metadata、SHA-512 和两程序 SHA-256 核对通过（首次请求均成功，下载总耗时约 6.6 秒，仅是此次读取样本）。正式候选分别通过 access、storage、web 的完整现有集成；DOM 安装通过，证据 `.dev-smoke/website-2fc0hF/evidence.json`。当前 packageInputs 与原 1.1.4 冻结源码一致。本轮没有真实触发新的四平台 CI 或 npm 发版，既有四平台安装/卸载入口保留，不能将 Linux 本地集成当作新四平台实测。

## T3 官网接续与发布证据自动收尾

稳定晋级后以 main dispatch 接续官网，固定实际 run ID、版本和来源 attempt，限时等待完成。未知触发、关联不符、失败或超时均不报告成功、不盲目重发。普通 push 在版本未晋级时完成静态检查并等待；正式接续必须版本一致，上传前重查当前 main。官网唯一 URL 与正式域名均核对十文件，随后执行三页桌面/手机浏览器。摘要遍历发布的各 attempt 和全部关联官网运行，统计真实队列/运行时长、重试和候选证据，保留未知字段及缺失日志。

57 项发布/官网 Node 测试通过，包括真实 CLI 的“唯一 URL 成功、正式域名失败”及成功对照、官网 A 失败/B 成功的跨 attempt 汇总。既有 1.1.4 发布 run 38241538144（2 attempts）与官网 run 38245448709 的只读实测汇总得到 13 个 job、47 条证据、无日志缺失；识别 4 个继承成功 job，避免重复计时。实际运行时间 ubuntu-24.04 1,598 秒、ubuntu-24.04-arm 77 秒、macos-15-intel 198 秒、macos-15 58 秒；这是旧流水线历史样本，不是新流水线性能。

只读访问既有 1.1.4 唯一 URL https://6c712b0f.runweft.pages.dev/ 和正式域名 https://runweft.pages.dev/，两处十文件 hash/MIME 均通过。新在线浏览器检查先暴露隐藏图片不应滚入视口，修正后桌面 1440px 三页通过；该次手机导航遇到代理 ERR_TUNNEL_CONNECTION_FAILED，诊断后仅续验 390px 三页，通过。证据保留在 `.dev-smoke/website-pages/deployment.json`、`browser.json` 和 `browser-390.json`，不将部分失败记录写成整组成功。未真实 dispatch、上传或新发版。

独立 subagent 整体评审发现两项：T3 的历史官网 run 遗漏已补测试修正；T1/T2 的晋级默认读取器契约不匹配由追加 T4 处理，见 Review。未改写已提交任务记录。

## T4 修正独立评审发现的公共读取契约

晋级默认读取器直接使用 verifyPublicRelease 内部的精确版本 fetch，不把 signal 误传为 metadata 的版本。新增测试拦截真实默认 fetch，分别核对稳定/预发行的五个 URL、AbortSignal 及相应标签结果。HTTP 错误响应体取消失败时保留原状态，401/403 回归确认只请求一次、不重试。

59 项发布/官网 Node 测试、typecheck、三份 workflow 的 actionlint、workflow 和 diff 检查通过。独立评审者复核全部修正并自行执行 9 项定向测试，均通过，未发现新增明确问题。根 260 项测试、build:hapi 及 T2 三组真实公共候选集成证据继续有效：产品输入、HAPI pin 未改变。新四平台 CI、真实 dispatch 及性能测量仍留待授权发行。
