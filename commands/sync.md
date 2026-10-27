---
description: Sync your skills, commands, agents and global instructions with your private git repository
argument-hint: "[init <repo-url>|pull|push|status]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs":*)
---

Run exactly this command with the Bash tool and report its output faithfully, without summarizing away any file name or warning:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude $ARGUMENTS
```

If `$ARGUMENTS` is empty, run it with `status`.

Rules for the result:

- Exit code 3 means `pull` found local files that differ from the repository and needs confirmation. Show the user the list (`~` marks files that would be overwritten, `+` new files), ask whether to continue, and only if they confirm re-run the same command with `--yes` added. Never add `--yes` on your own.
- Exit code 4 means the secret scan blocked `push`. Show the files and line numbers listed, never try to read or print the matched content, and do not work around the scan.
- Any other non-zero exit code is an error: show the message as it is.
- `init` needs the URL of a PRIVATE repository. If the user did not provide one, ask for it instead of guessing.
