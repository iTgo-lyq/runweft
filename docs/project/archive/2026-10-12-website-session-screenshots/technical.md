# 官网 HAPI 会话截图技术方案

> 依据：用户补充要求先找 HAPI 官方截图或示意图；沿用工程与自动验收授权。

HAPI 官方 https://hapi.run/ 的会话和代码截图分别为 /images/app-chat-interface.png 与 /images/app-code-view.png。HTTP 200，内容 SHA-256 与固定 HAPI 仓库 website/public/images 中同名资源一致；图片实际上是 WebP（946×2048），共 186,650 字节。直接复制本地上游字节，不改图；本站按真实格式命名 hapi-session.webp、hapi-code.webp 并声明 image/webp。官方另有文件列表、会话创建等截图及两张装饰插画，本次选最贴合已介绍功能的两张。

首页 #native-experience 后双图 figure，桌面并排、手机单列，图片显示宽度上限 320px，固定固有宽高，lazy loading。图片及查看原图链接无需 JavaScript；补充 HAPI 官网来源链接。全部新增图注、替代文本和来源说明由 iclaude 编写，明确上游示意图不等同 Runweft 任务截图。官方图片中的控件不用于宣称 Runweft 托管任务可在网页追加/续接。

build.mjs 自动复制 assets；publish.mjs 维持显式白名单，serve.mjs 声明 image/webp。浏览器验收包含先滚动再解码、原图键盘访问、无 JS、子路径、六宽度与首屏不变。发布后核对十文件摘要/MIME和正式浏览器。未发布的自制示例仅保留 .dev-smoke，专用服务/凭据已清理。

仅修改网站和本 Change，npm 1.1.3、发行冻结输入、HAPI gitlink与产品源码不变。
