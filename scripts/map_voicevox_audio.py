#!/usr/bin/env python3
"""
Map/rename VoiceVox-style wav files to the game's expected /audio/<itemId>.wav.

Usage (run from repo root):
  python3 scripts/map_voicevox_audio.py
or if you put it elsewhere:
  python3 map_voicevox_audio.py

What it does:
- Loads vocab items from lessons/index.json and each lesson file it references
- Moves non-<id>.wav audio files into audio/raw/
- Extracts the last underscore-separated token from each raw filename
- Matches the token to item.jp_kana or item.jp_kanji (exact match after normalization)
- Copies to audio/<itemId>.wav (does not overwrite)
- Writes audio/audio_map_report.json
"""
import json, os, re, shutil, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent if (Path(__file__).parts[-2:] == ("scripts","map_voicevox_audio.py")) else Path.cwd()
AUDIO_DIR = ROOT / "audio"
LESSONS_DIR = ROOT / "lessons"

PUNCT_RE = re.compile(r"[。．.、,，'’\"“”！？!?：:;；・（）()\[\]{}「」『』＜＞<>【】]")
WS_RE = re.compile(r"\s+")

def norm(s: str) -> str:
    s = s or ""
    s = unicodedata.normalize("NFKC", s)
    s = WS_RE.sub("", s)
    s = PUNCT_RE.sub("", s)
    s = s.replace("～", "").replace("〜", "")
    return s.strip()

def load_items():
    idx_path = LESSONS_DIR / "index.json"
    if not idx_path.exists():
        raise SystemExit(f"Missing {idx_path}. Run this from the repo root (where lessons/index.json exists).")
    idx = json.loads(idx_path.read_text(encoding="utf-8"))
    items = []
    for lesson in idx.get("lessons", []):
        fp = ROOT / lesson["file"]
        arr = json.loads(fp.read_text(encoding="utf-8"))
        items.extend(arr)
    # Build lookup: normalized token -> list[itemId]
    by_token = {}
    for it in items:
        item_id = it.get("id")
        kana = norm(it.get("jp_kana",""))
        kanji = norm(it.get("jp_kanji",""))
        for t, src in [(kana,"jp_kana"), (kanji,"jp_kanji")]:
            if not t: 
                continue
            by_token.setdefault(t, []).append((item_id, src))
    return items, by_token

def is_id_named(fname: str, item_ids: set) -> bool:
    # expected: <id>.wav
    base = fname[:-4] if fname.lower().endswith(".wav") else fname
    return base in item_ids

def extract_token_from_filename(fname: str) -> str:
    base = Path(fname).stem
    # Most VoiceVox exports: something_like_..._token
    parts = base.split("_")
    token = parts[-1] if parts else base
    return token

def main():
    AUDIO_DIR.mkdir(exist_ok=True)
    raw_dir = AUDIO_DIR / "raw"
    raw_dir.mkdir(exist_ok=True)

    items, by_token = load_items()
    item_ids = {it.get("id") for it in items if it.get("id")}

    report = {
        "renamed": [],
        "unmatched_files": [],
        "ambiguous": [],
        "duplicates": [],
        "missing_audio_for_itemIds": []
    }

    # Move VoiceVox-style wavs into raw/ (anything that isn't already <id>.wav)
    for p in AUDIO_DIR.glob("*.wav"):
        if not is_id_named(p.name, item_ids):
            shutil.move(str(p), str(raw_dir / p.name))

    # Map raw files -> ids
    for p in sorted(raw_dir.glob("*.wav")):
        token = extract_token_from_filename(p.name)
        tnorm = norm(token)
        candidates = by_token.get(tnorm, [])
        if not candidates:
            report["unmatched_files"].append({"file": p.name, "token": token})
            continue

        # Prefer jp_kana exact, then jp_kanji exact
        kana_matches = [c for c in candidates if c[1] == "jp_kana"]
        chosen = None
        if len(kana_matches) == 1:
            chosen = kana_matches[0]
        elif len(kana_matches) > 1:
            report["ambiguous"].append({"file": p.name, "token": token, "candidateItemIds": [c[0] for c in kana_matches]})
            continue
        else:
            # no kana matches; try kanji
            kanji_matches = [c for c in candidates if c[1] == "jp_kanji"]
            if len(kanji_matches) == 1:
                chosen = kanji_matches[0]
            else:
                report["ambiguous"].append({"file": p.name, "token": token, "candidateItemIds": [c[0] for c in candidates]})
                continue

        item_id, matched_by = chosen
        dest = AUDIO_DIR / f"{item_id}.wav"
        if dest.exists():
            report["duplicates"].append({"file": p.name, "token": token, "itemId": item_id})
            continue

        shutil.copy2(str(p), str(dest))
        report["renamed"].append({"from": f"audio/raw/{p.name}", "to": f"audio/{dest.name}", "itemId": item_id, "token": token, "matchedBy": matched_by})

    # Missing audio summary
    have = {p.stem for p in AUDIO_DIR.glob("*.wav")}
    report["missing_audio_for_itemIds"] = sorted([i for i in item_ids if i not in have])

    out_path = AUDIO_DIR / "audio_map_report.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("✅ Audio mapping complete")
    print(f"- Renamed/copied: {len(report['renamed'])}")
    print(f"- Unmatched:      {len(report['unmatched_files'])}")
    print(f"- Ambiguous:      {len(report['ambiguous'])}")
    print(f"- Duplicates:     {len(report['duplicates'])}")
    print(f"- Missing IDs:    {len(report['missing_audio_for_itemIds'])}")
    print(f"Report written to: {out_path}")

if __name__ == "__main__":
    main()
