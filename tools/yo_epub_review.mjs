#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Eyo, safeDictionary, notSafeDictionary } from '../dist/index.js';

const command = process.argv[2];
const args = process.argv.slice(3);

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}


function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function makeEyo(dictionary) {
  const eyo = new Eyo();
  eyo.dictionary.set(dictionary);
  return eyo;
}

function walkFiles(dir) {
  const result = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name === '.git') continue;
      result.push(...walkFiles(full));
    } else if (/\.xhtml$/i.test(name)) {
      result.push(full);
    }
  }
  return result.sort();
}

function textSegments(xhtml) {
  const segments = [];
  let pos = 0;
  const tagRe = /<[^>]*>/g;
  for (const match of xhtml.matchAll(tagRe)) {
    if (match.index > pos) {
      segments.push({ start: pos, end: match.index, text: xhtml.slice(pos, match.index) });
    }
    pos = match.index + match[0].length;
  }
  if (pos < xhtml.length) {
    segments.push({ start: pos, end: xhtml.length, text: xhtml.slice(pos) });
  }
  return segments.filter((s) => /[А-Яа-яЕеЁё]/u.test(s.text));
}

function lineColumnToIndex(text, line, column) {
  let currentLine = 1;
  let currentColumn = 1;
  for (let i = 0; i < text.length; i++) {
    if (currentLine === line && currentColumn === column) return i;
    if (text[i] === '\n') {
      currentLine += 1;
      currentColumn = 1;
    } else {
      currentColumn += 1;
    }
  }
  if (currentLine === line && currentColumn === column) return text.length;
  return -1;
}

function replacementIndex(text, replacement) {
  const firstPosition = replacement.position?.[0];
  if (!firstPosition) return -1;
  if (Number.isInteger(firstPosition.index)) return firstPosition.index;
  return lineColumnToIndex(text, firstPosition.line, firstPosition.column);
}

function findSentenceBounds(text, index) {
  const hardBreak = /[.!?…。！？]/u;
  let start = index;
  while (start > 0) {
    const previous = text[start - 1];
    if (hardBreak.test(previous) || previous === '\n') break;
    start -= 1;
  }
  while (start < text.length && /\s/u.test(text[start])) start += 1;

  let end = index;
  while (end < text.length) {
    const ch = text[end];
    if (hardBreak.test(ch)) {
      end += 1;
      while (end < text.length && /[»”"')\]]/u.test(text[end])) end += 1;
      break;
    }
    if (ch === '\n') break;
    end += 1;
  }
  while (end > start && /\s/u.test(text[end - 1])) end -= 1;
  return { start, end };
}

function onlyYoChanged(before, after) {
  const normalizeYo = (s) => s.replaceAll('ё', 'е').replaceAll('Ё', 'Е');
  return normalizeYo(before) === normalizeYo(after);
}

function dedupeSuggestions(suggestions) {
  const seen = new Set();
  const result = [];
  for (const item of suggestions) {
    const key = `${item.before}->${item.after}@${item.index}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function statePath(root) {
  return path.join(root, 'yo_epub_review.json');
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function prepare() {
  const root = args[0];
  if (!root) die('Использование: node tools/yo_epub_review.mjs prepare /path/to/unpacked-epub');
  const absRoot = path.resolve(root);
  if (!fs.existsSync(path.join(absRoot, 'META-INF', 'container.xml'))) {
    die('Это не похоже на распакованный EPUB: не найден META-INF/container.xml');
  }

  const safeEyo = makeEyo(safeDictionary);
  const notSafeEyo = makeEyo(notSafeDictionary);
  const files = walkFiles(absRoot);
  const itemsByKey = new Map();
  let safeReplacementCount = 0;
  let changedFiles = 0;

  for (const file of files) {
    const before = fs.readFileSync(file, 'utf8');
    let after = '';
    let cursor = 0;
    const originalSegments = textSegments(before);

    for (const segment of originalSegments) {
      safeReplacementCount += safeEyo.lint(segment.text, false).length;
    }

    for (const segment of originalSegments) {
      after += before.slice(cursor, segment.start);
      after += safeEyo.restore(segment.text);
      cursor = segment.end;
    }
    after += before.slice(cursor);

    if (after !== before) {
      fs.writeFileSync(file, after, 'utf8');
      changedFiles += 1;
    }

    const updatedSegments = textSegments(after);
    for (const segment of updatedSegments) {
      const replacements = notSafeEyo.lint(segment.text, false);
      for (const replacement of replacements) {
        const localIndex = replacementIndex(segment.text, replacement);
        if (localIndex < 0) continue;
        const bounds = findSentenceBounds(segment.text, localIndex);
        const start = segment.start + bounds.start;
        const end = segment.start + bounds.end;
        const key = `${rel(absRoot, file)}:${start}:${end}`;
        if (!itemsByKey.has(key)) {
          itemsByKey.set(key, {
            id: itemsByKey.size + 1,
            status: 'pending',
            file: rel(absRoot, file),
            start,
            end,
            sentence: after.slice(start, end),
            suggestions: []
          });
        }
        itemsByKey.get(key).suggestions.push({
          before: replacement.before,
          after: replacement.after,
          index: segment.start + localIndex
        });
      }
    }
  }

  const items = [...itemsByKey.values()].map((item) => ({
    ...item,
    suggestions: dedupeSuggestions(item.suggestions)
  }));

  writeJson(statePath(absRoot), {
    root: absRoot,
    createdAt: new Date().toISOString(),
    files: files.map((file) => rel(absRoot, file)),
    safeReplacementCount,
    changedFiles,
    total: items.length,
    items
  });

  console.log('Готово.');
  console.log(`XHTML-файлов просмотрено: ${files.length}`);
  console.log(`Файлов изменено безопасным проходом: ${changedFiles}`);
  console.log(`Безопасных замен: ${safeReplacementCount}`);
  console.log(`Предложений на ручную проверку: ${items.length}`);
  console.log(`Очередь: ${statePath(absRoot)}`);
}

function loadState(rootArg = null) {
  const root = path.resolve(rootArg || args[0] || '.');
  const file = statePath(root);
  if (!fs.existsSync(file)) die(`Не найден файл очереди: ${file}`);
  return { root, state: readJson(file) };
}

function stateCounts(state) {
  return {
    done: state.items.filter((x) => x.status === 'done').length,
    skipped: state.items.filter((x) => x.status === 'skipped').length,
    pending: state.items.filter((x) => x.status === 'pending').length
  };
}

function compactItem(item) {
  return {
    id: item.id,
    suggestions: item.suggestions.map((s) => `${s.before}→${s.after}`),
    sentence: item.sentence
  };
}

function applyDecision(root, state, decision) {
  const id = Number(decision.id);
  if (!Number.isInteger(id)) die(`Некорректный id в решении: ${JSON.stringify(decision)}`);
  const item = state.items.find((x) => x.id === id);
  if (!item) die(`Нет предложения с ID ${id}`);
  if (item.status !== 'pending') die(`Предложение ${id} уже имеет статус: ${item.status}`);

  if (decision.skip === true) {
    item.status = 'skipped';
    item.skippedAt = new Date().toISOString();
    return 'skipped';
  }

  const corrected = decision.sentence ?? decision.corrected;
  if (typeof corrected !== 'string') die(`В решении ${id} нет поля sentence/corrected`);
  if (!onlyYoChanged(item.sentence, corrected)) {
    die(`Решение ${id} отклонено: можно менять только е/ё и Е/Ё.`);
  }

  const file = path.join(root, item.file);
  const text = fs.readFileSync(file, 'utf8');
  const current = text.slice(item.start, item.end);
  if (current !== item.sentence) die(`Текст для ID ${id} изменился с момента подготовки очереди. Остановлено.`);
  fs.writeFileSync(file, text.slice(0, item.start) + corrected + text.slice(item.end), 'utf8');

  item.status = 'done';
  item.corrected = corrected;
  item.doneAt = new Date().toISOString();
  return 'done';
}

function status() {
  const { state } = loadState();
  const counts = stateCounts(state);
  console.log(`Безопасных замен: ${state.safeReplacementCount}`);
  console.log(`Файлов изменено безопасным проходом: ${state.changedFiles}`);
  console.log(`Всего предложений на ручную проверку: ${state.total}`);
  console.log(`Готово: ${counts.done}`);
  console.log(`Пропущено: ${counts.skipped}`);
  console.log(`Осталось: ${counts.pending}`);
}

function nextItem() {
  const { state } = loadState();
  const limit = parseLimit();
  const items = state.items
    .filter((x) => x.status === 'pending')
    .slice(0, limit)
    .map(compactItem);

  console.log(JSON.stringify({
    limit,
    count: items.length,
    items
  }, null, 2));
}

function parseLimit(defaultLimit = 15, maxLimit = 50) {
  const limitArgIndex = args.findIndex((x) => x === '--limit');
  const inlineLimitArg = args.find((x) => x.startsWith('--limit='));
  const rawLimit = inlineLimitArg
    ? inlineLimitArg.slice('--limit='.length)
    : limitArgIndex >= 0
      ? args[limitArgIndex + 1]
      : args[1];

  if (rawLimit === undefined) return defaultLimit;

  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1) {
    die(`Некорректный limit: ${rawLimit}`);
  }
  return Math.min(limit, maxLimit);
}

function readDecisionJson() {
  const decisionPath = args[1];
  const raw = decisionPath
    ? fs.readFileSync(path.resolve(decisionPath), 'utf8')
    : fs.readFileSync(0, 'utf8');

  if (!raw.trim()) die('Нет JSON с исправленными предложениями');
  try {
    return JSON.parse(raw);
  } catch (error) {
    die(`Некорректный JSON: ${error.message}`);
  }
}

function normalizeDecisions(input) {
  if (Array.isArray(input.apply) || Array.isArray(input.skip)) {
    const decisions = [];

    for (const item of input.apply ?? []) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        die(`Некорректное решение в apply: ${JSON.stringify(item)}`);
      }
      decisions.push(item);
    }

    for (const id of input.skip ?? []) {
      decisions.push({ id, skip: true });
    }

    return decisions;
  }

  if (Array.isArray(input)) return input;
  if (Array.isArray(input.items)) return input.items;
  if (Number.isInteger(Number(input.id))) return [input];
  die('JSON должен быть объектом с apply[]/skip[], items[], массивом решений или одним решением');
}

function markSkipped(item) {
  item.status = 'skipped';
  item.skippedAt = new Date().toISOString();
}

function apply() {
  const rootArg = args[0];
  if (!rootArg) {
    die('Использование: node tools/yo_epub_review.mjs apply /path/to/unpacked-epub [decisions.json]');
  }

  const input = readDecisionJson();
  const decisions = normalizeDecisions(input);
  const { root, state } = loadState(rootArg);
  const results = { applied: 0, skipped: 0 };
  const seenIds = new Set();

  for (const decision of decisions) {
    const id = Number(decision.id);
    if (!Number.isInteger(id)) die(`Некорректный id в решении: ${JSON.stringify(decision)}`);
    if (seenIds.has(id)) die(`ID ${id} указан больше одного раза`);
    seenIds.add(id);

    const item = state.items.find((x) => x.id === id);
    if (!item) die(`Нет предложения с ID ${id}`);
    if (item.status !== 'pending') die(`Предложение ${id} уже имеет статус: ${item.status}`);

    const corrected = decision.sentence ?? decision.corrected;
    if (decision.skip === true || corrected === item.sentence) {
      markSkipped(item);
      results.skipped += 1;
      continue;
    }
    if (typeof corrected !== 'string') die(`В решении ${id} нет поля sentence/corrected`);

    applyDecision(root, state, { id, sentence: corrected });
    results.applied += 1;
  }

  writeJson(statePath(root), state);
  console.log(JSON.stringify(results, null, 2));
}

function skip() {
  const rootArg = args[0];
  const id = Number(args[1]);
  if (!rootArg || !Number.isInteger(id)) die('Использование: node tools/yo_epub_review.mjs skip /path/to/unpacked-epub ID');
  const { root, state } = loadState(rootArg);
  const item = state.items.find((x) => x.id === id);
  if (!item) die(`Нет предложения с ID ${id}`);
  item.status = 'skipped';
  item.skippedAt = new Date().toISOString();
  writeJson(statePath(root), state);
  console.log(`Пропущено: ${id}`);
}

function help() {
  console.log(`Команды:\n  prepare /path/to/unpacked-epub\n  status /path/to/unpacked-epub\n  next /path/to/unpacked-epub [--limit N]\n  apply /path/to/unpacked-epub [decisions.json]\n  skip /path/to/unpacked-epub ID`);
}

if (command === 'prepare') prepare();
else if (command === 'status') status();
else if (command === 'next') nextItem();
else if (command === 'apply') apply();
else if (command === 'skip') skip();
else help();
