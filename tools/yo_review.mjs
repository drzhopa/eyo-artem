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

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function argValue(name, fallback = null) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  if (i + 1 >= args.length) die(`Нет значения после ${name}`);
  return args[i + 1];
}

function makeEyo(dictionary) {
  const eyo = new Eyo();
  eyo.dictionary.set(dictionary);
  return eyo;
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

function compactSpaces(s) {
  return s.replace(/\s+/gu, ' ').trim();
}

function buildQueue(text) {
  const notSafeEyo = makeEyo(notSafeDictionary);
  const replacements = notSafeEyo.lint(text, false);
  const bySentence = new Map();

  for (const replacement of replacements) {
    const index = replacementIndex(text, replacement);
    if (index < 0) continue;
    const bounds = findSentenceBounds(text, index);
    const key = `${bounds.start}:${bounds.end}`;
    if (!bySentence.has(key)) {
      bySentence.set(key, {
        id: bySentence.size + 1,
        status: 'pending',
        start: bounds.start,
        end: bounds.end,
        sentence: text.slice(bounds.start, bounds.end),
        suggestions: []
      });
    }
    bySentence.get(key).suggestions.push({
      before: replacement.before,
      after: replacement.after,
      index
    });
  }

  return [...bySentence.values()].map((item) => ({
    ...item,
    suggestions: dedupeSuggestions(item.suggestions)
  }));
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

function statePath(workdir) {
  return path.join(workdir, 'yo_state.json');
}

function textPath(workdir) {
  return path.join(workdir, 'text.current.txt');
}

function originalPath(workdir) {
  return path.join(workdir, 'text.original.txt');
}

function safePath(workdir) {
  return path.join(workdir, 'text.safe.txt');
}

function prepare() {
  const input = args[0];
  if (!input) die('Использование: node tools/yo_review.mjs prepare input.txt --workdir yo-work');
  const workdir = argValue('--workdir', 'yo-work');
  ensureDir(workdir);

  const original = readText(input);
  const safeEyo = makeEyo(safeDictionary);
  const safeText = safeEyo.restore(original);
  const queue = buildQueue(safeText);

  fs.writeFileSync(originalPath(workdir), original, 'utf8');
  fs.writeFileSync(safePath(workdir), safeText, 'utf8');
  fs.writeFileSync(textPath(workdir), safeText, 'utf8');

  writeJson(statePath(workdir), {
    input: path.resolve(input),
    workdir: path.resolve(workdir),
    createdAt: new Date().toISOString(),
    currentTextFile: 'text.current.txt',
    total: queue.length,
    items: queue
  });

  console.log(`Готово.`);
  console.log(`Безопасные замены применены: ${safeText === original ? 'нет изменений' : 'да'}`);
  console.log(`Предложений на ручную проверку: ${queue.length}`);
  console.log(`Рабочая папка: ${workdir}`);
}

function loadStateFromArgs() {
  const workdir = argValue('--workdir', 'yo-work');
  const file = statePath(workdir);
  if (!fs.existsSync(file)) die(`Не найдено состояние: ${file}. Сначала запусти prepare.`);
  return { workdir, state: readJson(file) };
}

function status() {
  const { state } = loadStateFromArgs();
  const done = state.items.filter((x) => x.status === 'done').length;
  const skipped = state.items.filter((x) => x.status === 'skipped').length;
  const pending = state.items.filter((x) => x.status === 'pending').length;
  console.log(`Всего: ${state.total}`);
  console.log(`Готово: ${done}`);
  console.log(`Пропущено: ${skipped}`);
  console.log(`Осталось: ${pending}`);
}

function nextItem() {
  const { state } = loadStateFromArgs();
  const item = state.items.find((x) => x.status === 'pending');
  if (!item) {
    console.log('Очередь пуста. Все предложения обработаны.');
    return;
  }

  console.log(`ID: ${item.id}`);
  console.log(`Спорные варианты: ${item.suggestions.map((s) => `${s.before}→${s.after}`).join(', ')}`);
  console.log('--- sentence ---');
  console.log(item.sentence);
  console.log('--- apply command ---');
  console.log(`node tools/yo_review.mjs apply ${item.id} "ИСПРАВЛЕННОЕ ПРЕДЛОЖЕНИЕ" --workdir ${path.relative(process.cwd(), state.workdir) || state.workdir}`);
}

function apply() {
  const id = Number(args[0]);
  const corrected = args[1];
  if (!Number.isInteger(id)) die('Использование: node tools/yo_review.mjs apply ID "исправленное предложение" --workdir yo-work');
  if (typeof corrected !== 'string') die('Нужно передать исправленное предложение вторым аргументом.');

  const { workdir, state } = loadStateFromArgs();
  const item = state.items.find((x) => x.id === id);
  if (!item) die(`Нет предложения с ID ${id}`);
  if (item.status !== 'pending') die(`Предложение ${id} уже имеет статус: ${item.status}`);

  if (!onlyYoChanged(item.sentence, corrected)) {
    console.error('Отклонено: можно менять только буквы е/ё, без правки слов, пунктуации или пробелов.');
    console.error('Было:');
    console.error(item.sentence);
    console.error('Стало:');
    console.error(corrected);
    process.exit(2);
  }

  const file = textPath(workdir);
  const text = readText(file);
  const currentSentence = text.slice(item.start, item.end);
  if (currentSentence !== item.sentence) {
    die(`Текст изменился с момента подготовки очереди. Остановлено, чтобы не вставить правку не туда.`);
  }

  const updatedText = text.slice(0, item.start) + corrected + text.slice(item.end);
  fs.writeFileSync(file, updatedText, 'utf8');

  const delta = corrected.length - item.sentence.length;
  item.status = 'done';
  item.corrected = corrected;
  item.doneAt = new Date().toISOString();

  for (const other of state.items) {
    if (other.status === 'pending' && other.start > item.start) {
      other.start += delta;
      other.end += delta;
    }
  }

  writeJson(statePath(workdir), state);
  console.log(`Применено: ${id}`);
}

function help() {
  console.log(`Команды:\n  prepare input.txt --workdir yo-work\n  next --workdir yo-work\n  apply ID "исправленное предложение" --workdir yo-work\n  status --workdir yo-work`);
}

if (command === 'prepare') prepare();
else if (command === 'next') nextItem();
else if (command === 'apply') apply();
else if (command === 'status') status();
else help();
