# Dot 记忆总线 (`@oxmumu3/dot-memory`)

**跨 DeepSeek Harness、Antigravity、Claude Code、Codex、Hermes Agent、WorkBuddy 与 Cursor 的本地共享记忆总线：4KB 原话实证活体记忆、零向量实体 Wiki 与一键跨端 Hook + MCP 接入。**

- **MIT License** · 作者：[牛村木木山 (`oxmumu3`)](https://github.com/oxmumu3/dot-memory)
- **纯 Node ESM · 零向量库 · 零 Docker · 100% 本机 Markdown & JSONL**

---

## 为什么做 `@oxmumu3/dot-memory`？

1. **不是改各家规则 MD 催模型自觉，而是硬接入 `Stop Hook + MCP`**：
   - **自动写（0 Token）**：各本机 Agent 跑完重活停下来时，由宿主 `Stop Hook` 自动把精简进展写入同一条 `handoffs/YYYY-MM-DD.jsonl`；闲聊自动静音过滤。
   - **主动读（按需查）**：通过标准 `stdio MCP` 暴露 7 个工具，让任意客户端随时检索其他工具刚完成的工作与实体档案。
   - **不碰用户规则文件**：绝不篡改 `CLAUDE.md` / `AGENTS.md`，写入任何外部配置前都会在 `~/.local/share/dot-memory/backups/` 自动备份。
2. **绝不打穿 KV Cache**：绝不动态改写 `System Prompt`，仅在首轮用户消息、压缩摘要后或活体记忆哈希变动时，附注一条 `<dot_memory_context>`。
3. **防编造铁闸 (`quotedIn`)**：所有自动提炼与提案必须携带来自原文的逐字 `quote` 并通过归一化子串校验；未核验的 LLM 猜测一律拒之门外。
4. **真正会新陈代谢的 `4KB` 活体记忆**：`Dreaming` 代谢引擎根据最新跨端交接与工作区进展，按主题自动替换过时的 `active_focus` 条目（保留 `replacedOld` 变更轨迹），绝不让两周前的旧进度永远赖在上下文里。

---

## 在 DeepSeek Harness 安装并一键打通本机全部 Agent

```text
1. 在 DeepSeek Harness 新建会话，点顶部「标准模式」下拉，切到「创造模式」。
2. 复制下面这句话发给 Agent，弹出授权时点「允许」：
请通过插件管理器，从 npm 官方源安装并启用 @oxmumu3/dot-memory@0.2.0。装好后先帮我检测本机已安装的其他 Agent（Antigravity / Claude Code / Codex / Hermes / WorkBuddy / Cursor），列出清单征得我同意后一键接入它们的 Stop Hook 与 dot-memory MCP，完成后打开左侧「Dot 记忆总线」核对连接状态。
（也可以在「插件 -> 添加插件」直接填入 @oxmumu3/dot-memory@0.2.0 安装启用，再点开左侧「Dot 记忆总线 -> 本机连接」一键接入全部 Agent。）
开源仓库与图文说明（觉得有帮助欢迎点个 Star）：
https://github.com/oxmumu3/dot-memory
```

---

## 支持的本机 Agent 接线矩阵

| 客户端 | 自动写入（0 Token） | 主动读写（stdio MCP） | 接入位置（均先自动备份） |
| :--- | :--- | :--- | :--- |
| **DeepSeek Harness** | 插件内置 `agent/turn-stopping` | 插件内置 6 个原生工具 | 随插件安装自动启用 |
| **Antigravity** | `Stop` Hook | `~/.gemini/config/mcp_config.json` | `~/.gemini/config/plugins/dot-memory-bridge/` |
| **Claude Code** | `~/.claude/settings.json` `Stop` | `~/.claude.json` `mcpServers` | 不修改 `CLAUDE.md` |
| **Codex** | `~/.codex/hooks.json` `Stop` | `~/.codex/config.toml` `[mcp_servers.dot-memory]` | 首次触发 Stop 需在 Codex 点允许一次 |
| **Hermes Agent** | `~/.hermes/hooks/dot-memory-handoff/` (`agent:end` / `session:end`) | `~/.hermes/config.yaml` 顶层 `mcp_servers` | 仅操作顶层 `mcp_servers` |
| **WorkBuddy / CodeBuddy** | `settings.json` `Stop` | `mcp.json` / `.mcp.json` | 自动识别 `~/.workbuddy-ai` / `~/.workbuddy` / `~/.codebuddy` |
| **Cursor** | 通过 MCP 主动记录 | `~/.cursor/mcp.json` | 无独立 Stop Hook |

---

## 与 `dsh-mnemon` 等同类 DSH 记忆插件能否共存？

- **不会发生技术冲突**：`@oxmumu3/dot-memory` 独占 `~/.local/share/dot-memory/` 存储目录、`/api/dot_memory/*` 路由、`dot_memory_*` 工具前缀与 `dotMemory` 服务名，且从不篡改 `System Prompt`。
- **使用建议**：如果已经装了 `dsh-mnemon` / `dsh-mneme` 等侧重 DSH 单回合记忆或 Skill 演进的插件，建议明确分工——把 `dot-memory` 的 4KB 活体记忆留给**跨工具主线焦点与全局硬规则**，不要两边重复记录相同条目，即可兼得零冲突与高性价比。

---

## 终端 CLI（供脚本或无界面环境使用）

```bash
# 扫描本机已安装的 Agent 及 Hook/MCP 连接状态
npx @oxmumu3/dot-memory connections

# 一键接入全部本机已安装的 Agent（写入前自动备份原配置）
npx @oxmumu3/dot-memory connect --agent all

# 单独接入或断开指定 Agent（antigravity | claude-code | codex | hermes | workbuddy | cursor）
npx @oxmumu3/dot-memory connect --agent hermes
npx @oxmumu3/dot-memory disconnect --agent hermes
```

默认数据目录为 `~/.local/share/dot-memory`（可通过 `DOT_MEMORY_HOME` 环境变量覆盖）：

- `living-memory.json` + 人类可读镜像 `LIVING-MEMORY.md`（4KB 硬预算：`rules` / `style` / `focus` + 待审 `candidates`）
- `wiki/{projects,topics,sessions}/*.md`（ID 锁 + 16 位 `expectedHash` 写栅栏 + 派生 Timeline + 自动 `Change Log`）
- `handoffs/YYYY-MM-DD.jsonl`（跨 Agent 收工交接事件流）
- `backups/`（修改外部 Agent 配置前的原始备份）
