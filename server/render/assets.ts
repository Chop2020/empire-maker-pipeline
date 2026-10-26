// Fonts and brand images, inlined as data URIs so rendering never depends on the network.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const cache = new Map<string, string>();
const dataUri = (file: string, mime: string) => {
  const hit = cache.get(file);
  if (hit) return hit;
  const uri = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  cache.set(file, uri);
  return uri;
};

const fontFile = (pkg: string, file: string) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'files', file);

const FACES: { family: string; pkg: string; prefix: string; weights: number[]; italic?: number[] }[] = [
  { family: 'Montserrat', pkg: '@fontsource/montserrat', prefix: 'montserrat', weights: [400, 500, 600, 700, 800] },
  { family: 'Source Serif 4', pkg: '@fontsource/source-serif-4', prefix: 'source-serif-4', weights: [400, 600, 700], italic: [400, 600] },
  { family: 'Inter', pkg: '@fontsource/inter', prefix: 'inter', weights: [400, 500, 600, 700] },
];

let fontCss: string | null = null;
export function fontFaceCss(): string {
  if (fontCss) return fontCss;
  const rules: string[] = [];
  for (const f of FACES) {
    for (const w of f.weights) {
      const src = dataUri(fontFile(f.pkg, `${f.prefix}-latin-${w}-normal.woff2`), 'font/woff2');
      rules.push(`@font-face{font-family:'${f.family}';font-style:normal;font-weight:${w};src:url(${src}) format('woff2');}`);
    }
    for (const w of f.italic ?? []) {
      const src = dataUri(fontFile(f.pkg, `${f.prefix}-latin-${w}-italic.woff2`), 'font/woff2');
      rules.push(`@font-face{font-family:'${f.family}';font-style:italic;font-weight:${w};src:url(${src}) format('woff2');}`);
    }
  }
  fontCss = rules.join('\n');
  return fontCss;
}

const asset = (name: string) => dataUri(path.join(here, 'assets', name), 'image/png');

export const brandImages = {
  markWhite: () => asset('em-mark-white.png'),
  wordmarkWhite: () => asset('em-wordmark-white.png'),
  markDark: () => asset('em-mark-dark.png'),
  wordmarkDark: () => asset('em-wordmark-dark.png'),
};
