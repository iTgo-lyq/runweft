# 测试与需求验收

## 按改动选择检查

在仓库根执行；比较前先 fetch 所需分支，显式参数引用必须在本地可解析。

```sh
node scripts/ci-scope.mjs --base origin/main --head HEAD
node scripts/ci-scope.mjs --base origin/main --head HEAD --working-tree
```

输出比较提交、文件清单、固定检查和依赖范围。`--working-tree` 额外纳入已暂存、未暂存及未跟踪文件；重命名同时考虑旧、新路径。比较分叉分支可加 `--merge-base`。明确基线不存在会失败，不能把失败当成“无须测试”。

开发 CI 在 Node 环境先选择范围，再安装所选检查需要的依赖。PR 使用目标分支 merge-base，普通 push 使用 before/head，首次 push 使用默认分支 merge-base；缺少可信自动基线保守选择完整检查。scope 与最终汇总始终执行，所选检查失败、取消或缺结果不能通过。

普通文档执行文档与流程检查；原型和官网使用所属工程的验证，Kit 检查结构及分发工具。根测试、公共 helper、共享源码和工作流变更不会因被排除而漏验。`native` 是按改动给出的模型验收建议，开发 CI 不会自动调用模型；`install` 表示候选安装的影响范围。实际命令仍按当前入口使用，范围输出不代表检查已经执行。

官网的验证与部署由其独立工作流负责，入口见 [官网说明](../website/README.md)；原型见 [包内说明](../packages/prototype/README.md)，候选、发布和恢复见 [发行操作](release.md)。
