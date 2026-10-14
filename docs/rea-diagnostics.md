# 按需 REA 诊断

可使用自行安装的 `morluto/rea` 安装，不加入播放运行依赖，也不自动下载。

1. 退出助手后使用 `npm start -- --rea-diagnostics`；开发诊断使用 `npm run dev -- --rea-diagnostics`。
2. 打开一个智慧树或学习通课程页面。
3. 将本地环境变量 `REA_ENTRY` 指向已有安装中的 `scripts/rea.mjs`，执行 `node scripts/rea-inspect.cjs`。也可在被 Git 忽略的 `scripts/rea.local.json` 保存 `{"entry":"本地工具路径"}`，复用已有安装。
4. 观察窗口为 10 秒。在工具开始观察后复现切课或关闭提醒。输出只保留域名、状态码和数量；不输出账号、Cookie、URL 路径参数、页面文字或脚本源码。
5. 诊断后正常退出，再按普通入口打开。普通启动不开放调试端口。

默认调试端口为回环地址 `127.0.0.1:9339`；可用 `ZH_REA_PORT` 指定其他非特权端口。端口只在诊断进程存活期间开放。本机其他进程可以访问这个调试端口，因此不要常驻启用。

开发与验证仍须使用独立 `ZH_STUDY_TEST_DATA_DIR`。不复制正式浏览器档案。REA 只能观察接入之后的网络活动，单独的状态码或请求数量不足以证明首页跳转根因。

参考：[REA 浏览器观察指南](https://rea.tools/guides/browser/)。
