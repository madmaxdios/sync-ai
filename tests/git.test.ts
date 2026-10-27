import { describe, expect, it } from 'vitest';
import { Git } from '../src/infra/git';

describe('Git', () => {
  it('disables terminal credential prompts even when the caller env enables them', async () => {
    const git = new Git({ ...process.env, GIT_TERMINAL_PROMPT: '1' });

    const result = await git.run(['-c', 'alias.probe=!printf %s "$GIT_TERMINAL_PROMPT"', 'probe']);

    expect(result.stdout).toBe('0');
  });
});
