import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { AICallFn } from '@/lib/generation/pipeline-types';
import { createLogger } from '@/lib/logger';

const log = createLogger('CF-AI');

const CF_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

export function isCloudflareAI(): boolean {
  try {
    const ctx = getCloudflareContext() as any;
    return !!ctx?.env?.AI;
  } catch {
    return false;
  }
}

export const cfAICall: AICallFn = async (systemPrompt, userPrompt, _images) => {
  const { env } = getCloudflareContext() as any;

  log.info(`Calling Workers AI model: ${CF_MODEL}`);
  const response: any = await env.AI.run(CF_MODEL, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 8192,
  });

  log.info('Workers AI raw response keys:', typeof response, Object.keys(response || {}));

  // Workers AI returns { response: "text" } for text generation
  let text: string;
  if (typeof response === 'string') {
    text = response;
  } else if (response?.response != null) {
    // response may be a string or already-parsed JSON (array/object)
    text = typeof response.response === 'string' ? response.response : JSON.stringify(response.response);
  } else if (response?.result?.response != null) {
    text = typeof response.result.response === 'string' ? response.result.response : JSON.stringify(response.result.response);
  } else {
    log.error('Unexpected Workers AI response format:', JSON.stringify(response).slice(0, 500));
    throw new Error(`Workers AI unexpected response: ${JSON.stringify(response).slice(0, 200)}`);
  }

  if (!text) {
    throw new Error('Workers AI returned empty text');
  }

  log.info(`Workers AI returned ${text.length} chars`);
  return text;
};
