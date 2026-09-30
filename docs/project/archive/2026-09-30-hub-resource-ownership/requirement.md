# 机器与 runtime 的归属和共享

> 状态：已完成
> 规模：大型
> 前置：[身份与空间](../../archive/2026-09-30-hub-identities-and-spaces/requirement.md)、[HAPI 授权](../../archive/2026-09-30-hub-hapi-access/requirement.md)
> 更新：2026-09-30

## 目标与行为

独立登记机器、注册机器上的 Codex/Claude runtime；两者全局于 Hub，不按项目重复创建。持久记录所有者与空间授权，保留在线/工具探测事实和原生执行。

### ADDED / MODIFIED

- 机器归属由可信注册衔接确定，自报已有 machineId 不能认领。
- runtime 默认私有，所有者可向指定空间成员共享执行；共享不授予编辑、改分享范围、新增 runtime、机器文件或终端控制权。
- 空间管理员可见必要治理概要并禁用，不能隐式消耗私有 runtime 或改写所有者配置。跨空间共享须显式授权。
- API/CLI 列表、详情、修改、注销、探测和执行解析都按同一身份规则；机器离线保留配置。

## 验收与边界

两所有者、两个空间验证私有/共享、撤销、跨空间和管理员边界；真实 Runner 注册与探测保持可用。任务/附件内容不随 runtime 共享，Agent 定义归独立 Change。技术方案和 Plan 按依赖完成后的真实接口形成。
