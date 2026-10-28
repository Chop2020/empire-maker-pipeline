// Image models. FLUX.2 [pro] (Black Forest Labs) is the default; `mock` draws labelled placeholders for offline tests.
// FLUX flow: POST the request → poll the returned polling_url → download result.sample (a signed URL valid ~10 min).
import { config } from '../../config.js';

export interface GenerateInput {
  prompt: string;
  width: number; // multiples of 32
  height: number;
  seed?: number | null;
  label?: string; // mock only
}

export interface GenerateResult {
  data: Buffer; // JPEG
  seed: number | null;
  costUsd: number | null;
  model: string;
}

export interface ImageProvider {
  name: string;
  model: string;
  generate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult>;
}

/** Rough price per image (USD) before a run. FLUX.2 [pro] bills by megapixel: ~$0.03 for the first MP, less for each extra. */
export function estimateUsd(width: number, height: number) {
  const mp = (width * height) / 1e6;
  return 0.03 + 0.015 * Math.max(0, mp - 1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fluxProvider(apiKey = config.bflApiKey, model = config.imageModel): ImageProvider {
  if (!apiKey) throw new Error('BFL_API_KEY is not set — add your Black Forest Labs API key in Replit Secrets to generate images.');
  const base = process.env.BFL_API_BASE ?? 'https://api.bfl.ai/v1'; // global endpoint; api.eu.bfl.ai / api.us.bfl.ai for regional
  const headers = { accept: 'application/json', 'content-type': 'application/json', 'x-key': apiKey };

  return {
    name: 'flux',
    model,
    async generate(input) {
      const seed = input.seed ?? Math.floor(Math.random() * 2 ** 31);
      type Submit = { id: string; polling_url: string; cost?: number | null };
      let submit = null as Submit | null;
      for (let attempt = 0; attempt < 6 && !submit; attempt++) {
        const res = await fetch(`${base}/${model}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            prompt: input.prompt,
            width: input.width,
            height: input.height,
            seed,
            output_format: 'jpeg',
            disable_pup: true, // the Image Director already wrote a detailed prompt; don't let the model rewrite it
            safety_tolerance: 2,
          }),
        });
        if (res.status === 429) {
          await sleep(3000 * (attempt + 1)); // too many active tasks — wait our turn
          continue;
        }
        if (res.status === 402) throw new Error('Black Forest Labs account is out of credits — add credits at bfl.ai.');
        if (res.status === 401 || res.status === 403) throw new Error('Black Forest Labs rejected the API key — check BFL_API_KEY in Secrets.');
        if (!res.ok) throw new Error(`Image request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
        submit = (await res.json()) as Submit;
      }
      if (!submit) throw new Error('Image service is busy (rate limited) — try again in a minute.');
      const job: Submit = submit;

      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await sleep(1200);
        const res = await fetch(job.polling_url, { headers });
        if (res.status === 429) continue;
        if (!res.ok) throw new Error(`Image status check failed (${res.status})`);
        const s = (await res.json()) as { status: string; result?: { sample?: string }; details?: unknown };
        if (s.status === 'Ready' && s.result?.sample) {
          const img = await fetch(s.result.sample);
          if (!img.ok) throw new Error(`Image download failed (${img.status})`);
          return {
            data: Buffer.from(await img.arrayBuffer()),
            seed,
            costUsd: typeof job.cost === 'number' ? job.cost / 100 : null, // BFL bills in credits; 1 credit = $0.01
            model,
          };
        }
        if (/moderated/i.test(s.status)) throw new Error(`The image service's safety filter blocked this prompt (${s.status}). Edit the prompt and try again.`);
        if (s.status === 'Error' || s.status === 'Failed') throw new Error(`Image generation failed: ${JSON.stringify(s.details ?? s).slice(0, 300)}`);
      }
      throw new Error('Image generation timed out after 5 minutes.');
    },
  };
}

/** Offline placeholder: a warm gradient with the slot title, so layouts can be checked without a key. */
export function mockProvider(): ImageProvider {
  return {
    name: 'mock',
    model: 'mock',
    async generate(input) {
      const { default: sharp } = await import('sharp');
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const w = input.width;
      const h = input.height;
      const fs = Math.round(Math.min(w, h) / 16);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
        <defs><radialGradient id="g" cx="50%" cy="60%" r="75%"><stop offset="0" stop-color="#8a4a2a"/><stop offset=".55" stop-color="#3a2218"/><stop offset="1" stop-color="#120c09"/></radialGradient></defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
        <ellipse cx="${w / 2}" cy="${h * 0.62}" rx="${w * 0.3}" ry="${h * 0.16}" fill="#5b2f1c" opacity=".8"/>
        <text x="50%" y="${h * 0.2}" text-anchor="middle" font-family="sans-serif" font-size="${fs}" font-weight="700" fill="#f3d9b0">PLACEHOLDER</text>
        <text x="50%" y="${h * 0.2 + fs * 1.4}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(fs * 0.6)}" fill="#f3d9b0">${esc((input.label ?? '').slice(0, 60))}</text>
      </svg>`;
      const data = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
      return { data, seed: 0, costUsd: 0, model: 'mock' };
    },
  };
}

export function imageProvider(): ImageProvider {
  return config.imageProvider === 'mock' ? mockProvider() : fluxProvider();
}

export const imagesReady = () => config.imageProvider === 'mock' || Boolean(config.bflApiKey);
