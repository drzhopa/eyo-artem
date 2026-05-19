# eyo-artem

Personal fork of `e2yo/eyo-kernel` for controlled Russian `ё` normalization in books.

This repo keeps the original `eyo-kernel` dictionaries and adds our review wrappers:

- `tools/yo_review.mjs` — plain `.txt` workflow.
- `tools/yo_epub_review.mjs` — unpacked EPUB/XHTML workflow.

The goal is not to rewrite a book with an LLM. The workflow is:

1. Apply safe `е → ё` replacements locally with the dictionary.
2. Collect ambiguous cases separately.
3. Show one sentence at a time for review.
4. Accept only `е/ё` and `Е/Ё` changes.
5. Keep a JSON review state so work can resume.

## Setup

```bash
npm install
npm run build
```

Run `npm run build` again after editing dictionary files.

## Plain text workflow

```bash
node tools/yo_review.mjs prepare input.txt --workdir yo-work
node tools/yo_review.mjs next --workdir yo-work
node tools/yo_review.mjs apply ID "исправленное предложение" --workdir yo-work
node tools/yo_review.mjs status --workdir yo-work
```

Output text is saved to:

```text
yo-work/text.current.txt
```

## EPUB workflow

Use this only on an unpacked EPUB folder, not directly on `.epub`.

```bash
node tools/yo_epub_review.mjs prepare /path/to/unpacked-epub
node tools/yo_epub_review.mjs next /path/to/unpacked-epub
node tools/yo_epub_review.mjs apply /path/to/unpacked-epub ID "исправленное предложение"
node tools/yo_epub_review.mjs skip /path/to/unpacked-epub ID
node tools/yo_epub_review.mjs status /path/to/unpacked-epub
```

The workflow has only two modes:

1. automatic safe pass (`prepare`);
2. manual one-sentence review (`next` + `apply`/`skip`).

`next` prints only one sentence as a compact JSON object with its `id` and `е→ё` variants. `apply` rejects any change except `е/ё` and `Е/Ё`.

The EPUB wrapper changes only visible text between XHTML tags. It does not edit tags, attributes, links, or EPUB structure.

## Dictionaries

Main files:

```text
dictionary/safe.txt
dictionary/not_safe.txt
```

Rules:

- Add a word to `safe.txt` only if it is safe without sentence context.
- If the correct spelling depends on meaning or grammar, keep it for manual review.
- Do not add book-specific guesses as global safe words.
- Edit dictionaries only in clear cases: impossible suggestions, obvious dictionary errors, or genuinely missing context-free safe forms.
- Do not remove rare, colloquial, archaic, dialectal, or stylistic forms just because they are noise in the current book.

Examples:

- Good safe candidate: a word that only exists naturally with `ё`.
- Bad safe candidate: `стекла → стёкла`, because `стекла` can also be a past-tense verb.


## Known ambiguity examples

`ведра` must stay in manual review:

```text
три ведра   # no ё: numeral + genitive singular
эти вёдра   # ё: nominative plural
```

So `ведра → вёдра` is context-dependent and must not be moved to `safe.txt`.
