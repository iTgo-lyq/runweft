# Runweft 开发与自动验收

使用固定 Bun 1.4.2 和 package.json 中的 HAPI pin。当前产品使用 Hub 身份/空间和中心配置；旧 YAML/root-token smoke 只保留研究价值，不是新版验收入口。

## 构建与基础检查

```sh
git submodule update --init hapi
bun install --frozen-lockfile
(cd hapi && bun install --frozen-lockfile)
bun run build:hapi
bun run typecheck
bun run test
bun run build
```

根测试显式使用 `./test`，不要执行 HAPI 全套测试。build 核对 HAPI revision、源码干净和二进制 hash；pin 改变后先重新 build:hapi，不混用旧程序。不修改用户原生配置，不提交 `.dev-smoke/`。

## 当前 Hub 验收

以下脚本使用专用数据、当前编译 CLI 和真实 HAPI，停止自建服务并保存 evidence.json。Playwright 可设置 `RUNWEFT_SMOKE_CHROMIUM` 指向已有 Chromium；没有时安装兼容浏览器，不连接用户真实浏览器。

| 命令 | 范围 |
| --- | --- |
| `bun run test:hub-connect` | 编译 CLI、RSA/WebCrypto、主动创建身份/选择空间、加密交接、重试、取消、秘密扫描 |
| `bun run test:hub-console` | 完整后台、机器/runtime/Agent/仓库/个人选择、权限、任务分页、多身份 HAPI 标签/审批/文件/SSE、390px；任务历史/RPC 是明确夹具，不运行模型/OS PTY |
| `bun run test:hub-service` | 默认服务角色、独立机器接入、轮换/撤销、监督 Runner、显式 reset 与保留 worktree；不运行模型 |
| `bun run test:hub-resources` | 真实 Runner 接入、两个原生工具探测、分享/治理与凭据轮换；不运行模型 |
| `bun run test:hub-configuration` | 中心仓库、Agent、个人选择与配置解析；工具发现不等于模型调用 |
| `bun run test:hub-access` | 真实 HAPI HTTP/文件及多主体隔离 |
| `bun run test:hub-realtime` | 真实 Socket/SSE，协议执行端的终端/派生，不等于真实 PTY |

模型验收须已有授权和专用认证副本：

```sh
bun run test:hub-native-mcp
bun run test:hub-consumers
```

`test:hub-native-mcp` 先通过真实浏览器 begin/complete 连接，再用 Codex/Claude 两个原生主宿主 × 两种 runtime 执行 spawn/wait/read；每组实际等待超过 60 秒、核对报告、子 CLI 递归拒绝与进程退出。可用 RUNWEFT_SMOKE_HOST=codex|claude 选择宿主。仅专用 helper 的预期审批由脚本自动处理，不改变产品权限。

`test:hub-consumers` 使用两个独立 Runner，验证共享两轮、原生确认历史缺失后重建、本地 worktree、同机远端 Claude 附件/代码回收和显式清理。历史缺失以专用空原生 home 和相同认证/机器验证，不能删除部分文件就把 unknown 当 missing。

脚本默认复制已有 Codex/Claude 配置与认证到 `.dev-smoke/`。Claude 优先 iclaude，可用 RUNWEFT_SMOKE_CLAUDE 指定；Codex 可用 RUNWEFT_SMOKE_CODEX_MODEL/EFFORT 覆盖专用副本中的可用模型。不要打印复制凭据、完整原生输出或 prompt。所有成功与失败保留真实证据，同机两个 Runner 不称物理远端。

## Skill 与官网

产品 Skill 在 `skills/runweft/`，只交付、不安装到开发者全局。使用 skill-creator 结构校验和独立 Agent 场景验证，安装/更新/卸载只针对专用 HOME/CODEX_HOME/CLAUDE_CONFIG_DIR。

```sh
node website/build.mjs
RUNWEFT_SITE_CHROMIUM=<Chromium路径> node website/verify.mjs
```

先准备当前源码的四平台包，旧认证包被构建器拒绝。Playwright 真正下载 Skill 与四平台包、核对 hash、检查 320–1440px/链接/键盘/无 JS，并从页面 DOM 执行 Linux x64 安装。只在专用 HOME 解包，不改用户 MCP，不部署在线站点。详情见[官网说明](../website/README.md)。

## 发行

```sh
bun run package --all
```

或 `--platform darwin-arm64` 选单平台；已核对的 HAPI 构建可加 `--reuse-hapi`。完整 `dist/packages/` 含主包、四平台 tarball、独立产品 Skill、index.json 和 SHA256SUMS。主包和平台包内使用说明/Skill一致，包含 HAPI 许可/NOTICE/源码。索引绑定源码 revision/dirty、HAPI pin、二进制与 tarball hash；全部成功才替换旧发行目录，不自动 publish。

最终集成必须从同一候选执行真实安装、当前 Hub smoke 与四平台校验，不能用旧产物验收外推；发行包检查/registry 安装脚本中的旧服务路径由最终集成阶段更新后才作为入口。Mac 必须构建双架构但保留实机边界，Linux arm64 QEMU 与原生协作分开记录。使用说明见 [usage.md](usage.md)，实际交付和验证状态见[项目入口](README.md)。
