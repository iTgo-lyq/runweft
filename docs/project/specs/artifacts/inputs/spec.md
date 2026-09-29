# 启动前文件输入

spawn 和 next 接受最多 100 个 inputs[{artifactId,name?}]，名称缺省取对象文件名。CLI 使用可重复 --input <id> 或 --input name=<id>；MCP 使用相同结构。中心确认对象 available 后冻结名称、大小和摘要，并将本轮约定纳入请求指纹；重复逻辑名拒绝。每轮独立声明，未提供时没有新输入，steer 不接受附件。

接受意图先写 Runweft SQLite，再建立稳定 input pin 并接受任务。明确拒绝时回收新 pin，结果不明时保留意图；中心启动前只对账自己已记载的意图，已接受保留、确认未接受释放。未知来源或恢复引用不会凭年龄移除。

preparing 经 HAPI Runner materialize 下载到当前连接数据根，逐项验证 hash/长度。操作先保存身份和回执，再后台执行；未知结果查询原操作，不换身份重放模型。准备失败不启动原生进程，prompt 不承担补做下载或目录初始化的职责。

shared 使用当前 preparedFiles 门禁；worktree 把已验证文件交给 Git prepare，校验复制后树外路径并使用 preparedWorkspace。Runtime 从准备完成的 cwd 启动，继续加载原生工程配置和默认权限；Claude 当前输入目录沿已有 --add-dir 通道提供，不扩大到整个 home。

轮次上下文包含实际输入路径。next 优先复用原生 session，传本轮准备引用；无新输入时显式清除上一轮 shared preparedFiles。输入错误不等同于原生历史缺失，不触发重建或重发任务。

worktree 成功复制后回收 materialize 中间副本，最终树外输入随环境留存。shared 在执行确认停止或明确未启动后回收下载副本；回收失败可见并由协调器继续原操作，中心 input pin 保持。read/show 的 input_files 展示准备、实际路径、download_retention 和清理错误。中心对象释放见[留存](../retention/spec.md)。
