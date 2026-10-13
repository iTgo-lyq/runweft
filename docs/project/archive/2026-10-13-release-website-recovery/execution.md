# 官网接续故障定位与修正

## T1 环境隔离和运行标题就绪

五包 latest/beta 已为 1.1.5。原发布 run `38345712525` 的 beta、七组并行验收和 promote 均成功；只处理官网接续，包输入与原不可变 tag 完全一致。

实际 API 在 dispatch 返回精确官网 run ID `38348023714` 后，第一次 GET 的 `display_title` 仍为 `website Pages`，随后更新为 `release 1.1.5 from 38345712525/1`。旧等待器提前拒绝。修正只等待这个未完成的默认标题，run 路径、事件、main 分支和最终标题/成功结果继续严格核对；超时不重发。

官网自身在发布环境 `RELEASE_VERSION=1.1.5` 下运行测试。Beta CLI 子进程继承此变量却模拟 push，导致错误进入正式接续判据；该夹具现在明确清空变量。真实生产接续仍继承并核对版本。

`RELEASE_VERSION=1.1.5 node --test scripts/tests/release-finish.test.mjs website/publish.test.mjs` 24 项通过，覆盖默认标题短暂出现后成功、默认标题持续到超时、完成标题错误和既有错误状态，以及发布环境中的 Beta 子进程。文档/流程/diff 检查通过；`git diff v1.1.5 -- <全部 packageInputs>` 为空。新正式官网部署结果在恢复完成后的发行记录中另行登记，不把本地修正验收冒充生产部署成功。
