# scq_lines.py: re-voice Wei Ling (the daughter) with the Voicebox profile "Scq" (owner 16 Oct). Only her two lines that
# are heard in the film: c04-wei and c07-wei-sunday. Scq speaks faster than qsy, so the lines keep their NATURAL length
# (no time-stretch) and the chapters are retimed to them (c04_office.js VOICE, c07_clinic.js VOX): the bubble still
# shows exactly while the voice plays.
#   synthesise word for word (a few punctuation variants, fixed seeds) -> trim like vb_lines.py (0.03 s before speech,
#   0.08 s after) -> Whisper check (match >= 0.9) -> keep a take no longer than the old line (so it fits the shots) and
#   as close to it as possible; for c07-wei-sunday the second sentence must start where there is a pause.
# Writes audio/voices-v5/<id>.wav (old qsy files kept in voices-v5/qsy/), updates voices-v5.json (duration, phrases,
# second_line_at, env = loudness 0-9 at 15 steps a second, as c07_clinic.js uses).
#   D:/AI/whisper-env/Scripts/python.exe -I D:/ripple-c2/film/promo/audio/scq_lines.py
import difflib, json, os, re, site, shutil, time, urllib.error, urllib.request
from pathlib import Path
for sd in site.getsitepackages():
    root = Path(sd) / "nvidia"
    if root.is_dir():
        for b in sorted(root.glob("*/bin")):
            os.environ["PATH"] = str(b) + os.pathsep + os.environ.get("PATH", "")
            if hasattr(os, "add_dll_directory"): os.add_dll_directory(str(b))
import numpy as np, soundfile as sf
from faster_whisper import WhisperModel

HERE = Path(__file__).resolve().parent
OUT = HERE / "voices-v5"; KEEP = OUT / "qsy"; KEEP.mkdir(exist_ok=True)
TAKES = HERE / "voicebox" / "scq"; TAKES.mkdir(parents=True, exist_ok=True)
B = "http://127.0.0.1:17493"
SEEDS = [23, 71, 47, 101, 7, 11]
TABLE = json.load(open(HERE / "voices-v5.json", encoding="utf-8"))
LINES = {
    "c04-wei": {"texts": ["Dad... I'll come with you, to Dr Lim, at ten thirty!", "Dad, I'll come with you to Dr Lim at ten thirty!"], "second": None},
    "c07-wei-sunday": {"texts": ["Dad, you missed it on Sunday, remember? ... You went to the market early.",
                                 "Dad, you missed it on Sunday, remember? You went to the market early."], "second": "You"},
}


def get(path, timeout=60):
    with urllib.request.urlopen(B + path, timeout=timeout) as r: return r.read()


PID = {p["name"]: p["id"] for p in json.loads(get("/profiles"))}["Scq"]


def synth(text, seed, path):
    body = json.dumps({"profile_id": PID, "text": text, "language": "en", "seed": seed, "personality": False, "normalize": True}).encode()
    req = urllib.request.Request(B + "/generate", data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=1800) as r: gid = json.loads(r.read())["id"]
    t0 = time.time()
    while True:
        try:
            w = get(f"/audio/{gid}")
            if w[:4] == b"RIFF": break
        except urllib.error.HTTPError as e:
            if e.code not in (404, 500): raise
        if time.time() - t0 > 900: raise SystemExit(f"timed out: {text}")
        time.sleep(1.5)
    path.write_bytes(w)


def mono(path):
    x, sr = sf.read(path); return (x if x.ndim == 1 else x.mean(1)), sr


def rms_db(x, sr, step):
    hop = int(sr * step); n = len(x) // hop
    return np.array([20 * np.log10(np.sqrt(np.mean(x[i * hop:(i + 1) * hop] ** 2) + 1e-12)) for i in range(n)])


def phrases(x, sr, gate=-40, gap=0.12):
    on = rms_db(x, sr, 0.01) > gate; out = []; i = 0; n = len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]: j += 1
            s, e = i * 0.01, j * 0.01
            if out and s - out[-1][1] < gap: out[-1] = (out[-1][0], e)
            else: out.append((s, e))
            i = j
        else: i += 1
    return out


def env15(x, sr):
    d = rms_db(x, sr, 1 / 15); top = d.max()
    return "".join(str(int(np.clip(round((v - (top - 36)) / 36 * 9), 0, 9))) for v in d)


def norm(s):
    s = s.lower().replace("ten thirty", "1030").replace("10:30", "1030").replace("10 .30", "1030").replace("mister", "mr")
    return re.sub(r"[\s\W_]+", "", s)


model = WhisperModel("large-v3", device="cuda", compute_type="float16")


def heard(path):
    segs, _ = model.transcribe(str(path), language="en", beam_size=5, word_timestamps=True)
    words = [w for s in segs for w in s.words]
    return " ".join(w.word.strip() for w in words), words


report = {}
for lid, spec in LINES.items():
    spoken, old = TABLE[lid]["spoken"], TABLE[lid]["duration"]
    cands = []
    for vi, text in enumerate(spec["texts"]):
        for seed in SEEDS:
            raw = TAKES / f"{lid}-v{vi}-s{seed}.wav"
            if not raw.exists(): synth(text, seed, raw)
            x, sr = mono(raw); ph = phrases(x, sr)
            a, b = ph[0][0], ph[-1][1]
            y = x[max(0, int((a - 0.03) * sr)): int((b + 0.08) * sr)]
            trimmed = TAKES / f"{lid}-v{vi}-s{seed}-trim.wav"; sf.write(trimmed, y, sr)
            h, words = heard(trimmed)
            score = difflib.SequenceMatcher(None, norm(spoken), norm(h)).ratio()
            dur = len(y) / sr
            sec_at = None
            if spec["second"]:
                w2 = [w for w in words if w.word.strip().lower().startswith(spec["second"].lower())]
                sec_at = round(w2[-1].start, 2) if w2 else None
            ok = score >= 0.9 and dur <= old + 0.02 and dur >= old - 1.2 and (not spec["second"] or sec_at is not None)
            cands.append({"text": text, "seed": seed, "file": trimmed.name, "dur": round(dur, 3), "match": round(score, 3), "heard": h,
                          "second_at": sec_at, "ok": ok})
            print(f"{lid} v{vi} seed {seed}: {dur:.2f}s match {score:.2f} second {sec_at} ok={ok} | {h}", flush=True)
    good = [c for c in cands if c["ok"]]
    if not good: raise SystemExit(f"no usable take for {lid}")
    pick = min(good, key=lambda c: old - c["dur"])           # the longest take that still fits = closest to the old pace
    src = TAKES / pick["file"]
    if not (KEEP / f"{lid}.wav").exists(): shutil.copy2(OUT / f"{lid}.wav", KEEP / f"{lid}.wav")
    shutil.copy2(src, OUT / f"{lid}.wav")
    y, sr = mono(OUT / f"{lid}.wav")
    ph = [(round(s, 3), round(e, 3)) for s, e in phrases(y, sr)]
    TABLE[lid].update({"voice": "Scq", "duration": round(len(y) / sr, 3), "phrases": ph, "heard": pick["heard"], "match": pick["match"],
                       "source_take": pick["file"], "spoken_as": pick["text"], "second_line_at": pick["second_at"], "env": env15(y, sr),
                       "replaced_qsy_take": f"voices-v5/qsy/{lid}.wav"})
    report[lid] = {"pick": pick, "candidates": cands}
    print(f"==> {lid}: {pick['file']} {len(y) / sr:.3f}s (was {old}) phrases {ph} second {pick['second_at']}", flush=True)

json.dump(TABLE, open(HERE / "voices-v5.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(report, open(TAKES / "report.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("done")
