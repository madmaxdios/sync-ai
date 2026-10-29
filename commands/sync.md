---
description: Run the safe automatic sync flow
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude sync:*)
---

Run exactly this command with the Bash tool and report its output faithfully:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude sync
```

Do not pass arguments. The flow pulls safe remote changes and publishes eligible local changes; it never overwrites conflicts, publishes deletions, or bypasses the secret scan.
