import { z } from 'zod';
import type { CheckReport } from './check-decision';
import { CheckEvent } from './check-event';

export interface HookInput {
  readonly event: CheckEvent;
  /** Chat session id, or a fixed placeholder when the agent did not send one. */
  readonly sessionId: string;
}

const hookInputSchema = z.object({
  hook_event_name: z.string().optional(),
  session_id: z.string().optional(),
});

export const UNKNOWN_SESSION = 'unknown';

export function manualInput(): HookInput {
  return { event: CheckEvent.Other, sessionId: UNKNOWN_SESSION };
}

/** Reads the JSON the agent sends to a hook on stdin; anything unreadable counts as another event. */
export function parseHookInput(text: string): HookInput {
  let parsed: z.infer<typeof hookInputSchema>;
  try {
    const result = hookInputSchema.safeParse(JSON.parse(text));
    if (!result.success) return manualInput();
    parsed = result.data;
  } catch {
    return manualInput();
  }
  const sessionId = parsed.session_id ?? UNKNOWN_SESSION;
  if (parsed.hook_event_name === CheckEvent.SessionStart) return { event: CheckEvent.SessionStart, sessionId };
  if (parsed.hook_event_name === CheckEvent.UserPromptSubmit) return { event: CheckEvent.UserPromptSubmit, sessionId };
  return { event: CheckEvent.Other, sessionId };
}

/** The single JSON object printed for a hook: a message for the user and, if needed, context for the agent. */
export function formatHookOutput(input: HookInput, report: CheckReport): string {
  const output: Record<string, unknown> = { systemMessage: report.user };
  if (report.claude !== undefined && input.event !== CheckEvent.Other) {
    output.hookSpecificOutput = { hookEventName: input.event, additionalContext: report.claude };
  }
  return JSON.stringify(output);
}
