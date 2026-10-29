---
description: Show, file by file, what is waiting to be pushed or pulled and which files are in conflict
argument-hint: "[--all]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude status:*)
---

Run exactly this command with the Bash tool and report its output faithfully, without summarizing away any file name or warning:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude status $ARGUMENTS
```

Rules for the result:

- `status` only reads: it never changes your local files or the repository.
- Skills, commands and agents that were not added are not synced. By default they appear as one line (`N items not synced`); `--all` lists them. Only list them when the user asks, and offer `/sync-ai:add <skill|command|agent> <name>` for the ones they want.
- A hook runs a lighter version of this comparison at the start of every chat and when prompts are sent. If the user mentions a `sync-ai:` line they saw, this command gives the full detail.
- Files are grouped as "To push" (changed on this machine), "To pull" (changed in the repository) and "CONFLICT" (changed on both sides). If there are conflicts, tell the user to use `/sync-ai:resolve`.
- If it fails because no repository is initialized on this machine, show the message as it is and tell the user to run `/sync-ai:init`.
- Any other non-zero exit code is an error: show the message as it is.
