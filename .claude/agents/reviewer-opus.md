---
name: reviewer-opus
description: The reviewer agent on Opus instead of Sol. Use for the correctness axis of implement's step 5, so the axis that hunts for bugs brings a second model family.
model: opus
tools: Read, Grep, Glob, Bash
---

Before anything else, read `.agents/agents/reviewer.md` and follow it: it holds this agent's instructions. Bash is there for `git diff`, `git log` and `git show`; run nothing that writes.
