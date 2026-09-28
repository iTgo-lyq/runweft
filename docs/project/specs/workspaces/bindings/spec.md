# 本机工作区绑定

`runweft workspace bind [directory]` 校验本机目录并绑定稳定 workspaceId；省略参数时使用进程当前目录。绑定保存真实路径与可发现的 Git 根，符号链接别名指向同一真实工作区。

绑定存于当前 Runweft 数据根的 `client.sqlite`，SQLite 唯一约束保证同一真实目录取得同一 ID。重复绑定、跨进程查询及服务重启保留身份；`workspace list` 查询已有绑定。

绑定不创建或移动仓库，不修改源码、Git 分支或原生会话。非 Git 目录可以绑定，绑定本身不表示已具备独立 worktree 或远端任务能力。父会话识别、委派与工作区准备仍由各自模块实现。
