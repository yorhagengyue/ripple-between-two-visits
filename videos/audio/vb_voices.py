# vb_voices.py: re-voice every human line in the film with the owner's Voicebox voices (owner, 16 Oct: 「够好，用
# Voicebox 这三个声音把片子里的人声全部换掉」). Wei Ling = qsy, Dr Lim = kuang, Mr Tan = gy (the owner's own voice).
#   D:/AI/whisper-env/Scripts/python.exe -I audio/vb_voices.py        (Voicebox backend on 127.0.0.1:17493)
# Each line is synthesised word for word (personality off) with a fixed seed, transcribed back with Whisper to check it,
# retried with the next seed if the words came out wrong or the line is too long for its slot, and then laid out on the
# same clock as the voice file it replaces, so voices.py places it 1:1 with the app panels exactly as before.
# Output: audio/voicebox/*.wav and audio/voicebox/manifest.json (every take, its transcript, its duration, the choice).
import difflib, json, os, re, site, sys, time, urllib.error, urllib.request
from pathlib import Path
for sd in site.getsitepackages():  # the cuBLAS fix from the local-transcribe skill: PATH and dll dirs before faster_whisper
    root = Path(sd) / "nvidia"
    if root.is_dir():
        for b in sorted(root.glob("*/bin")):
            os.environ["PATH"] = str(b) + os.pathsep + os.environ.get("PATH", "")
            if hasattr(os, "add_dll_directory"): os.add_dll_directory(str(b))
import numpy as np, soundfile as sf
from faster_whisper import WhisperModel

HERE = Path(__file__).resolve().parent
OUT = HERE / "voicebox"; OUT.mkdir(exist_ok=True)
B = "http://127.0.0.1:17493"
VOICE = {"doctor": ("lim", "en"), "family": ("qsy", "en"), "patient": ("gy", "zh")}
SEEDS = [23, 7, 11, 31, 47, 59]
FILE0 = 19.865  # clip time of the old conversation file's first sample (voices.py: line 1 at 20.9 = file 1.035)
SR = 24000

CONV = [  # (speaker, text, clip start s) from film/s1talk-story/lines.txt and the s1 taps sheet
    ("doctor", "Good morning, Mr Tan. Please have a seat. Your daughter came with you today.", 20.9),
    ("family", "Good morning, doctor. I'm his daughter, and Dad has been getting headaches in the morning this week.", 28.8),
    ("patient", "医生，我这几天早上起来头有点痛，晚上也睡不好。", 36.3),
    ("doctor", "Let me check your blood pressure. It is one hundred and fifty two over ninety four, higher than last time.", 43.7),
    ("patient", "医生，amlodipine 我每天早上都有吃，没有忘记。", 52.4),
    ("family", "Dad, you missed it on Sunday, remember? You went to the market early.", 58.9),
    ("doctor", "Mister Tan, we will increase the amlodipine to ten milligrams, every morning.", 65.2),
    ("patient", "十毫克，每天早上吃一粒，对吗？", 72.0),
    ("doctor", "Yes, that's right. Please measure your blood pressure at home every morning.", 77.3),
    ("patient", "医生，我打太极的早上没吃早餐，血压就比较高，要怎么安排？", 84.0),
    ("doctor", "On tai chi mornings, have a small breakfast first, then rest five minutes before you measure. Write it down and show me in two weeks.", 92.8),
    ("family", "I can help him record it on his phone. Should we worry about the headaches?", 103.6),
    ("doctor", "If they get worse, bring him back earlier. Otherwise, come back in two weeks.", 109.3),
    ("patient", "好的医生，那我两个星期以后再来。谢谢医生。", 117.0),
    ("family", "Okay, Dad, I will remind you every morning.", 124.2),
]
SINGLES = {  # name: (speaker, text, longest allowed seconds)
    "s2-his-words": ("patient", "早上打完太极，还没吃早餐。", 5.8),
    "s4-his-words": ("patient", "今天血压一百五十二，九十六，我能不能多吃一粒？", 6.0),
    "s3-doctor-a": ("doctor", "Over the years, high pressure damages the heart, the brain and the kidneys.", 4.6),
    "s3-doctor-b": ("doctor", "So you take it every day, even when you feel fine.", 3.4),
    "s4-doctor": ("doctor", "Please don't change the dose yourself.", 2.4),
}


def get(path, timeout=60):
    with urllib.request.urlopen(B + path, timeout=timeout) as r: return r.read()


PROFILES = {p["name"]: p["id"] for p in json.loads(get("/profiles"))}


def synth(speaker, text, seed, path):
    name, lang = VOICE[speaker]
    body = json.dumps({"profile_id": PROFILES[name], "text": text, "language": lang, "seed": seed, "personality": False,
                       "normalize": True}).encode()
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


def voiced(x, sr, gate=-40):
    """first and last voiced sample times (s)"""
    hop = int(sr * 0.01); n = len(x) // hop
    rms = np.array([np.sqrt(np.mean(x[i * hop:(i + 1) * hop] ** 2) + 1e-12) for i in range(n)])
    on = np.where(20 * np.log10(rms) > gate)[0]
    return (on[0] * hop / sr, (on[-1] + 1) * hop / sr) if len(on) else (0, len(x) / sr)


NUMS = {"one hundred and fifty two": "152", "ninety four": "94", "ten milligrams": "10mg", "ten": "10", "five": "5",
        "two": "2", "一百五十二": "152", "九十六": "96", "十毫克": "10毫克", "mister": "mr"}


def norm(s):
    s = s.lower()
    for k, v in NUMS.items(): s = s.replace(k, v)
    s = s.replace("10 mg", "10mg").replace("milligrams", "mg").replace(" mg", "mg")
    return re.sub(r"[\s\W_]+", "", s)


model = WhisperModel("large-v3", device="cuda", compute_type="float16")


def check(path, speaker, text):
    lang = VOICE[speaker][1]
    segs, _ = model.transcribe(str(path), language=lang, beam_size=5)
    heard = " ".join(s.text.strip() for s in segs)
    return heard, difflib.SequenceMatcher(None, norm(text), norm(heard)).ratio()


def best_take(key, speaker, text, max_len):
    takes = []
    for seed in SEEDS:
        p = OUT / f"{key}-{VOICE[speaker][0]}-s{seed}.wav"  # the voice name in the file name: a take is never reused for another voice
        if not p.exists(): synth(speaker, text, seed, p)
        x, sr = sf.read(p); x = x if x.ndim == 1 else x.mean(1)
        a, b = voiced(x, sr)
        heard, score = check(p, speaker, text)
        takes.append({"seed": seed, "file": p.name, "voiced": round(float(b - a), 2), "heard": heard, "score": round(float(score), 3)})
        print(f"  {key} seed {seed}: {b - a:.2f} s (max {max_len:.2f}), match {score:.2f}: {heard}", flush=True)
        if score >= 0.9 and b - a <= max_len: return takes[-1], takes
    ok = [t for t in takes if t["score"] >= 0.85]
    pick = min(ok, key=lambda t: t["voiced"]) if ok else max(takes, key=lambda t: t["score"])
    return pick, takes


def trimmed(path):
    x, sr = sf.read(OUT / path); x = x if x.ndim == 1 else x.mean(1)
    if sr != SR: raise SystemExit(f"{path}: {sr} Hz, expected {SR}")
    a, b = voiced(x, sr)
    return x[max(0, int((a - 0.03) * sr)): int((b + 0.08) * sr)]


manifest = {"voices": {k: v[0] for k, v in VOICE.items()}, "conversation": [], "singles": {}}
# the conversation, laid out on the old file's clock: line i's first voiced sample at clip start - FILE0
conv = np.zeros(int(150 * SR))
for i, (spk, text, start) in enumerate(CONV):
    nxt = CONV[i + 1][2] if i + 1 < len(CONV) else start + 9
    pick, takes = best_take(f"conv{i:02d}", spk, text, nxt - start - 0.35)
    y = trimmed(pick["file"]); at = int((start - FILE0 - 0.03) * SR)
    conv[at:at + len(y)] += y
    manifest["conversation"].append({"i": i, "speaker": spk, "text": text, "clip_start": start, "pick": pick, "takes": takes,
                                     "fits": bool(pick["voiced"] <= nxt - start - 0.35)})
sf.write(OUT / "scene1-conversation-vb.wav", conv[: int((CONV[-1][2] - FILE0 + 9) * SR)], SR)
for key, (spk, text, max_len) in SINGLES.items():
    pick, takes = best_take(key, spk, text, max_len)
    y = trimmed(pick["file"])
    sf.write(OUT / f"{key}-vb.wav", np.concatenate([np.zeros(int(0.3 * SR)), y, np.zeros(int(0.2 * SR))]), SR)
    manifest["singles"][key] = {"speaker": spk, "text": text, "max": max_len, "pick": pick, "takes": takes,
                                "fits": bool(pick["voiced"] <= max_len)}
json.dump(manifest, open(OUT / "manifest.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("done:", OUT / "manifest.json")
