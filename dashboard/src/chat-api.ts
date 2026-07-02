export interface AskError extends Error {
  code?: string;
  status?: number;
}

async function asJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: { error?: string; code?: string } = {};
    try {
      body = await response.json();
    } catch {}
    const err = new Error(
      body.error || `Request failed (${response.status})`,
    ) as AskError;
    err.code = body.code;
    err.status = response.status;
    throw err;
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

  health: () =>
    fetch('/api/ai/health').then((response) => asJson<{ ready: boolean }>(response)),

  warm: (body: { model: string }) =>
    fetch('/api/ai/warm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((response) => asJson<{ ready: boolean }>(response)),

  ask: (body: { model: string; messages: ChatMessage[] }) =>
    fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((response) => asJson<{ reply: string }>(response)),
};
