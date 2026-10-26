// Thin LLM layer: structured-JSON calls with a cached system prompt, usage accounting,
// and a web-research call. Agents take an `Llm` so tests can inject a fake.
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  calls: number;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, calls: 0 });
export const addUsage = (a: Usage, b: Usage) => {
  a.inputTokens += b.inputTokens;
  a.outputTokens += b.outputTokens;
  a.cacheReadTokens += b.cacheReadTokens;
  a.calls += b.calls;
};

export interface JsonCall {
  model: string;
  system: string; // cached — keep it identical across calls (persona, rules, examples)
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export interface Llm {
  json<T>(call: JsonCall): Promise<{ data: T; usage: Usage }>;
  research(opts: { model: string; system: string; prompt: string; maxSearches?: number; maxTokens?: number }): Promise<{ text: string; sources: string[]; usage: Usage }>;
}

function usageOf(u: Anthropic.Messages.Usage | undefined): Usage {
  return {
    inputTokens: (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0),
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    calls: 1,
  };
}

export function anthropicLlm(apiKey = config.anthropicApiKey): Llm {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — add it in Replit Secrets to use the AI agents.');
  const client = new Anthropic({ apiKey, maxRetries: 4 });

  return {
    async json<T>(c: JsonCall) {
      const res = await client.messages.create({
        model: c.model,
        max_tokens: c.maxTokens ?? 8000,
        system: [{ type: 'text', text: c.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: c.prompt }],
        output_config: { format: { type: 'json_schema', schema: c.schema } },
      });
      if (res.stop_reason === 'max_tokens') throw new Error('Model output hit max_tokens — section too long for one call.');
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      return { data: JSON.parse(text) as T, usage: usageOf(res.usage) };
    },

    async research(o) {
      const usage = emptyUsage();
      const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: o.prompt }];
      const sources = new Set<string>();
      let text = '';
      // Server-side web search may pause long turns; continue up to a few times.
      for (let round = 0; round < 4; round++) {
        const res = await client.messages.create({
          model: o.model,
          max_tokens: o.maxTokens ?? 6000,
          system: o.system,
          messages,
          tools: [{ type: 'web_search_20260318', name: 'web_search', max_uses: o.maxSearches ?? 8 }],
        });
        addUsage(usage, usageOf(res.usage));
        for (const b of res.content) {
          if (b.type === 'text') text += b.text;
          if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
            for (const r of b.content) if ('url' in r && typeof r.url === 'string') sources.add(r.url);
          }
        }
        if (res.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: res.content as Anthropic.Messages.ContentBlockParam[] });
      }
      return { text: text.trim(), sources: [...sources], usage };
    },
  };
}
