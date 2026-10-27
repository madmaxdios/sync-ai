const AFFIRMATIVE = /^(s|si|sí|y|yes)$/i;

export function isAffirmative(answer: string): boolean {
  return AFFIRMATIVE.test(answer.trim());
}
