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

- `pull` compares three versions of every file: yours, the repository's and the one that was last in sync. Files changed only in the repository are installed without asking; files changed only on this machine are left alone (they wait for `/sync-ai:push`).
- Exit code 5 means some files changed on BOTH sides (conflicts, marked with `!`). Your local files were NOT modified. List the files for the user and explain the options: `/sync-ai:resolve` to review and settle them one by one (keep local, take the repository version, auto-merge, or open a three-way merge editor), or `/sync-ai:pull --yes` to take the repository version of ALL of them (a `.backup-*` copy of each local file is kept). Never choose for the user and never add `--yes` on your own.
- If it fails because no repository is initialized on this machine, show the message as it is and tell the user to run `/sync-ai:init`.
- Any other non-zero exit code is an error: show the message as it is.
