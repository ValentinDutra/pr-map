async function asJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error((await response.text()) || `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export interface AiModel {
  id: string;
  name: string;
  path: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const aiApi = {
  listModels: () =>
    fetch('/api/ai/models').then((response) => asJson<{ models: AiModel[] }>(response)),

  ask: (body: { model: string; messages: ChatMessage[] }) =>
    fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((response) => asJson<{ reply: string }>(response)),
};
