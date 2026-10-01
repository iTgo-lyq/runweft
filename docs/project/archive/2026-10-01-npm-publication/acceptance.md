# npm 1.1.0 发布验收

## 结果与候选

2026-10-01，账号 `itgo-lyq` 已将五个 1.1.0 包公开发布到 npm，全部 latest=1.1.0，匿名下载与 Linux x64 专用安装通过。按持续授权自动完成本地验收；三项 Requirement 标准通过，T3 同步当前发行事实并归档。

正式候选为干净源码 `bfa2df88531a2f997038817c901d89ca9cab491e`，Bun 1.4.2；HAPI 0.30.7 / 协议 1 / revision `3ac8b08b2aead13e9eaae459de62d9a5d5df7395`。四平台程序与 Skill 同原验收候选，未重新执行模型验收。

## 公共包完整性

| 包 | 字节 | SHA-512（base64，registry integrity 去除 sha512- 前缀） |
| --- | ---: | --- |
| [runweft-darwin-arm64](https://www.npmjs.com/package/runweft-darwin-arm64/v/1.1.0) | 102301510 | `VvC/NI9PXdc0RNElZGIfE95IjlfgPNcVDE2wsfFKgl1qbaLl2pA1hrxatB53YymJ2jINnodjjQ8kbuYiIE8y5A==` |
| [runweft-darwin-x64](https://www.npmjs.com/package/runweft-darwin-x64/v/1.1.0) | 106156649 | `3vPpMLQIcpgRZjbnT043vMud8Dcc+gDexCwX3C2YCEprHAKkIGepEwo+2NKlr/DDOu6RIiX7mhDyR4p3VmhyXQ==` |
| [runweft-linux-arm64](https://www.npmjs.com/package/runweft-linux-arm64/v/1.1.0) | 134040214 | `urJ12i92WGofiKxgA8nX4X7t1bTXUO9pweP7puO2qlDol2spBLLZlXwQIS8UmFsAyvOsh37u4PQ/qnHhZm3+Qw==` |
| [runweft-linux-x64](https://www.npmjs.com/package/runweft-linux-x64/v/1.1.0) | 134823009 | `snjE9YXX7GI1vy1Cv664DnLUix5BK8ZiYz5YXVrIYbT+DEFV0trwuW0izAFfCD3GnPsjAIWiG1Vlq0lNcfENPA==` |
| [runweft](https://www.npmjs.com/package/runweft/v/1.1.0) | 18870 | `7a2MA7BbIt3iLNkpwwY7gnTODz6SYm3/aNGFm54KM7V+MtBvl5kRrj2qhCWi8Pi7Y3RgUJH7O9QqBU60Jw369Q==` |

公共五包的版本、latest、manifest、主包精确可选依赖、tarball 完整性均与冻结索引一致。四平台先完成匿名下载，最终检查重新读取全部元数据并下载主包；不重复下载相同完整性的已验产物。

## 程序与 Skill

| 平台 | Runweft SHA-256 | HAPI SHA-256 |
| --- | --- | --- |
| darwin-arm64 | `276ccb1ff046b7e092c2312cab2db3d9c31bccbfb33b54a8b19867a1d9c7a2a6` | `b6acc3f6f3edbd41c108d84db57bb8333430b9bb7e8ec082dd3fbfc8126d41cd` |
| darwin-x64 | `1f9a5c3c50a6cecc7525e11f806eff9a5b1504f7a181b3dc55a3953b20d5ed00` | `8d902ae39129113a2a5c13d5dea043e712f127807b7f57e6354ff8c4c0e3a639` |
| linux-arm64 | `8e5a9f99acd9b294d30d27a7185e6bed4a605ec8b5b1c044f652439bed870f9b` | `82d8d04fe95c22eb6c9c44d0a4f6a865e001886817cedd74c84220606a7004dd` |
| linux-x64 | `45294f01f79f76bee545d1aba9a91051db97f51293e12bb68758f46d0195307f` | `bdf706d7966ae4818b09029991a2bb03e70b10b0555763fc41430afd977b4fec` |

独立 Skill SHA-256：`c45cc0337d030ae4534a22fb46fe4ffca829978b50737d915a2c82a348665a7e`。主包与本机平台包的全部 Skill 文件逐字节匹配源码；所有公共 tarball 匹配包验证所检查的同一冻结产物。

## 需求与验证

- 五包公开版本/完整性/依赖：真实发布及公共 registry 读取通过，回执 `.dev-smoke/npm-publication/publication.json`。
- 公共安装：空 npmrc、cache、prefix 从公共 npm 安装；实际 CLI/HAPI 版本、程序 hash、Skill 与 MCP/Hub 帮助通过，证据 `.dev-smoke/npm-publication/public-install/evidence.json`。
- 正式包：`test:packages`、`test:install`、五包 dry-run 与 README 对照通过；证据 `.dev-smoke/release-packages-nDC1ok/evidence.json`、`.dev-smoke/install-sMpeaY/evidence.json`、`.dev-smoke/npm-publication/preflight.json`。
- 缩减源码归档：全部源码/许可和当前平台工具的 2934 个 Git blob 一致，实际四平台无 Web CLI 编译通过；typecheck、256 项根测试和 build 通过，证据 `.dev-smoke/npm-publication/source-archives-v2/evidence.json`。
- 本次专用 npm logout 成功并删除认证 npmrc；用户默认配置、全局安装、原生宿主配置和模型凭据未被更改。

## 范围与后续

本次公共安装为 Linux x64，其余平台本次验证公共下载与构建材料。已有原生协作验收及实机缺口沿用[1.1.0 集成验收](../../archive/2026-10-01-hub-spaces-and-agent-configuration/acceptance.md)，未扩张为四平台模型实测。

原离线整包、源码 bundle 与网站副本保留原候选 `657550f20d44d1a65a48b232ef13f3ca5160e8cd`；本次公共包更新 README、按平台的匹配源码归档与 repository 元数据，程序/Skill 相同。不声称重新组装离线交付或部署官网/在线 Hub。

可信发布未由本 Change 配置；仓库仍只有安装测试工作流，npm 端绑定查询因额外 2FA 未完成，不推断当前绑定。后续须添加发布工作流并绑定各包；本次发布成功不依赖该设置。

任务独立提交：T1 `9d44a50`，T4 `bfa2df8`，T2 `3f43e83`；T3 提交包含 Specs/入口同步与本目录归档。
