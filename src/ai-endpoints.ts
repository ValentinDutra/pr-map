import { Router, type Request, type Response } from 'express';
import type { LocalChat } from './llama-runner.js';
import type { LlmErrorCode } from './llm-provider.js';
import { isOk } from './result.js';

export interface AiRouterDeps {
  localChat: LocalChat;
}

export function statusForAskError(code: LlmErrorCode): number {
  return code === 'llama_not_found' ? 503 : 502;
}

type AsyncHandler = (request: Request, response: Response) => Promise<void>;

function wrap(handler: AsyncHandler) {
  return (request: Request, response: Response): void => {
    handler(request, response).catch((error: unknown) => {
      if (!response.headersSent) {
        response.status(500).json({ error: (error as Error).message });
      }
    });
  };
}

export function createAiRouter(deps: AiRouterDeps): Router {
  const router = Router();

  router.get(
    '/models',
    wrap(async (_request, response) => {
      const result = await deps.localChat.listModels();
      if (isOk(result)) {
        response.json({ models: result.value });
      } else {
        response.status(500).json({ error: result.error.message });
      }
    }),
  );

  router.get(
    '/health',
    wrap(async (_request, response) => {
      response.json({ ready: deps.localChat.isReady() });
    }),
  );

  router.post(
    '/warm',
    wrap(async (request, response) => {
      const { model } = request.body as { model?: unknown };
      if (typeof model !== 'string') {
        response.status(400).json({ error: 'model (string) is required' });
        return;
      }
      const result = await deps.localChat.prewarm(model);
      response.json({ ready: isOk(result) });
    }),
  );

  router.post(
    '/ask',
    wrap(async (request, response) => {
      const { model, messages } = request.body as { model?: unknown; messages?: unknown };
      if (typeof model !== 'string' || !Array.isArray(messages)) {
        response.status(400).json({ error: 'model (string) and messages (array) are required' });
        return;
      }
      const result = await deps.localChat.ask({ model, messages });
      if (isOk(result)) {
        response.json({ reply: result.value });
      } else {
        response
          .status(statusForAskError(result.error.code))
          .json({ error: result.error.message, code: result.error.code });
      }
    }),
  );

  return router;
}
