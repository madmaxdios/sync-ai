---
name: sync-status
description: Show the sync status and pending Codex changes.
---

Run this command from the folder containing this `SKILL.md`:

```bash
node <this skill folder>/../../../dist/agent-sync.mjs --agent codex status
```

Report the command result faithfully.

Status compares only `~/.codex` with the user's remote `sync-ai-data` repository.
Ignore the current working repository and never treat the local agent-sync clone
as the source of truth. If the remote is unreachable, report that comparison was
skipped; do not report local-clone differences or synchronization success.
