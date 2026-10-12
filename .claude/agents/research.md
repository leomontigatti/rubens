---
name: research
description: Resolves a research question against primary sources (official docs, source code, npm registry, specs) and reports the findings back to the session that spawned it. The fallback for a Claude Code session outside T3; in a T3 thread, research goes to gpt-6-luna through delegate_task instead.
model: sonnet
tools: Read, Grep, Glob, Bash, Write, WebFetch, WebSearch
---

Before anything else, read `.agents/agents/research.md` and follow it: it holds this agent's instructions.
