// Persona store: built-ins seeded from /personas/*.json, plus personas you create or research.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import type { Persona, PresetTone } from '../shared/types.js';
import { researchPersona, personaFromPresets } from './agents/persona/research.js';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { personas } from './db/schema.js';
import { enqueue, registerHandler } from './jobs.js';
import { anthropicLlm } from './llm.js';
import { HttpError } from './util/http.js';
import { newId } from './util/ids.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function builtInPersonas(): Persona[] {
  const dir = path.join(root, 'personas');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.examples.json'))
    .map((f) => {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Persona;
      const exFile = path.join(dir, f.replace(/\.json$/, '.examples.json'));
      if (fs.existsSync(exFile)) p.examples = (JSON.parse(fs.readFileSync(exFile, 'utf8')) as { examples: Persona['examples'] }).examples;
      return { ...p, builtIn: true };
    });
}

export async function seedPersonas() {
  const db = await getDb();
  for (const p of builtInPersonas()) {
    const [row] = await db.select().from(personas).where(eq(personas.id, p.id));
    if (!row) await db.insert(personas).values({ id: p.id, name: p.name, data: p, builtIn: 'yes' });
    else if (row.builtIn === 'yes') await db.update(personas).set({ name: p.name, data: p, updatedAt: new Date() }).where(eq(personas.id, p.id));
  }
}

export async function listPersonas(): Promise<Persona[]> {
  const db = await getDb();
  const rows = await db.select().from(personas).orderBy(asc(personas.createdAt));
  return rows.map((r) => ({ ...r.data, id: r.id, builtIn: r.builtIn === 'yes' }));
}

export async function getPersona(id: string): Promise<Persona> {
  const db = await getDb();
  const [r] = await db.select().from(personas).where(eq(personas.id, id));
  if (!r) throw new HttpError(404, 'Persona not found');
  return { ...r.data, id: r.id, builtIn: r.builtIn === 'yes' };
}

async function insert(p: Omit<Persona, 'id'>): Promise<Persona> {
  const db = await getDb();
  const id = newId('per');
  const persona: Persona = { ...p, id, builtIn: false };
  await db.insert(personas).values({ id, name: persona.name, data: persona });
  return persona;
}

export async function createFromPresets(body: { name?: string; presets?: PresetTone[]; sliders?: Persona['sliders']; baseId?: string }) {
  const name = body.name?.trim();
  if (!name) throw new HttpError(400, 'Give the persona a name.');
  const sliders = body.sliders ?? { formality: 0.4, humor: 0.3, sentenceLength: 0.5, readingLevel: 8, opinion: 0.5 };
  const base = body.baseId ? await getPersona(body.baseId) : undefined;
  return insert(personaFromPresets(name, body.presets ?? [], sliders, base));
}

export async function updatePersona(id: string, patch: Partial<Persona>) {
  const current = await getPersona(id);
  if (current.builtIn) throw new HttpError(409, 'Built-in personas are read-only — duplicate it to customize.');
  const next: Persona = { ...current, ...patch, id, builtIn: false };
  const db = await getDb();
  await db.update(personas).set({ name: next.name, data: next, updatedAt: new Date() }).where(eq(personas.id, id));
  return next;
}

export async function duplicatePersona(id: string) {
  const p = await getPersona(id);
  const { id: _omit, ...rest } = p;
  void _omit;
  return insert({ ...rest, name: `${p.name} (copy)`, builtIn: false });
}

export async function deletePersona(id: string) {
  const p = await getPersona(id);
  if (p.builtIn) throw new HttpError(409, 'Built-in personas cannot be deleted.');
  const db = await getDb();
  await db.delete(personas).where(eq(personas.id, id));
}

export async function requestResearch(body: { authorName?: string; samples?: string; notes?: string }) {
  if (!body.authorName?.trim() && !body.samples?.trim()) throw new HttpError(400, 'Enter an author/copywriter name, paste writing samples, or both.');
  if (!config.anthropicApiKey) throw new HttpError(409, 'ANTHROPIC_API_KEY is not set — add it in Replit Secrets to use the AI agents.');
  return enqueue(null, 'persona', { authorName: body.authorName?.trim() || undefined, samples: body.samples?.trim() || undefined, notes: body.notes?.trim() || undefined });
}

registerHandler('persona', async (job, progress) => {
  const p = job.payload as { authorName?: string; samples?: string; notes?: string };
  const res = await researchPersona(anthropicLlm(), p, (pct, msg) => progress(pct, msg));
  const saved = await insert(res.persona);
  return { personaId: saved.id, name: saved.name, sources: res.sources.slice(0, 15), usage: res.usage };
});
