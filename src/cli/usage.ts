export const USAGE = `Usage: agent-sync [--agent NAME] [--yes] [--dry-run] <command>

Commands:
  init [url]   Clone your PRIVATE configuration repository; without a URL, create
               one with the GitHub CLI (gh) and clone it
  pull         Fetch changes from the repository and install the files into the agent
  push         Publish your local configuration (with secret scanning)
  status       Compare your local configuration with the repository

Options:
  --agent NAME    Agent to sync (default: claude)
  --name REPO     Name of the private repository init creates (default: sync-ai-data)
  --yes, -y       Confirm overwrites and repository creation without asking
                  (required without a terminal)
  --dry-run       Do not modify your local configuration, create commits or publish

Exit codes: 0 ok, 1 error, 2 incorrect usage,
            3 confirmation required (repeat with --yes), 4 secrets detected`;
