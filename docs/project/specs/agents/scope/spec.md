# Agent 范围与本人选择

Agent 归空间及可选 Repository，私有内容只对所有者可见；分享提供使用权，不授予编辑权，管理员治理不取得私有内容。Git 关联以中心仓库及本人 checkout 为准，不依赖项目 YAML。

选择依次为显式 Agent、本人仓库选择、本人空间选择；runtime 按显式、匹配仓库 override、匹配空间 override、定义引用解析。已选择层无效时明确报错，不按名称或下一层静默替换。agent select/selection/unselect 操作本人中心偏好，不写 client.sqlite。完整边界见[中心 Agent](../central/spec.md)。

local/hub 只影响服务托管方式，不能改变资源授权或选择范围。不同 Hub、用户、空间、仓库的选择互不借用；同仓库不同用户各自保存定义与偏好。
