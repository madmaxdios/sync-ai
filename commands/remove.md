---
description: Stop syncing a skill, command or agent on this machine (no files are deleted)
argument-hint: "<skill|command|agent> <name> [--dry-run]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude remove:*)
---

Run exactly this command with the Bash tool and report its output faithfully:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude remove $ARGUMENTS
```

Rules for the result:

- `remove` only stops syncing the item on this machine. Neither your local files nor the copy in the repository are deleted; if the user wants it gone from the repository, tell them to delete it there themselves.
- Never remove anything the user did not ask for by name.
- Exit code 2 means the arguments were wrong (`<skill|command|agent> <name>`): show the usage line as it is.
- Any other non-zero exit code is an error: show the message as it is.
