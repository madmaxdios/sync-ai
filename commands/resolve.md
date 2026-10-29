---
description: List open sync conflicts
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude resolve:*)
---

Run exactly this command with the Bash tool and report its output faithfully:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude resolve
```

This command only lists open conflicts. Do not choose a resolution or overwrite a file automatically.
