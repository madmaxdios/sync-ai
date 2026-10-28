export const USAGE = `Usage: agent-sync [--agent NAME] [--yes] [--dry-run] <command>

Commands:
  init [url]   Clone your PRIVATE configuration repository; without a URL, use the
               GitHub CLI (gh): create it, or clone it and install its files if it
               already exists (setting up another device)
  pull         Fetch changes from the repository and install the files into the agent
  push         Publish your local configuration (with secret scanning)
  status       Compare your local configuration with the repository, file by file
  resolve      List the conflicts found by pull; resolve <path> settles one of them

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

Exit codes: 0 ok, 1 error, 2 incorrect usage,
            3 confirmation required (repeat with --yes), 4 secrets detected,
            5 conflicts (changed on both sides: see resolve)`;
