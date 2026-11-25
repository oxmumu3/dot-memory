# Dot 记忆总线 (`@oxmumu3/dot-memory`)

**跨 Antigravity、Claude Code、Codex 与 DeepSeek Harness 的本地共享记忆总线：4KB 原话实证活体记忆、零向量实体 Wiki 与跨端交接流。**

- **MIT License** · 作者：[牛村木木山 (`oxmumu3`)](https://github.com/oxmumu3/dot-memory)
- **纯 Node ESM · 零向量库 · 零 Docker · 100% 本机 Markdown & JSONL**

---

## 为什么做 `@oxmumu3/dot-memory`？

1. **解决“多工具孤岛”**：在 Antigravity 跑到一半卡住的项目，切到 DeepSeek Harness、Claude Code 或 Codex，通过同一条本地 `handoffs/YYYY-MM-DD.jsonl` 交接流与 `wiki/` 实体档案，立刻知道发生了什么、卡在哪里。
2. **绝不打穿 KV Cache**：绝不动态改写 `System Prompt`，仅在首轮用户消息、压缩摘要后或活体记忆哈希变动时，附注一条 `<dot_memory_context>`。
3. **防编造铁闸 (`quotedIn`)**：所有自动提炼与提案必须携带来自原文的逐字 `quote` 并通过归一化子串校验；未核验的 LLM 猜测一律拒之门外。
4. **真正会新陈代谢的 `4KB` 活体记忆**：`Dreaming` 代谢引擎根据最新跨端交接与工作区进展，按主题自动替换过时的 `active_focus` 条目（保留 `replacedOld` 变更轨迹），绝不让两周前的旧进度永远赖在上下文里。

---

## 在 DeepSeek Harness 安装（桌面版 / 网页版）

```text
1. 在 DeepSeek Harness 新建会话，点顶部「标准模式」下拉，切到「创造模式」。
2. 复制下面这句话发给 Agent，弹出授权时点「允许」：
请通过插件管理器，从 npm 官方源安装并启用 @oxmumu3/dot-memory@latest。完成后请核对版本和启用状态，再带我打开左侧「Dot 记忆总线」。
（也可以在「插件 -> 添加插件」直接填入 @oxmumu3/dot-memory@latest 安装并启用。）
开源仓库与图文说明（觉得有帮助欢迎点个 Star）：
https://github.com/oxmumu3/dot-memory
```

---

## 接入其他本机 Agent（Claude Code / Codex / Antigravity）

```bash
# 查看本机记忆总线状态
npx @oxmumu3/dot-memory status

# 一键安装 Stop 钩子（默认仅记录耗时 >=30s / 改动文件 / 阻塞报错，短问答自动静音）
npx @oxmumu3/dot-memory install-hooks --agent antigravity
npx @oxmumu3/dot-memory install-hooks --agent claude-code

# 查看标准 stdio MCP 配置（兼容 Claude Code / Codex / Cursor / Antigravity）
npx @oxmumu3/dot-memory mcp-config
```

默认数据目录为 `~/.local/share/dot-memory`（可通过 `DOT_MEMORY_HOME` 环境变量覆盖）：

- `living-memory.json` + 人类可读镜像 `LIVING-MEMORY.md`（4KB 硬预算：`rules` / `style` / `focus` + 待审 `candidates`）
- `wiki/{projects,topics,sessions}/*.md`（ID 锁 + 引用守恒 + 自动 `Change Log`）
- `handoffs/YYYY-MM-DD.jsonl`（跨 Agent 收工交接事件流）
