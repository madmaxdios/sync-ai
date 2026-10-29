export const USAGE = `Usage: agent-sync [--agent NAME] [--yes] [--dry-run] <command>

Commands:
  init [url]   Clone your PRIVATE configuration repository; without a URL, use the
               GitHub CLI (gh): create it, or clone it and install its files if it
               already exists (setting up another device)
  pull         Fetch changes from the repository and install the files into the agent
  push         Publish your local configuration (with a strict scan for secrets, passwords
               and personal data). Only items you listed are published: CLAUDE.md always,
               and the skills, commands and agents you added (or that the repository has)
  status       Compare your local configuration with the repository, file by file; items
               that are not synced are counted on one line (--all lists them)
  add <kind> <name>     List a skill, command or agent so it is synced (kind: skill, command, agent)
  remove <kind> <name>  Stop syncing it here; your files and the repository copy stay untouched
  resolve      List the conflicts found by pull; resolve <path> settles one of them
  check        Tell whether this device is out of sync (used by the agent's hooks); at the
               start of a chat it also pulls what is safe to pull, and it pushes your listed
               changes once they have been quiet for 5 minutes (never deletions, never when
               the scan finds anything). Never asks

Options:
  --agent NAME    Agent to sync (default: claude)
  --name REPO     Name of the private repository init creates (default: sync-ai-data)
  --yes, -y       Confirm repository creation, cloning, taking the repository version
                  for conflicts in pull, and resolve --editor results without asking
                  (required without a terminal)
  --dry-run       Do not modify your local configuration, create commits or publish
  --take-local    resolve: keep your local file (the next push publishes it)
  --take-repo     resolve: replace your file with the repository version (backup kept)
  --auto          resolve: merge both versions with git merge-file when they do not overlap
  --editor [E]    resolve: open a three-way editor (E: auto, code or vimdiff)
  --hook          check: read the agent's hook JSON from stdin and answer with hook JSON
  --quiet         check: print nothing when everything is in sync
  --all           status: also list the items that are not synced

Exit codes: 0 ok, 1 error, 2 incorrect usage,
            3 confirmation required (repeat with --yes), 4 secrets, passwords or personal data detected,
            5 conflicts (changed on both sides: see resolve)`;
