---
name: sync-sync
description: Run the safe automatic sync flow for Codex.
---

Run exactly this command from the folder containing this `SKILL.md`:

```bash
node <this skill folder>/../../../dist/agent-sync.mjs --agent codex sync
```

Do not add arguments. The flow pulls safe remote changes and publishes eligible local changes; it never overwrites conflicts, publishes deletions, or bypasses the secret scan.
