/* Kat’s Mandarin Garden 🌸 — HSK 1 (V1.3) */

const APP_VERSION = "V1.3";
const STORAGE = {
  stars: "hsk1_stars_v1_1",
  settings: "hsk1_settings_v1_1",
  stats: "hsk1_stats_v1_1",
  kanjiOverrides: "hsk1_hanzi_overrides_v1_1",
  vocabEdits: "hsk1_vocab_edits_v1_1",
  seeded: "hsk1_seeded_v1_1"
};

const DEFAULT_SETTINGS = {
  audioOn: true,
  volume: 0.9,
  autoplay: false,
  smartGrade: true,
  backgroundVideo: "off"
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 1800);
}

function loadJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

function uniq(arr) {
  return [...new Set(arr)];
}

function normEnglish(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function englishAliases(en) {
  const base = (en || "").trim();
  const parts = [];
  if (!base) return parts;
  parts.push(base);
  const withoutParens = base.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
  if (withoutParens) parts.push(withoutParens);
  parts.push(base.split(",")[0].trim());
  parts.push(base.split("(")[0].trim());
  const segments = base.split(/[;,/]/).map((seg) => seg.trim()).filter(Boolean);
  segments.forEach((seg) => parts.push(seg));
  const segmentsNoParens = withoutParens
    .split(/[;,/]/)
    .map((seg) => seg.trim())
    .filter(Boolean);
  segmentsNoParens.forEach((seg) => parts.push(seg));
  return uniq(parts.filter(Boolean));
}

function englishVariants(s) {
  const spaced = normEnglish(s);
  if (!spaced) return [];
  const tight = spaced.replace(/\s+/g, "");
  return uniq([spaced, tight].filter(Boolean));
}

function normJP(s) {
  return (s || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[。．\.\、,，'’"“”！？!?:：;；・]/g, "")
    .trim();
}

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;

function supportsSpeechRecognition() {
  return !!SpeechRecognitionCtor;
}

function createSpeechRecognizer({ lang = "zh-CN", onStart, onResult, onError, onEnd } = {}) {
  if (!supportsSpeechRecognition()) return null;
  const recognition = new SpeechRecognitionCtor();
  recognition.lang = lang;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.addEventListener("start", () => onStart?.());
  recognition.addEventListener("result", (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    onResult?.(transcript, event);
  });
  recognition.addEventListener("error", (event) => onError?.(event));
  recognition.addEventListener("end", () => onEnd?.());
  return recognition;
}

const AUDIO_EXTENSIONS = ["wav", "mp3", "m4a", "ogg"];
const AUDIO_SRC_CACHE = new Map();
let AUDIO_FALLBACK_MAP = null;
let AUDIO_FALLBACK_LOADING = null;
let CURRENT_AUDIO_ENTRIES = [];
let CURRENT_AUDIO_SIGNATURE = "";
let SW_REGISTRATION = null;

function attachWaitingServiceWorker(worker) {
  if (!worker) return;
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed" && navigator.serviceWorker.controller) {
      toast("Update ready. Tap Refresh / Update App.");
    }
  });
}

async function forceRefreshApp() {
  const refreshBtn = $("#btnAppRefresh");
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    if (!("serviceWorker" in navigator)) {
      location.reload();
      return;
    }

    const reg = SW_REGISTRATION || await navigator.serviceWorker.getRegistration();
    if (reg) {
      SW_REGISTRATION = reg;
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      await reg.update();
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    const hasController = !!navigator.serviceWorker.controller;
    if (hasController) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        navigator.serviceWorker.addEventListener("controllerchange", finish, { once: true });
        setTimeout(finish, 1200);
      });
    }

    location.href = `./index.html?force=${Date.now()}`;
  } catch {
    location.reload();
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

async function audioUrlExists(url) {
  try {
    const head = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (head.ok) return true;
    if ([403, 405].includes(head.status)) {
      const getRes = await fetch(url, { method: "GET", cache: "no-store" });
      return getRes.ok;
    }
    return false;
  } catch {
    return false;
  }
}

function audioIdVariants(id) {
  const variants = [id];
  if (id?.startsWith("hsk1_")) {
    variants.push(id.replace(/^hsk1_/, "hsk1_"));
  }
  return variants;
}

function audioIdForItem(item) {
  return item?.audio_id || item?.audioId || item?.id;
}

async function loadAudioFallbackMap() {
  if (AUDIO_FALLBACK_MAP) return AUDIO_FALLBACK_MAP;
  if (AUDIO_FALLBACK_LOADING) return AUDIO_FALLBACK_LOADING;
  AUDIO_FALLBACK_LOADING = (async () => {
    try {
      const res = await fetch("./audio/audio_rename_report.json", { cache: "no-store" });
      if (!res.ok) {
        AUDIO_FALLBACK_MAP = new Map();
        return AUDIO_FALLBACK_MAP;
      }
      const data = await res.json();
      const map = new Map();
      (data.renamed || []).forEach((entry) => {
        if (entry.itemId && entry.from) {
          map.set(entry.itemId, entry.from);
        }
      });
      AUDIO_FALLBACK_MAP = map;
      return map;
    } catch {
      AUDIO_FALLBACK_MAP = new Map();
      return AUDIO_FALLBACK_MAP;
    }
  })();
  return AUDIO_FALLBACK_LOADING;
}

async function resolveAudioUrl(id) {
  if (AUDIO_SRC_CACHE.has(id)) return AUDIO_SRC_CACHE.get(id);
  const variants = audioIdVariants(id);
  for (const variant of variants) {
    for (const ext of AUDIO_EXTENSIONS) {
      const url = `./audio/${variant}.${ext}`;
      if (await audioUrlExists(url)) {
        AUDIO_SRC_CACHE.set(id, url);
        return url;
      }
    }
  }
  const fallbackMap = await loadAudioFallbackMap();
  const fallbackPath = fallbackMap.get(id);
  if (fallbackPath) {
    const url = fallbackPath.startsWith("audio/") ? `./${fallbackPath}` : fallbackPath;
    if (await audioUrlExists(url)) {
      AUDIO_SRC_CACHE.set(id, url);
      return url;
    }
  }
  AUDIO_SRC_CACHE.set(id, null);
  return null;
}

function clearAudioCache() {
  AUDIO_SRC_CACHE.clear();
  AUDIO_FALLBACK_MAP = null;
  AUDIO_FALLBACK_LOADING = null;
}

async function hasAudioFile(id) {
  return !!(await resolveAudioUrl(id));
}

function expectedAudioFilename(id) {
  const ext = AUDIO_EXTENSIONS[0] || "wav";
  return `audio/${id}.${ext}`;
}

function displayAudioFilename(url) {
  if (!url) return "";
  return url.replace(/^\.\//, "");
}
function jpDisplay(item, mode) {
  const kana = item.jp_kana || "";
  const kanji = item.jp_kanji || "";
  if (mode === "kana") return kana;
  if (mode === "kanji") return kanji || kana;
  if (kanji && kanji !== kana) return `${kanji} (${kana})`;
  return kana;
}

function jpAcceptableAnswers(item, dmode) {
  const kana = item.jp_kana || "";
  const kanji = item.jp_kanji || "";
  if (dmode === "kana") return [kana];
  if (dmode === "kanji") return [kanji || kana];
  return uniq([kana, kanji].filter(Boolean));
}

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...loadJSON(STORAGE.settings, {}) };
}
function setSettings(patch) {
  const s = getSettings();
  const next = { ...s, ...patch };
  saveJSON(STORAGE.settings, next);
  applySettingsToUI(next);
  return next;
}

function applySettingsToUI(s) {
  $("#setAudioOn").checked = !!s.audioOn;
  $("#setVolume").value = String(s.volume ?? 0.9);
  $("#setAutoplay").checked = !!s.autoplay;
  $("#setSmartGrade").checked = !!s.smartGrade;
  const bgSelect = $("#setBackgroundVideo");
  const bgHint = $("#backgroundVideoHint");
  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  if (bgSelect) {
    bgSelect.value = prefersReduced ? "off" : (s.backgroundVideo || "off");
    bgSelect.disabled = prefersReduced;
  }
  if (bgHint) {
    bgHint.textContent = prefersReduced
      ? "Background video is disabled because your device prefers reduced motion."
      : "Enable the blossom background video behind the UI.";
  }
  applyBackgroundVideo(prefersReduced ? "off" : (s.backgroundVideo || "off"));
  updateListeningAvailability();
}

let VIDEO_FALLBACK_CLEANUP = null;

function clearVideoFallback() {
  if (VIDEO_FALLBACK_CLEANUP) {
    VIDEO_FALLBACK_CLEANUP();
    VIDEO_FALLBACK_CLEANUP = null;
  }
}

function addVideoInteractionFallback(video) {
  clearVideoFallback();
  const events = ["pointerdown", "touchstart", "click", "keydown"];
  const handler = () => {
    video.play()
      .then(() => clearVideoFallback())
      .catch(() => {});
  };
  events.forEach((evt) => window.addEventListener(evt, handler, { passive: true }));
  VIDEO_FALLBACK_CLEANUP = () => {
    events.forEach((evt) => window.removeEventListener(evt, handler));
  };
}

function applyBackgroundVideo(state) {
  const layer = $("#videoBackground");
  if (!layer) return;
  clearVideoFallback();
  layer.classList.remove("is-active");
  layer.innerHTML = "";
  if (state !== "on") return;

  const video = document.createElement("video");
  video.src = "./icons/Sakura.mp4";
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.setAttribute("aria-hidden", "true");
  video.preload = "auto";
  layer.appendChild(video);
  layer.classList.add("is-active");

  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => addVideoInteractionFallback(video));
  } else {
    addVideoInteractionFallback(video);
  }
}

let LESSONS = [];
let LESSON_NAME_TO_CODE = new Map();
let ITEMS = [];
let ITEMS_BY_ID = new Map();
let VOCAB_EDITS = {};

let STARRED = new Set();
let KANJI_OVERRIDES = new Set();
let SETTINGS = getSettings();

function getStats() {
  return loadJSON(STORAGE.stats, { attempts: 0, correct: 0, perItem: {} });
}
function recordAttempt(id, ok) {
  const s = getStats();
  s.attempts += 1;
  if (ok) s.correct += 1;
  s.perItem[id] = s.perItem[id] || { a: 0, c: 0 };
  s.perItem[id].a += 1;
  if (ok) s.perItem[id].c += 1;
  saveJSON(STORAGE.stats, s);
}

function seedStarsIfNeeded() {
  const seeded = localStorage.getItem(STORAGE.seeded);
  if (seeded) return;
  STARRED = new Set();
  saveJSON(STORAGE.stars, Array.from(STARRED));
  localStorage.setItem(STORAGE.seeded, "1");
}

function loadStars() {
  const saved = loadJSON(STORAGE.stars, null);
  if (Array.isArray(saved)) {
    STARRED = new Set(saved);
  } else {
    STARRED = new Set();
  }
}

function saveStars() {
  saveJSON(STORAGE.stars, Array.from(STARRED));
}

function isStarred(id) {
  return STARRED.has(id);
}
function toggleStar(id, force) {
  const on = force !== undefined ? force : !STARRED.has(id);
  if (on) STARRED.add(id); else STARRED.delete(id);
  saveStars();
  refreshHeaderCounts();
  updateQuestionCountUI();
  updateSpeakingLessonHint();
  updateSpeakingQuestionCountUI();
  updateCurrentAudioListIfOpen();
  return on;
}

function loadHanziOverrides() {
  const saved = loadJSON(STORAGE.kanjiOverrides, null);
  if (Array.isArray(saved)) {
    KANJI_OVERRIDES = new Set(saved);
  } else {
    KANJI_OVERRIDES = new Set();
  }
}

function saveHanziOverrides() {
  saveJSON(STORAGE.kanjiOverrides, Array.from(KANJI_OVERRIDES));
}

function isHanziOverride(id) {
  return KANJI_OVERRIDES.has(id);
}

function toggleHanziOverride(id, force) {
  const on = force !== undefined ? force : !KANJI_OVERRIDES.has(id);
  if (on) KANJI_OVERRIDES.add(id); else KANJI_OVERRIDES.delete(id);
  saveHanziOverrides();
  return on;
}

function loadVocabEdits() {
  const saved = loadJSON(STORAGE.vocabEdits, {});
  VOCAB_EDITS = saved && typeof saved === "object" ? saved : {};
}

function saveVocabEdits() {
  saveJSON(STORAGE.vocabEdits, VOCAB_EDITS);
}

function applyVocabEditsToItem(item) {
  const edit = VOCAB_EDITS[item.id];
  if (!edit) return;
  if (Object.prototype.hasOwnProperty.call(edit, "jp_kana")) item.jp_kana = edit.jp_kana;
  if (Object.prototype.hasOwnProperty.call(edit, "jp_kanji")) item.jp_kanji = edit.jp_kanji;
  if (Object.prototype.hasOwnProperty.call(edit, "en")) item.en = edit.en;
}

function populateVocabEditRow(row, item) {
  const kanaInput = row.querySelector("[data-field='jp_kana']");
  const kanjiInput = row.querySelector("[data-field='jp_kanji']");
  const enInput = row.querySelector("[data-field='en']");
  if (kanaInput) kanaInput.value = item.jp_kana || "";
  if (kanjiInput) kanjiInput.value = item.jp_kanji || "";
  if (enInput) enInput.value = item.en || "";
}

function setVocabRowEditing(row, editing) {
  row.classList.toggle("editing", editing);
  row.querySelectorAll(".vocabView").forEach((el) => el.classList.toggle("hidden", editing));
  row.querySelectorAll(".vocabEdit").forEach((el) => el.classList.toggle("hidden", !editing));
  if (editing) {
    const firstInput = row.querySelector(".vocabEdit input");
    if (firstInput) firstInput.focus();
  }
}

function updateVocabRowDisplay(row, item) {
  const jpEl = row.querySelector(".jpDisplayText");
  const pyEl = row.querySelector(".pinyinDisplayText");
  const enEl = row.querySelector(".enDisplayText");
  if (jpEl) {
    jpEl.textContent = item.jp_kanji || item.jp_kana || "";
  }
  if (pyEl) pyEl.textContent = item.jp_kana || "—";
  if (enEl) enEl.textContent = item.en || "";
}

function lesson_code(lessonName) {
  const normalized = (lessonName || "").toLowerCase().trim();
  if (LESSON_NAME_TO_CODE.has(normalized)) return LESSON_NAME_TO_CODE.get(normalized);
  const lower = (lessonName || "").toLowerCase();
  const m = lower.match(/lesson\s*([0-9]+)/);
  if (m) return "h1_l" + m[1];
  return "misc";
}

function selectedLessonCodes() {
  return $$("#lessonList input[type=checkbox]:checked").map(x => x.value);
}

function selectedToneLessonCodes() {
  return $$("#toneLessonList input[type=checkbox]:checked").map(x => x.value);
}

function isToneLessonCode(code) {
  return /^h1_t/i.test(String(code || ""));
}

function poolFromSelection(codes, starredOnly) {
  let pool = ITEMS.filter((it) => codes.includes(lesson_code(it.lesson)));
  if (starredOnly) {
    pool = pool.filter(it => isStarred(it.id));
  }
  return pool;
}

function currentPool() {
  return poolFromSelection(selectedLessonCodes(), $("#filterStarredOnly").checked);
}

function selectedSpeakingLessonCodes() {
  return $$("#speakingLessonList input[type=checkbox]:checked").map((x) => x.value);
}

function currentSpeakingPool() {
  return poolFromSelection(selectedSpeakingLessonCodes(), $("#speakingStarredOnly")?.checked);
}

function currentTonePool() {
  const codes = selectedToneLessonCodes();
  return ITEMS.filter((it) => codes.includes(lesson_code(it.lesson)));
}

function currentPoolSignature(pool) {
  return pool.map((item) => item.id).join("|");
}

function updateCurrentAudioListIfOpen() {
  if (!$("#currentAudioList").classList.contains("hidden")) {
    buildCurrentAudioList({ force: true });
  }
}

function updateQuestionCountUI() {
  const auto = $("#qAuto").checked;
  const input = $("#qCount");
  input.disabled = auto;
  if (auto) {
    const pool = currentPool();
    input.value = String(pool.length || 0);
  }
}

function updateSpeakingQuestionCountUI() {
  const auto = $("#speakingAuto")?.checked;
  const input = $("#speakingCount");
  if (!input) return;
  input.disabled = !!auto;
  if (auto) {
    const pool = currentSpeakingPool();
    input.value = String(pool.length || 0);
  }
}

function renderCurrentAudioList(entries) {
  const rowsHost = $("#currentAudioRows");
  const summary = $("#currentAudioSummary");
  const meta = $("#currentAudioMeta");
  const missingOnly = $("#currentAudioMissingOnly").checked;
  const filtered = missingOnly ? entries.filter(({ url }) => !url) : entries;
  const found = entries.filter(({ url }) => url).length;

  rowsHost.innerHTML = "";
  if (!filtered.length) {
    rowsHost.innerHTML = `<div class="hint">${missingOnly ? "No missing audio in the current selection." : "No words in the current selection."}</div>`;
  } else {
    filtered.forEach(({ item, url }) => {
      const row = document.createElement("div");
      row.className = "audioRow";
      const audioId = audioIdForItem(item);
      const filename = url ? displayAudioFilename(url) : expectedAudioFilename(audioId);
      row.innerHTML = `
        <div>
          <div class="audioRowTitle">${jpDisplay(item, "both")}</div>
          <div class="hint">${item.en || ""}</div>
        </div>
        <div class="audioRowMeta">
          <div class="audioStatus ${url ? "" : "missing"}">${url ? "Audio found" : "Missing audio"}</div>
          <div class="audioFile">${filename}</div>
        </div>
      `;
      const metaCol = row.querySelector(".audioRowMeta");
      const btn = document.createElement("button");
      btn.className = "btn subtle audioPlayBtn";
      btn.type = "button";
      btn.textContent = url ? "Play" : "No audio";
      btn.disabled = !url;
      if (url) {
        btn.addEventListener("click", () => playItemAudio(item));
      }
      metaCol.appendChild(btn);
      rowsHost.appendChild(row);
    });
  }

  if (missingOnly) {
    summary.textContent = `Showing ${filtered.length} missing audio words.`;
  } else {
    summary.textContent = `Showing ${filtered.length} words.`;
  }
  meta.textContent = `Audio found: ${found}/${entries.length}.`;
}

async function buildCurrentAudioList({ force = false } = {}) {
  const list = $("#currentAudioList");
  const rowsHost = $("#currentAudioRows");
  const summary = $("#currentAudioSummary");
  const meta = $("#currentAudioMeta");

  list.classList.remove("hidden");
  rowsHost.innerHTML = `<div class="hint">Loading current words…</div>`;
  const pool = currentPool();
  if (!pool.length) {
    rowsHost.innerHTML = `<div class="hint">No words in the current selection.</div>`;
    summary.textContent = "No words selected.";
    meta.textContent = "Nothing to show.";
    CURRENT_AUDIO_ENTRIES = [];
    CURRENT_AUDIO_SIGNATURE = "";
    return;
  }

  const signature = currentPoolSignature(pool);
  if (!force && CURRENT_AUDIO_SIGNATURE === signature && CURRENT_AUDIO_ENTRIES.length) {
    renderCurrentAudioList(CURRENT_AUDIO_ENTRIES);
    return;
  }

  clearAudioCache();
  const entries = await Promise.all(pool.map(async (item) => {
    const audioId = audioIdForItem(item);
    const url = await resolveAudioUrl(audioId);
    return { item, url, audioId };
  }));
  CURRENT_AUDIO_ENTRIES = entries;
  CURRENT_AUDIO_SIGNATURE = signature;
  renderCurrentAudioList(entries);
}

async function loadData() {
  const fallbackLessons = [
    "h1_l1", "h1_l2", "h1_l3", "h1_l4", "h1_l5", "h1_l6", "h1_l7",
    "h1_l8", "h1_l9", "h1_l10", "h1_l11", "h1_l12", "h1_l13",
    "h1_t1", "h1_t2", "h1_t3", "h1_t4", "h1_t5"
  ].map((code, idx) => ({
    code,
    name: idx < 13 ? `HSK 1 • Lesson ${idx + 1}` : `Tone Recognition • Lesson ${idx - 12}`,
    file: `./lessons/${code}.json`
  }));

  const fetchJsonStrict = async (url) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
    return res.json();
  };

  const toLessonFileCandidates = (filePath) => {
    const base = String(filePath || "").trim();
    if (!base) return [];
    const normalized = base.replace(/^\.\//, "");
    const trimmedLessonsPrefix = normalized.replace(/^lessons\//, "");
    return uniq([
      `./${normalized}`,
      normalized,
      `./lessons/${trimmedLessonsPrefix}`,
      `lessons/${trimmedLessonsPrefix}`
    ].filter(Boolean));
  };

  let idx;
  try {
    idx = await fetchJsonStrict("./lessons/index.json");
  } catch (e) {
    console.warn("Unable to load lessons/index.json, using bundled fallback list.", e);
    idx = { lessons: fallbackLessons };
  }

  LESSONS = Array.isArray(idx?.lessons) && idx.lessons.length ? idx.lessons : fallbackLessons;
  LESSON_NAME_TO_CODE = new Map(LESSONS.map((l) => [String(l.name || "").toLowerCase().trim(), l.code]));
  const all = [];
  for (const l of LESSONS) {
    const candidates = toLessonFileCandidates(l.file);
    let arr = null;
    for (const candidate of candidates) {
      try {
        arr = await fetchJsonStrict(candidate);
        if (Array.isArray(arr)) break;
      } catch (e) {
        // try next candidate
      }
    }
    if (!Array.isArray(arr)) {
      console.warn(`Skipping lesson ${l.code}: could not load file.`, l.file);
      continue;
    }
    for (const it of arr) all.push(it);
    if (!l.count || Number.isNaN(Number(l.count))) l.count = arr.length;
  }
  loadVocabEdits();
  all.forEach(applyVocabEditsToItem);
  ITEMS = all;
  ITEMS_BY_ID = new Map(ITEMS.map(it => [it.id, it]));
  $("#countTotal").textContent = String(ITEMS.length);

  loadStars();
  seedStarsIfNeeded();
  const saved = loadJSON(STORAGE.stars, null);
  if (Array.isArray(saved)) STARRED = new Set(saved);
  loadHanziOverrides();

  buildLessonUI();
  buildVocabUI();
  refreshHeaderCounts();
  renderStats();
}

function buildLessonUI() {
  const host = $("#lessonList");
  const toneHost = $("#toneLessonList");
  const speakingHost = $("#speakingLessonList");
  host.innerHTML = "";
  if (toneHost) toneHost.innerHTML = "";
  if (speakingHost) speakingHost.innerHTML = "";
  for (const l of LESSONS.filter((lesson) => !isToneLessonCode(lesson.code))) {
    [host, speakingHost].filter(Boolean).forEach((target) => {
      const row = document.createElement("label");
      row.className = "lessonRow";
      row.innerHTML = `
        <span>
          <input type="checkbox" value="${l.code}" checked />
          <strong style="margin-left:6px;">${l.name}</strong>
        </span>
        <span class="meta">${l.count} items</span>
      `;
      target.appendChild(row);
    });
  }
  if (toneHost) {
    for (const l of LESSONS.filter((lesson) => isToneLessonCode(lesson.code))) {
      const row = document.createElement("label");
      row.className = "lessonRow";
      row.innerHTML = `
        <span>
          <input type="checkbox" value="${l.code}" checked />
          <strong style="margin-left:6px;">${l.name}</strong>
        </span>
        <span class="meta">${l.count} items</span>
      `;
      toneHost.appendChild(row);
    }
  }
  host.addEventListener("change", () => {
    refreshHeaderCounts();
    updateLessonHint();
    buildVocabUI();
    updateQuestionCountUI();
    updateCurrentAudioListIfOpen();
  });
  speakingHost?.addEventListener("change", () => {
    updateSpeakingLessonHint();
    updateSpeakingQuestionCountUI();
  });
  toneHost?.addEventListener("change", () => {
    updateToneHint();
  });
  updateLessonHint();
  updateQuestionCountUI();
  updateSpeakingLessonHint();
  updateSpeakingQuestionCountUI();
  updateToneHint();

  const sel = $("#vLessonFilter");
  sel.innerHTML = `<option value="__all__">All lessons</option>` + LESSONS.map(l => `<option value="${l.code}">${l.name}</option>`).join("");
}

function updateSpeakingLessonHint() {
  const pool = currentSpeakingPool();
  const hint = $("#speakingLessonHint");
  if (hint) hint.textContent = `Selected set: ${pool.length} item(s).`;
}


function updateToneHint() {
  const pool = currentTonePool();
  const starOnly = $("#toneStarredOnly")?.checked;
  const playable = starOnly ? pool.filter((it) => isStarred(it.id)).length : pool.length;
  const audioState = SETTINGS.audioOn ? "Audio on" : "Audio off";
  const hint = $("#toneHint");
  if (hint) hint.textContent = `${playable} playable item(s) • Tone lessons selected • ${audioState}`;
}

function updateLessonHint() {
  const pool = currentPool();
  $("#lessonHint").textContent = `Selected set: ${pool.length} item(s).`;
}

function refreshHeaderCounts() {
  const codes = selectedLessonCodes();
  let inSet = ITEMS.filter(it => codes.includes(lesson_code(it.lesson)));
  $("#countInSet").textContent = String(inSet.length);
  $("#countStarred").textContent = String(Array.from(STARRED).length);
}

function updateListeningAvailability() {
  const on = SETTINGS.audioOn;
  const listenEn = $("#qListenEN");
  const listenJp = $("#qListenJP");
  const listenMixed = $("#qListenMixed");
  listenEn.disabled = !on;
  listenJp.disabled = !on;
  if (listenMixed) listenMixed.disabled = !on;
  if (!on) {
    const select = $("#qModeSelect");
    if (select.value.startsWith("listen") || select.value === "mixedlisten") {
      select.value = "mixed";
    }
  }
  updateQModeDependencies();
  updateAudioUI();
  updateToneHint();
  updateSpeakingSupportUI();
}

function isToneListenMode(mode) {
  return mode === "tonelisten";
}

function updateSpeakingSupportUI() {
  const supported = supportsSpeechRecognition();
  const hint = $("#speakingSupportHint");
  const startBtn = $("#btnStartSpeaking");
  if (hint) {
    hint.classList.toggle("hidden", supported);
    hint.textContent = supported
      ? ""
      : "Speech recognition is not available in this browser. Try Chrome or Edge.";
  }
  if (startBtn) startBtn.disabled = !supported;
}

function updateQModeDependencies() {
  const qmode = getQMode();
  const atype = $("#aTypeSelect");
  if (!atype) return;
  const toneMode = isToneListenMode(qmode);
  if (toneMode) atype.value = "mc";
  atype.disabled = toneMode;
}

function getQMode() {
  return $("#qModeSelect")?.value || "en2jp";
}
function getAType() {
  return $("#aTypeSelect")?.value || "mc";
}
function getDMode() {
  return $("#dModeSelect")?.value || "kana";
}
function getSpeakingDMode() {
  return $("#speakingDModeSelect")?.value || "kana";
}

function displayModeForItem(item, dmode) {
  if (!item) return dmode;
  return isHanziOverride(item.id) ? "kanji" : dmode;
}

function canUseAudio() {
  return SETTINGS.audioOn;
}

function isMobileViewport() {
  return window.matchMedia?.("(max-width: 560px)")?.matches ?? false;
}

function isIphoneDevice() {
  return /iPhone/i.test(navigator.userAgent || "");
}

function setIphoneAudioSessionMixing() {
  if (!isIphoneDevice()) return;
  const session = navigator.audioSession;
  if (!session) return;
  if (session.type && session.type !== "ambient") {
    try {
      session.type = "ambient";
    } catch (e) {
      console.warn("Unable to set iPhone audio session type.", e);
    }
  }
}

let AUDIO = null;
let audioSeqToken = 0;
let vocabAudioToken = 0;

function updateAudioUI() {
  const on = SETTINGS.audioOn;
  const replay = $("#btnReplay");
  if (replay) {
    replay.disabled = !on;
    replay.title = on ? "Replay (=)" : "Audio is off in Settings";
  }
}

async function playItemAudio(item) {
  if (!item) return;
  if (!canUseAudio()) {
    toast("Audio is off in Settings.");
    return;
  }
  try {
    setIphoneAudioSessionMixing();
    audioSeqToken++;
    const myToken = audioSeqToken;
    const audioId = audioIdForItem(item);
    const src = await resolveAudioUrl(audioId);
    if (!src) {
      toast(`Missing audio for ${audioId}.`);
      return;
    }
    if (AUDIO) {
      AUDIO.pause();
      AUDIO.currentTime = 0;
      AUDIO.src = src;
    } else {
      AUDIO = new Audio(src);
      AUDIO.preload = "auto";
      AUDIO.setAttribute("playsinline", "");
      AUDIO.setAttribute("webkit-playsinline", "");
    }
    const baseVolume = Math.max(0, Math.min(1, Number(SETTINGS.volume ?? 0.9)));
    AUDIO.volume = baseVolume;
    AUDIO.load();
    await AUDIO.play();
    if (myToken !== audioSeqToken) {
      AUDIO.pause();
      AUDIO.currentTime = 0;
    }
  } catch (e) {
    if (e?.name === "NotAllowedError") {
      toast("Audio blocked by browser. Tap a button, then try again.");
      return;
    }
    if (e?.name === "AbortError") {
      return;
    }
    const audioId = audioIdForItem(item);
    console.warn(`Audio failed for ${audioId}.`, e);
    toast(`Audio failed for ${audioId}.`);
  }
}

function showView(view) {
  for (const v of ["study","speaking","tone","vocab","stats","settings"]) {
    const sec = document.getElementById(`view-${v}`);
    sec.classList.toggle("hidden", v !== view);
    document.querySelector(`.navBtn[data-view='${v}']`).classList.toggle("active", v === view);
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function sample(arr, n) {
  return shuffle(arr).slice(0, n);
}

function makeQuestion(item, qmode, atype) {
  let qm = qmode;
  if (qm === "mixed") {
    const allowed = ["en2jp","jp2en"];
    qm = allowed[Math.floor(Math.random()*allowed.length)];
  }
  if (qm === "mixedlisten") {
    const allowed = SETTINGS.audioOn ? ["listen2en","listen2jp"] : ["en2jp","jp2en"];
    qm = allowed[Math.floor(Math.random()*allowed.length)];
  }
  let am = atype;
  if (isToneListenMode(qm)) am = "mc";
  if (am === "mixed") am = Math.random() < 0.5 ? "mc" : "type";
  return { item, qmode: qm, atype: am };
}

function promptTextForQuestion(q, dmode) {
  const it = q.item;
  if (q.qmode === "en2jp") return it.en;
  if (q.qmode === "jp2en") return jpDisplay(it, displayModeForItem(it, dmode));
  if (isToneListenMode(q.qmode)) return "🎧 Tone listening: which word did you hear?";
  if (q.qmode.startsWith("listen")) return "🎧 Listening… (press =)";
  return it.en;
}

function correctAnswerText(q, dmode) {
  const it = q.item;
  if (isToneListenMode(q.qmode)) {
    return `${it.jp_kana} • ${it.jp_kanji} — ${it.en}`;
  }
  if (q.qmode === "en2jp" || q.qmode === "listen2jp") {
    return jpDisplay(it, displayModeForItem(it, dmode));
  }
  return it.en;
}

function buildMCOptions(q, pool, dmode) {
  const it = q.item;
  if (isToneListenMode(q.qmode)) {
    const toneGroup = String(it.tone_group || "").trim();
    const groupPool = toneGroup
      ? pool.filter((x) => String(x.tone_group || "").trim() === toneGroup)
      : [];
    const candidates = groupPool.length >= 2 ? groupPool : pool;
    const correct = `${it.jp_kana} • ${it.jp_kanji} — ${it.en}`;
    const mapped = candidates
      .filter((x) => x.id !== it.id)
      .map((x) => `${x.jp_kana} • ${x.jp_kanji} — ${x.en}`);
    const distractors = sample(uniq(mapped.filter(Boolean)), 3);
    return { correct, options: shuffle([correct, ...distractors]) };
  }
  const isJPAnswer = (q.qmode === "en2jp" || q.qmode === "listen2jp");
  const correct = isJPAnswer ? jpDisplay(it, displayModeForItem(it, dmode)) : it.en;

  const others = pool.filter(x => x.id !== it.id);
  const picks = sample(others, 12);
  const mapped = picks.map(x => isJPAnswer ? jpDisplay(x, displayModeForItem(x, dmode)) : x.en);
  const uniqs = uniq(mapped.filter(Boolean).filter(x => x !== correct));
  const distractors = sample(uniqs, 3);
  const options = shuffle([correct, ...distractors]);
  return { correct, options };
}

function gradeTyping(q, user, dmode) {
  const it = q.item;
  if (!SETTINGS.smartGrade) {
    if (q.qmode === "en2jp" || q.qmode === "listen2jp") {
      const u = (user || "").trim();
      const acceptable = jpAcceptableAnswers(it, "both").map(x => (x || "").trim());
      return acceptable.some(a => a && a === u);
    }
    const u = (user || "").trim();
    const exp = correctAnswerText(q, dmode).trim();
    return u === exp;
  }

  if (q.qmode === "jp2en" || q.qmode === "listen2en") {
    const uVariants = englishVariants(user);
    const aliases = englishAliases(it.en).flatMap(englishVariants).filter(Boolean);
    if (uVariants.length === 0) return false;
    return uVariants.some((u) => aliases.some((a) => a && (u === a || u.includes(a) || a.includes(u))));
  }

  const u = normJP(user);
  if (!u) return false;
  const acceptable = jpAcceptableAnswers(it, "both").map(normJP).filter(Boolean);
  return acceptable.some(a => a === u);
}

let QUIZ = {
  active: false,
  pool: [],
  questions: [],
  idx: 0,
  current: null,
  awaitingNext: false,
  correctCount: 0
};

let TONE_GAME = {
  active: false,
  pool: [],
  questions: [],
  idx: 0,
  current: null,
  awaitingNext: false,
  correctCount: 0
};

let SPEAKING = {
  active: false,
  pool: [],
  questions: [],
  idx: 0,
  current: null,
  awaitingNext: false,
  correctCount: 0,
  recognizer: null,
  listening: false,
  heard: ""
};

function resetQuizUI() {
  $("#quizArea").classList.add("hidden");
  $("#studySetup").classList.remove("hidden");
  $("#answerMC").classList.add("hidden");
  $("#answerType").classList.add("hidden");
  $("#feedback").classList.add("hidden");
  $("#feedback").textContent = "";
  $("#prompt").textContent = "—";
  $("#quizCourse").textContent = "HSK 1 • —";
  $("#quizProgress").textContent = "—";
  $("#btnNext").disabled = true;
}

function resetToneGameUI() {
  $("#toneGameArea")?.classList.add("hidden");
  $("#toneSetup")?.classList.remove("hidden");
  const feedback = $("#toneFeedback");
  if (feedback) {
    feedback.classList.add("hidden");
    feedback.classList.remove("good", "bad");
    feedback.textContent = "";
  }
  const prompt = $("#tonePrompt");
  if (prompt) prompt.textContent = "🎧 Tone listening: which word did you hear?";
  const sub = $("#toneQuizSub");
  if (sub) sub.textContent = "—";
  const progress = $("#toneQuizProgress");
  if (progress) progress.textContent = "—";
  const next = $("#btnNextTone");
  if (next) next.disabled = true;
  const answers = $("#toneAnswerMC");
  if (answers) answers.innerHTML = "";
}

function resetSpeakingUI() {
  $("#speakingQuizArea")?.classList.add("hidden");
  $("#speakingSetup")?.classList.remove("hidden");
  const heard = $("#speakingHeard");
  const feedback = $("#speakingFeedback");
  const prompt = $("#speakingPrompt");
  const progress = $("#speakingQuizProgress");
  const sub = $("#speakingQuizSub");
  const status = $("#speakingStatus");
  const mic = $("#btnStartListening");
  if (heard) {
    heard.classList.add("hidden");
    heard.classList.remove("good", "bad");
    heard.textContent = "";
  }
  if (feedback) {
    feedback.classList.add("hidden");
    feedback.classList.remove("good", "bad");
    feedback.textContent = "";
  }
  if (prompt) prompt.textContent = "—";
  if (progress) progress.textContent = "—";
  if (sub) sub.textContent = "—";
  if (status) status.textContent = "Ready";
  if (mic) {
    mic.disabled = !supportsSpeechRecognition();
    mic.classList.remove("is-listening");
    mic.textContent = "🎙️ Tap to speak";
  }
  const next = $("#btnNextSpeaking");
  if (next) next.disabled = true;
}

function setSpeakingQuizVisibility(active) {
  $("#speakingQuizArea")?.classList.toggle("hidden", !active);
  $("#speakingSetup")?.classList.toggle("hidden", active);
}

function speakingPromptTextForQuestion(q, dmode) {
  if (q.qmode === "jpSpeak") return jpDisplay(q.item, displayModeForItem(q.item, dmode));
  return q.item.en;
}

function stopSpeakingRecognition() {
  if (!SPEAKING.recognizer) return;
  try {
    SPEAKING.recognizer.stop();
  } catch {
    // ignore
  }
}

function setSpeakingListeningState(listening, message = "Ready") {
  SPEAKING.listening = listening;
  const mic = $("#btnStartListening");
  const status = $("#speakingStatus");
  if (mic) {
    mic.classList.toggle("is-listening", listening);
    mic.textContent = listening ? "🎙️ Listening…" : "🎙️ Tap to speak";
  }
  if (status) status.textContent = message;
}

function showSpeakingHeard(text) {
  const heard = $("#speakingHeard");
  if (!heard) return;
  heard.classList.remove("hidden");
  heard.classList.remove("good", "bad");
  heard.textContent = text ? `Heard: “${text}”` : "Heard: (no speech detected)";
}

function submitSpeakingAnswer(transcript) {
  if (!SPEAKING.active || SPEAKING.awaitingNext) return;
  const q = SPEAKING.current;
  if (!q) return;
  SPEAKING.awaitingNext = true;
  const ok = gradeTyping({ ...q, qmode: "en2jp" }, transcript, getSpeakingDMode());
  recordAttempt(q.item.id, ok);
  if (ok) SPEAKING.correctCount += 1;
  $("#btnNextSpeaking").disabled = false;
  const expected = correctAnswerText({ ...q, qmode: "en2jp" }, getSpeakingDMode());
  const detail = ok ? "✅ Correct" : `❌ Incorrect • Correct: ${expected}`;
  const feedback = $("#speakingFeedback");
  feedback.classList.remove("hidden");
  feedback.classList.toggle("good", ok);
  feedback.classList.toggle("bad", !ok);
  feedback.textContent = detail;
}

function nextSpeakingQuestion() {
  if (!SPEAKING.active) return;
  SPEAKING.awaitingNext = false;
  SPEAKING.heard = "";
  $("#btnNextSpeaking").disabled = true;
  const heard = $("#speakingHeard");
  const feedback = $("#speakingFeedback");
  heard?.classList.add("hidden");
  feedback?.classList.add("hidden");
  setSpeakingListeningState(false, "Ready");

  if (SPEAKING.idx >= SPEAKING.questions.length) {
    endSpeakingQuiz();
    return;
  }

  const q = SPEAKING.questions[SPEAKING.idx];
  SPEAKING.current = q;
  const dmode = getSpeakingDMode();
  $("#speakingQuizCourse").textContent = `HSK 1 • ${q.item.lesson}`;
  $("#speakingQuizProgress").textContent = `Question ${SPEAKING.idx + 1}/${SPEAKING.questions.length}`;
  $("#speakingQuizSub").textContent = `Correct: ${SPEAKING.correctCount} • Pool: ${SPEAKING.pool.length}`;
  $("#speakingPrompt").textContent = speakingPromptTextForQuestion(q, dmode);
  $("#speakingPromptHint").textContent = q.qmode === "jpSpeak"
    ? "Read the Chinese aloud for pronunciation practice."
    : "Speak the Chinese answer.";
  $("#btnToggleStarSpeaking").textContent = isStarred(q.item.id) ? "⭐" : "☆";
  maybeAutoplay({ qmode: q.qmode === "jpSpeak" ? "jp2en" : "en2jp", item: q.item });
}

function startSpeakingRecognition() {
  if (!SPEAKING.active || SPEAKING.awaitingNext) return;
  if (!supportsSpeechRecognition()) return;
  stopSpeakingRecognition();
  SPEAKING.recognizer = createSpeechRecognizer({
    lang: "zh-CN",
    onStart: () => setSpeakingListeningState(true, "Listening… speak now."),
    onResult: (transcript) => {
      const heard = (transcript || "").trim();
      SPEAKING.heard = heard;
      showSpeakingHeard(heard);
      submitSpeakingAnswer(heard);
      setSpeakingListeningState(false, heard ? "Captured speech." : "No speech detected.");
    },
    onError: (event) => {
      const map = {
        not_allowed: "Microphone permission denied.",
        service_not_allowed: "Speech service blocked by browser.",
        no_speech: "No speech detected. Try again.",
        audio_capture: "No microphone available."
      };
      const msg = map[event.error] || "Speech recognition failed. Try again.";
      setSpeakingListeningState(false, msg);
      toast(msg);
    },
    onEnd: () => {
      if (!SPEAKING.awaitingNext) {
        setSpeakingListeningState(false, "Ready");
      }
    }
  });
  try {
    SPEAKING.recognizer.start();
  } catch {
    setSpeakingListeningState(false, "Could not start listening.");
  }
}

function startSpeakingQuiz() {
  if (!supportsSpeechRecognition()) {
    toast("Speech recognition is not supported in this browser.");
    return;
  }
  let pool = currentSpeakingPool();
  if (!pool.length) {
    toast("No items in your selected set.");
    return;
  }
  const useAuto = $("#speakingAuto")?.checked ?? true;
  const countValue = Number($("#speakingCount")?.value || 20);
  const qCount = useAuto ? pool.length : Math.max(1, Math.min(500, countValue));
  const maxCount = Math.min(qCount, pool.length);
  if (qCount > pool.length) {
    toast(`Only ${pool.length} items available — speaking set to ${pool.length}.`);
  }
  const qmode = $("#speakingQModeSelect")?.value || "en2jp";
  const questions = shuffle(pool).slice(0, maxCount).map((item) => ({ item, qmode }));
  SPEAKING = {
    active: true,
    pool,
    questions,
    idx: 0,
    current: null,
    awaitingNext: false,
    correctCount: 0,
    recognizer: null,
    listening: false,
    heard: ""
  };
  setSpeakingQuizVisibility(true);
  showView("speaking");
  nextSpeakingQuestion();
}

function endSpeakingQuiz() {
  stopSpeakingRecognition();
  const total = SPEAKING.questions.length;
  const correct = SPEAKING.correctCount;
  SPEAKING.active = false;
  toast(`Speaking finished: ${correct}/${total}`);
  renderStats();
  resetSpeakingUI();
}

function setQuizVisibility(active) {
  $("#quizArea").classList.toggle("hidden", !active);
  $("#studySetup").classList.toggle("hidden", active);
}

function startQuiz(forceStarredOnly=false, overrides={}) {
  const pool0 = currentPool();
  let pool = pool0;

  if (forceStarredOnly) pool = pool.filter(it => isStarred(it.id));
  if (pool.length === 0) {
    toast("No items in your selected set.");
    return;
  }
  const useAuto = overrides.useAuto ?? $("#qAuto").checked;
  const countValue = overrides.qCount ?? Number($("#qCount")?.value || 20);
  const qCount = useAuto
    ? pool.length
    : Math.max(1, Math.min(500, countValue));
  const maxCount = Math.min(qCount, pool.length);
  if (qCount > pool.length) {
    toast(`Only ${pool.length} items available — quiz set to ${pool.length}.`);
  }
  const qmode = overrides.qmode || getQMode();
  const atype = overrides.atype || getAType();

  const questions = shuffle(pool).slice(0, maxCount).map(it => makeQuestion(it, qmode, atype));

  QUIZ = {
    active: true,
    pool,
    questions,
    idx: 0,
    current: null,
    awaitingNext: false,
    correctCount: 0,
    starFiltered: forceStarredOnly || $("#filterStarredOnly").checked
  };

  setQuizVisibility(true);
  nextQuestion();
}


function startToneQuiz() {
  if (!SETTINGS.audioOn) {
    toast("Turn on Audio in Settings to play Tone Game.");
    return;
  }
  const pool0 = currentTonePool();
  let pool = pool0;
  const useAuto = $("#toneAuto")?.checked ?? true;
  const countValue = Number($("#toneCount")?.value || 20);
  const starredOnly = $("#toneStarredOnly")?.checked ?? false;
  if (starredOnly) pool = pool.filter((it) => isStarred(it.id));
  if (pool.length === 0) {
    toast("No items in your selected tone lessons.");
    return;
  }
  const qCount = useAuto ? pool.length : Math.max(1, Math.min(500, countValue));
  const maxCount = Math.min(qCount, pool.length);
  if (qCount > pool.length) {
    toast(`Only ${pool.length} items available — tone game set to ${pool.length}.`);
  }

  TONE_GAME = {
    active: true,
    pool,
    questions: shuffle(pool).slice(0, maxCount),
    idx: 0,
    current: null,
    awaitingNext: false,
    correctCount: 0
  };

  $("#toneSetup")?.classList.add("hidden");
  $("#toneGameArea")?.classList.remove("hidden");
  showView("tone");
  nextToneQuestion();
}

function lockToneChoices(correct, picked) {
  const buttons = $$("#toneAnswerMC .choice");
  buttons.forEach((b) => {
    b.disabled = true;
    const value = b.dataset.value || b.textContent;
    if (value === correct) b.classList.add("correct");
    if (value === picked && picked !== correct) b.classList.add("wrong");
  });
}

function showToneFeedback(ok, detail) {
  const fb = $("#toneFeedback");
  if (!fb) return;
  fb.classList.remove("hidden");
  fb.classList.toggle("good", ok);
  fb.classList.toggle("bad", !ok);
  fb.textContent = detail;
}

function renderToneChoices(item) {
  const host = $("#toneAnswerMC");
  if (!host) return;
  const q = { item, qmode: "tonelisten" };
  const { correct, options } = buildMCOptions(q, TONE_GAME.pool, "both");
  host.innerHTML = "";
  options.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "choice";
    b.dataset.index = String(i);
    b.dataset.value = opt;
    const index = document.createElement("span");
    index.className = "choiceIndex";
    index.textContent = String(i + 1);
    const label = document.createElement("span");
    label.className = "choiceText";
    label.textContent = opt;
    b.append(index, label);
    b.addEventListener("click", () => submitToneChoice(opt, correct));
    host.appendChild(b);
  });
}

function submitToneChoice(picked, correct) {
  if (!TONE_GAME.active || TONE_GAME.awaitingNext) return;
  const item = TONE_GAME.current;
  if (!item) return;
  const ok = picked === correct;
  TONE_GAME.awaitingNext = true;
  $("#btnNextTone").disabled = false;
  lockToneChoices(correct, picked);
  recordAttempt(item.id, ok);
  if (ok) TONE_GAME.correctCount += 1;
  showToneFeedback(ok, ok ? "✅ Correct" : `❌ Incorrect • Correct: ${correct}`);
}

function nextToneQuestion() {
  if (!TONE_GAME.active) return;
  TONE_GAME.awaitingNext = false;
  const feedback = $("#toneFeedback");
  if (feedback) {
    feedback.classList.add("hidden");
    feedback.textContent = "";
  }
  $("#btnNextTone").disabled = true;

  if (TONE_GAME.idx >= TONE_GAME.questions.length) {
    endToneGame();
    return;
  }

  const item = TONE_GAME.questions[TONE_GAME.idx];
  TONE_GAME.current = item;
  $("#toneQuizProgress").textContent = `Question ${TONE_GAME.idx + 1}/${TONE_GAME.questions.length}`;
  $("#toneQuizSub").textContent = `Correct: ${TONE_GAME.correctCount} • Pool: ${TONE_GAME.pool.length}`;
  $("#toneQuizCourse").textContent = `HSK 1 • ${item.lesson}`;
  $("#btnToggleStarTone").textContent = isStarred(item.id) ? "⭐" : "☆";
  renderToneChoices(item);
  playItemAudio(item);
}

function endToneGame() {
  const total = TONE_GAME.questions.length;
  const correct = TONE_GAME.correctCount;
  TONE_GAME.active = false;
  toast(`Tone game finished: ${correct}/${total}`);
  renderStats();
  resetToneGameUI();
}

function setStarButton(item) {
  const on = isStarred(item.id);
  $("#btnToggleStar").textContent = on ? "⭐" : "☆";
}

function maybeAutoplay(q) {
  if (!SETTINGS.autoplay) return;
  const isChineseQuestion = q.qmode === "jp2en" || q.qmode.startsWith("listen") || isToneListenMode(q.qmode);
  if (isChineseQuestion) playItemAudio(q.item);
}

function nextQuestion() {
  QUIZ.awaitingNext = false;
  $("#feedback").classList.add("hidden");
  $("#feedback").textContent = "";
  $("#answerInput").value = "";
  $("#btnNext").disabled = true;

  if (QUIZ.idx >= QUIZ.questions.length) {
    endQuiz();
    return;
  }

  const q = QUIZ.questions[QUIZ.idx];
  QUIZ.current = q;
  const dmode = getDMode();

  $("#quizCourse").textContent = `HSK 1 • ${q.item.lesson}`;
  $("#quizProgress").textContent = `Question ${QUIZ.idx+1}/${QUIZ.questions.length}`;
  $("#quizSub").textContent = `Correct: ${QUIZ.correctCount} • Pool: ${QUIZ.pool.length}`;
  $("#prompt").textContent = promptTextForQuestion(q, dmode);

  setStarButton(q.item);

  const isTyping = q.atype === "type";
  $("#answerType").classList.toggle("hidden", !isTyping);
  $("#answerMC").classList.toggle("hidden", isTyping);

  if (isTyping) {
    $("#answerInput").placeholder = (q.qmode === "jp2en" || q.qmode === "listen2en") ? "Type English…" : "Type Chinese…";
    setTimeout(() => $("#answerInput").focus(), 0);
  } else {
    renderMC(q);
  }

  maybeAutoplay(q);
}

function renderMC(q) {
  const dmode = getDMode();
  const { correct, options } = buildMCOptions(q, QUIZ.pool, dmode);
  const host = $("#answerMC");
  const hasHanziChoices = /[\u3400-\u9fff]/.test(correct);
  host.innerHTML = "";
  host.classList.toggle("hanziChoices", hasHanziChoices);
  options.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "choice";
    b.dataset.index = String(i);
    b.dataset.value = opt;
    const index = document.createElement("span");
    index.className = "choiceIndex";
    index.textContent = String(i + 1);
    const label = document.createElement("span");
    label.className = "choiceText";
    label.textContent = opt;
    b.append(index, label);
    b.addEventListener("click", () => submitMC(opt, correct));
    host.appendChild(b);
  });
}

function lockMC(correct, picked) {
  const buttons = $$("#answerMC .choice");
  buttons.forEach(b => {
    b.disabled = true;
    const value = b.dataset.value || b.textContent;
    if (value === correct) b.classList.add("correct");
    if (value === picked && picked !== correct) b.classList.add("wrong");
  });
}

function showFeedback(ok, detail) {
  const fb = $("#feedback");
  fb.classList.remove("hidden");
  fb.classList.toggle("good", ok);
  fb.classList.toggle("bad", !ok);
  fb.textContent = detail;
}

function submitMC(picked, correct) {
  if (QUIZ.awaitingNext) return;
  const q = QUIZ.current;
  const ok = picked === correct;
  QUIZ.awaitingNext = true;
  lockMC(correct, picked);
  $("#btnNext").disabled = false;

  recordAttempt(q.item.id, ok);
  if (ok) QUIZ.correctCount += 1;

  const exp = correctAnswerText(q, getDMode());
  const detail = ok ? "✅ Correct" : `❌ Incorrect • Correct: ${exp}`;
  showFeedback(ok, detail);
}

function submitTyping() {
  if (QUIZ.awaitingNext) return;
  const q = QUIZ.current;
  const user = $("#answerInput").value;
  if (!user.trim()) return;
  const ok = gradeTyping(q, user, getDMode());
  QUIZ.awaitingNext = true;
  $("#btnNext").disabled = false;

  recordAttempt(q.item.id, ok);
  if (ok) QUIZ.correctCount += 1;

  const exp = correctAnswerText(q, getDMode());
  const detail = ok ? "✅ Correct" : `❌ Incorrect • Correct: ${exp}`;
  showFeedback(ok, detail);
}

function endQuiz() {
  QUIZ.active = false;
  const total = QUIZ.questions.length;
  const correct = QUIZ.correctCount;
  toast(`Finished: ${correct}/${total}`);
  renderStats();
  resetQuizUI();
}

function buildVocabUI() {
  const starOnly = $("#vStarOnly").checked;
  const lessonFilter = $("#vLessonFilter").value;
  const q = ($("#vSearch").value || "").trim();

  let rows = ITEMS.slice();
  if (lessonFilter && lessonFilter !== "__all__") {
    rows = rows.filter(it => lesson_code(it.lesson) === lessonFilter);
  }
  if (starOnly) rows = rows.filter(it => isStarred(it.id));
  if (q) {
    const qn = q.toLowerCase();
    rows = rows.filter(it =>
      (it.en || "").toLowerCase().includes(qn) ||
      (it.jp_kana || "").includes(q) ||
      (it.jp_kanji || "").includes(q) || (it.jp_kana || "").toLowerCase().includes(q.toLowerCase())
    );
  }

  const sortMode = $("#vSort")?.value || "default";
  if (sortMode === "kanji_asc" || sortMode === "kanji_desc") {
    const dir = sortMode === "kanji_asc" ? 1 : -1;
    rows.sort((a, b) => {
      const aHanzi = normJP(a.jp_kanji || a.jp_kana || "");
      const bHanzi = normJP(b.jp_kanji || b.jp_kana || "");
      const kanjiCmp = aHanzi.localeCompare(bHanzi, "zh");
      if (kanjiCmp !== 0) return kanjiCmp * dir;
      const aEn = (a.en || "").toLowerCase();
      const bEn = (b.en || "").toLowerCase();
      return aEn.localeCompare(bEn) * dir;
    });
  }

  const host = $("#vTable");
  host.innerHTML = "";
  const rowEls = [];
  rows.forEach(it => {
    const tr = document.createElement("tr");
    tr.dataset.id = it.id;
    const starOn = isStarred(it.id);
    const audioId = audioIdForItem(it);
    tr.innerHTML = `
      <td><button class="starBtn ${starOn ? "on" : ""}" data-id="${it.id}">${starOn ? "⭐" : "☆"}</button></td>
      <td>
        <div class="vocabView">
          <div class="jpDisplayText" style="font-weight:800;">${it.jp_kanji || it.jp_kana || ""}</div>
          <div class="hint pinyinDisplayText">${it.jp_kana || "—"}</div>
          <div class="hint audioHint">${audioId}</div>
        </div>
        <div class="vocabEdit hidden">
          <div class="vocabEditGrid">
            <label class="vocabEditField">Pinyin
              <input class="input compact" type="text" data-field="jp_kana" value="${it.jp_kana || ""}" />
            </label>
            <label class="vocabEditField">Hanzi
              <input class="input compact" type="text" data-field="jp_kanji" value="${it.jp_kanji || ""}" />
            </label>
          </div>
          <div class="hint">Leave blank to remove a field.</div>
        </div>
      </td>
      <td>
        <div class="vocabView enDisplayText">${it.en}</div>
        <div class="vocabEdit hidden">
          <input class="input compact" type="text" data-field="en" value="${it.en || ""}" />
        </div>
      </td>
      <td><span class="hint">${it.lesson}</span></td>
      <td><button class="audioBtn" data-a="${it.id}">🔊</button></td>
      <td class="vocabActions">
        <div class="vocabView">
          <button class="btn subtle editBtn" data-id="${it.id}">Edit</button>
        </div>
        <div class="vocabEdit hidden">
          <div class="row gap">
            <button class="btn primary saveBtn" data-id="${it.id}">Save</button>
            <button class="btn subtle cancelBtn" data-id="${it.id}">Cancel</button>
          </div>
        </div>
      </td>
    `;
    host.appendChild(tr);
    rowEls.push(tr);
  });

  host.querySelectorAll(".starBtn").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.getAttribute("data-id");
      const on = toggleStar(id);
      b.textContent = on ? "⭐" : "☆";
      b.classList.toggle("on", on);
    });
  });

  host.querySelectorAll(".audioBtn").forEach(b => {
    const isOn = SETTINGS.audioOn;
    b.disabled = !isOn;
    b.title = isOn ? "Play audio (=)" : "Audio is off in Settings";
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-a");
      const it = ITEMS_BY_ID.get(id);
      await playItemAudio(it);
    });
  });

  host.querySelectorAll(".editBtn").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.getAttribute("data-id");
      const row = b.closest("tr");
      const item = ITEMS_BY_ID.get(id);
      if (!row || !item) return;
      populateVocabEditRow(row, item);
      setVocabRowEditing(row, true);
    });
  });

  host.querySelectorAll(".cancelBtn").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.getAttribute("data-id");
      const row = b.closest("tr");
      const item = ITEMS_BY_ID.get(id);
      if (!row || !item) return;
      populateVocabEditRow(row, item);
      setVocabRowEditing(row, false);
    });
  });

  host.querySelectorAll(".saveBtn").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.getAttribute("data-id");
      const row = b.closest("tr");
      const item = ITEMS_BY_ID.get(id);
      if (!row || !item) return;
      const kanaInput = row.querySelector("[data-field='jp_kana']");
      const kanjiInput = row.querySelector("[data-field='jp_kanji']");
      const enInput = row.querySelector("[data-field='en']");
      const next = {
        jp_kana: kanaInput ? kanaInput.value.trim() : "",
        jp_kanji: kanjiInput ? kanjiInput.value.trim() : "",
        en: enInput ? enInput.value.trim() : ""
      };
      item.jp_kana = next.jp_kana;
      item.jp_kanji = next.jp_kanji;
      item.en = next.en;
      VOCAB_EDITS[id] = next;
      saveVocabEdits();
      updateVocabRowDisplay(row, item);
      setVocabRowEditing(row, false);
      updateCurrentAudioListIfOpen();
      renderStats();
    });
  });

  updateVocabAudioHints(rowEls);
  $("#vCountHint").textContent = `Showing ${rows.length} of ${ITEMS.length} total.`;
}

async function updateVocabAudioHints(rows) {
  const myToken = ++vocabAudioToken;
  for (const row of rows) {
    const id = row.dataset.id;
    const item = ITEMS_BY_ID.get(id);
    if (!item) continue;
    const audioId = audioIdForItem(item);
    const hintEl = row.querySelector(".audioHint");
    if (!hintEl) continue;
    const url = await resolveAudioUrl(audioId);
    if (myToken !== vocabAudioToken) return;
    const filename = url ? displayAudioFilename(url) : expectedAudioFilename(audioId);
    hintEl.textContent = audioId !== id ? `ID: ${id} • Audio: ${filename}` : filename;
  }
}

function renderStats() {
  const s = getStats();
  $("#statTotalAttempts").textContent = String(s.attempts || 0);
  const acc = (s.attempts ? Math.round((s.correct/s.attempts)*100) : 0);
  $("#statAccuracy").textContent = `${acc}%`;

  const arr = Object.entries(s.perItem || {})
    .map(([id, v]) => ({ id, a: v.a || 0, c: v.c || 0, miss: (v.a||0)-(v.c||0) }))
    .filter(x => x.a >= 3 && x.miss > 0)
    .sort((a,b) => b.miss - a.miss)
    .slice(0, 10);

  const host = $("#missList");
  if (!arr.length) {
    host.textContent = "No misses yet (or not enough attempts).";
    return;
  }
  host.innerHTML = "";
  arr.forEach(x => {
    const it = ITEMS_BY_ID.get(x.id);
    const row = document.createElement("div");
    row.className = "missRow";
    row.innerHTML = `
      <div>
        <div style="font-weight:900;">${it ? jpDisplay(it, "both") : x.id}</div>
        <div class="hint">${it ? it.en : ""} • Misses: ${x.miss}/${x.a}</div>
      </div>
      <div class="row gap">
        <button class="btn subtle" data-play="${x.id}">🔊</button>
        <button class="btn subtle" data-star="${x.id}">${isStarred(x.id) ? "⭐" : "☆"}</button>
      </div>
    `;
    host.appendChild(row);
  });

  host.querySelectorAll("[data-play]").forEach(b => {
    b.addEventListener("click", () => {
      const it = ITEMS_BY_ID.get(b.getAttribute("data-play"));
      playItemAudio(it);
    });
  });
  host.querySelectorAll("[data-star]").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.getAttribute("data-star");
      const on = toggleStar(id);
      b.textContent = on ? "⭐" : "☆";
    });
  });
}

function wireUI() {
  const hasFinePointer = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
  const isNarrowView = window.matchMedia && window.matchMedia("(max-width: 720px)").matches;
  const isDesktopInput = hasFinePointer && !isNarrowView && !("ontouchstart" in window);

  $$(".navBtn").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
  $("#btnAppRefresh").addEventListener("click", forceRefreshApp);

  $("#btnSelectAll").addEventListener("click", () => {
    $$("#lessonList input[type=checkbox]").forEach(x => x.checked = true);
    refreshHeaderCounts(); updateLessonHint(); buildVocabUI(); updateQuestionCountUI();
    updateCurrentAudioListIfOpen();
  });
  $("#btnClearAll").addEventListener("click", () => {
    $$("#lessonList input[type=checkbox]").forEach(x => x.checked = false);
    refreshHeaderCounts(); updateLessonHint(); buildVocabUI(); updateQuestionCountUI();
    updateCurrentAudioListIfOpen();
  });
  $("#btnStarredOnly").addEventListener("click", () => {
    $$("#lessonList input[type=checkbox]").forEach(x => x.checked = true);
    $("#filterStarredOnly").checked = true;
    refreshHeaderCounts(); updateLessonHint(); buildVocabUI(); updateQuestionCountUI();
    updateCurrentAudioListIfOpen();
  });
  $("#btnSelectAllSpeaking")?.addEventListener("click", () => {
    $$("#speakingLessonList input[type=checkbox]").forEach((x) => x.checked = true);
    updateSpeakingLessonHint();
    updateSpeakingQuestionCountUI();
  });
  $("#btnClearAllSpeaking")?.addEventListener("click", () => {
    $$("#speakingLessonList input[type=checkbox]").forEach((x) => x.checked = false);
    updateSpeakingLessonHint();
    updateSpeakingQuestionCountUI();
  });
  $("#btnStarredOnlySpeaking")?.addEventListener("click", () => {
    $$("#speakingLessonList input[type=checkbox]").forEach((x) => x.checked = true);
    $("#speakingStarredOnly").checked = true;
    updateSpeakingLessonHint();
    updateSpeakingQuestionCountUI();
  });
  $("#btnSelectAllTone")?.addEventListener("click", () => {
    $$("#toneLessonList input[type=checkbox]").forEach((x) => x.checked = true);
    updateToneHint();
  });
  $("#btnClearAllTone")?.addEventListener("click", () => {
    $$("#toneLessonList input[type=checkbox]").forEach((x) => x.checked = false);
    updateToneHint();
  });

  $("#btnStart").addEventListener("click", () => startQuiz(false));
  $("#btnPracticeStarred").addEventListener("click", () => startQuiz(true));
  $("#btnStartSpeaking")?.addEventListener("click", startSpeakingQuiz);
  $("#btnStartListening")?.addEventListener("click", startSpeakingRecognition);
  $("#btnReplaySpeaking")?.addEventListener("click", () => {
    if (!SPEAKING.current) return;
    playItemAudio(SPEAKING.current.item);
  });
  $("#btnToggleStarSpeaking")?.addEventListener("click", () => {
    if (!SPEAKING.current) return;
    const on = toggleStar(SPEAKING.current.item.id);
    $("#btnToggleStarSpeaking").textContent = on ? "⭐" : "☆";
  });
  $("#btnNextSpeaking")?.addEventListener("click", () => {
    if (!SPEAKING.active) return;
    if (!SPEAKING.awaitingNext) {
      toast("Speak an answer first.");
      return;
    }
    SPEAKING.idx += 1;
    nextSpeakingQuestion();
  });
  $("#btnEndSpeaking")?.addEventListener("click", endSpeakingQuiz);
  $("#btnStartTone")?.addEventListener("click", startToneQuiz);
  $("#btnReplayTone")?.addEventListener("click", () => {
    if (!TONE_GAME.current) return;
    playItemAudio(TONE_GAME.current);
  });
  $("#btnToggleStarTone")?.addEventListener("click", () => {
    if (!TONE_GAME.current) return;
    const on = toggleStar(TONE_GAME.current.id);
    $("#btnToggleStarTone").textContent = on ? "⭐" : "☆";
  });
  $("#btnNextTone")?.addEventListener("click", () => {
    if (!TONE_GAME.active) return;
    if (!TONE_GAME.awaitingNext) {
      toast("Pick an answer first.");
      return;
    }
    TONE_GAME.idx += 1;
    nextToneQuestion();
  });
  $("#btnEndTone")?.addEventListener("click", endToneGame);

  $("#btnReplay").addEventListener("click", () => {
    if (!QUIZ.current) return;
    playItemAudio(QUIZ.current.item);
  });
  $("#btnToggleStar").addEventListener("click", () => {
    if (!QUIZ.current) return;
    const on = toggleStar(QUIZ.current.item.id);
    $("#btnToggleStar").textContent = on ? "⭐" : "☆";
  });

  const handleEnterAction = () => {
    if (!QUIZ.active) return;
    if (QUIZ.awaitingNext) {
      advanceToNext();
      return;
    }
    if (!$("#answerType").classList.contains("hidden")) {
      if (!$("#answerInput").value.trim()) return;
      submitTyping();
      return;
    }
    if (!$("#answerMC").classList.contains("hidden")) {
      toast("Pick an answer first.");
    }
  };

  $("#btnSubmit").addEventListener("click", submitTyping);
  $("#answerInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (!$("#answerInput").value.trim()) return;
      e.preventDefault();
      e.stopPropagation();
      handleEnterAction();
    }
  });

  function advanceToNext() {
    if (!QUIZ.active) return;
    if (!QUIZ.awaitingNext) {
      toast("Submit an answer first.");
      return;
    }
    QUIZ.idx += 1;
    nextQuestion();
  }

  $("#btnNext").addEventListener("click", advanceToNext);

  $("#btnEnd").addEventListener("click", () => endQuiz());

  $("#vSearch").addEventListener("input", buildVocabUI);
  $("#vLessonFilter").addEventListener("change", buildVocabUI);
  $("#vStarOnly").addEventListener("change", buildVocabUI);
  $("#vSort").addEventListener("change", buildVocabUI);
  $("#vReset").addEventListener("click", () => {
    $("#vSearch").value = "";
    $("#vLessonFilter").value = "__all__";
    $("#vStarOnly").checked = false;
    $("#vSort").value = "default";
    buildVocabUI();
  });

  $("#filterStarredOnly").addEventListener("change", () => {
    refreshHeaderCounts();
    updateLessonHint();
    buildVocabUI();
    updateQuestionCountUI();
    updateCurrentAudioListIfOpen();
  });
  $("#speakingStarredOnly")?.addEventListener("change", () => {
    updateSpeakingLessonHint();
    updateSpeakingQuestionCountUI();
  });
  $("#speakingAuto")?.addEventListener("change", () => {
    updateSpeakingQuestionCountUI();
  });
  $("#toneStarredOnly")?.addEventListener("change", () => {
    updateToneHint();
  });

  $("#qAuto").addEventListener("change", () => {
    updateQuestionCountUI();
  });
  $("#qModeSelect").addEventListener("change", () => {
    updateQModeDependencies();
  });
  $("#speakingDModeSelect")?.addEventListener("change", () => {
    if (!SPEAKING.active || !SPEAKING.current) return;
    $("#speakingPrompt").textContent = speakingPromptTextForQuestion(SPEAKING.current, getSpeakingDMode());
  });

  $("#setAudioOn").addEventListener("change", () => {
    SETTINGS = setSettings({ audioOn: $("#setAudioOn").checked });
    buildVocabUI();
  });
  $("#setVolume").addEventListener("input", () => {
    SETTINGS = setSettings({ volume: Number($("#setVolume").value) });
  });
  $("#setAutoplay").addEventListener("change", () => {
    SETTINGS = setSettings({ autoplay: $("#setAutoplay").checked });
  });
  $("#setSmartGrade").addEventListener("change", () => {
    SETTINGS = setSettings({ smartGrade: $("#setSmartGrade").checked });
  });
  $("#setBackgroundVideo").addEventListener("change", () => {
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const select = $("#setBackgroundVideo");
    if (prefersReduced) {
      select.value = "off";
      SETTINGS = setSettings({ backgroundVideo: "off" });
      return;
    }
    SETTINGS = setSettings({ backgroundVideo: select.value });
  });
  $("#btnAudioCheck").addEventListener("click", async () => {
    const summary = $("#audioCheckSummary");
    summary.textContent = "Checking audio files…";
    clearAudioCache();
    const ids = ITEMS.map((item) => audioIdForItem(item));
    let found = 0;
    const missing = [];
    for (const id of ids) {
      if (await hasAudioFile(id)) {
        found += 1;
      } else {
        missing.push(id);
      }
    }
    summary.textContent = `Found ${found}/${ids.length} audio files.`;
    if (missing.length) {
      console.warn("Missing audio files (first 10):", missing.slice(0, 10));
    }
  });

  $("#btnCurrentAudioList").addEventListener("click", async () => {
    await buildCurrentAudioList({ force: true });
  });

  $("#btnCloseCurrentAudio").addEventListener("click", () => {
    $("#currentAudioList").classList.add("hidden");
  });

  $("#currentAudioMissingOnly").addEventListener("change", () => {
    if ($("#currentAudioList").classList.contains("hidden")) return;
    if (!CURRENT_AUDIO_ENTRIES.length) {
      buildCurrentAudioList({ force: true });
      return;
    }
    renderCurrentAudioList(CURRENT_AUDIO_ENTRIES);
  });

  $("#btnReloadData").addEventListener("click", async () => {
    toast("Reloading lessons…");
    await loadData();
    toast("Reloaded.");
  });
  $("#btnResetStars").addEventListener("click", () => {
    if (!confirm("Reset all stars on this device?")) return;
    STARRED = new Set();
    saveStars();
    localStorage.removeItem(STORAGE.seeded);
    buildVocabUI();
    refreshHeaderCounts();
    updateLessonHint();
    updateQuestionCountUI();
    updateSpeakingLessonHint();
    updateSpeakingQuestionCountUI();
    updateCurrentAudioListIfOpen();
    if (QUIZ.current) setStarButton(QUIZ.current.item);
    if (TONE_GAME.current) {
      $("#btnToggleStarTone").textContent = isStarred(TONE_GAME.current.id) ? "⭐" : "☆";
    }
    if (QUIZ.active && QUIZ.starFiltered) {
      endQuiz();
    }
    if (TONE_GAME.active && $("#toneStarredOnly")?.checked) {
      endToneGame();
    }
    if (SPEAKING.active && $("#speakingStarredOnly")?.checked) {
      endSpeakingQuiz();
    }
    toast("Stars reset.");
  });
  $("#btnResetStats").addEventListener("click", () => {
    if (!confirm("Reset stats on this device?")) return;
    saveJSON(STORAGE.stats, { attempts: 0, correct: 0, perItem: {} });
    renderStats();
    toast("Stats reset.");
  });

  window.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    const inInput = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
    const key = e.key;
    const isTypingMode = QUIZ.active && !$("#answerType").classList.contains("hidden");
    const isMCMode = QUIZ.active && !$("#answerMC").classList.contains("hidden");
    const isToneMCMode = TONE_GAME.active && !$("#toneGameArea")?.classList.contains("hidden");
    const isSpeakingMode = SPEAKING.active && !$("#speakingQuizArea")?.classList.contains("hidden");

    if (key === "=") {
      if (QUIZ.active || TONE_GAME.active || SPEAKING.active) {
        e.preventDefault();
        if (QUIZ.current) playItemAudio(QUIZ.current.item);
        if (TONE_GAME.current) playItemAudio(TONE_GAME.current);
        if (SPEAKING.current) playItemAudio(SPEAKING.current.item);
      }
      return;
    }
    if (key === "`") {
      if (QUIZ.active || TONE_GAME.active || SPEAKING.active) {
        e.preventDefault();
        if (QUIZ.current) {
          const on = toggleStar(QUIZ.current.item.id);
          $("#btnToggleStar").textContent = on ? "⭐" : "☆";
        }
        if (TONE_GAME.current) {
          const on = toggleStar(TONE_GAME.current.id);
          $("#btnToggleStarTone").textContent = on ? "⭐" : "☆";
        }
        if (SPEAKING.current) {
          const on = toggleStar(SPEAKING.current.item.id);
          $("#btnToggleStarSpeaking").textContent = on ? "⭐" : "☆";
        }
      }
      return;
    }

    if ((isMCMode || isToneMCMode) && ["1","2","3","4"].includes(key)) {
      e.preventDefault();
      const idx = Number(key) - 1;
      const btn = isToneMCMode ? $$("#toneAnswerMC .choice")[idx] : $$("#answerMC .choice")[idx];
      if (btn) btn.click();
      return;
    }

    if (key === "Enter" && TONE_GAME.active && !inInput) {
      e.preventDefault();
      if (!TONE_GAME.awaitingNext) {
        toast("Pick an answer first.");
        return;
      }
      TONE_GAME.idx += 1;
      nextToneQuestion();
      return;
    }
    if (key === "Enter" && isSpeakingMode && !inInput) {
      e.preventDefault();
      if (SPEAKING.awaitingNext) {
        SPEAKING.idx += 1;
        nextSpeakingQuestion();
      } else {
        startSpeakingRecognition();
      }
      return;
    }

    if (key === "Enter" && QUIZ.active && !inInput) {
      e.preventDefault();
      handleEnterAction();
      return;
    }

    if (inInput) return;
    if (!isDesktopInput) return;

    if (key === "/" && QUIZ.active) {
      e.preventDefault();
      if (isTypingMode) $("#answerInput").focus();
      return;
    }

    if (!QUIZ.active) return;

    if (isTypingMode) {
      if (key === "Enter") {
        e.preventDefault();
        handleEnterAction();
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && key.length === 1) {
        const input = $("#answerInput");
        e.preventDefault();
        input.focus();
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.value = input.value.slice(0, start) + key + input.value.slice(end);
        const nextPos = start + key.length;
        input.setSelectionRange(nextPos, nextPos);
        return;
      }
    }

    if (key === "Enter") {
      e.preventDefault();
      handleEnterAction();
    }
  });

  showView("study");
  resetSpeakingUI();
  resetToneGameUI();
  applySettingsToUI(SETTINGS);
}

(async function init() {
  $("#settingsHint").textContent = "Stars and stats are saved only on this device/browser (personal).";
  $("#versionLabel").textContent = APP_VERSION;
  SETTINGS = getSettings();
  applySettingsToUI(SETTINGS);
  setIphoneAudioSessionMixing();
  wireUI();
  if ("serviceWorker" in navigator) {
    try {
      SW_REGISTRATION = await navigator.serviceWorker.register("./sw.js");
      if (SW_REGISTRATION.waiting) {
        toast("Update ready. Tap Refresh / Update App.");
      }
      SW_REGISTRATION.addEventListener("updatefound", () => {
        attachWaitingServiceWorker(SW_REGISTRATION.installing);
      });
      attachWaitingServiceWorker(SW_REGISTRATION.installing);
    } catch {
      // Ignore registration failures
    }
  }
  await loadData();
  updateQuestionCountUI();
})();
