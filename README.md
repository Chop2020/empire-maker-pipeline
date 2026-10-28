# Empire Maker Pipeline

PLR source → finished Empire Maker Publishing product. This repo covers **Milestone 1 (ingest + render)** and **Milestone 2 (personas + Writer)**.

```
Upload PDF → Agent 0 Ingest → Agent 2 Writer → review → Render → branded PDF
                 (structure, junk                (persona voice,   (source vs   (cover, imprint,
                  stripping, flags)               copy check,       rewrite,     contents, body,
                                                  scope, rebrand)   locks)       locked back cover)
```

Agents 1 and 3 (Analyst, Designer) plug in around the Writer. Every agent reads and writes the same `ProductDocument` (see `shared/types.ts`).

## Run it on Replit

1. **Import:** Create Repl → Import from GitHub → `Chop2020/empire-maker-pipeline`. `.replit` and `replit.nix` set up Node 22, Postgres and Chromium.
2. **Database:** Replit provides PostgreSQL and sets `DATABASE_URL` automatically. No code changes are needed — the app connects on start (the Run console prints `db: postgres`). Without `DATABASE_URL` it falls back to an embedded database in `./data`.
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
| Flags | Seller branding and URLs (stripped), trademarks, old copyright, AI-content disclosure, community-recipe-site naming (copied source) |
| AI refine (optional) | Claude repairs low-confidence sections without changing wording. Capped by `REFINE_MAX_SECTIONS` |

## Personas (Milestone 2)

The **Personas** tab holds the voices the Writer uses.

- **Built-in:** *The Flavor Hunter* (`personas/flavor-hunter.json`) — curious, myth-busting, dry humor, science made plain. Its style traits were researched from a food journalist's published work; his name is kept for reference only and never reaches a product. Three approved recipe rewrites (`flavor-hunter.examples.json`) are sent to the Writer as targets.
- **New from presets:** tick tone presets (Informative, Witty, Casual, Authoritative, Motivational, Story-driven, Conversational, Direct-response), set the dials, and optionally blend with an existing persona.
- **Research an author:** enter an author or copywriter. Claude searches the web for reviews and interviews, then builds the persona. Pasting samples you own makes it much sharper. Needs `ANTHROPIC_API_KEY`.

Built-ins are read-only — **Duplicate** to customize.

## Writer (Milestone 2)

On a product page, the **Writer** card sets:

| Setting | What it does |
|---|---|
| Persona | The voice |
| Scope (cookbooks) | **Beef only** cuts fish, pork, ham, lamb, venison and sides; keeps sauces, rubs and marinades made for steak (`server/agents/writer/scope.ts`) |
| Canned soup / packet recipes | **Upgrade** to from-scratch, **Keep** the shortcut and own it, or **Cut** |
| Run size | Sample 5, sample 20, or everything — always sample first |
| Minimum new wording | Copy-check threshold (default 85%) |

Per section the Writer drafts, then runs a **copy check** (5-word overlap with the source) and a **banned-phrase check**. A failing draft goes back to the model with the exact copied phrases to change, up to 3 attempts, then gets **flagged** for you. After the sections it writes **5 title options** and the **back-cover copy**, which the renderer uses.

Runs are cumulative: each run adds to the draft. **Lock** a section you've approved or hand-edited and the Writer won't touch it again. The estimate shows calls and tokens before you spend anything; set `PRICE_IN_PER_MTOK` / `PRICE_OUT_PER_MTOK` to see dollars.

Render uses the draft when there is one, the ingested source otherwise.

Offline checks (no API key): `tsx scripts/dev/writer-mock.ts <ingest.json> <out.pdf> 20` runs the whole Writer pipeline with a fake model and renders the result; `tsx scripts/dev/check-scope.ts <ingest.json>` lists what the beef-only rule keeps and cuts.

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
server/products.ts, jobs.ts     product records, job queue
client/                         React UI (library, product review, author)
scripts/                        CLI ingest/render, dev helpers
```

## Next milestones

3. Analyst agent (Upgrade Brief, chapter grouping, duplicates) + Product Bible for 300+ page sources
4. Template library + Designer agent (real covers, image slots)
5. Factory mode: batch queue, thresholds, spot-check review
