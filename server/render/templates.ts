// HTML templates for the three render passes: front matter, body, back cover.
import type { Block, ProductDocument, PublisherBrand, Section } from '../../shared/types.js';
import { brandImages, fontFaceCss } from './assets.js';
import type { Theme } from './theme.js';

export interface CatalogItem {
  title: string;
  coverBg: string;
  coverAccent: string;
}

export interface RenderCtx {
  productId: string;
  doc: ProductDocument;
  brand: PublisherBrand;
  theme: Theme;
  authorName: string | null;
  authorShortBio: string | null;
  catalog: CatalogItem[];
  qrSvg: string;
  year: number;
}

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const contentSections = (doc: ProductDocument) =>
  doc.deliverables.flatMap((d) => d.sections).filter((s) => s.kind !== 'front' && s.kind !== 'back');

// ---------- shared CSS ----------

function baseCss(t: Theme) {
  const c = t.colors;
  return `
${fontFaceCss()}
:root{--paper:${c.paper};--ink:${c.ink};--muted:${c.muted};--accent:${c.accent};--accent-ink:${c.accentInk};--tint:${c.tint};--tint-alt:${c.tintAlt};--rule:${c.rule};--cover-bg:${c.coverBg};--cover-ink:${c.coverInk};--cover-accent:${c.coverAccent};}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--paper);color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:${t.fonts.body};font-size:${t.trim.w >= 8 ? 10.5 : 10}pt;line-height:1.55;font-kerning:normal;font-variant-ligatures:common-ligatures;hyphens:manual;}
h1,h2,h3{font-family:${t.fonts.display};color:var(--ink);margin:0;line-height:1.2;break-after:avoid;hyphens:none;text-wrap:balance}
.ui{font-family:${t.fonts.ui}}
p{margin:0 0 0.7em;orphans:3;widows:3}
`;
}

// ---------- blocks ----------

const CALLOUT_CLASS: Record<string, string> = {
  tips: 'co-tips',
  prompts: 'co-prompts',
  example: 'co-example',
  sample: 'co-sample',
  note: 'co-note',
  generic: 'co-generic',
};

function blockHtml(b: Block): string {
  switch (b.type) {
    case 'heading': {
      const tag = b.level === 1 ? 'h2' : b.level === 2 ? 'h3' : 'h4';
      return `<${tag} class="bh bh${b.level}">${esc(b.text)}</${tag}>`;
    }
    case 'paragraph':
      return `<p>${esc(b.text)}</p>`;
    case 'quote':
      return `<blockquote>${esc(b.text)}${b.cite ? `<cite>${esc(b.cite)}</cite>` : ''}</blockquote>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag} class="lst">${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</${tag}>`;
    }
    case 'checklist':
      return `<ul class="chk">${b.items.map((i) => `<li><span class="box"></span>${esc(i)}</li>`).join('')}</ul>`;
    case 'callout':
      return `<aside class="callout ${CALLOUT_CLASS[b.variant] ?? 'co-generic'}"><div class="co-label ui">${esc(b.label)}</div>${b.blocks.map(blockHtml).join('')}</aside>`;
    case 'table': {
      const head = b.header ? `<thead><tr>${b.header.map((h) => `<th class="ui">${esc(h)}</th>`).join('')}</tr></thead>` : '';
      const body = b.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 && !b.header ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('');
      return `<table class="tbl${b.header ? '' : ' tbl-kv'}">${head}<tbody>${body}</tbody></table>`;
    }
    case 'fillIn':
      return `<div class="fill"><div class="fill-q">${esc(b.prompt)}</div>${'<div class="fill-line"></div>'.repeat(Math.max(1, b.lines))}</div>`;
    case 'imageSlot':
      return `<div class="img-slot ui">${esc(b.description)}</div>`;
    case 'recipe': {
      const meta = b.meta
        ? [b.meta.servings && `Serves ${b.meta.servings}`, b.meta.prepTime && `Prep ${b.meta.prepTime}`, b.meta.cookTime && `Cook ${b.meta.cookTime}`]
            .filter(Boolean)
            .join(' · ')
        : '';
      const ings = b.ingredients
        .map((i) => (/:$/.test(i.trim()) ? `<li class="ing-group ui">${esc(i.replace(/:$/, ''))}</li>` : `<li>${esc(i)}</li>`))
        .join('');
      return `<div class="recipe-body">
        ${meta ? `<div class="r-meta ui">${esc(meta)}</div>` : ''}
        <div class="r-grid">
          <div class="r-ing"><div class="r-label ui">Ingredients</div><ul>${ings}</ul></div>
          <div class="r-dir"><div class="r-label ui">Directions</div><ol>${b.directions.map((d) => `<li>${esc(d)}</li>`).join('')}</ol></div>
        </div>
      </div>`;
    }
  }
}

// ---------- body ----------

export function bodyHtml(ctx: RenderCtx): string {
  const { theme: t, doc } = ctx;
  const sections = contentSections(doc);
  let chapterNo = 0;
  let partNo = 0;
  const parts = sections
    .map((s) => {
      if (s.kind === 'part') {
        partNo++;
        const [label, ...rest] = s.title.split(' — ');
        const title = rest.length ? rest.join(' — ') : s.title;
        const kicker = rest.length ? label : `Part ${partNo}`;
        return `<section class="part" id="${s.id}">
          <div class="part-inner">
            <div class="part-kicker ui">${esc(kicker)}</div>
            <h1 class="sec-title part-title">${esc(title)}</h1>
            <div class="part-rule"></div>
            ${s.blocks.map(blockHtml).join('')}
          </div>
        </section>`;
      }
      if (s.kind === 'recipe') {
        const r = s.blocks[0];
        const rest = s.blocks.slice(1);
        return `<section class="recipe" id="${s.id}">
          <h1 class="sec-title recipe-title">${esc(s.title)}</h1>
          ${r?.type === 'recipe' ? blockHtml(r) : ''}${rest.map(blockHtml).join('')}
        </section>`;
      }
      chapterNo++;
      return `<section class="chapter" id="${s.id}">
        <div class="ch-kicker ui">Chapter ${chapterNo}</div>
        <h1 class="sec-title ch-title">${esc(s.title)}</h1>
        <div class="ch-rule"></div>
        ${s.blocks.map(blockHtml).join('')}
      </section>`;
    })
    .join('\n');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
${baseCss(t)}
@page{size:${t.trim.w}in ${t.trim.h}in;margin:0.75in ${t.trim.w >= 8 ? 0.8 : 0.68}in 0.85in}
.chapter,.recipe,.part,.closing{break-before:page}
.ch-kicker{font-size:7.5pt;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:6pt}
.ch-title{font-size:${t.trim.w >= 8 ? 24 : 21}pt;font-weight:700;letter-spacing:-.01em}
.ch-rule{width:42pt;height:2.5pt;background:var(--accent);margin:12pt 0 16pt}
.chapter > p:first-of-type{font-size:1.08em;color:var(--ink)}
.part{height:calc(${t.trim.h}in - 1.6in);display:flex;align-items:center}
.part-inner{width:100%}
.part-kicker{font-size:9pt;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:var(--accent-ink)}
.part-title{font-size:${t.trim.w >= 8 ? 36 : 30}pt;font-weight:700;margin-top:10pt;letter-spacing:-.015em}
.part-rule{width:60pt;height:3pt;background:var(--accent);margin:16pt 0}
.part p{font-size:12pt;color:var(--muted);font-style:italic;max-width:85%}
.bh{margin:1.1em 0 .45em}
.bh1{font-size:15pt}.bh2{font-size:13pt}.bh3{font-family:${t.fonts.ui};font-size:9.5pt;font-weight:700;letter-spacing:.02em}
ul.lst,ol.lst{margin:0 0 .8em;padding-left:1.25em}
ul.lst li,ol.lst li{margin:0 0 .3em;padding-left:.15em}
ul.lst li::marker{color:var(--accent)}
ol.lst li::marker{color:var(--accent-ink);font-family:${t.fonts.ui};font-weight:700;font-size:.85em}
.chk{list-style:none;padding:0;margin:0 0 .8em}
.chk li{display:flex;gap:8pt;margin-bottom:.35em}
.chk .box{flex:none;width:9pt;height:9pt;border:1.2pt solid var(--accent-ink);border-radius:2pt;margin-top:3pt}
.callout{border-radius:5pt;padding:10pt 12pt 4pt;margin:12pt 0 14pt;break-inside:avoid;background:var(--tint)}
.callout .lst{margin-bottom:.5em}
.co-label{font-size:7pt;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:6pt}
.co-prompts{background:var(--tint-alt);font-family:${t.fonts.ui};font-size:.86em;line-height:1.5}
.co-prompts li{margin-bottom:.55em}
.co-example{background:none;border:1pt solid var(--rule)}
.co-sample{background:none;border:1pt dashed var(--accent)}
.co-note{background:var(--tint-alt)}
blockquote{margin:1em 0;padding:0 0 0 14pt;border-left:2.5pt solid var(--accent);font-style:italic;color:var(--muted)}
.tbl{width:100%;border-collapse:collapse;margin:10pt 0 14pt;font-size:.9em;break-inside:avoid}
.tbl th,.tbl td{text-align:left;vertical-align:top;padding:6pt 8pt;border-bottom:.75pt solid var(--rule)}
.tbl thead th{font-size:7pt;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--accent-ink);border-bottom:1.5pt solid var(--accent)}
.tbl-kv th[scope=row]{font-family:${t.fonts.ui};font-size:.88em;font-weight:600;width:32%}
.fill{margin:10pt 0}.fill-q{font-weight:600;margin-bottom:6pt}.fill-line{border-bottom:.75pt solid var(--muted);height:20pt}
.img-slot{border:1pt dashed var(--rule);color:var(--muted);font-size:8pt;padding:24pt;text-align:center;margin:12pt 0}
.recipe-title{font-size:${t.trim.w >= 8 ? 24 : 20}pt;font-weight:700;letter-spacing:-.01em;padding-bottom:10pt;border-bottom:2pt solid var(--accent);margin-bottom:6pt}
.r-meta{font-size:8pt;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:6pt 0 0}
.r-grid{display:grid;grid-template-columns:minmax(0,36fr) minmax(0,64fr);gap:18pt;margin-top:14pt}
.r-label{font-size:7.5pt;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:8pt}
.r-ing{background:var(--tint);border-radius:5pt;padding:12pt 12pt 8pt;align-self:start}
.r-ing ul{list-style:none;margin:0;padding:0;font-size:.92em;line-height:1.4}
.r-ing li{padding:0 0 6pt;margin:0 0 6pt;border-bottom:.5pt solid var(--rule)}
.r-ing li:last-child{border-bottom:0}
.r-ing .ing-group{font-size:7pt;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-ink);border-bottom:0;padding-top:4pt}
.r-dir ol{margin:0;padding:0;list-style:none;counter-reset:step}
.r-dir li{counter-increment:step;position:relative;padding-left:26pt;margin-bottom:10pt}
.r-dir li::before{content:counter(step);position:absolute;left:0;top:1pt;width:17pt;height:17pt;border-radius:50%;background:var(--accent);color:#fff;font-family:${t.fonts.ui};font-size:8pt;font-weight:700;display:flex;align-items:center;justify-content:center}
${closingCss(ctx)}
</style></head><body>
${parts}
${closingPages(ctx)}
</body></html>`;
}

// ---------- closing pages: About the publisher + catalog ----------

function closingCss(ctx: RenderCtx) {
  const b = ctx.brand.colors;
  return `
.closing{min-height:calc(${ctx.theme.trim.h}in - 1.6in);display:flex;flex-direction:column}
.about-pub{font-family:${ctx.theme.fonts.ui}}
.about-pub img.mark{width:62pt;display:block;margin-bottom:14pt}
.about-pub h1{font-family:${ctx.theme.fonts.ui};font-size:18pt;font-weight:800;letter-spacing:.02em}
.about-pub .tag{font-size:8pt;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:#7A5C16;margin:8pt 0 18pt}
.about-pub p{font-family:${ctx.theme.fonts.body};font-size:10.5pt}
.cat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14pt;margin-top:16pt}
.cat-cover{aspect-ratio:2/3;border-radius:3pt;padding:10pt;display:flex;flex-direction:column;justify-content:space-between;color:#fff}
.cat-cover .t{font-family:${ctx.theme.fonts.ui};font-size:8.5pt;font-weight:800;text-transform:uppercase;line-height:1.2}
.cat-cover .r{width:24pt;height:2pt}
.cat-cta{margin-top:auto;padding-top:20pt;font-family:${ctx.theme.fonts.ui};font-size:9pt;font-weight:600;color:${b.black}}
.cat-cta span{color:#7A5C16}`;
}

function catalogCovers(items: CatalogItem[], size: 'lg' | 'sm') {
  return items
    .map(
      (c) =>
        size === 'lg'
          ? `<div class="cat-cover" style="background:${c.coverBg}"><div class="t">${esc(c.title)}</div><div class="r" style="background:${c.coverAccent}"></div></div>`
          : `<div class="mini" style="background:${c.coverBg}"><div class="t">${esc(c.title)}</div><div class="r" style="background:${c.coverAccent}"></div></div>`,
    )
    .join('');
}

function closingPages(ctx: RenderCtx) {
  const { brand } = ctx;
  const catalog = ctx.catalog.length
    ? `<div class="cat-grid">${catalogCovers(ctx.catalog.slice(0, 6), 'lg')}</div>`
    : '';
  return `<section class="closing about-pub">
    <img class="mark" src="${brandImages.markDark()}" alt="">
    <h1>About ${esc(brand.name)}</h1>
    <div class="tag">${esc(brand.tagline)}</div>
    <p>${esc(brand.name)} publishes practical, no-filler guides, workbooks and cookbooks built to be used, not just read. Every title is designed to get you from first page to first result.</p>
    ${ctx.catalog.length ? `<h1 style="font-size:12pt;margin-top:18pt">More from ${esc(brand.name)}</h1>${catalog}` : ''}
    <div class="cat-cta">Find the full catalog at <span>${esc(brand.website)}</span></div>
  </section>`;
}

// ---------- front matter: cover, title page, imprint, contents ----------

export interface TocEntry {
  id: string;
  title: string;
  kind: Section['kind'];
  page: number | null;
}

export function tocEntries(doc: ProductDocument): TocEntry[] {
  return contentSections(doc).map((s) => ({ id: s.id, title: s.title, kind: s.kind, page: null }));
}

export function frontHtml(ctx: RenderCtx, toc: TocEntry[]): string {
  const { theme: t, doc, brand } = ctx;
  const author = ctx.authorName ?? '[Pen name]';
  const isCookbook = doc.productType === 'cookbook';
  const tocRows = toc
    .map((e) => {
      const n = e.page ? String(e.page) : '';
      if (e.kind === 'part') {
        const [label, ...rest] = e.title.split(' — ');
        return `<li class="toc-part"><span class="ui">${esc(rest.length ? label : '')}</span> ${esc(rest.length ? rest.join(' — ') : e.title)}<span class="pg">${n}</span></li>`;
      }
      return `<li><span class="tt">${esc(e.title)}</span><span class="dots"></span><span class="pg">${n}</span></li>`;
    })
    .join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
${baseCss(t)}
@page{size:${t.trim.w}in ${t.trim.h}in;margin:0}
.page{width:${t.trim.w}in;height:${t.trim.h}in;position:relative;overflow:hidden;break-after:page}
.cover{background:var(--cover-bg);color:var(--cover-ink);padding:${t.trim.w * 0.11}in ${t.trim.w * 0.1}in;display:flex;flex-direction:column}
.cover .kick{font-family:${t.fonts.ui};font-size:8pt;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:var(--cover-accent)}
.cover h1{color:var(--cover-ink);font-size:${t.trim.w >= 8 ? 46 : 38}pt;font-weight:700;line-height:1.05;letter-spacing:-.02em;margin-top:14pt}
.cover .rule{width:56pt;height:3pt;background:var(--cover-accent);margin:20pt 0}
.cover .sub{text-wrap:balance;font-size:${t.trim.w >= 8 ? 15 : 13}pt;line-height:1.4;opacity:.88;max-width:88%}
.cover .author{margin-top:auto;font-family:${t.fonts.ui};font-size:11pt;font-weight:600;letter-spacing:.14em;text-transform:uppercase}
.cover .pub{display:flex;align-items:center;gap:10pt;margin-top:18pt;padding-top:14pt;border-top:.75pt solid rgba(255,255,255,.18)}
.cover .pub img.m{height:26pt}.cover .pub img.w{height:12pt}
.title-page{padding:1.6in ${t.trim.w * 0.12}in 0.9in;display:flex;flex-direction:column;text-align:center;align-items:center}
.title-page h1{font-size:${t.trim.w >= 8 ? 34 : 28}pt;font-weight:700;letter-spacing:-.015em}
.title-page .sub{margin-top:12pt;font-size:12pt;color:var(--muted);max-width:90%}
.title-page .rule{width:40pt;height:2pt;background:var(--accent);margin:22pt auto}
.title-page .author{font-family:${t.fonts.ui};font-size:10pt;font-weight:600;letter-spacing:.16em;text-transform:uppercase}
.title-page .pub{margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:8pt}
.title-page .pub img.m{height:34pt}.title-page .pub img.w{height:12pt}
.imprint{padding:0.9in ${t.trim.w * 0.12}in;display:flex;flex-direction:column;justify-content:flex-end;font-size:8.5pt;line-height:1.6;color:var(--muted)}
.imprint p{margin:0 0 9pt}
.imprint strong{color:var(--ink)}
.toc{padding:0.8in ${t.trim.w >= 8 ? 0.85 : 0.7}in 0.8in;height:auto;overflow:visible;break-after:page}
.toc h1{font-size:22pt;font-weight:700;margin-bottom:18pt}
.toc ol{list-style:none;margin:0;padding:0;${isCookbook ? 'columns:2;column-gap:22pt;font-size:8.5pt;line-height:1.35' : 'font-size:10pt'}}
.toc li{display:flex;align-items:baseline;gap:6pt;padding:${isCookbook ? '2pt' : '5pt'} 0;break-inside:avoid}
.toc .tt{flex:0 1 auto}
.toc .dots{flex:1 1 auto;border-bottom:.75pt dotted var(--rule);transform:translateY(-3pt);min-width:12pt}
.toc .pg{font-family:${t.fonts.ui};font-size:.85em;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums;min-width:18pt;text-align:right}
.toc .toc-part{font-weight:700;margin-top:10pt;font-family:${t.fonts.display};font-size:11pt}
.toc .toc-part .ui{font-size:7pt;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--accent-ink);margin-right:6pt}
.toc .toc-part .pg{margin-left:auto}
</style></head><body>
<section class="page cover">
  <div class="kick">${esc(isCookbook ? 'The cookbook' : doc.productType === 'workbook' ? 'The workbook' : 'The guide')}</div>
  <h1>${esc(doc.title)}</h1>
  <div class="rule"></div>
  ${doc.subtitle ? `<div class="sub">${esc(doc.subtitle)}</div>` : ''}
  <div class="author">${esc(author)}</div>
  <div class="pub"><img class="m" src="${brandImages.markWhite()}" alt=""><img class="w" src="${brandImages.wordmarkWhite()}" alt="${esc(brand.name)}"></div>
</section>
<section class="page title-page">
  <h1>${esc(doc.title)}</h1>
  ${doc.subtitle ? `<div class="sub">${esc(doc.subtitle)}</div>` : ''}
  <div class="rule"></div>
  <div class="author">${esc(author)}</div>
  <div class="pub"><img class="m" src="${brandImages.markDark()}" alt=""><img class="w" src="${brandImages.wordmarkDark()}" alt="${esc(brand.name)}"></div>
</section>
<section class="page imprint">
  <p><strong>${esc(doc.title)}</strong>${doc.subtitle ? `<br>${esc(doc.subtitle)}` : ''}</p>
  <p>Copyright © ${ctx.year} ${esc(brand.name)}. All rights reserved.</p>
  <p>No part of this publication may be reproduced, distributed or transmitted in any form or by any means without the prior written permission of the publisher, except for brief quotations in reviews.</p>
  <p>This book is provided for general information and education. It is not a substitute for professional ${isCookbook ? 'dietary or medical' : 'financial, legal or medical'} advice. The author and publisher accept no liability for actions taken based on its contents.</p>
  <p>Published by ${esc(brand.name)}<br>${esc(brand.website)}</p>
  <p>First edition, ${ctx.year}</p>
</section>
<section class="toc">
  <h1>Contents</h1>
  <ol>${tocRows}</ol>
</section>
</body></html>`;
}

// ---------- back cover (locked Empire Maker band) ----------

export function backHtml(ctx: RenderCtx): string {
  const { theme: t, doc, brand } = ctx;
  const W = 600;
  const H = Math.round((W * t.trim.h) / t.trim.w);
  const bandH = t.trim.w === 6 && t.trim.h === 9 ? 320 : Math.max(300, Math.round(H * 0.4));
  const zoom = (t.trim.w * 96) / W;
  const sections = contentSections(doc);
  const firstPara = sections
    .flatMap((s) => s.blocks)
    .find((b): b is Extract<Block, { type: 'paragraph' }> => b.type === 'paragraph' && b.text.split(' ').length > 12);
  const blurb = firstPara ? truncateWords(firstPara.text, 42) : '[Back-cover blurb — written by the Writer agent]';
  const bullets = sections
    .filter((s) => (s.kind === 'chapter' || s.kind === 'recipe') && !/^(introduction|how to use|welcome|thank you|resources|why )/i.test(s.title))
    .slice(0, 4)
    .map((s) => s.title);
  const headline = doc.subtitle ?? doc.title;
  const c = brand.colors;
  const check = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${t.colors.coverAccent}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
  const minis = ctx.catalog.slice(0, 3);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.title)} — back cover</title><style>
${baseCss(t)}
@page{size:${t.trim.w}in ${t.trim.h}in;margin:0}
html,body{background:${t.colors.coverBg}}
.bc{width:${W}px;height:${H}px;zoom:${zoom};display:flex;flex-direction:column;background:${t.colors.coverBg};color:${t.colors.coverInk};overflow:hidden}
.var{flex:1;padding:44px 46px 28px;display:flex;flex-direction:column;min-height:0}
.kick{font-family:${t.fonts.ui};font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:${t.colors.coverAccent}}
.hl{text-wrap:balance;font-family:${t.fonts.display};font-weight:700;font-size:30px;line-height:1.12;margin-top:14px;color:${t.colors.coverInk}}
.blurb{text-wrap:pretty;font-size:14.5px;line-height:1.55;opacity:.88;margin-top:14px}
.inside{margin-top:20px;font-family:${t.fonts.ui};font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:${t.colors.coverAccent}}
.bul{margin-top:10px;display:flex;flex-direction:column;gap:8px}
.bul div{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.4}
.bul svg{flex:none;margin-top:3px}
.au{margin-top:auto;padding-top:14px;border-top:1px solid rgba(255,255,255,.18);font-size:13px;line-height:1.45;opacity:.9}
.au b{font-family:${t.fonts.ui};font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;display:block;margin-bottom:3px;opacity:.9;color:${t.colors.coverAccent}}
.band{height:${bandH}px;flex:none;background:${c.black};color:${c.white};font-family:'Montserrat',sans-serif;display:flex;flex-direction:column}
.band .top{height:4px;background:${c.gold}}
.band .in{flex:1;padding:26px 40px;display:flex;flex-direction:column;gap:20px}
.lock{display:flex;align-items:center;gap:20px}
.lock .m{width:76px;display:block}.lock .w{width:236px;display:block}
.tag{font-size:10.5px;font-weight:600;letter-spacing:.26em;text-transform:uppercase;color:${c.gold};margin-top:10px}
.sep{height:1px;background:${c.rule}}
.row{display:flex;gap:28px;align-items:flex-end}
.more{flex:1;display:flex;flex-direction:column;gap:12px}
.more .lbl{font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:${c.muted}}
.minis{display:flex;gap:12px}
.mini{width:62px;height:93px;padding:7px;border:1px solid rgba(255,255,255,.12);display:flex;flex-direction:column;justify-content:space-between}
.mini .t{font-size:7.5px;font-weight:800;line-height:1.15;text-transform:uppercase;color:#fff}
.mini .r{height:2px;width:18px}
.cta{font-size:12px;font-weight:600;line-height:1.5;color:${c.white};max-width:260px}
.qr{display:flex;flex-direction:column;align-items:center;gap:8px}
.qr .box{width:84px;height:84px;padding:6px;background:#fff}
.qr .box svg{width:72px;height:72px;display:block}
.qr .url{font-size:9.5px;font-weight:600;letter-spacing:.04em}
</style></head><body>
<div class="bc">
  <div class="var">
    <div class="kick">${esc(doc.title)}</div>
    <div class="hl">${esc(headline)}</div>
    <div class="blurb">${esc(blurb)}</div>
    ${bullets.length ? `<div class="inside">Inside you'll find</div><div class="bul">${bullets.map((b) => `<div>${check}<span>${esc(b)}</span></div>`).join('')}</div>` : ''}
    <div class="au"><b>About the author</b>${esc(ctx.authorName ?? '[Pen name]')} ${esc(ctx.authorShortBio ?? '[short author bio]')}</div>
  </div>
  <div class="band">
    <div class="top"></div>
    <div class="in">
      <div class="lock">
        <img class="m" src="${brandImages.markWhite()}" alt="">
        <div><img class="w" src="${brandImages.wordmarkWhite()}" alt="${esc(brand.name)}"><div class="tag">${esc(brand.tagline)}</div></div>
      </div>
      <div class="sep"></div>
      <div class="row">
        <div class="more">
          <div class="lbl">More from Empire Maker</div>
          ${minis.length ? `<div class="minis">${catalogCovers(minis, 'sm')}</div>` : `<div class="cta">Practical guides, workbooks and cookbooks — see the full catalog online.</div>`}
        </div>
        <div class="qr"><div class="box">${ctx.qrSvg}</div><div class="url">${esc(brand.website)}</div></div>
      </div>
    </div>
  </div>
</div>
</body></html>`;
}

function truncateWords(s: string, n: number) {
  const w = s.split(/\s+/);
  if (w.length <= n) return s;
  return w.slice(0, n).join(' ').replace(/[,;:]$/, '') + '…';
}
