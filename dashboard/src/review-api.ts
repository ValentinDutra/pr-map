import type {
  CommentScope,
  CommentSide,
  ExistingDiscussion,
  ReviewEvent,
  ReviewState,
} from './types';

async function asJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error((await response.text()) || `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export interface AddCommentInput {
  scope: CommentScope;
  path: string;
  line?: number;
  startLine?: number;
  side?: CommentSide;
  startSide?: CommentSide;
  body: string;
}

export const reviewApi = {
  getPending: () => fetch('/api/review/pending').then((response) => asJson<ReviewState>(response)),

  getExisting: () =>
    fetch('/api/existing').then((response) => asJson<ExistingDiscussion>(response)),

  addComment: (input: AddCommentInput) =>
    fetch('/api/review/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((response) => asJson<ReviewState>(response)),

  deleteComment: (id: string) =>
    fetch(`/api/review/comment/${id}`, { method: 'DELETE' }).then((response) =>
      asJson<ReviewState>(response),
    ),

  reply: (commentId: number, body: string) =>
    fetch('/api/review/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentId, body }),
    }).then((response) => asJson<{ ok: boolean }>(response)),

  addConversationComment: (body: string) =>
    fetch('/api/review/conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    }).then((response) => asJson<{ ok: boolean }>(response)),

  setSummary: (body: string) =>
    fetch('/api/review/summary', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    }).then((response) => asJson<ReviewState>(response)),

  submit: (event: ReviewEvent, body?: string) =>
    fetch('/api/review/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, body }),
    }).then((response) => asJson<{ ok: boolean }>(response)),
};
