import { describe, expect, it } from 'vitest';
import { scanText } from '../../src/domain/secret-scanner';

// Samples are assembled at runtime so this file contains no literal secret.
const join = (...parts: string[]): string => parts.join('');

describe('scanText', () => {
  it.each([
    ['private key header', join('-----BEGIN OPENSSH PRIV', 'ATE KEY-----'), 'private key'],
    ['GitHub token', join('gh', 'p_', 'a'.repeat(36)), 'GitHub token'],
    ['GitHub fine-grained token', join('github', '_pat_', 'A1'.repeat(15)), 'GitHub token'],
    ['sk- key', join('s', 'k-', 'x'.repeat(24)), 'sk- key'],
    ['AWS access key', join('AK', 'IA', 'ABCDEFGH12345678'), 'AWS key'],
    ['password assignment', 'DB_PASSWORD = "hunter2secret"', 'password assignment'],
    ['passwd assignment', 'passwd=abcd1234', 'password assignment'],
    ['api key assignment', 'api_key = abcdefghijklmnop1234', 'secret assignment'],
    ['token assignment', "TOKEN='abcdefghijklmnop1234'", 'secret assignment'],
  ])('detects a %s', (_name, line, label) => {
    expect(scanText(line).map((finding) => finding.label)).toContain(label);
  });

  it.each([
    'Use the password field to sign in',
    'password=$DB_PASSWORD',
    'password = ${SECRET_FROM_ENV}',
    'token = short',
    'a normal sentence about skills and commands',
    '',
  ])('ignores %j', (line) => {
    expect(scanText(line)).toEqual([]);
  });

  it('reports every matching line number for a pattern, starting at 1', () => {
    const content = ['clean', 'password=hunter2secret', 'clean', 'pwd and passwd=anothersecret'].join('\n');

    expect(scanText(content)).toEqual([{ label: 'password assignment', lines: [2, 4] }]);
  });

  it('never exposes the matched content', () => {
    const findings = scanText('password=hunter2secret');

    expect(JSON.stringify(findings)).not.toContain('hunter2secret');
  });
});
