import { describe, expect, it } from 'vitest';
import { CheckEvent } from '../../src/domain/check-event';
import { formatHookOutput, manualInput, parseHookInput, UNKNOWN_SESSION } from '../../src/domain/hook-input';

describe('parseHookInput', () => {
  it('reads the event and the session of the agent hooks', () => {
    expect(parseHookInput('{"hook_event_name":"SessionStart","session_id":"abc"}')).toEqual({
      event: CheckEvent.SessionStart,
      sessionId: 'abc',
    });
    expect(parseHookInput('{"hook_event_name":"UserPromptSubmit","session_id":"abc","prompt":"hi"}').event).toBe(
      CheckEvent.UserPromptSubmit,
    );
  });

  it('treats other events and a missing session as unknown', () => {
    expect(parseHookInput('{"hook_event_name":"Stop"}')).toEqual({ event: CheckEvent.Other, sessionId: UNKNOWN_SESSION });
  });

  it.each(['', 'not json', '[]', 'null', '{"hook_event_name":42}'])('treats %j as a manual run', (text) => {
    expect(parseHookInput(text)).toEqual(manualInput());
  });
});

describe('formatHookOutput', () => {
  const withAction = { user: 'sync-ai: 1 local change not pushed', claude: 'Offer /sync-ai:push.', signature: 's' };

  it('prints a message for the user and context for the agent', () => {
    const output = JSON.parse(
      formatHookOutput({ event: CheckEvent.UserPromptSubmit, sessionId: 'a' }, withAction),
    ) as Record<string, unknown>;

    expect(output).toEqual({
      systemMessage: 'sync-ai: 1 local change not pushed',
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Offer /sync-ai:push.' },
    });
  });

  it('adds no agent context when nothing is needed or the event is unknown', () => {
    const informative = { ...withAction, claude: undefined };

    expect(JSON.parse(formatHookOutput({ event: CheckEvent.SessionStart, sessionId: 'a' }, informative))).toEqual({
      systemMessage: 'sync-ai: 1 local change not pushed',
    });
    expect(JSON.parse(formatHookOutput(manualInput(), withAction))).toEqual({
      systemMessage: 'sync-ai: 1 local change not pushed',
    });
  });
});
