---
description: Start syncing one of your skills, commands or agents (nothing outside CLAUDE.md is synced until you add it)
argument-hint: "<skill|command|agent> <name> [--dry-run]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude add:*)
---

Run exactly this command with the Bash tool and report its output faithfully:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude add $ARGUMENTS
```

Rules for the result:

- Only skills, commands and agents that were added (or that already exist in the repository) are synced. `add` only records the choice on this machine; the files are published by the next `/sync-ai:push` (or by the automatic push of the hook).
- If the user gave no arguments, run `/sync-ai:status --all` first to show what is not synced yet and ask which one to add. Never add anything on your own.
- Exit code 2 means the arguments were wrong (`<skill|command|agent> <name>`): show the usage line as it is.
- Any other non-zero exit code is an error (for example, there is no such item): show the message as it is.
