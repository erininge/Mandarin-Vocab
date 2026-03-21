#!/usr/bin/env node
const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LESSON_INDEX = path.join(ROOT, "lessons", "index.json");
const AUDIO_DIR = path.join(ROOT, "audio");
const RAW_DIR = path.join(AUDIO_DIR, "raw");
const REPORT_PATH = path.join(AUDIO_DIR, "audio_rename_report.json");

const AUDIO_EXTENSIONS = [".wav", ".mp3", ".m4a", ".ogg"];

const PUNCT_RE = /[。．\.、,，'’"“”！？!?：:;；・（）()\[\]{}「」『』]/g;
const WS_RE = /\s+/g;

function normalizeJP(value) {
  return (value || "")
    .normalize("NFKC")
    .replace(WS_RE, "")
    .replace(PUNCT_RE, "")
    .trim();
}

function tokenFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  const parts = base.split("_");
  return parts[parts.length - 1] || "";
}

function normalizeExtension(ext) {
  return (ext || "").toLowerCase();
}

function isSupportedAudioFile(filename) {
  const ext = normalizeExtension(path.extname(filename));
  return AUDIO_EXTENSIONS.includes(ext);
}

async function findExistingAudioForId(id) {
  for (const ext of AUDIO_EXTENSIONS) {
    const candidate = path.join(AUDIO_DIR, `${id}${ext}`);
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadItems() {
  const idxRaw = await fs.readFile(LESSON_INDEX, "utf8");
  const idx = JSON.parse(idxRaw);
  const items = [];
  for (const lesson of idx.lessons || []) {
    const lessonPath = path.join(ROOT, lesson.file);
    const raw = await fs.readFile(lessonPath, "utf8");
    const arr = JSON.parse(raw);
    for (const item of arr) items.push(item);
  }
  return items;
}

async function ensureRawDir() {
  await fs.mkdir(RAW_DIR, { recursive: true });
}

async function moveOriginals(items) {
  const itemIds = new Set(items.map((item) => item.id));
  const entries = await fs.readdir(AUDIO_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (!isSupportedAudioFile(entry.name)) continue;
    const base = path.basename(entry.name, path.extname(entry.name));
    if (itemIds.has(base)) continue;
    const from = path.join(AUDIO_DIR, entry.name);
    const to = path.join(RAW_DIR, entry.name);
    if (await fileExists(to)) continue;
    await fs.rename(from, to);
  }
}

async function main() {
  const items = await loadItems();
  await ensureRawDir();
  await moveOriginals(items);

  const kanaMap = new Map();
  const kanjiMap = new Map();
  for (const item of items) {
    const kanaKey = normalizeJP(item.jp_kana);
    const kanjiKey = normalizeJP(item.jp_kanji);
    if (kanaKey) {
      const list = kanaMap.get(kanaKey) || [];
      list.push(item);
      kanaMap.set(kanaKey, list);
    }
    if (kanjiKey) {
      const list = kanjiMap.get(kanjiKey) || [];
      list.push(item);
      kanjiMap.set(kanjiKey, list);
    }
  }

  const report = {
    renamed: [],
    unmatched_files: [],
    missing_audio_for_itemIds: [],
    ambiguous: [],
    duplicates: []
  };

  const usedItemIds = new Set();
  const rawEntries = await fs.readdir(RAW_DIR, { withFileTypes: true });
  for (const entry of rawEntries) {
    if (entry.isDirectory()) continue;
    if (!isSupportedAudioFile(entry.name)) continue;

    const token = tokenFromFilename(entry.name);
    const normalizedToken = normalizeJP(token);
    const rawPath = path.join(RAW_DIR, entry.name);
    const ext = normalizeExtension(path.extname(entry.name));

    const kanaMatches = normalizedToken ? (kanaMap.get(normalizedToken) || []) : [];
    if (kanaMatches.length > 1) {
      report.ambiguous.push({
        file: entry.name,
        token,
        candidateItemIds: kanaMatches.map((item) => item.id)
      });
      continue;
    }
    if (kanaMatches.length === 1) {
      const item = kanaMatches[0];
      const target = path.join(AUDIO_DIR, `${item.id}${ext}`);
      const existing = await findExistingAudioForId(item.id);
      if (usedItemIds.has(item.id) || existing) {
        report.duplicates.push({ file: entry.name, itemId: item.id });
        continue;
      }
      await fs.copyFile(rawPath, target);
      usedItemIds.add(item.id);
      report.renamed.push({
        from: `audio/raw/${entry.name}`,
        to: `audio/${item.id}${ext}`,
        itemId: item.id,
        matchedBy: "jp_kana"
      });
      continue;
    }

    const kanjiMatches = normalizedToken ? (kanjiMap.get(normalizedToken) || []) : [];
    if (kanjiMatches.length > 1) {
      report.ambiguous.push({
        file: entry.name,
        token,
        candidateItemIds: kanjiMatches.map((item) => item.id)
      });
      continue;
    }
    if (kanjiMatches.length === 1) {
      const item = kanjiMatches[0];
      const target = path.join(AUDIO_DIR, `${item.id}${ext}`);
      const existing = await findExistingAudioForId(item.id);
      if (usedItemIds.has(item.id) || existing) {
        report.duplicates.push({ file: entry.name, itemId: item.id });
        continue;
      }
      await fs.copyFile(rawPath, target);
      usedItemIds.add(item.id);
      report.renamed.push({
        from: `audio/raw/${entry.name}`,
        to: `audio/${item.id}${ext}`,
        itemId: item.id,
        matchedBy: "jp_kanji"
      });
      continue;
    }

    report.unmatched_files.push(entry.name);
  }

  const audioEntries = await fs.readdir(AUDIO_DIR, { withFileTypes: true });
  const audioIds = new Set(
    audioEntries
      .filter((entry) => entry.isFile() && isSupportedAudioFile(entry.name))
      .map((entry) => path.basename(entry.name, path.extname(entry.name)))
  );

  report.missing_audio_for_itemIds = items
    .map((item) => item.id)
    .filter((id) => !audioIds.has(id));

  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));

  const summary = {
    renamed: report.renamed.length,
    unmatched: report.unmatched_files.length,
    ambiguous: report.ambiguous.length,
    duplicates: report.duplicates.length,
    missing: report.missing_audio_for_itemIds.length
  };
  console.log("Audio rename complete:", summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
