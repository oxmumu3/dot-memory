# `@oxmumu3/dot-memory` — Open-Source Baseline & Clean-Room Design Notes

## 1. License Audit & Isolation

| Category | Project | License | Decision |
| :--- | :--- | :--- | :--- |
| **Strict Quarantine (0% touched)** | `OpenViking`, `WeClone`, `staticroostermedia-arch/engram` | `AGPL-3.0` | Never cloned, never inspected, zero code/ideas copied |
| **Existing Tools Reused As-Is** | `dsh-context`, `@deepseek-ai/dsh-experimental-session-search` | `Apache-2.0` / First-party | Recommended alongside `dot-memory` for context telemetry and raw session FTS; not reimplemented |
| **Permissive Reference Baselines** | `tinqiao-oss/engramory` | `MIT` | Adopted KV-cache-safe delta injection discipline (`agent/pre-step` waterfall append-first, inject only on first turn / post-compaction / state change) and bounded prompt caps |
| **Permissive Reference Baselines** | `PerryLink/dsh-memento` | `Apache-2.0` | Adopted versioned service seam declaration (`ctx.dotMemory` + `features` capability list) and strict byte/char ceilings |
| **Permissive Reference Baselines** | `EternalNight996/memory-eternal` | `MIT` | Adopted candidate-proposal vs human-approved main store separation and multi-client stdio MCP + CLI alignment |
| **Permissive Reference Baselines** | `vshulcz/deja-vu` | `MIT` | Confirmed cross-agent boundary discipline (strict subagent/internal session filtering, non-blocking hooks) |

## 2. Unique Architecture Differentiators

1. **Cross-Agent Handoff Bus (`handoffs/YYYY-MM-DD.jsonl`)**: Captures significant work handoffs across Antigravity, Claude Code, Codex, and DeepSeek Harness into a single open local stream.
2. **4KB Verbatim-Verified Living Memory (`living-memory.json` + `LIVING-MEMORY.md`)**: Enforces deterministic `quotedIn()` substring verification against original evidence (blocking fabricated LLM preferences), and runs active `focus` metabolism so superseded tasks are replaced instead of lingering forever.
3. **Zero-Vector, Zero-Docker Retrieval & Flashback**: Uses bilingual Han-bigram + RRF ranking (`hybrid-search.mjs`) and 1-hop decaying associative recall (`flashback.mjs`) over an ID-locked Markdown Entity Wiki (`entity-wiki.mjs`).
4. **Zero KV-Cache Tax**: Never mutates `systemPrompt` dynamically; injects bounded `<dot_memory_context>` as user-turn context only when the session starts, compacts, or memory hash changes.
