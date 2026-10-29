/** A time budget for work that must not keep the user waiting (it uses the real clock). */
export interface Deadline {
  /** Milliseconds left, never negative. */
  remaining(): number;
}

export function startDeadline(budgetMs: number): Deadline {
  const end = Date.now() + budgetMs;
  return { remaining: () => Math.max(0, end - Date.now()) };
}
