# 全局机器登记

机器是 Hub 全局对象，具有所有者和独立机器连接凭据。machine enroll 持久保存原请求并登记本机；机器关联空间不自动创建或分享 runtime/Agent。原生 ID、元数据、在线心跳和执行仍由 HAPI 处理，Runweft 不新增心跳系统。

machine list/show 显示可见登记及真实在线事实；rename/register/unregister 修改名称或登记，associate/detach 管理空间关联。credential/revoke-credential/rotate-credential 分别查询、撤销及替换本机机器凭据。访问、管理员治理、失效重试和凭据持久化见[Hub 资源归属](../ownership/spec.md)。

Runner 的启动与机器登记分开，使用 runner start/stop/status。注销不删除原生历史，在线不等于模型可运行。业务连接身份与机器凭据分别保存，不能互换。
