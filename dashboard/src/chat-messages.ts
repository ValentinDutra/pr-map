export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function buildOutgoingMessages(
  conversationHistory: ChatMessage[],
  contextCode: string,
  question: string
): ChatMessage[] {
  if (conversationHistory.length === 0) {
    return [
      {
        role: 'user',
        content: `${contextCode}\n\nAnswer concisely.\nQuestion: ${question}`,
      },
    ];
  }
  return [...conversationHistory, { role: 'user', content: question }];
}
