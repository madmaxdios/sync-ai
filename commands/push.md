---
description: Upload your skills, commands, agents and CLAUDE.md to your private sync repository (secret scan first)
argument-hint: "[--dry-run]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude push:*)
---

Run exactly this command with the Bash tool and report its output faithfully, without summarizing away any file name or warning:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude push $ARGUMENTS
```

Rules for the result:

- `push` only publishes CLAUDE.md and the skills, commands and agents that were added with `/sync-ai:add` (or that the repository already has); the rest is reported as one line. It never deletes in the repository without asking for confirmation.
- `push` scans the files for secrets, passwords and user or personal data before anything is committed. Exit code 4 means the scan blocked it: show the `path:line  category (label)` entries listed, never try to read or print the matched content, and do not work around the scan.
- Exit code 5 means some files changed on both sides, so publishing would overwrite someone's work. Nothing was published. List the files and suggest `/sync-ai:pull` and then `/sync-ai:resolve`. Do not try to get around it.
- If the push is refused because the repository has newer changes, show the message as it is and suggest `/sync-ai:pull` first. Do not force anything.
- If it fails because no repository is initialized on this machine, show the message as it is and tell the user to run `/sync-ai:init`.
- Any other non-zero exit code is an error: show the message as it is.
