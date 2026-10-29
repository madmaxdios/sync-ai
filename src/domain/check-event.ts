/** The moment `check` runs in, as reported by the agent's hook. */
export enum CheckEvent {
  /** A chat starts, resumes or is cleared. The only moment where files may be pulled. */
  SessionStart = 'SessionStart',
  /** The user sent a prompt: only inform. */
  UserPromptSubmit = 'UserPromptSubmit',
  /** Any other event, or a manual run: only inform. */
  Other = 'Other',
}
