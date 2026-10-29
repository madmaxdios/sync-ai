import { ScanCategory } from './scan-category';
import { cleanValue, isPlaceholder, looksLikeRealSecret } from './scan-values';

export interface ScanOptions {
  /** The OS user name of this device; it must not appear in published files. */
  readonly username?: string | undefined;
  /** Extra personal words (from the user's scan-words file), matched as whole words. */
  readonly words?: readonly string[];
}

export interface ScanRule {
  readonly category: ScanCategory;
  readonly label: string;
  /** True when the line contains something that must not be published. */
  readonly matches: (line: string, options: ScanOptions) => boolean;
}

const pattern = (category: ScanCategory, label: string, regex: RegExp): ScanRule => ({
  category,
  label,
  matches: (line) => regex.test(line),
});

const WORD_EDGE_BEFORE = '(?<![\\p{L}\\p{N}_-])';
const WORD_EDGE_AFTER = '(?![\\p{L}\\p{N}_-])';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive match; `-` and `_` count as part of a word. */
function containsWord(line: string, word: string): boolean {
  return new RegExp(`${WORD_EDGE_BEFORE}${escapeRegExp(word)}${WORD_EDGE_AFTER}`, 'iu').test(line);
}

// --- assignments: password = value, "token": "value", export API_KEY=value, --password=value ---
const ASSIGNMENT =
  /(?:^|[^A-Za-z0-9])((?:[A-Za-z0-9]+[_.-])*(password|passwd|pwd|pass|secret|token|api[_-]?key))["'`]?\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s"'`,;)}\]]+))/gi;

function assignmentMatches(line: string, keywords: RegExp): boolean {
  for (const match of line.matchAll(ASSIGNMENT)) {
    if (!keywords.test(match[2] ?? '')) continue;
    const quoted = match[3] ?? match[4] ?? match[5];
    if (looksLikeRealSecret(quoted ?? match[6] ?? '', quoted !== undefined)) return true;
  }
  return false;
}

// --- authorization headers and URLs with credentials ---
const AUTHORIZATION = /Authorization["']?\s*[:=]\s*["']?(?:Bearer|Basic)\s+([^\s"']+)/i;
const URL_CREDENTIALS = /[a-z][a-z0-9+.-]*:\/\/[^\s/:@"']+:([^\s/@"']+)@/i;

function authorizationMatches(line: string): boolean {
  const value = AUTHORIZATION.exec(line)?.[1];
  return value !== undefined && value.length >= 6 && !isPlaceholder(value);
}

function urlCredentialsMatch(line: string): boolean {
  const value = URL_CREDENTIALS.exec(line)?.[1];
  return value !== undefined && !isPlaceholder(value);
}

// --- personal data ---
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,}))/g;
const PLACEHOLDER_LOCAL_PARTS = new Set(['you', 'user', 'name', 'email', 'me', 'foo', 'bar', 'someone', 'git', 'ssh', 'your-email', 'your.name']);
const FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js', 'ts', 'tsx', 'jsx', 'json', 'md', 'mjs', 'cjs', 'yml', 'yaml']);

function isPlaceholderEmail(address: string, domain: string, tld: string): boolean {
  const local = address.slice(0, address.indexOf('@')).toLowerCase();
  const host = domain.toLowerCase();
  if (PLACEHOLDER_LOCAL_PARTS.has(local) || local.includes('noreply') || local.includes('no-reply')) return true;
  if (/(^|\.)example\.(com|org|net)$/.test(host) || /\.(example|test|invalid|localhost)$/.test(host)) return true;
  return host === 'users.noreply.github.com' || FILE_EXTENSIONS.has(tld.toLowerCase());
}

function emailMatches(line: string): boolean {
  for (const match of line.matchAll(EMAIL)) {
    if (!isPlaceholderEmail(match[0], match[1] ?? '', match[2] ?? '')) return true;
  }
  return false;
}

const HOME_PATH = /(?:\/home\/|\/Users\/|[A-Za-z]:[\\/]+Users[\\/]+)([^\s/\\"'`<>:*;,)|\]]+)/g;
const GENERIC_USERS = new Set([
  'user', 'username', 'you', 'your-user', 'your-username', 'name', 'me', 'runner', 'ubuntu', 'node', 'vscode', 'app',
  'nobody', 'root', 'example', 'foo', 'bar', 'someone', 'public', 'default', 'shared', 'all users',
]);

function homePathMatches(line: string): boolean {
  for (const match of line.matchAll(HOME_PATH)) {
    const user = match[1] ?? '';
    if (/^[$%~{<*.]/.test(user) || GENERIC_USERS.has(user.toLowerCase())) continue;
    return true;
  }
  return false;
}

const COMMON_USER_NAMES = new Set(['root', 'user', 'admin', 'super', 'test', 'node', 'home', 'public', 'default', 'guest', 'shared', 'git', 'docker', 'runner', 'ubuntu', 'app', 'dev']);

function usernameMatches(line: string, options: ScanOptions): boolean {
  const name = options.username?.trim();
  if (name === undefined || name.length < 4 || COMMON_USER_NAMES.has(name.toLowerCase())) return false;
  return containsWord(line, name);
}

const USER_ASSIGNMENT = /^\s*(?:[-*]\s+)?(?:export\s+)?["']?(?:username|user|login)["']?\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s"',;]+))/i;
const GENERIC_ACCOUNTS = new Set(['root', 'admin', 'postgres', 'mysql', 'node', 'ubuntu', 'runner', 'app', 'www-data', 'nobody', 'test', 'guest']);

function userAssignmentMatches(line: string): boolean {
  const match = USER_ASSIGNMENT.exec(line);
  if (!match) return false;
  const quoted = match[1] ?? match[2];
  const value = cleanValue(quoted ?? match[3] ?? '');
  if (value.length < 2 || isPlaceholder(value) || GENERIC_ACCOUNTS.has(value.toLowerCase())) return false;
  // An unquoted capitalised word is a type name (`user: User`), not an account.
  return quoted !== undefined || !/^[A-Z]/.test(value);
}

function personalWordMatches(line: string, options: ScanOptions): boolean {
  return (options.words ?? []).some((word) => word !== '' && containsWord(line, word));
}

/** Matched contents are never reported by the scanner, only the rule's category and label. */
export const SCAN_RULES: readonly ScanRule[] = [
  pattern(ScanCategory.Secret, 'private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/),
  pattern(ScanCategory.Secret, 'GitHub token', /(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})/),
  pattern(ScanCategory.Secret, 'sk- key', /sk-[A-Za-z0-9_-]{20,}/),
  pattern(ScanCategory.Secret, 'AWS key', /(AKIA|ASIA)[0-9A-Z]{16}/),
  pattern(ScanCategory.Secret, 'Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/),
  pattern(ScanCategory.Secret, 'Google API key', /AIza[0-9A-Za-z_-]{35}/),
  pattern(ScanCategory.Secret, 'npm token', /npm_[A-Za-z0-9]{36}/),
  pattern(ScanCategory.Secret, 'JSON web token', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/),
  { category: ScanCategory.Secret, label: 'authorization header', matches: authorizationMatches },
  { category: ScanCategory.Password, label: 'password assignment', matches: (line) => assignmentMatches(line, /^(password|passwd|pwd|pass)$/i) },
  { category: ScanCategory.Secret, label: 'secret assignment', matches: (line) => assignmentMatches(line, /^(secret|token|api[_-]?key)$/i) },
  { category: ScanCategory.Password, label: 'credentials in URL', matches: urlCredentialsMatch },
  { category: ScanCategory.Personal, label: 'email address', matches: emailMatches },
  { category: ScanCategory.Personal, label: 'OS user name', matches: usernameMatches },
  { category: ScanCategory.Personal, label: 'home directory path', matches: homePathMatches },
  { category: ScanCategory.Personal, label: 'user name assignment', matches: userAssignmentMatches },
  { category: ScanCategory.Personal, label: 'personal word', matches: personalWordMatches },
];
