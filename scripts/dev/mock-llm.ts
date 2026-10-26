// Fake LLM for offline tests of the Writer pipeline. See writer-mock.ts.
import { emptyUsage, type Llm } from '../../server/llm.js';

export function mockLlm(examples: { source: { title: string }; rewrite: Record<string, unknown> }[]): Llm {
const seen = new Map<string, number>();
return {
  async json<T>(c: { prompt: string }) {
    const u = { ...emptyUsage(), calls: 1, inputTokens: Math.ceil(c.prompt.length / 4), outputTokens: 400 };
    if (c.prompt.includes('rebrand pack')) {
      return {
        data: {
          titleOptions: [
            { title: 'The Steak Book', subtitle: 'Four hundred ways to cook beef that tastes like beef' },
            { title: 'Hot Pan, Good Beef', subtitle: 'Weeknight steaks, slow braises and the sauces that make them' },
          ],
          backCover: {
            headline: 'Great steak is mostly heat, salt and nerve.',
            blurb: 'Synthetic test blurb from the mock writer. In a real run this is written by the model in the persona voice.',
            bullets: ['Sear like you mean it', 'Braises for the cheap cuts', 'Sauces from scratch', 'Doneness by temperature'],
          },
        } as T,
        usage: u,
      };
    }
    const m = c.prompt.match(/SOURCE RECIPE:\n(.*)$/s);
    if (m) {
      const src = JSON.parse(m[1]) as { title: string; ingredients: string[]; directions: string[] };
      const n = (seen.get(src.title) ?? 0) + 1;
      seen.set(src.title, n);
      const ex = examples.find((e) => e.source.title === src.title);
      if (ex) return { data: { ...ex.rewrite, tips: ex.rewrite.tips ?? [], changeNotes: ['Approved example'] } as T, usage: u };
      if (n === 1) {
        // lazy first attempt: copy the source — the copy check must reject this
        return { data: { title: src.title, headnote: 'A copied attempt.', ingredients: src.ingredients, directions: src.directions, tips: [], changeNotes: ['copied'] } as T, usage: u };
      }
      return {
        data: {
          title: `${src.title} (mock rewrite)`,
          headnote: `Mock headnote for ${src.title}. Real runs write this in the persona voice.`,
          ingredients: src.ingredients,
          directions: src.directions.map((_d, i) => `Synthetic replacement step number ${i + 1} written fresh by the mock model for testing purposes only.`),
          tips: ['Why it works: mock tip.'],
          changeNotes: [`attempt ${n}`],
        } as T,
        usage: u,
      };
    }
    throw new Error('mock: unexpected prompt');
  },
  async research() {
    throw new Error('not used');
  },
} as Llm;
}

