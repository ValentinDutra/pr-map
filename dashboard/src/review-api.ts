import type { CommentSide, ReviewEvent, ReviewState } from './types';

async function asJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error((await response.text()) || `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export interface AddCommentInput {
  path: string;
  line?: number;
  side?: CommentSide;
  body: string;
}

export const reviewApi = {
  getPending: () => fetch('/api/review/pending').then((response) => asJson<ReviewState>(response)),

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

  submit: (event: ReviewEvent, body?: string) =>
    fetch('/api/review/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, body }),
    }).then((response) => asJson<{ ok: boolean }>(response)),
};
