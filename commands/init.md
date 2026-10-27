---
description: Set up syncing on this machine (create your private data repository with gh, or clone the one you already have)
argument-hint: "[repo-url] [--name <repo>] [--dry-run]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude init:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude pull:*)
---

Run exactly this command with the Bash tool and report its output faithfully, without summarizing away any file name or warning:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude init $ARGUMENTS
```

Rules for the result:

- `init <repo-url>` clones a repository the user already has; it must be PRIVATE.
- `init` without a URL creates a new PRIVATE repository on the user's GitHub account with the GitHub CLI (`gh`), named `sync-ai-data` unless `--name <repo>` is given. Creating a repository on GitHub is an outward-facing action: never run it unless the user explicitly asked you to create one. Do not add `--yes` on your own. Run it without `--yes` first; exit code 3 means it needs confirmation, so tell the user which repository would be created, ask whether to continue, and only if they confirm re-run the same command with `--yes` added after `init`.
- If `<user>/sync-ai-data` (or the `--name` repository) already exists, `init` without a URL does not create anything: it clones that existing PRIVATE repository and installs its files with `pull`. This is the setup for a second device. A public repository is refused. Exit code 3 on the first run means it needs confirmation to clone: tell the user which repository would be cloned, ask, and only if they confirm re-run with `--yes` added after `init`.
- After that clone, `init` can exit with code 3 again if local files differ from the repository. The clone is already done and nothing local was changed. Show the user the list (`~` marks files that would be overwritten), explain which local files differ, ask whether to overwrite them, and only if they confirm run `/sync-ai:pull --yes` (not `init --yes`, which only confirms the clone). Never add `--yes` on your own.
- Exit code 2 from `init` without a URL means `gh` is missing or not logged in. Show the message as it is and let the user choose between installing and logging in with `gh`, or giving you the URL of a private repository.
- If the user wants `init` but gave no URL and did not say to create a repository, ask which of the two they want instead of guessing.
- Any other non-zero exit code is an error: show the message as it is.
