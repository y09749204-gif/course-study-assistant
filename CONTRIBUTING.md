# 贡献指南

使用功能分支或独立 worktree，通过 `npm run dev` 与隔离模拟课程验证。不要复制实际浏览器档案或修改其他应用数据。

提交前运行 `npm test`、`npm run check:privacy`、`npm run check:generated`。修改学习通预加载源文件后运行 `npm run build:preload`。浏览器测试先执行 `npm run test:browser:install`。

Issue 和 PR 写明预期、脱敏复现、验证及限制。禁止提交凭据、真实课程参数、题目截图、个人记录及本机绝对路径。测试素材使用合成页面。平台完成标记是完成依据，不新增伪造进度调用。

公开仓库 `main` 是开源主线。个人部署和公开版是独立仓库，只同步经过审查的功能补丁，不合并私人历史或复制运行目录。Windows 为当前验收平台，其他系统差异需单独验证。
