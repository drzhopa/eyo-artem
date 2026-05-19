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

function status() {
  const { state } = loadState();
  const done = state.items.filter((x) => x.status === 'done').length;
  const skipped = state.items.filter((x) => x.status === 'skipped').length;
  const pending = state.items.filter((x) => x.status === 'pending').length;
  console.log(`Безопасных замен: ${state.safeReplacementCount}`);
  console.log(`Файлов изменено безопасным проходом: ${state.changedFiles}`);
  console.log(`Всего предложений на ручную проверку: ${state.total}`);
  console.log(`Готово: ${done}`);
  console.log(`Пропущено: ${skipped}`);
  console.log(`Осталось: ${pending}`);
}

function nextItem() {
  const { root, state } = loadState();
  const item = state.items.find((x) => x.status === 'pending');
  if (!item) {
    console.log('Очередь пуста. Все предложения обработаны.');
    return;
  }
  console.log(`ID: ${item.id}`);
  console.log(`Файл: ${item.file}`);
  console.log(`Спорные варианты: ${item.suggestions.map((s) => `${s.before}→${s.after}`).join(', ')}`);
  console.log('--- sentence ---');
  console.log(item.sentence);
  console.log('--- apply command ---');
  console.log(`node tools/yo_epub_review.mjs apply ${JSON.stringify(root)} ${item.id} "ИСПРАВЛЕННОЕ ПРЕДЛОЖЕНИЕ"`);
}

function apply() {
  const rootArg = args[0];
  const id = Number(args[1]);
  const corrected = args[2];
  if (!rootArg || !Number.isInteger(id) || typeof corrected !== 'string') {
    die('Использование: node tools/yo_epub_review.mjs apply /path/to/unpacked-epub ID "исправленное предложение"');
  }
  const { root, state } = loadState(rootArg);
  const item = state.items.find((x) => x.id === id);
  if (!item) die(`Нет предложения с ID ${id}`);
  if (item.status !== 'pending') die(`Предложение ${id} уже имеет статус: ${item.status}`);
  if (!onlyYoChanged(item.sentence, corrected)) {
    console.error('Отклонено: можно менять только буквы е/ё, без правки слов, пунктуации или пробелов.');
    process.exit(2);
  }

  const file = path.join(root, item.file);
  const text = fs.readFileSync(file, 'utf8');
  const current = text.slice(item.start, item.end);
  if (current !== item.sentence) die('Текст изменился с момента подготовки очереди. Остановлено.');
  fs.writeFileSync(file, text.slice(0, item.start) + corrected + text.slice(item.end), 'utf8');

  item.status = 'done';
  item.corrected = corrected;
  item.doneAt = new Date().toISOString();
  writeJson(statePath(root), state);
  console.log(`Применено: ${id}`);
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
  console.log(`Команды:\n  prepare /path/to/unpacked-epub\n  status /path/to/unpacked-epub\n  next /path/to/unpacked-epub\n  apply /path/to/unpacked-epub ID "исправленное предложение"\n  skip /path/to/unpacked-epub ID`);
}

if (command === 'prepare') prepare();
else if (command === 'status') status();
else if (command === 'next') nextItem();
else if (command === 'apply') apply();
else if (command === 'skip') skip();
else help();
