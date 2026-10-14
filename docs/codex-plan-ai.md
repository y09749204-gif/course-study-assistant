# ChatGPT plan AI

The `codex-plan` provider runs the official local Codex executable with its saved ChatGPT login.
It uses the selected account's available Codex quota. It does not extract OAuth tokens or use a
Platform API key. API-key login is rejected for this provider.

Select **ChatGPT 套餐（Codex）** in AI settings. The model must be available to the signed-in
account. A completed structured inference verifies access; a model catalog alone does not.
The installed desktop runtime is located automatically. A private absolute executable override
can be supplied through `ZH_CODEX_EXECUTABLE`; do not commit machine paths or credentials.

Questions are sent on stdin to ephemeral, read-only executions. The CLI uses the Windows system
proxy feature when required. User configuration, shell execution, Code Mode host, plugins, apps,
web search and subagents are disabled. Results containing tool actions or incomplete turns are
rejected. Only temporary schema files are created by the adapter; question text and credentials
are not written to application diagnostics. CLI-managed authentication stays in its own store.

Single, multiple and short answers share the existing validators and memory-only success cache.
Login, quota and network failures pause environment assessments. There is no automatic fallback
to Ollama or separately billed API credentials. Model output format does not establish correctness.

The formal `--use-codex-plan-ai` launch option saves this selection once. Tests use mock subprocesses
or synthetic prompts with isolated temporary directories, never copied browser profiles.
