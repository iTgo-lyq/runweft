# Agent 定义

Agent 配置以 Hub 为权威，有稳定 UUID、所有者、空间、可选 Repository 及不可变版本。全局和项目范围分别表示空间默认适用与指定仓库适用；定义内容、访问模式、并发更新和个人选择见[中心 Agent](../central/spec.md)。

root agent 与 hub agent 使用同一中心 API。create/update 的 JSON 文件仅是单次输入，不作为持续配置源；不再提供 agent init/bind 或扫描全局/项目 YAML。机器接入、runtime 登记与 Agent 定义独立，名称不承担路由。

任务发起时 Hub 解析 Agent 与目标，保存每轮不可变快照；下一轮读取当前定义并验证固定目标，见[中心委派](../../delegation/central/spec.md)。原生参数映射和配置继承见[继承边界](../inheritance/spec.md)。
