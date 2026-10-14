# AI 配置

默认关闭。两种方式分别配置，不共享认证，不自动切换到另一种收费服务。

## 兼容 Chat Completions

填写完整 HTTPS 端点、服务支持的模型及自己的 Key；本机服务可用 localhost。费用、额度及数据处理以提供方为准。登录 ChatGPT 不会替这条接口配置 API Key。

Key 通过系统安全存储加密保存，不放入 Git 或 Issue。模型需支持项目使用的结构化输出，否则格式校验可能失败。

## 本地 Codex

自行安装官方客户端并登录 ChatGPT，选择“ChatGPT 套餐（Codex）”，填写账号可用模型。支持范围和额度以实际执行及 [官方认证说明](https://learn.chatgpt.com/docs/auth) 为准。

Windows 会尝试发现桌面运行时；其他安装通过本地 `ZH_CODEX_EXECUTABLE` 指定绝对路径。该模式调用 CLI，不提取 OAuth token，不转换为通用 HTTP API，也不接受 API-key 登录。勿提交本机路径或客户端认证目录。

题目经 stdin 传入临时只读执行，关闭工具、插件和搜索，采用 schema 输出并验证结果。临时 schema 会清理，应用诊断不保存题目正文或凭据；Codex 自身存储和服务端处理遵循其配置与政策。

登录、额度、网络或格式失败会提示处理；格式正确仍需核对内容。参见 [适配器细节](codex-plan-ai.md)。
