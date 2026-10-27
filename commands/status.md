---
description: Show whether your AI agent configuration is ahead of or behind your private sync repository
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude status:*)
---

Run exactly this command with the Bash tool and report its output faithfully, without summarizing away any file name or warning:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude status
```

Rules for the result:

- `status` only reads: it never changes your local files or the repository.
- If it fails because no repository is initialized on this machine, show the message as it is and tell the user to run `/sync-ai:init`.
- Any other non-zero exit code is an error: show the message as it is.
