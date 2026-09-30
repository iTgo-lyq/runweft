# 全局 Runtime 登记

runtime 是某个已登记机器上的 codex 或 claude，具有稳定 UUID、所有者和独立登记状态；同机同 flavor 重复登记沿用 ID，名称不参与路由。runtime register <flavor> --machine <id> 不创建 Agent。

list/show/check/resolve 基于当前原生工具发现及空间授权判断可用性，rename/unregister 管理登记；share/unshare 按空间授予或收回使用权。私有资源、成员共享与管理员禁用规则见[Hub 资源归属](../ownership/spec.md)。机器关联空间不等于分享 runtime。

原生命令及模型配置沿 Runner 环境，不提供 runtime profile、插件加载或第二套 launcher。工具可用与版本探测不证明模型认证/执行已通过；失败按目标返回具体原因，不回退另一机器或 runtime。
