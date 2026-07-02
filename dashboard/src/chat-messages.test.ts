import { describe, it, expect } from 'vitest';
import { buildOutgoingMessages, type ChatMessage } from './chat-messages';

describe('buildOutgoingMessages', () => {
  const contextCode = '> const x = 1;\n  const y = 2;';
  const question = 'What does this do?';

  it('returns one message with contextCode and question when history is empty', () => {
    const result = buildOutgoingMessages([], contextCode, question);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toContain(contextCode);
    expect(result[0].content).toContain(question);
    expect(result[0].content).toBe(
      `${contextCode}\n\nAnswer concisely.\nQuestion: ${question}`
    );
  });

  it('uses the NEW question on retry (empty history, different question)', () => {
    const firstQuestion = 'First question';
    const retryQuestion = 'Different retry question';

    const firstResult = buildOutgoingMessages([], contextCode, firstQuestion);
    expect(firstResult[0].content).toContain(firstQuestion);
    expect(firstResult[0].content).toContain(contextCode);

    const retryResult = buildOutgoingMessages([], contextCode, retryQuestion);
    expect(retryResult[0].content).toContain(retryQuestion);
    expect(retryResult[0].content).toContain(contextCode);
    expect(retryResult[0].content).not.toContain(firstQuestion);
  });

  it('appends question to history without contextCode when history is non-empty', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: `${contextCode}\n\nAnswer concisely.\nQuestion: First` },
      { role: 'assistant', content: 'This sets x to 1.' },
    ];
    const followUp = 'And what about y?';

    const result = buildOutgoingMessages(history, contextCode, followUp);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(history[0]);
    expect(result[1]).toEqual(history[1]);
    expect(result[2]).toEqual({ role: 'user', content: followUp });
    expect(result[2].content).not.toContain(contextCode);
  });
});
