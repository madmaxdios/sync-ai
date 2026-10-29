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

    expect(scanText(content)).toEqual([{ category: 'password', label: 'password assignment', lines: [2, 4] }]);
  });

  it('never exposes the matched content', () => {
    const findings = scanText('password=hunter2secret');

    expect(JSON.stringify(findings)).not.toContain('hunter2secret');
  });
});

describe('scanText categories', () => {
  const categoryOf = (line: string, options = {}): string[] => scanText(line, options).map((finding) => finding.category);

  it.each([
    ['a secret token', join('gh', 'p_', 'a'.repeat(36)), 'secret'],
    ['an authorization header', 'Authorization: Bearer abcdef123456', 'secret'],
    ['a password', 'password = "hunter2secret"', 'password'],
    ['credentials in a URL', 'postgres://admin:hunter2secret@db.internal/app', 'password'],
    ['an email address', 'contact: jane.doe@corp-mail.io', 'user-or-personal-data'],
    ['a home directory', 'cd /home/janedoe/projects', 'user-or-personal-data'],
    ['a Windows home directory', 'C:\\Users\\janedoe\\bin', 'user-or-personal-data'],
    ['a user name assignment', 'username: janedoe', 'user-or-personal-data'],
  ])('classifies %s', (_name, line, category) => {
    expect(categoryOf(line)).toContain(category);
  });

  it.each([
    'contact: you@example.com',
    'Co-authored by noreply@anthropic.com',
    'cd /home/user/project',
    'cd ~/projects',
    'cd $HOME/projects',
    'username: root',
    'user: User',
    'postgres://user:password@localhost/db',
    'Authorization: Bearer $TOKEN',
    'logo@2x.png',
  ])('lets the placeholder %j through', (line) => {
    expect(scanText(line)).toEqual([]);
  });

  it('flags the OS user name of the device but not short or common ones', () => {
    expect(categoryOf('my login is janedoe here', { username: 'janedoe' })).toEqual(['user-or-personal-data']);
    expect(scanText('my login is janedoe here', { username: undefined })).toEqual([]);
    expect(scanText('use root for this', { username: 'root' })).toEqual([]);
    expect(scanText('abc is short', { username: 'abc' })).toEqual([]);
  });

  it('flags personal words as whole words only, ignoring case', () => {
    const words = ['Acme'];
    expect(categoryOf('works at ACME corp', { words })).toEqual(['user-or-personal-data']);
    expect(scanText('acmeish things', { words })).toEqual([]);
  });

  it('skips a line carrying the allow marker', () => {
    expect(scanText('password = "hunter2secret" # sync-ai:allow')).toEqual([]);
    expect(scanText('<!-- sync-ai:allow --> jane.doe@corp-mail.io')).toEqual([]);
  });
});
