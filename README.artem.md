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
npm run yo:txt:prepare -- input.txt --workdir yo-work
npm run yo:txt:next -- --workdir yo-work
npm run yo:txt:apply -- ID "исправленное предложение" --workdir yo-work
npm run yo:txt:status -- --workdir yo-work
```

Output text is saved to:

```text
yo-work/text.current.txt
```

## EPUB workflow

Use this only on an unpacked EPUB folder, not directly on `.epub`.

```bash
npm run yo:epub:prepare -- /path/to/unpacked-epub
npm run yo:epub:export-batch -- /path/to/unpacked-epub batch.json --limit 50
npm run yo:epub:print-batch -- batch.json
npm run yo:epub:apply-batch -- /path/to/unpacked-epub decisions.json
npm run yo:epub:status -- /path/to/unpacked-epub
```

Use batch mode by default to minimize chat/token usage. The model should see only the compact batch content and return a compact `decisions.json` array:

```json
[
  {"id": 166, "sentence": "Всё равно до обеда..."},
  {"id": 167, "sentence": "unchanged original sentence..."},
  {"id": 168, "skip": true}
]
```

`sentence` may be identical to the original when no `ё` change is needed. The script rejects any change except `е/ё` and `Е/Ё`.

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
