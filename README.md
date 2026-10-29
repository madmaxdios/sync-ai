# sync-ai

Sync your skills, commands, agents and global instructions across devices
through **your own private git repository**, much like VS Code Settings Sync.
This plugin is public and contains nothing personal: your data lives only in
your repository.

For now there is only an adapter for Claude Code. Codex and OpenCode adapters
are planned: each one only adds its path map in `src/agents/` and its way of
installing its commands.

## Requirements

- Node.js 20 or newer (the core is a single dependency-free JavaScript file:
  `dist/agent-sync.mjs`).
- `git` on the `PATH`.
- Optional: the [GitHub CLI](https://cli.github.com) (`gh`), logged in with
  `gh auth login`, so `init` can create your private repository for you.
- Works on Linux, macOS and Windows.

## Installation

```bash
claude plugin marketplace add madmaxdios/sync-ai
claude plugin install sync-ai@sync-ai
```

Then, inside Claude Code, run `/reload-plugins` or start a new session.

## Usage

Plugin commands are prefixed with the plugin name, and there is one command per
action:

| Command | What it does |
| --- | --- |
| `/sync-ai:init` | With `gh`: creates a **private** GitHub repository (`sync-ai-data`) and clones it into `~/.local/share/agent-sync/repo`, or clones and installs it if it already exists (second device) |
| `/sync-ai:init <url>` | Clones a **private** repository you already have |
| `/sync-ai:add <skill\|command\|agent> <name>` | Starts syncing one of your skills, commands or agents (see [What is synced](#what-is-synced)) |
| `/sync-ai:remove <skill\|command\|agent> <name>` | Stops syncing it on this machine; nothing is deleted |
| `/sync-ai:push` | Scans for secrets, passwords and personal data, copies the listed files, commits and pushes |
| `/sync-ai:pull` | Fetches changes (`git pull --ff-only`) and installs the files changed in the repository into `~/.claude`; files changed on both sides become [conflicts](#conflicts) |
| `/sync-ai:status` | Shows, file by file, what is waiting to be pushed or pulled and which files are in conflict. `status --all` also lists the items that are not synced. A hook runs the same comparison on its own, see [Staying in sync automatically](#staying-in-sync-automatically) |
| `/sync-ai:resolve` | Lists the conflicts, or settles one: `resolve <path> --take-local \| --take-repo \| --auto \| --editor` |

## Updating

Claude Code does not update third-party marketplaces automatically unless you
turn it on. Updates only arrive when a new version of the plugin is released, and
a restart of Claude Code is needed to apply them.

**Automatic (recommended).** In Claude Code open `/plugin`, go to **Marketplaces**,
select `sync-ai` and choose **Enable auto-update**. From then on the catalog and
the plugin are refreshed in the background.

**Manual.** Two levels are involved: the marketplace catalog (the list of
available versions) and the installed plugin. Refresh the catalog first, then
update the plugin:

```bash
claude plugin marketplace update sync-ai && claude plugin update sync-ai@sync-ai
```

## Staying in sync automatically

The plugin registers two hooks (`hooks/hooks.json`) that run `agent-sync check --hook`:

| When | What `check` does |
| --- | --- |
| A chat starts, resumes or is cleared (`SessionStart`) | Always asks the remote whether it has new commits. If the repository has changes this device does not have, it **pulls them**, but only when this device has a sync baseline (`state.json`) and there are no conflicts. Then it tells you what it did |
| You send a prompt (`UserPromptSubmit`) | Compares your local files with the last sync (offline and instant). It contacts the remote **at most every 10 minutes**. It never pulls; it may [push automatically](#automatic-push) |

What you see, as one short line in the chat:

- `sync-ai: pulled 2 files from the repository`: done automatically at the start of a chat, with the usual `.backup-*` copies.
- `sync-ai: pushed 2 files (commit abc1234)`: the [automatic push](#automatic-push) published your quiet, clean changes.
- `sync-ai: 3 local changes not pushed (run /sync-ai:push)`: shown when the automatic push is off or cannot run (conflicts, the repository has news). Claude also gets a short note and will offer the push, never pushing without your confirmation.
- `sync-ai: 1 deletion pending, run /sync-ai:push to confirm`: deletions are never automatic.
- `sync-ai: auto-push skipped, 1 file contains possible secrets or personal data (commands/x.md:3); fix them or review with /sync-ai:push`: only the places are named, never the content. Items that are not on your list are never mentioned in these messages.
- `sync-ai: the repository has 1 file change (1 newer commit) (run /sync-ai:pull)`: shown when a prompt is sent, because files are only pulled when a chat starts.
- `sync-ai: 1 conflict, run /sync-ai:resolve`: nothing is overwritten.
- `sync-ai: this device has no sync baseline yet ...`: once per chat. Without `state.json` the tool cannot tell "I deleted this on purpose" from "this is new", so it never pulls on its own. Run `/sync-ai:status` and a first `pull` or `push` to create it.

When everything is in sync it prints nothing and costs no tokens. The same message is not repeated on every prompt: it is announced again only when the situation changes, after 30 minutes, or in another chat.

`check` never blocks and never asks questions: it always exits 0, stays silent when it is offline or the data repository does not exist, and keeps its network work inside about 4 seconds (`git ls-remote` first, a quiet `git fetch` only when the remote moved).

| Variable | Effect |
| --- | --- |
| `AGENT_SYNC_CHECK=0` | Turns the check off completely |
| `AGENT_SYNC_CHECK_INTERVAL_MINUTES` | Minutes between remote checks while you type prompts (default 10; `0` checks on every prompt) |
| `AGENT_SYNC_AUTO_PUSH=0` | Turns the automatic push off (the hook only informs) |
| `AGENT_SYNC_AUTO_PUSH_QUIET_MINUTES` | Minutes a file must stay unedited before it is pushed (default 5) |
| `AGENT_SYNC_AUTO_PUSH_MAX_FILES` | Most files one automatic push may publish (default 20) |

Run it by hand with `agent-sync --agent claude check` (it also prints `sync-ai: in sync.` unless you add `--quiet`), or with `--dry-run` to see what it would do. The throttle and the repeated-message memory live in `check-cache.json` in the data directory, next to `state.json`.

To turn the hooks off without uninstalling the plugin, set `AGENT_SYNC_CHECK=0` in the `env` block of your `settings.json`.

### Automatic push

`check` publishes your changes by itself, but only when **all** of this holds:

- the change is in an item on your list (see [What is synced](#what-is-synced)) or is `CLAUDE.md`;
- every changed file has been unedited for at least 5 minutes;
- at most 20 files changed (more than that is left for `/sync-ai:push`);
- the [scan](#security) finds nothing in any of them (one finding blocks the whole push, which is reported once);
- there are no conflicts and the repository has nothing newer than this device (it pulls first, at the start of a chat);
- this device has a sync baseline.

It **never deletes** anything: deleted files are reported as pending and need `/sync-ai:push` and your confirmation. If the push fails (offline, rejected) it stays silent and tries again after the check interval. `--dry-run` only says what it would push.

## Upgrading from `agent-sync`

Versions up to 0.2.0 shipped the plugin as `agent-sync` with a single
`/agent-sync:sync` command. From 0.3.0 the plugin is called `sync-ai`. Your data
repository and local clone are unchanged, so just swap the plugin:

```bash
claude plugin uninstall agent-sync@sync-ai
claude plugin marketplace update sync-ai
claude plugin install sync-ai@sync-ai
```

Then restart Claude Code.

## First use

1. Install the plugin and run `/sync-ai:init`. With `gh` installed and
   logged in, it asks for confirmation and creates the private repository
   `<your-user>/sync-ai-data` (choose another name with `--name <repo>`), then
   clones it. Without a terminal (for example inside Claude Code) it stops with
   exit code 3 until you repeat it with `--yes`.
2. Run `/sync-ai:push` to upload your configuration.
3. On another device, install the plugin and run `/sync-ai:init`. Because
   `<your-user>/sync-ai-data` already exists, it clones it and installs your
   configuration with `pull`. That is all.

If local files on the new device differ from the repository, `init` still clones
it but changes nothing locally and exits with code 5: this device has no record
of what was last in sync, so every difference counts as a [conflict](#conflicts).
Review them with `/sync-ai:resolve`, or run `/sync-ai:pull --yes` to take the
repository versions (a `.backup-*` copy is kept). `--yes` on `init` only confirms
the clone, never an overwrite.

`init` never overwrites anything on GitHub: it creates the repository only when it
does not exist, and otherwise clones the existing one, but only if GitHub reports
it as private (a public repository is refused; pass another `--name` or an
`init <url>`). After creating a repository it checks that GitHub reports it as
private and aborts if it does not. Over https, the clone is configured to
authenticate through `gh auth git-credential` in its own git config only; your
global git config is not modified and no token is written anywhere. The core also works outside Claude Code:

```bash
node sync/dist/agent-sync.mjs --agent claude status
```

Options: `--yes` confirms repository creation, cloning and taking the repository
version for conflicts, `--take-local`, `--take-repo`, `--auto` and `--editor`
choose how `resolve` settles a file,
`--name <repo>` names the repository `init` creates, and `--dry-run` does not
modify your local configuration, create repositories, create commits or publish. The clone lives by
default in `~/.local/share/agent-sync/repo` (on Windows,
`%LOCALAPPDATA%\agent-sync\repo`); change it with `AGENT_SYNC_HOME`. When
comparing text files, CRLF and LF line-ending differences are ignored.

Inside your repository the files are stored under `claude/<path>`.

## What is synced

Only this allowlist from `~/.claude`:

- `CLAUDE.md`, always.
- Skills, commands and agents **that you add**. Having a file in `skills/`, `commands/` or `agents/` is not enough: nothing is published until you run `/sync-ai:add skill git` (or `command deploy`, `agent reviewer`). An item that already exists in the repository is synced on every device without adding it.

`/sync-ai:remove` stops syncing an item on this machine without deleting any file, here or in the repository. `/sync-ai:status` shows the items that are not synced as one line (`2 items not synced`); `status --all` lists them.

A local item with the same name as a repository item that this device never synced is treated as a **conflict**, never overwritten. The list lives in `state.json`; devices whose state predates the list keep syncing what the repository already has.

## What is never synced

Everything that is not in the list above and, even inside an allowed folder:
`settings.json`, `settings.local.json`, `.credentials.json`, `history.jsonl`,
`projects/`, `sessions/`, `plugins/`, `backups/`, `skills/synced/` (claude.ai
already syncs it), `*.backup-*` copies, `*.bak` and `.git`. Symbolic links are
ignored. The full list is in `src/agents/claude.ts`.

## Conflicts

For every file, `pull` and `push` compare three versions: yours (L), the
repository's (R) and the one that was last in sync on this device (B, the common
ancestor, recorded in `state.json` next to the clone).

| L | R | B | Result |
| --- | --- | --- | --- |
| = R | = L | any | in sync |
| = B | changed | known | `pull` installs R (a `.backup-*` copy is kept) |
| changed | = B | known | waits for `push` |
| changed | changed | known | **conflict** |
| differs | differs | unknown | **conflict** (a device that never synced before has no ancestor) |
| present | missing | = L | removed from the repository: your copy is kept and not re-published |
| present, edited | missing | known | **conflict** (edited here, deleted there) |
| missing | present | = R | you deleted it: it stays deleted and `push` removes it from the repository |
| missing | present, edited | known | **conflict** (deleted here, edited there) |

Most days there are no conflicts: a change made on one device only is applied
or published without any question. A conflict only appears when the same file
changed on both devices.

For a conflict, `pull` leaves your file untouched, exits with code **5** and saves
three copies for comparison in `~/.local/share/agent-sync/conflicts/claude/`:
`<path>.local` (yours), `<path>.repo` (the repository's) and `<path>.base` (the
ancestor). They are deliberately **not** placed next to the originals: in
`~/.claude/commands` or `~/.claude/agents` a stray `foo_new.md` would be loaded by
Claude Code as a command or an agent. `push` refuses to publish (exit 5) while a
conflict is open, so a stale copy can never overwrite newer work.

Settle each conflict with `resolve <path>`:

```text
/sync-ai:resolve                              list the open conflicts
/sync-ai:resolve CLAUDE.md --take-local       keep your file; the next push publishes it
/sync-ai:resolve CLAUDE.md --take-repo        replace your file with the repository's (backup kept)
/sync-ai:resolve CLAUDE.md --auto             merge both with git merge-file (only if the edits do not overlap)
/sync-ai:resolve CLAUDE.md --editor           open a three-way merge editor
/sync-ai:pull --yes                           take the repository version of ALL conflicts (backups kept)
```

`--editor` runs `code --wait --merge <local> <repo> <base> <result>` (VS Code's
three-way merge, with your version, the repository's and the result, which is written
to your real file) and falls back to `vimdiff` in a terminal; choose one with
`--editor=code` or `--editor=vimdiff`. A backup of your file is saved first. When the
editor closes, it asks before marking the conflict as resolved; without a terminal it
exits with code 3 and you finish with `resolve <path> --take-local` (or pass `--yes`).

Limits:

- A merge editor needs a screen: over plain SSH there is no window to open, so use
  `--take-local`, `--take-repo`, `--auto`, or VS Code Remote. `--editor` blocks until
  the editor closes, so run it in your own terminal rather than through Claude.
- There is no line-by-line automatic merge beyond `--auto`: if both sides changed
  the same lines, you choose one side or edit by hand.
- On a device that never synced, every difference is a conflict, because there is no
  recorded ancestor.
- Windows: the editor is started through `cmd.exe` because `code` is `code.cmd`; paths with
  `& | < > ^ % ! "` are refused. This path has not been verified end to end.

`--dry-run` never writes the conflicts folder or the state. `pull` never deletes
local files on its own (only `pull --yes` on a delete-vs-edit conflict does, with a
backup).

## Security

- Use a **private** repository: your skills and instructions may contain
  sensitive information.
- Before every `push` (and every automatic push) the files that would be
  published are scanned in three categories, and the push is cancelled (exit
  code 4) if anything is found. Only `path:line  category (label)` is shown,
  never the content:
  - `secret`: private keys, GitHub, Slack, npm and Google tokens, `sk-` and AWS
    keys, JSON web tokens, `Authorization` headers and `secret`, `token` or
    `api_key` assignments with a real-looking value.
  - `password`: `password`/`passwd`/`pwd` assignments with a real-looking
    value, and credentials inside URLs (`scheme://user:pass@host`).
  - `user-or-personal-data`: email addresses, home directory paths
    (`/home/name`, `C:\Users\name`), the OS user name of this device,
    `username:`/`login:` assignments and the words of `scan-words.txt`.
  Placeholders (`$TOKEN`, `<password>`, `you@example.com`, `/home/user`) are
  ignored. To accept a line on purpose, put `sync-ai:allow` on it. To catch
  your own names, put one word per line in `scan-words.txt` in the data
  directory (`#` starts a comment); they match as whole words, ignoring case.
- The scan is a basic safety net, not a substitute for reviewing what you
  publish. It can produce false positives (for example code samples in
  documentation) and does not detect every kind of secret.
- Only the allowed paths are added to git; `git add .` is never used.

## Development

```bash
cd sync
npm install
npm run tsc:check   # types (strict)
npm run lint        # ESLint + typescript-eslint
npm test            # Vitest
npm run build       # generates dist/agent-sync.mjs
```

The tests use two simulated devices, a local git remote and temporary
directories; they never touch your `~/.claude`.

`dist/agent-sync.mjs` is generated by esbuild from `src/` and includes Zod. It
is **committed on purpose**: Claude Code installs the plugin by cloning the
repository and runs no build step, so the bundle has to be in the repository.
Run `npm run build` and commit `dist/` together with any change to `src/`.
`npm test` fails if `dist/` does not match a fresh build of `src/`.

Structure of `src/`:

- `cli/`: argument parsing (Zod) and command dispatch.
- `commands/`: `init` (including the `gh` flow), `pull`, `push`, `status`, `resolve` and `check` (the hook command, with its remote probe in `check-remote.ts`).
- `domain/`: pure functions (deny list, secret scanner, three-way file classification, and the `check` decision, message, throttle and hook JSON).
- `agents/`: typed configuration for each agent, validated with Zod.
- `infra/`: git (no shell, optional timeout), file system, sync state, `check` cache, conflict copies, time budget and input/output.

## Publishing

This directory is developed inside the private `madmax-config` repository and is
published to `madmaxdios/sync-ai` (public) when you create a tag:

```bash
# 1. Bump the version in package.json and .claude-plugin/plugin.json
# 2. Commit and create the tag with the same number
git tag sync-v0.2.0 && git push origin sync-v0.2.0
```

The `.github/workflows/publish-sync.yml` workflow checks that the tag matches
the versions, runs `tsc:check`, `lint` and `test`, and copies only `sync/` to
the public repository in a single commit tagged `v0.2.0`. It needs the
`SYNC_AI_DEPLOY_KEY` secret: the private key of a deploy key with write access
to `madmaxdios/sync-ai`.
