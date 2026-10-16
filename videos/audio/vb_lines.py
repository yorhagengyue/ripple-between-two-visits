# vb_lines.py: the v5 voice table. Every speech bubble in the film is one voiced line (owner, 16 Oct: the bubble appears
# when the voice starts and goes when it ends; nothing cut off; bubbles without voice get one). Voices: Wei Ling = qsy,
# Mr Tan = gy, Dr Lim = lim, the MRT passenger = kuang.
#   D:/AI/whisper-env/Scripts/python.exe -I audio/vb_lines.py
# Reuses the takes vb_voices.py already checked; synthesises the new lines the same way (word for word, fixed seeds,
# Whisper check, next seed on a mismatch). Writes audio/voices-v5/<id>.wav (trimmed to 0.03 s before the first voiced
# sample and 0.08 s after the last) and audio/voices-v5.json: id, speaker, voice, spoken text, bubble lines, duration
# (s, the whole trimmed file, which is how long the bubble stays up) and phrases (start, end in the file).
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
VB = HERE / "voicebox"; OUT = HERE / "voices-v5"; OUT.mkdir(exist_ok=True)
B = "http://127.0.0.1:17493"
VOICE = {"doctor": ("lim", "en"), "family": ("qsy", "en"), "patient": ("gy", "zh"), "passenger": ("kuang", "en")}
SEEDS = [23, 7, 11, 31, 47, 59]

# id: (speaker, spoken text, bubble lines, reuse an existing checked take or None)
LINES = {
    "c03-tan": ("patient", "早上打完太极，还没吃早餐。", ["Did tai chi this morning, no breakfast yet.", "早上打完太极，还没吃早餐。"], "s2-his-words"),
    "c04-wei": ("family", "Dad, I'll come with you to Dr Lim at ten thirty!", ["Dad, I'll come with you to Dr Lim at 10:30!"], None),
    "c05-lim-a": ("doctor", "Over the years, high pressure damages the heart, the brain and the kidneys.",
                  ["Over the years, high pressure damages", "the heart, the brain and the kidneys."], "s3-doctor-a"),
    "c05-lim-b": ("doctor", "So you take it every day, even when you feel fine.", ["So you take it every day,", "even when you feel fine."], "s3-doctor-b"),
    "c06-passenger": ("passenger", "Morning, uncle!", ["Morning, uncle!"], None),
    "c06-tan": ("patient", "早啊！", ["Morning!", "早啊！"], None),
    "c07-lim-hello": ("doctor", "Good morning, Mr Tan. Please have a seat. Your daughter came with you today.",
                      ["Good morning, Mr Tan. Please have a seat.", "Your daughter came with you today."], "conv00"),
    "c07-wei-intro": ("family", "Good morning, doctor. I'm his daughter, and Dad has been getting headaches in the morning this week.",
                      ["Good morning, doctor. I'm his daughter,", "and Dad has been getting headaches", "in the morning this week."], "conv01"),
    "c07-tan-headache": ("patient", "医生，我这几天早上起来头有点痛，晚上也睡不好。",
                         ["Doctor, my head aches in the mornings", "and I don't sleep well at night.", "医生，我这几天早上起来头有点痛，晚上也睡不好。"], "conv02"),
    "c07-lim-bp": ("doctor", "Let me check your blood pressure. It is one hundred and fifty two over ninety four, higher than last time.",
                   ["Let me check your blood pressure.", "It is 152 over 94, higher than last time."], "conv03"),
    "c07-tan-amlo": ("patient", "医生，amlodipine 我每天早上都有吃，没有忘记。",
                     ["Doctor, I take amlodipine every morning.", "I haven't forgotten!", "医生，amlodipine 我每天早上都有吃，没有忘记。"], "conv04"),
    "c07-wei-sunday": ("family", "Dad, you missed it on Sunday, remember? You went to the market early.",
                       ["Dad, you missed it on Sunday, remember?", "You went to the market early."], "conv05"),
    "c07-lim-10mg": ("doctor", "Mister Tan, we will increase the amlodipine to ten milligrams, every morning.",
                     ["Mr Tan, we will increase the amlodipine", "to 10 milligrams every morning."], "conv06"),
    "c07-tan-10mg": ("patient", "十毫克，每天早上吃一粒，对吗？", ["Ten milligrams, one tablet every morning, right?", "十毫克，每天早上吃一粒，对吗？"], "conv07"),
    "c07-lim-yes": ("doctor", "Yes, that's right. Please measure your blood pressure at home every morning.",
                    ["Yes, that's right. Please measure", "your blood pressure at home every morning."], "conv08"),
    "c07-tan-taichi": ("patient", "医生，我打太极的早上没吃早餐，血压就比较高，要怎么安排？",
                       ["On tai chi mornings I skip breakfast", "and my pressure is higher. What should I do?", "医生，我打太极的早上没吃早餐，血压就比较高，要怎么安排？"], "conv09"),
    "c07-lim-answer": ("doctor", "On tai chi mornings, have a small breakfast first, then rest five minutes before you measure. Write it down and show me in two weeks.",
                       ["On tai chi mornings, have a small breakfast first,", "then rest five minutes before you measure.", "Write it down and show me in two weeks."], "conv10"),
    "c07-wei-help": ("family", "I can help him record it on his phone. Should we worry about the headaches?",
                     ["I can help him record it on his phone.", "Should we worry about the headaches?"], "conv11"),
    "c07-lim-worse": ("doctor", "If they get worse, bring him back earlier. Otherwise, come back in two weeks.",
                      ["If they get worse, bring him back earlier.", "Otherwise, come back in two weeks."], "conv12"),
    "c07-tan-ok": ("patient", "好的医生，那我两个星期以后再来。谢谢医生。", ["OK, doctor, I'll come back in two weeks. Thank you!", "好的医生，那我两个星期以后再来。谢谢医生。"], "conv13"),
    "c07-wei-remind": ("family", "Okay, Dad, I will remind you every morning.", ["Okay, Dad, I will remind you every morning."], "conv14"),
    "c09-lim": ("doctor", "Mister Tan, we will increase the amlodipine to ten milligrams, every morning.",
                ["Mr Tan, we will increase the amlodipine", "to 10 milligrams every morning."], "conv06"),
    "c11-tan-q": ("patient", "今天血压一百五十二，九十六，我能不能多吃一粒？",
                  ["My blood pressure is 152/96 today,", "can I take one more tablet?", "今天血压一百五十二，九十六，我能不能多吃一粒？"], "s4-his-words"),
    "c11-lim-dose": ("doctor", "Please don't change the dose yourself.", ["Please don't change the dose yourself."], "s4-doctor"),
    "c11-tan-chest": ("patient", "爬完楼梯，胸口有点闷。", ["My chest feels tight after climbing the stairs.", "爬完楼梯，胸口有点闷。"], None),
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


def mono(path):
    x, sr = sf.read(path); return (x if x.ndim == 1 else x.mean(1)), sr


def phrases(x, sr, gate=-40, gap=0.12):
    hop = int(sr * 0.01); n = len(x) // hop
    rms = np.array([np.sqrt(np.mean(x[i * hop:(i + 1) * hop] ** 2) + 1e-12) for i in range(n)])
    on = 20 * np.log10(rms) > gate; out = []; i = 0
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]: j += 1
            s, e = i * hop / sr, j * hop / sr
            if out and s - out[-1][1] < gap: out[-1] = (out[-1][0], e)
            else: out.append((s, e))
            i = j
        else: i += 1
    return out


NUMS = {"one hundred and fifty two": "152", "ninety four": "94", "ten thirty": "1030", "10:30": "1030", "ten milligrams": "10mg",
        "ten": "10", "five": "5", "two": "2", "一百五十二": "152", "九十六": "96", "十毫克": "10毫克", "mister": "mr"}


def norm(s):
    s = s.lower()
    for k, v in NUMS.items(): s = s.replace(k, v)
    s = s.replace("milligrams", "mg").replace(" mg", "mg")
    return re.sub(r"[\s\W_]+", "", s)


model = WhisperModel("large-v3", device="cuda", compute_type="float16")


def check(path, speaker, text):
    segs, _ = model.transcribe(str(path), language=VOICE[speaker][1], beam_size=5)
    heard = " ".join(s.text.strip() for s in segs)
    return heard, difflib.SequenceMatcher(None, norm(text), norm(heard)).ratio()


def new_take(lid, speaker, text):
    tried = []
    for seed in SEEDS:
        p = VB / f"{lid}-{VOICE[speaker][0]}-s{seed}.wav"
        if not p.exists(): synth(speaker, text, seed, p)
        heard, score = check(p, speaker, text)
        tried.append({"seed": seed, "file": p.name, "heard": heard, "score": round(float(score), 3)})
        print(f"  {lid} seed {seed}: match {score:.2f}: {heard}", flush=True)
        if score >= 0.9: return p, tried
    return VB / max(tried, key=lambda t: t["score"])["file"], tried


manifest = json.load(open(VB / "manifest.json", encoding="utf-8"))
picked = {f"conv{c['i']:02d}": VB / c["pick"]["file"] for c in manifest["conversation"]}
picked.update({k: VB / v["pick"]["file"] for k, v in manifest["singles"].items()})
table = {}
for lid, (spk, text, bubble, reuse) in LINES.items():
    tried = []
    src = picked[reuse] if reuse else None
    if src is None: src, tried = new_take(lid, spk, text)
    x, sr = mono(src)
    ph = phrases(x, sr)
    a, b = ph[0][0], ph[-1][1]
    y = x[max(0, int((a - 0.03) * sr)): int((b + 0.08) * sr)]
    sf.write(OUT / f"{lid}.wav", y, sr)
    ph2 = [(round(s - a + 0.03, 3), round(e - a + 0.03, 3)) for s, e in phrases(y, sr)]
    heard, score = check(OUT / f"{lid}.wav", spk, text)
    table[lid] = {"speaker": spk, "voice": VOICE[spk][0], "spoken": text, "bubble": bubble, "file": f"audio/voices-v5/{lid}.wav",
                  "duration": round(len(y) / sr, 3), "phrases": ph2, "heard": heard, "match": round(float(score), 3),
                  "source_take": src.name, "new_takes": tried}
    print(f"{lid:18s} {len(y) / sr:5.2f} s  match {score:.2f}  {heard}", flush=True)
json.dump(table, open(HERE / "voices-v5.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote", HERE / "voices-v5.json")
