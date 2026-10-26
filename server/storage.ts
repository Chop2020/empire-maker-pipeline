// File storage: local disk by default; Replit Object Storage when STORAGE=replit
// (needed for deployments — the deployed filesystem is not persistent).
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export interface Storage {
  put(key: string, data: Buffer | Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private p(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return full;
  }
  async put(key: string, data: Buffer | Uint8Array) {
    const f = this.p(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data);
  }
  async get(key: string) {
    return fs.readFile(this.p(key));
  }
  async exists(key: string) {
    return fs.access(this.p(key)).then(
      () => true,
      () => false,
    );
  }
}

type ReplitClient = {
  uploadFromBytes(key: string, data: Buffer): Promise<{ ok: boolean; error?: unknown }>;
  downloadAsBytes(key: string): Promise<{ ok: boolean; value: [Buffer]; error?: unknown }>;
  exists(key: string): Promise<{ ok: boolean; value: boolean }>;
};

class ReplitStorage implements Storage {
  private client: Promise<ReplitClient>;
  constructor() {
    const mod = '@replit/object-storage';
    this.client = import(mod).then((m: { Client: new () => ReplitClient }) => new m.Client());
  }
  async put(key: string, data: Buffer | Uint8Array) {
    const r = await (await this.client).uploadFromBytes(key, Buffer.from(data));
    if (!r.ok) throw new Error(`Object storage upload failed: ${String(r.error)}`);
  }
  async get(key: string) {
    const r = await (await this.client).downloadAsBytes(key);
    if (!r.ok) throw new Error(`Object storage download failed: ${String(r.error)}`);
    return r.value[0];
  }
  async exists(key: string) {
    const r = await (await this.client).exists(key);
    return r.ok && r.value;
  }
}

export const storage: Storage =
  config.storage === 'replit' ? new ReplitStorage() : new LocalStorage(path.join(config.dataDir, 'files'));
