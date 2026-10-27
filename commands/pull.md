---
description: Download your configuration from your private sync repository and install it into ~/.claude
argument-hint: "[--dry-run]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude pull:*)
---

Run exactly this command with the Bash tool and report its output faithfully, without summarizing away any file name or warning:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude pull $ARGUMENTS
```

Rules for the result:

- Exit code 3 means `pull` found local files that differ from the repository and needs confirmation. Show the user the list (`~` marks files that would be overwritten, `+` new files), ask whether to continue, and only if they confirm re-run the same command with `--yes` added after `pull`. Never add `--yes` on your own. Overwritten files are kept as `.backup-*` copies.
- If it fails because no repository is initialized on this machine, show the message as it is and tell the user to run `/sync-ai:init`.
- Any other non-zero exit code is an error: show the message as it is.
