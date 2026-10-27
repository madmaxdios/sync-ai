---
description: Sync your skills, commands, agents and global instructions with your private git repository
argument-hint: "[init [repo-url] [--name <repo>]|pull|push|status]"
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
- `init <repo-url>` clones a repository the user already has; it must be PRIVATE.
- `init` without a URL creates a new PRIVATE repository on the user's GitHub account with the GitHub CLI (`gh`), named `sync-ai-data` unless `--name <repo>` is given. Creating a repository on GitHub is an outward-facing action: never run it unless the user explicitly asked you to create one. Do not add `--yes` on your own. Run it without `--yes` first; exit code 3 means it needs confirmation, so tell the user which repository would be created, ask whether to continue, and only if they confirm re-run the same command with `--yes` added.
- Exit code 2 from `init` without a URL means `gh` is missing or not logged in. Show the message as it is and let the user choose between installing and logging in with `gh`, or giving you the URL of a private repository.
- If the user wants `init` but gave no URL and did not say to create a repository, ask which of the two they want instead of guessing.
