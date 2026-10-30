import { describe, expect, it } from 'vitest';
import { formatTree, repositoryLabel } from '../../src/domain/status-report';

describe('status report formatting', () => {
  it('renders a nested tree for synced paths', () => {
    expect(formatTree(['skills/git/SKILL.md', 'commands/deploy.md', 'AGENTS.md'])).toEqual([
      '|--- AGENTS.md',
      '|--- commands/',
      '|    |--- deploy.md',
      '|--- skills/',
      '|    |--- git/',
      '|    |    |--- SKILL.md',
    ]);
  });

  it.each([
    ['https://github.com/userGithub/sync-ai-data.git', 'userGithub/sync-ai-data'],
    ['git@github.com:userGithub/sync-ai-data.git', 'userGithub/sync-ai-data'],
  ])('shortens GitHub remote %s', (remote, expected) => {
    expect(repositoryLabel(remote)).toBe(expected);
  });
});
