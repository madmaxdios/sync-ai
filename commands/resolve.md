---
description: List and settle the files that changed on both sides (keep local, take the repository version, auto-merge or open a merge editor)
argument-hint: "[<path> --take-local | --take-repo | --auto | --editor]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude resolve:*)
---

Run exactly this command with the Bash tool and report its output faithfully, without summarizing away any file name or warning:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/agent-sync.mjs" --agent claude resolve $ARGUMENTS
```

Rules for the result:

- Without arguments it lists the conflicts recorded by the last `/sync-ai:pull`, and where the comparison copies (`.local`, `.repo`, `.base`) are. Those copies live in the tool's own folder, never next to your files.
- To settle a file the user must pick a strategy for that file. Explain the options and ask, one file at a time. NEVER choose for the user and NEVER add `--take-local`, `--take-repo`, `--auto`, `--editor` or `--yes` on your own:
  - `--take-local`: keep the local file; the next `/sync-ai:push` publishes it.
  - `--take-repo`: replace the local file with the repository version (a `.backup-*` copy is kept).
  - `--auto`: merge both versions with `git merge-file`. It only works when the edits do not overlap; exit code 5 means it still conflicts and nothing was changed.
  - `--editor`: open a three-way merge editor (VS Code's `code --merge`, or vimdiff in a terminal). This blocks until the editor closes and needs a screen, so suggest that the user runs it in their own terminal instead of through you, and offer the exact command. Without a terminal it exits with code 3 after the editor closes: the edits are already in the file, and the user finishes with `resolve <path> --take-local`. If no editor can be started, show the manual commands it prints.
- After settling, remind the user to run `/sync-ai:push` when the local version should be published.
- Exit code 1 with "is not an unresolved conflict" means the path is wrong: run it without arguments to list the valid paths.
- Any other non-zero exit code is an error: show the message as it is.
