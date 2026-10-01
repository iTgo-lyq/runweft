# npm 可信发布技术方案

> 来源：./requirement.md
> 状态：已确认

## 已核实依据

- 既有 `cli-install.yml` 使用固定 SHA 的 Actions、Node 24/Bun 1.4.2，已完成四平台打包安装；包 manifest 的 repository 与目标仓库一致。
- npm 11.19.0 提供 `npm trust`。本地 npm 实现 `lib/utils/oidc.js` 请求 GitHub audience `npm:registry.npmjs.org`，并以 Bearer ID token POST `/-/npm/v1/oidc/token/exchange/package/<name>`；只有该包绑定匹配才返回短期 token。
- 官方资料确认可信发布支持私有仓库；私有仓库不生成自动 provenance。本次不变更可见性。

## 实现

新增 `npm-publish.yml`：普通 main/codex 分支的发布相关变更触发构建与预演；仅 push 事件中严格 `v<major>.<minor>.<patch>` 标签且与源码/索引版本一致时正式上传；手动入口始终只预演。复用 `cli-install.yml` 为可调用工作流，发布 job 必须依赖根检查、四平台 package/安装与包检查；调用和独立 CI 并发组区分，发布全局并发不取消。授权/发布 job 获取 id-token:write，不依赖 npm secrets，不运行产品脚本；源码检出不保留 Git 凭据。

新发布脚本先验证干净冻结索引、五包集合、版本、hash、主包精确依赖与 tarball manifest；源码必须等于 github.sha。预演报告已经存在的版本并提示正式发版前升版本，仍检查候选；实测 npm 11.19.0 的 dry-run 会拒绝已有版本，因此只在 dry-run 同时传 --force，不在真实上传使用。正式模式先查询全部版本，任何同版本不同完整性在上传前停止。

上传前写未知状态回执，成功退出后改为已接受并等待最多二十分钟后台处理；主包等待四平台公开确认，未知失败不自动重发。发布 job 最多五十分钟。回执 always 上传并允许同名覆盖，候选按 build 的 run_attempt 唯一命名，均保留三十天；恢复使用同一 run 的 Re-run failed jobs，下载原 build 输出指定的候选与最新回执。重跑整个 run 会重新构建，不视作相同候选。

OIDC 检查使用 npm 官方 Registry API 已公开的交换路径，逐包交换并立即丢弃返回 token；仅记录包名/状态，不打印或保存请求凭据和响应秘密。不将 npm whoami 或 dry-run 当作授权证明。npm 绑定允许仓库该工作流取得发布权限，不限制具体分支；普通分支不上传由版本/事件判断保障，仓库写权限即包含修改工作流的能力。本次不追加 environment 或账户 token 政策。

绑定操作使用 npm 官方 CLI 和专用配置：先列出真实绑定，匹配 owner/repository/file 且 permissions 包含 createPackage 则复用，缺少时添加，不撤销其他配置；遇不同绑定或冲突先停止并检查。首次认证如需用户操作，提供当前官方链接；官方限速建议逐包间隔两秒。操作后再次查询核对、退出专用登录并清理认证文件。

## 版本与范围

CI 只允许标签与 package/index 版本一致；不变更当前 1.1.0，不创建发布标签。为真实授权检查推送当前分支、运行普通检查，必要时仅重跑失败的授权 job。main 的手动预演入口需将来合入工作流后使用，当前标签入口可直接工作。新构建候选的验证范围仅本次 CI，不继承既有 hash 的模型/实机验收；正式标签路径本次只做模拟验证，真实版本上传留待下一次正式发版。
