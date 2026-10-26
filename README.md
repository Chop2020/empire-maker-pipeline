# Empire Maker Pipeline

PLR source → finished Empire Maker Publishing product. This repo is **Milestone 1: ingest + render**.

```
Upload PLR PDF → Agent 0 Ingest → review + rights gate → Render → branded PDF
                 (structure, junk                         (cover, title, imprint,
                  stripping, flags)                        contents, body, closing
                                                           pages, locked back cover)
```

Agents 1–3 (Analyst, Writer, Designer) plug in between ingest and render. They read and write the same `ProductDocument` (see `shared/types.ts`).

## Run it on Replit

1. **Import:** Create Repl → Import from GitHub → `Chop2020/empire-maker-pipeline`. `.replit` and `replit.nix` set up Node 22, Postgres and Chromium.
2. **Database:** add the **PostgreSQL** tool. Replit sets `DATABASE_URL` automatically. Without it, the app uses an embedded database in `./data`.
3. **Secrets** (padlock icon):
   - `APP_PASSWORD` — recommended. Replit URLs are public, so this adds a login prompt.
   - `ANTHROPIC_API_KEY` — optional. Turns on the Claude structure check and source review during ingest.
   - `STORAGE=replit` — set this before deploying. It needs the **Object Storage** tool added; then run `npm i @replit/object-storage`. Deployed filesystems don't persist.
4. **Run:** press **Run**. One process serves the API and the UI on port 3000.
5. **Deploy:** use a **Reserved VM** deployment (already configured). Renders take a while on big books, and a VM keeps the process alive.

The header shows **Renderer** green when Chromium was found. If it's red, set `CHROME_PATH` to the output of `which chromium` in the Shell.

## Run it locally

```bash
npm install
cp .env.example .env      # optional
npm run dev               # http://localhost:3000
```

You need Chrome or Chromium installed (auto-detected, or set `CHROME_PATH`).

## Command line (no server)

```bash
npm run ingest -- path/to/source.pdf data/cli/book.json   # Agent 0 → JSON + report
npm run render -- data/cli/book.json data/cli/book.pdf    # JSON → branded PDF
```

## What ingest does

| Step | Detail |
|---|---|
| Extract | pdf.js text with positions, font sizes and bold, plus mojibake repair (`Campbell'sВ®` → `Campbell's®`) |
| Clean | Detects and drops TOC pages (keeping the entries), running headers/footers, page numbers and the old cover |
| Structure | Headings, parts, paragraphs, bullet/numbered lists, callouts (`QUICK TIPS`, `PROMPTS`, `EXAMPLE`…), tables (incl. wrapped cells), recipes (two-column or stacked, wrapped ingredient lines, sub-groups like `MARINADE:`) |
| Flags | Seller branding and URLs (stripped), trademarks, old copyright, AI-content disclosure, community-recipe-site naming (copied source), missing license |
| Rights gate | Nothing renders until you confirm: edit, rebrand, claim authorship, sell as a finished product |
| AI refine (optional) | Claude repairs low-confidence sections without changing wording. Capped by `REFINE_MAX_SECTIONS` |

## What render produces

- **Front:** typographic cover (placeholder until the Designer agent), title page, Empire Maker imprint/copyright page, contents with real page numbers
- **Body:** part openers, chapters, styled callouts, tables, recipe pages with an ingredients panel and numbered steps, page numbers
- **Closing:** About Empire Maker Publishing, plus the live catalog of your other rendered titles
- **Back cover:** variable zone (blurb, highlights, author) above the **locked Black & Gold publisher band**: logo, tagline, 3 catalog covers pulled live, and a QR code to `empiremakerpublishing.com/?book=<id>` for per-book tracking

Trim sizes: ebooks 6×9 in, cookbooks 8×10 in (`server/render/theme.ts`).

## Layout

```
shared/types.ts                 document model (the contract between agents)
server/agents/ingest/           Agent 0: extract → layout → structure/recipes → classify → refine
server/render/                  templates, themes, brand assets, HTML→PDF
server/publisher.ts             locked Empire Maker brand
server/products.ts, jobs.ts     product records, job queue, rights gate
client/                         React UI (library, product review, rights, author)
scripts/                        CLI ingest/render, dev helpers
```

## Next milestones

2. Persona engine + Writer agent (Studio mode, 20-page source)
3. Product Bible + chunking for 300+ page sources
4. Template library + Designer agent (real covers, image slots)
5. Factory mode: batch queue, thresholds, spot-check review
