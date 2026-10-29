// Helpers that decide whether the value of an assignment is a real value or a placeholder.

const PLACEHOLDER_WORDS = new Set([
  'string', 'number', 'boolean', 'any', 'unknown', 'object', 'null', 'none', 'undefined', 'true',
  'false', 'yes', 'no', 'required', 'optional', 'empty', 'value', 'values', 'text', 'hash', 'key',
  'keys', 'name', 'names', 'user', 'username', 'login', 'password', 'pass', 'passwd', 'pwd', 'secret',
  'token', 'tokens', 'id', 'email', 'env', 'input', 'output',
]);

const PLACEHOLDER_FRAGMENT = /(your|example|sample|placeholder|changeme|change-me|redacted|dummy|fake|replace|todo|tbd|lorem|[-_]here$)/i;

/** Removes surrounding quotes and trailing punctuation that is not part of the value. */
export function cleanValue(raw: string): string {
  return raw.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[;,)}\]]+$/g, '');
}

/** True for values that stand for something else: `<token>`, `$TOKEN`, `${X}`, `xxxx`, `your-password`... */
export function isPlaceholder(value: string): boolean {
  const text = cleanValue(value);
  if (text === '') return true;
  if (/^[<{$%[(*.~]/.test(text)) return true;
  if (/\$\{|\{\{|<[^>]*>|%[A-Za-z_]+%/.test(text)) return true;
  if (/^(.)\1{2,}$/i.test(text)) return true;
  if (PLACEHOLDER_FRAGMENT.test(text)) return true;
  return PLACEHOLDER_WORDS.has(text.toLowerCase());
}

const DOTTED_REFERENCE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/;

/**
 * Decides whether the value of a password-like assignment looks real. A quoted literal counts
 * from four characters. An unquoted word needs six characters and a digit, a symbol or enough
 * length, so type names and prose such as `password: required` do not count.
 */
export function looksLikeRealSecret(raw: string, quoted: boolean): boolean {
  const value = cleanValue(raw);
  if (isPlaceholder(value)) return false;
  if (quoted) return value.length >= 4;
  if (value.length < 6) return false;
  if (value.includes('(') || (DOTTED_REFERENCE.test(value) && !/\d/.test(value))) return false;
  return /\d/.test(value) || /[!@#$%^&*+=/\\|~]/.test(value) || value.length >= 12;
}
