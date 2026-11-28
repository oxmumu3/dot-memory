# Changelog

## 0.2.0 (2026-11-28)

- **One-Click Cross-Agent Connectors (`agent-connectors.mjs`)**: Auto-detect local agents and wire both Stop Hooks (0-token auto-capture) and stdio MCP servers without touching user-maintained `CLAUDE.md` / `AGENTS.md` files; creates automatic backups under `~/.local/share/dot-memory/backups/` before editing any config.
- **Expanded Agent Matrix (6 External Agents + DSH)**: Added native support for **Hermes Agent** (`~/.hermes/config.yaml` + `HOOK.yaml`/`handler.py` on `agent:end` & `session:end`), **WorkBuddy / CodeBuddy** (`~/.workbuddy-ai` / `~/.workbuddy` / `~/.codebuddy`), **Cursor** (`~/.cursor/mcp.json`), full **Codex** (`~/.codex/hooks.json` + `~/.codex/config.toml`), **Antigravity** (`hooks.json` + `mcp_config.json`), and **Claude Code** (`~/.claude/settings.json` + `~/.claude.json`).
- **Electron-Safe Runtime Resolution**: Prevents Electron host binaries from being written into external MCP/Hook configs and resolves stable `node` + hoisted package paths.
- **DSH UI & Model Tool Upgrade**: Added a dedicated `本机连接 (Connections)` tab, Day-0 unconnected agent banner with one-click setup, and the `dot_memory_manage_connections` model tool.
- **Knowledge Hardening (from Stage 11)**: Added 16-char `expectedHash` write fencing on Entity Wiki updates, derived chronological timelines, local Git checkpoints, zero-LLM `dot_memory_recall` trigger matching, and 30-day dormant Wiki archiving.

## 0.1.0 (2026-11-25)

- Initial public release of `@oxmumu3/dot-memory` (Dot 记忆总线).
- Zero-dependency local store: 4KB verbatim-verified Living Memory (`quotedIn`), active `focus` metabolism in `runDreaming`, ID-locked Markdown Entity Wiki, Han-bigram RRF hybrid search, zero-LLM 1-hop Flashback, and cross-agent `handoffs/YYYY-MM-DD.jsonl` bus.
- Added stdio MCP server (`dot-memory-mcp`), CLI + Stop hook installers (`dot-memory`), and DSH `0.2.2` / `0.2.3` dual-compatible plugin with a 3-tab sidebar workbench.
