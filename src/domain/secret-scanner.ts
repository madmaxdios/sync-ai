export interface SecretFinding {
  readonly label: string;
  readonly lines: readonly number[];
}

interface SecretPattern {
  readonly label: string;
  readonly pattern: RegExp;
}

// Matched contents are never reported, only the pattern label and line numbers.
const SECRET_PATTERNS: readonly SecretPattern[] = [
  { label: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    label: 'GitHub token',
    pattern: /(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})/,
  },
  { label: 'sk- key', pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { label: 'AWS key', pattern: /(AKIA|ASIA)[0-9A-Z]{16}/ },
  {
    label: 'password assignment',
    pattern: /pass(word|wd)\s*=\s*["']?[^\s"'$<{(]{4,}/i,
  },
  {
    label: 'secret assignment',
    pattern: /(api[_-]?key|secret|token)\s*=\s*["']?[A-Za-z0-9/+_.-]{16,}/i,
  },
];

/** Returns one finding per matching pattern, with 1-based line numbers. */
export function scanText(content: string): SecretFinding[] {
  const textLines = content.split('\n');
  const findings: SecretFinding[] = [];
  for (const { label, pattern } of SECRET_PATTERNS) {
    const lines: number[] = [];
    textLines.forEach((line, index) => {
      if (pattern.test(line)) lines.push(index + 1);
    });
    if (lines.length > 0) findings.push({ label, lines });
  }
  return findings;
}
