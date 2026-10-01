# 官网统一 npm 安装

> 状态：已完成
> 规模：中型
> 更新：2026-10-02

## 目标与范围

用户要求官网不再提供包下载，所有安装通过 npm。首页、指南和完整参考统一给出 npm 安装及包内 Skill 接入；静态交付不包含平台包、Skill 归档或下载目录。

方案、Plan、逐任务提交与自动本地验收沿用 AGENTS.md 的持续授权。公共 npm 1.1.0、既有离线整包和运行服务保留，不执行网站部署或新版本发布。

## 行为变化

### MODIFIED

- `website/product` — 安装：平台下载与解包命令改为固定已发布版本的 npm 命令，注明 Node.js 20+，平台依赖由 npm 自动选择。
- `website/guide` — 接入：Agent 通过 npm 安装 CLI，从 npm 包内取得 Skill，再完成 Hub/MCP 接入；更新 PATH、升级和卸载说明。
- `installation/skill`、`installation/cli` — 接入与维护：包内 Skill 和说明以 npm 为常规入口，官网不再提供独立下载；当前公开包保持原有字节。
- `release/distribution` — 组装：独立 npm 网站按版本和安装元数据与候选匹配，不要求下载副本。
- `website/product` — 构建：独立生成小体积静态站点，不再要求本地发行包；完整发行组装适配独立站点。

### REMOVED

- `website/product` — 所有平台包/Skill/校验文件下载按钮、下载表、平台切换解包命令和部署目录内的归档文件。

## 验收标准

- [x] 三个页面仅提供 npm 安装和包内 Skill 说明，无下载入口、过期 npm 文案或归档文件。
- [x] 没有 dist/packages 的干净环境能构建；失败保留旧站点；完整发行组装仍可校验新站点。
- [x] Playwright 验证复制/拒绝、键盘、无 JS、320–1440px 与子路径；DOM npm 命令在专用环境真实安装并核对版本/Skill，失败不继续执行。
- [x] 说明、Specs 与验收记录同步并归档，不修改用户全局配置。

## 已核实依据

官网当前复制四份约 180–207 MB 平台包和独立 Skill；npm 五包 1.1.0 已公开，主包携带 skills/runweft，engines.node 为 >=20。当前根说明是完整参考页的源，发行组装读取网站 release.json 并假定 downloads 存在；两处须同步调整。
