---
name: epub-kindle-formatting
description: Use when Codex receives an EPUB file or unpacked EPUB folder that needs cleanup, reformatting, validation, or conversion to a clean Kindle-ready EPUB standard, especially books converted from FB2, PDF, DOCX, or messy auto-generated sources.
---

# EPUB Kindle Formatting

## Core principle

Prepare books as clean, modern EPUB 3 for the user's personal reading on a current-generation Kindle Paperwhite.

Do not apply a template blindly. First identify this book's repeated damage patterns, then fix those patterns in batches. Passing validators is required but not enough: always do semantic spot checks after structural edits.

Keep the main conversation clean. Put noisy work into scripts, shell commands, or narrow subagents. Report practical results, not low-level XML noise.

## Default EPUB rules

- Target EPUB 3 unless the user explicitly asks for legacy EPUB 2/MOBI compatibility.
- Do not preserve NCX, legacy guide entries, or `.html` content extensions unless explicitly requested.
- Every `.xhtml` file must include `<meta charset="utf-8"/>` inside `<head>`.
- Use one EPUB 3 nav document, normally `toc.xhtml` or `nav.xhtml`, with `properties="nav"`.
- Put non-linear service files such as nav at the end of the spine with `linear="no"` when appropriate.
- OPF spine order must match the reading order: cover/title/front matter, main content, back matter, then non-linear service files.
- Let the reader choose the body font. Do not force a normal body font family.
- Keep CSS simple. Prefer semantic selectors (`h1`, `h2`, `p`, `section`) over extra classes.

## Heading hierarchy

Use one semantic hierarchy for the whole book, not a fresh `h1` in every file.

| Content | Heading |
|---|---|
| Book title | `h1` |
| Parts/front matter/back matter | `h2` |
| Chapters/scenes/явления | `h3` |
| Subsections/scene breaks | `h4` |

For plays: title page `h1`; `Действующие лица`, each `Действие`, and `Примечания` use `h2`; each `Явление` uses `h3`.

## Russian books and ё normalization

For Russian-language books, ё normalization is part of normal book repair, not a separate optional feature. Treat it like structure cleanup, markup cleanup, CSS cleanup, footnotes, metadata, and validation.

Ё normalization must still be done as a controlled local text pass. Never send full chapters, full XHTML files, or the full book through an LLM for ёification.

Use the user's maintained fork by default:

- GitHub: `https://github.com/drzhopa/eyo-artem`
- Dictionaries: `dictionary/safe.txt`, `dictionary/not_safe.txt`
- EPUB wrapper: `tools/yo_epub_review.mjs`
- TXT wrapper: `tools/yo_review.mjs`

Install it in the clean project folder when needed. The normal user setup is a fresh folder containing only the input EPUB, so do not rely on an existing nearby checkout.

```bash
git clone https://github.com/drzhopa/eyo-artem.git eyo-artem
cd eyo-artem
npm install
npm run build
```

### Ё workflow

There are exactly two user-facing modes:

1. **Automatic safe pass**: `prepare` applies safe replacements locally and builds the ambiguous queue. The model does not need to see the automatic output.
2. **Manual batch pass**: `next` shows one compact JSON batch of pending items, normally 15 sentences. The model returns a compact decisions JSON: changed items in `apply[]`, unchanged item IDs in `skip[]`. `apply` validates that only `е/ё` changed and inserts decisions back into XHTML.

For unpacked EPUB:

```bash
cd /path/to/eyo-artem
node tools/yo_epub_review.mjs prepare /path/to/unpacked-epub
node tools/yo_epub_review.mjs next /path/to/unpacked-epub
node tools/yo_epub_review.mjs next /path/to/unpacked-epub --limit 10
node tools/yo_epub_review.mjs apply /path/to/unpacked-epub decisions.json
node tools/yo_epub_review.mjs apply /path/to/unpacked-epub < decisions.json
node tools/yo_epub_review.mjs skip /path/to/unpacked-epub ID
node tools/yo_epub_review.mjs status /path/to/unpacked-epub
```

For plain text:

```bash
cd /path/to/eyo-artem
node tools/yo_review.mjs prepare input.txt --workdir yo-work
node tools/yo_review.mjs next --workdir yo-work
node tools/yo_review.mjs apply ID "исправленное предложение" --workdir yo-work
node tools/yo_review.mjs status --workdir yo-work
```

Manual review rules:

- The model must see only the current compact `next` JSON batch: `limit`, `count`, and `items[]` with `id`, suggested `е→ё` variants, and one sentence per item.
- Default batch size is 15. Use smaller batches, e.g. `--limit 5` or `--limit 10`, if the cases are unusually difficult.
- The model returns only compact decisions JSON:
  - `apply`: items that need `ё` changes, each with `id` and corrected `sentence`;
  - `skip`: IDs that should stay unchanged.
- Do not return unchanged full sentences in `apply`; put their IDs in `skip` to save tokens.
- Do not print per-sentence shell commands, full chapters, surrounding paragraphs, verbose npm output, or repeated explanations.
- Accept only `е/ё` and `Е/Ё` substitutions. Reject punctuation, spacing, wording, and style changes.
- Keep the review state file so work can resume safely.
- Apply reviewed text back into XHTML without changing tags, attributes, links, or EPUB structure.

### Ё dictionary policy

`eyo-artem` is a reusable cross-book project, not a per-book patch.

Edit and commit `eyo-artem`, never `node_modules` or upstream packages. Edit dictionaries only in clear cases:

- impossible suggestion, e.g. invalid form;
- obvious upstream dictionary error;
- genuinely missing context-free safe form.

Do not remove rare, colloquial, archaic, dialectal, or stylistic forms merely because they are noise in the current book. Keep them in manual review.

Add a word to `safe.txt` only if it is safe for future books without sentence context. If a word depends on meaning, grammar, or is a name/author-specific form, keep it manual.

After dictionary edits:

```bash
cd /path/to/eyo-artem
npm run build
npm test
git add dictionary src README.artem.md package.json tools
git commit -m "..."
git push
```

Known ambiguity: `ведра` stays manual because `три ведра` has no `ё`, while `эти вёдра` has `ё`.

Do not use web paste services for ёification.

## Required tools

Check before starting a book:

```bash
which python3 || echo "MISSING: python3"
which xmllint || echo "MISSING: xmllint"
which epubcheck || echo "MISSING: epubcheck"
which unzip || echo "MISSING: unzip"
which zip || echo "MISSING: zip"
which git || echo "MISSING: git"
which node || echo "MISSING: node"
which npm || echo "MISSING: npm"
```

For GitHub dictionary work also check:

```bash
which gh || echo "MISSING: gh"
gh auth status || true
```

If tools are missing on macOS:

```bash
brew install epubcheck libxml2 node gh
```

Follow current approval/escalation rules for installs, network access, or destructive commands.

## Bundled helpers

Use these before custom one-off structural checks:

```bash
python3 /Users/artem/.codex/skills/epub-kindle-formatting/scripts/diagnose_epub.py /path/to/unpacked-epub
python3 /Users/artem/.codex/skills/epub-kindle-formatting/scripts/final_check.py /path/to/unpacked-epub
```

`diagnose_epub.py` is a quick structural report. `final_check.py` catches common EPUB structure mistakes. They do not replace `xmllint`, `epubcheck`, or semantic spot checks.

## Standard workflow

### 1. Inspect and unpack

Identify whether input is `.epub` or an unpacked EPUB folder.

If packed:

```bash
mkdir book-unpacked
cd book-unpacked
unzip ../book.epub
git init
git add -A
git commit -m "original unpacked"
```

Discover the OPF path from `META-INF/container.xml`. Do not assume the content directory is `OPS`; common roots include `OPS/`, `OEBPS/`, `OEBPS/Text/`, and `EPUB/`.

### 2. Diagnose before edits

Run diagnosis:

```bash
python3 /Users/artem/.codex/skills/epub-kindle-formatting/scripts/diagnose_epub.py /path/to/unpacked-epub
```

Then manually inspect:

- `content.opf`;
- 3–5 representative XHTML files: beginning, middle, note-heavy, image-heavy, and a special-format section if present;
- CSS links and main stylesheet;
- notes file if present.

Find XHTML files with `find`, not hardcoded content-directory globs:

```bash
find . -name '*.xhtml' -print
find . -name '*.xhtml' -exec grep -Hn 'style=' {} +
find . -name '*.xhtml' -exec grep -Hn '<h[1-6]' {} +
```

Write a book-specific problem inventory before template cleanup. Include:

- actual language from text;
- paragraph wrapper type;
- heading structure and split/merge needs;
- CSS path consistency;
- inline styles/junk attributes;
- footnote structure/order;
- image structure;
- special content: poems, epigraphs, tables, block quotes, screenplay/play text;
- 3–10 concrete examples with filenames/locations;
- repeated patterns and proposed batch fixes.

### 3. Confirm ambiguous structure

Ask the user before structural edits when meaning is ambiguous:

- file naming/splitting scheme;
- heading hierarchy;
- whether parts get separate files;
- special content formatting.

Do not ask for routine mechanical cleanup when the pattern is clear.

### 4. Apply batch cleanup

Typical safe batch fixes:

- normalize stylesheet paths;
- remove junk `style`, duplicate namespace attributes, and empty paragraphs;
- convert wrapper `div/span` paragraphs to real `<p>` only when safe;
- convert scene divider paragraphs like `* * *` to semantic dividers only when appropriate;
- wrap bare images in `<figure class="image">`;
- preserve existing attributes when adding `epub:type` or classes.

After script rewrites:

```bash
find . -name '*.xhtml' -print0 | while IFS= read -r -d '' f; do
  xmllint --format "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
find . -name '*.xhtml' -print0 | xargs -0 xmllint --noout
```

Commit each major phase.

### 5. Merge, split, or rename only when needed

When merging continuation files:

1. Merge body content only.
2. Ensure each chapter file has exactly one `h3` unless the book structure requires otherwise.
3. Demote later headings only when semantically correct.
4. Remove merged files from manifest/spine.
5. Update nav and cross-links.
6. Spot-check first/last blocks and merge boundaries.

When renaming files:

1. Build a full old-to-new map first.
2. Rename files.
3. Replace references everywhere, longest filenames first.
4. Verify no old filenames remain.

### 6. Section markup and language

Every content XHTML file should follow the standard patterns in `references/kindle-templates.md` when needed.

Rules:

- content sections keep `class="title"` when it provides intended top spacing;
- `cover.xhtml` and nav documents are exceptions;
- visible text language drives `dc:language`, `lang`, and `xml:lang`;
- technical markup stays in English: tags, attributes, ids, classes, filenames.

### 7. Footnotes

Default: EPUB pop-up footnotes.

- Keep note bodies in `notes.xhtml`.
- Note body: `<aside class="footnote" id="note-N" epub:type="footnote" role="doc-footnote">`.
- Notes wrapper: `<section class="footnotes" epub:type="footnotes">`.
- Text reference: `<a class="noteref" epub:type="noteref" role="doc-noteref" href="notes.xhtml#note-N" id="noteref-N">[N]</a>`.
- Do not add backlink arrows unless specifically needed.

If notes are reversed or disordered, renumber in spine reading order using placeholders to avoid double replacement.

### 8. Ё normalization for Russian books

Run ё normalization after structural text files are stable and before final repack.

Use `eyo-artem prepare`, then repeat the batch loop until no pending items remain or the user explicitly pauses:

```bash
node tools/yo_epub_review.mjs next /path/to/unpacked-epub > yo-batch.json
# model creates yo-decisions.json with {"apply":[...],"skip":[...]}
node tools/yo_epub_review.mjs apply /path/to/unpacked-epub yo-decisions.json
```

After ё review:

```bash
node tools/yo_epub_review.mjs status /path/to/unpacked-epub
find /path/to/unpacked-epub -name '*.xhtml' -print0 | xargs -0 xmllint --noout
```

Commit the ё phase separately.

### 9. Metadata

Use real sources. Do not invent:

- `dc:title`;
- `dc:creator`;
- original publication year/date;
- description;
- language.

If web lookup is needed, follow current session rules. If web searches must be delegated, use a subagent and request only concise source-backed facts.

### 10. Nav and OPF sync

After file edits:

- every XHTML on disk is in manifest;
- every manifest XHTML exists on disk;
- every manifest XHTML is in spine or intentionally non-linear;
- nav reflects actual file and heading structure;
- cover image has `properties="cover-image"`.

### 11. Repack

Name output after the original with `(fixed)` suffix unless the user asks otherwise.

Delete/overwrite old output only after confirming the path or when the user has explicitly allowed it.

Repack with `mimetype` first and uncompressed:

```bash
zip -X "../Book Title (fixed).epub" mimetype
zip -rg "../Book Title (fixed).epub" META-INF <actual-content-root-or-roots>
```

Use the actual top-level content root(s), not hardcoded `OPS`. Do not use `zip -9`.

## Validation checklist

Before delivery:

```bash
python3 /Users/artem/.codex/skills/epub-kindle-formatting/scripts/final_check.py /path/to/unpacked-epub
find /path/to/unpacked-epub -name '*.xhtml' -print0 | xargs -0 xmllint --noout
epubcheck "../Book Title (fixed).epub"
```

Checklist:

- [ ] Git has checkpoints for original and major phases.
- [ ] Book-specific problem inventory exists before template cleanup.
- [ ] OPF spine order matches intended reading order.
- [ ] Manifest, spine, nav, cover, CSS paths are synced.
- [ ] `dc:language`, `lang`, and `xml:lang` match actual text language.
- [ ] Heading hierarchy is semantic across the whole book.
- [ ] Merged/split boundaries were spot-checked.
- [ ] Footnote refs and note bodies validate and are sequential when renumbered.
- [ ] Images exist and are semantically wrapped where appropriate.
- [ ] For Russian books, ё safe pass ran and manual queue is complete or intentionally paused.
- [ ] `final_check.py` has 0 errors; warnings reviewed.
- [ ] `xmllint --noout` passes on all XHTML.
- [ ] `epubcheck` passes with 0 errors and 0 warnings, or pre-existing/unrelated warnings are clearly named.

Deliver the output EPUB path and a short validation summary. The user usually performs final visual review in Sigil and Kindle Previewer.

## Subagents

Use subagents only when allowed and useful for independent work. Good tasks:

- regex cleanup across many XHTML files;
- manifest/spine sync checks;
- `xmllint`/`epubcheck` validation summaries;
- metadata web lookup when current rules require delegated search.

When delegating, include absolute working directory, exact file scope, exact task, and required return format: summary only, counts, OK/FAIL, first 3 examples.

Always verify subagent work yourself with spot reads, `xmllint`, OPF checks when relevant, and `git diff`.

## Common failures

| Symptom | Fix |
|---|---|
| Template applied too early | Stop, inspect real files, write problem inventory, then redo by patterns. |
| EPUB validates but looks wrong | Check CSS path, heading hierarchy, language attrs, spine order, and Kindle Previewer. |
| `class="title"` disappears | Preserve attributes when adding `epub:type`. |
| Multiple chapter headings in one file | Merge/split/demote only after semantic check. |
| Old filenames remain | Replace references everywhere, longest names first. |
| Bare images or text inside figures | Wrap image correctly; move text outside figure or into `figcaption`. |
| Reversed footnotes | Renumber in spine order with placeholders. |
| Ё review burns tokens | Use `next` batches, normally 15 sentences; never print chapters, XHTML, full queue files, or command noise. |
| Dictionary gets over-pruned | Only fix clear dictionary errors; keep rare/archaic/style forms manual. |
