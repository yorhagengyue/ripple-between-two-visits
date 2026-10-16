# The v5 sound track (edl-v5.json, 477.8 s = 22 934 400 samples at 48 kHz), one continuous file, agenda included.
#   D:/AI/seed-vc/.venv/Scripts/python.exe audio/build5.py [--v6]     (after audio/music5.py [--v6])
# Voices: the 17 lines of audio/voices-v5, each placed with its first sample on the first frame of its speech bubble
# (out/vlog/*.json "bubbles"); nothing else of any voice is used. Effects: on the first frame of every sound word in the
# logs SOUND_V5.md lists (and the agenda's three row swishes). Mix and master as build.py (v3): music ducked 9 dB under the
# voices, effects 3 dB, soft clip and bus limiters, -16 LUFS, true peak under -1.3 dBTP.
# Writes out/audio-v5.wav, out/audio-v5-cues.json and audio/stems-v5/*.wav. v3/v4 outputs are not touched.
import json, math, os, re, sys
import numpy as np, soundfile as sf, pyloudnorm as pyln
from scipy import signal
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SR, FPS, PROMO, AUD, n_, hp, lp, peaking, undb, db, add_at, make_ir, reverb, first_onset, compress
import edl, sfxlib
import build as B  # the v3 mixer's tools (duck_curve, tp_limit, softclip, peak_mom, panned, kweight, true_peak_db)

# --v6: the v6 cut (edl-v6.json, 461.2 s = 22 137 600 samples; c10 B5 and c11 EXP 04 removed): out/audio-v6.wav,
# out/audio-v6-cues.json, audio/stems-v6/ (music from audio/music5.py --v6); without it everything is v5 as before
V8 = "--v8" in sys.argv   # v8: v7 with part 3 to 466.7 (build slide 14 s), c14 at 466.7-476.7 (22 881 600 samples)
V7 = "--v7" in sys.argv or V8   # v7: v6 up to 304.2; part 3 reworked (304.2-459.2), c14 at 459.2-469.2 (22 521 600 samples)
V6 = "--v6" in sys.argv or V7
VER = "v8" if V8 else "v7" if V7 else "v6" if V6 else "v5"
EDL5 = f"{PROMO}/edl-{VER}.json"
OUT_WAV, OUT_CUES, STEMS = f"{PROMO}/out/audio-{VER}.wav", f"{PROMO}/out/audio-{VER}-cues.json", f"{AUD}/stems-{VER}"
N5 = 22881600 if V8 else 22521600 if V7 else 22137600 if V6 else 22934400
PARTS = [("agenda", 0, 7), ("story", 7, 226.2), ("  c07 clinic", 134, 208.2)] + (
    [("explainer", 226.2, 304.2), ("sober", 304.2, 466.7), ("end card", 466.7, 476.7)] if V8 else
    [("explainer", 226.2, 304.2), ("sober", 304.2, 459.2), ("end card", 459.2, 469.2)] if V7 else
    [("explainer", 226.2, 304.2), ("sober", 304.2, 451.2), ("end card", 451.2, 461.2)] if V6 else
    [("explainer", 226.2, 320.8), ("sober", 320.8, 467.8), ("end card", 467.8, 477.8)])
LOGS = ["out/vlog/a_agenda.json", "out/log-0-15.json", "out/log-15-27.json", "out/vlog/c03_bp.json", "out/vlog/c04_office.json",
        "out/vlog/c05_meds.json", "out/vlog/c06_mrt.json", "out/vlog/c07.json", "out/log-187-205.json", "out/vlog/c09_problem.json",
        "out/log-237-239.json", "out/log-291.5-300.5.json", "out/log-305.5-315.1.json", "out/log-319.6-322.json",
        "out/vlog/c11_trustlab.json", "out/vlog/c14_tryit.json"]
if V6: LOGS.remove("out/log-291.5-300.5.json")  # c10 B5 is cut in v6
VOICE_LOGS = ["out/vlog/c03_bp.json", "out/vlog/c04_office.json", "out/vlog/c05_meds.json", "out/vlog/c06_mrt.json",
              "out/vlog/c07.json", "out/vlog/c09_problem.json", "out/vlog/c11_trustlab.json"]
# the brief's table (SOUND_V5.md): id -> (bubble's first source frame, output start, duration)
TABLE = {"c03-tan": (48.300, 55.300, 2.56), "c04-wei": (77.800, 84.800, 4.56), "c05-lim-a": (101.800, 108.800, 4.14),
         "c05-lim-b": (106.200, 113.200, 2.80), "c06-passenger": (123.500, 130.500, 0.98), "c06-tan": (124.700, 131.700, 0.48),
         "c07-lim-hello": (1140.100, 147.100, 3.46), "c07-lim-bp": (1147.533, 154.533, 5.69), "c07-tan-amlo": (1154.800, 161.800, 4.53),
         "c07-wei-sunday": (1159.633, 166.633, 4.62), "c07-lim-10mg": (1167.133, 174.133, 4.93), "c07-tan-taichi": (1173.333, 180.333, 6.66),
         "c07-lim-answer": (1180.433, 187.433, 8.48), "c09-lim": (218.267, 236.467, 4.93), "c11-tan-q": (1325.567, 278.267, 5.31),
         "c11-lim-dose": (1335.700, 288.400, 1.95), "c11-tan-chest": (1355.167, 305.167, 2.74)}
if V6: TABLE.update({"c11-tan-q": (1325.567, 269.267, 5.31), "c11-lim-dose": (1335.700, 279.400, 1.95), "c11-tan-chest": (1355.167, 296.167, 2.74)})
PHONE = {"c05-lim-a", "c05-lim-b", "c11-lim-dose"}  # Dr Lim's recordings played from Mr Tan's phone
AGENDA_ROWS = [1.10, 1.90, 2.70]                     # a_agenda.js T_ROW: each part card slides in


def segments():
    e, segs, total = edl.load(EDL5)
    assert total * SR // FPS == N5, total
    return [{"name": s["name"], "a": s["a"], "b": s["b"], "oa": s["oa"] / FPS, "ob": s["ob"] / FPS} for s in segs]


def src_to_out(src, segs):
    for s in segs:
        if s["a"] - 1e-6 <= src < s["b"] - 1e-6: return s["oa"] + src - s["a"], s
    return None, None


def legacy(src):
    """classify() keys a few sounds on the v3 source times; c07 and c11 moved by +1000 s in v5"""
    return src - 1000 if 1000 <= src < 1500 else src


def effect_cues(segs, report):
    words = []
    for f in LOGS:
        d = json.load(open(f"{PROMO}/{f}", encoding="utf-8"))
        for w in d["sfx"]: words.append({**w, "log": f})
    uniq = []
    for w in sorted(words, key=lambda w: w["hit"]):
        if not any(w["txt"] == v["txt"] and abs(w["hit"] - v["hit"]) < 0.05 for v in uniq): uniq.append(w)
    cues, unplaced, silent = [], [], []
    for w in uniq:
        ff = math.ceil(w["hit"] * FPS - 1e-3) / FPS
        o, s = src_to_out(ff, segs); how = "first frame"
        if o is None:
            for sg in segs:
                if w["hit"] < sg["a"] <= w["hit"] + 0.07: o, s, how = sg["oa"], sg, f"segment start (landed {sg['a'] - w['hit']:.3f} s before the cut-in)"
        if o is None: unplaced.append({"word": w["txt"], "src_hit": w["hit"], "log": w["log"], "why": "lands outside the cut"}); continue
        c = sfxlib.classify(w["txt"], legacy(w["hit"]))
        if c is None: silent.append({"word": w["txt"], "src_hit": w["hit"], "out": round(o, 3), "why": "vocal word: no sound by design"}); continue
        if c == "unknown": unplaced.append({"word": w["txt"], "src_hit": w["hit"], "log": w["log"], "why": "no sound class"}); continue
        cues.append({"word": w["txt"], "src_hit": w["hit"], "src_first_frame": round(ff, 4), "out": round(o, 4), "segment": s["name"],
                     "x": round(w["x"], 1), "size": w["size"], "placed_at": how, "log": w["log"], "cls": c})
    for t in AGENDA_ROWS:  # the agenda's part cards slide in: a light swish each (as in v4's agenda_audio.py)
        c = ("whoosh/swish", sfxlib.whoosh, {"dur": 0.35, "fa": 600, "fb": 2600, "attack": 0.03, "q": 1.6, "travel": 0.4}, -8.0, False)
        cues.append({"word": "(agenda row slides in)", "src_hit": 800 + t, "src_first_frame": 800 + t, "out": t, "segment": "agenda",
                     "x": 960.0, "size": 70, "placed_at": "a_agenda.js T_ROW", "log": "a_agenda.js", "cls": c})
    drop = set()
    for i, c in enumerate(cues):
        if c["word"] in sfxlib.STAMPS and any(d["word"] == "THUNK!" and abs(d["out"] - c["out"]) < 0.25 for d in cues):
            drop.add(i); silent.append({"word": c["word"], "src_hit": c["src_hit"], "out": c["out"], "why": "stamp: its THUNK! word carries the sound"})
    cues = sorted([c for i, c in enumerate(cues) if i not in drop], key=lambda c: c["out"])
    return cues, unplaced, silent


def voice_starts(segs, report):
    first = {}
    for f in VOICE_LOGS:
        for b in json.load(open(f"{PROMO}/{f}", encoding="utf-8")).get("bubbles", []):
            v = b.get("voice")
            if v and (v not in first or b["t"] < first[v][0]): first[v] = (b["t"], f)
    rows = []
    for vid, (t, f) in sorted(first.items(), key=lambda kv: kv[1][0] if kv[1][0] < 1000 else kv[1][0]):
        o, s = src_to_out(t, segs)
        rows.append((vid, t, o, s["name"] if s else None, f))
    extra = [r for r in rows if r[0] not in TABLE]
    if extra: report.append(f"bubbles with a voice id not in the brief's table (not placed): {extra}")
    missing = [v for v in TABLE if v not in first]
    if missing: report.append(f"voice ids of the table with no bubble in the logs (placed from the table): {missing}")
    starts = {}
    for vid, (src_t, out_t, dur) in TABLE.items():
        if vid in first:
            o, _ = src_to_out(first[vid][0], segs)
            if abs(o - out_t) > 0.02: report.append(f"voice {vid}: bubble's first frame maps to {o:.3f}, the table says {out_t:.3f} (using the log)")
            starts[vid] = (round(o, 4), first[vid][0])
        else: starts[vid] = (out_t, src_t)
    return starts


def voice_stem(starts, report):
    table = json.load(open(f"{AUD}/voices-v5.json", encoding="utf-8"))
    stem = np.zeros((N5, 2)); placed = []
    for vid, (t_out, src_t) in sorted(starts.items(), key=lambda kv: kv[1][0]):
        meta = table[vid]
        x, sr = sf.read(f"{PROMO}/{meta['file']}", dtype="float64")
        if x.ndim > 1: x = x.mean(1)
        y = signal.resample_poly(x, SR // sr, 1) if SR % sr == 0 else signal.resample_poly(x, SR, sr)
        y = hp(y, 80, 2)
        if vid in PHONE: y = peaking(lp(hp(y, 230, 2), 7000, 2), 2500, 2.0, 0.8)
        def level(z):
            e = np.abs(z); w = n_(0.02); c = np.convolve(e ** 2, np.ones(w) / w, "same")
            act = z[c > (c.max() * 10 ** (-35 / 10))]
            return z * (10 ** (-20 / 20) / (np.sqrt(np.mean(act ** 2)) + 1e-12))
        y = level(y); y = compress(y, -12.0, ratio=3.0, attack=0.004, release=0.08); y = level(y)
        k1, k2 = n_(0.003), n_(0.012)
        y[:k1] *= np.linspace(0, 1, k1); y[-k2:] *= np.linspace(1, 0, k2)
        i0 = int(round(t_out * SR))
        assert not np.any(stem[i0:i0 + len(y)]), f"voice {vid} would overlap another"
        stem[i0:i0 + len(y)] += np.stack([y, y], 1) * 0.7071
        placed.append({"type": "voice", "id": vid, "speaker": meta["speaker"], "spoken": meta["spoken"], "bubble": meta.get("bubble"),
                       "file": meta["file"], "src_bubble_first_frame": round(src_t, 4), "out": round(t_out, 4),
                       "out_end": round(t_out + len(y) / SR, 4), "duration": round(len(y) / SR, 3), "phone_playback": vid in PHONE,
                       "sample_start": i0, "sample_end": i0 + len(y),
                       "brief_out": TABLE[vid][1]})
    return stem, placed


def main():
    os.makedirs(STEMS, exist_ok=True)
    segs = segments(); report = []
    cues, unplaced, silent = effect_cues(segs, report)
    SFX = np.zeros((N5, 2)); placed = []
    for i, c in enumerate(cues):
        name, fn, kw, base, soft = c["cls"]
        rng = np.random.default_rng(9000 + i)
        y, hit = fn(rng, **kw); y = sfxlib.finish(y)
        if hit is None: hit = first_onset(y)
        pm, sp = B.peak_mom(y), float(db(np.abs(y).max()))
        y = y * undb(B.SFX_REF - max(pm, sp - B.CREST_MAX))
        size_db = float(np.clip(6 * math.log2(c["size"] / 90), -4, 4)) * 0.75
        lvl = base + size_db
        pan = float(np.clip((c["x"] / 1920 - 0.5) * 0.7, -0.35, 0.35))
        add_at(SFX, B.panned(y * undb(lvl), pan), c["out"] - hit)
        placed.append({"type": "sfx", "out": c["out"], "word": c["word"], "class": name, "segment": c["segment"], "src_hit": c["src_hit"],
                       "src_first_frame": c["src_first_frame"], "placed_at": c["placed_at"], "log": c["log"], "hit_offset_in_sound": round(hit, 4),
                       "level_db_rel": round(lvl, 2), "pan": round(pan, 3), "x": c["x"], "size": c["size"], "soft_onset": soft})
    SFX = SFX + reverb(SFX, make_ir(rt=0.45, pre=0.006, seed=5, lp_hz=8000), wet=0.12)

    starts = voice_starts(segs, report)
    VOICE, vplaced = voice_stem(starts, report)
    VOICE *= undb(B.VOICE_LEVEL + 20)

    MUS, sr = sf.read(f"{STEMS}/music.wav", dtype="float64"); assert sr == SR and len(MUS) == N5
    MUS *= undb(B.MUSIC_GAIN_DB)
    gd, _ = B.duck_curve(VOICE, B.DUCK_DB)
    gs, _ = B.duck_curve(VOICE, B.SFX_UNDER_VOICE_DB)
    meter = pyln.Meter(SR)
    G = B.TARGET_LUFS - meter.integrated_loudness(MUS * gd[:, None] + SFX * gs[:, None] + VOICE)
    bus_ceiling = B.CEILING_DBTP - G - 1.5
    SFX = B.softclip(SFX, undb(bus_ceiling))
    SFX, g1 = B.tp_limit(SFX, bus_ceiling, release=0.05)
    VOICE, g2 = B.tp_limit(VOICE, bus_ceiling, release=0.08)
    MUSD, g3 = B.tp_limit(MUS * gd[:, None], bus_ceiling, release=0.15)
    report.append(f"bus limiters at {bus_ceiling:.2f} dBTP before the master gain ({G:+.2f} dB): deepest reduction effects "
                  f"{20 * math.log10(g1):.2f} dB, voices {20 * math.log10(g2):.2f} dB, music {20 * math.log10(g3):.2f} dB")
    mix = MUSD + SFX * gs[:, None] + VOICE
    L0 = meter.integrated_loudness(mix); g = undb(B.TARGET_LUFS - L0); mix *= g
    gall = 1.0; mgr = np.ones(N5)
    for it in range(3):
        mix, gmin = B.tp_limit(mix, B.CEILING_DBTP); gall = min(gall, gmin); mgr *= B.tp_limit.last
        L = meter.integrated_loudness(mix)
        if abs(L - B.TARGET_LUFS) < 0.05: break
        mix *= undb(B.TARGET_LUFS - L)
    mix, gmin = B.tp_limit(mix, B.CEILING_DBTP); mgr *= B.tp_limit.last
    L = meter.integrated_loudness(mix); tp = B.true_peak_db(mix)
    grd = -db(mgr)
    report.append(f"master limiter: gain reduction over 1 dB for {np.mean(grd > 1) * 100:.2f} % of the time, over 3 dB {np.mean(grd > 3) * 100:.3f} %, deepest {grd.max():.2f} dB")
    assert len(mix) == N5
    sf.write(OUT_WAV, mix, SR, subtype="PCM_24")
    for nm, x in [("music-ducked", MUSD), ("sfx", SFX * gs[:, None]), ("voice", VOICE), ("sfx-dry-unducked", SFX)]:
        sf.write(f"{STEMS}/{nm}.wav", (x * g).astype(np.float32), SR, subtype="FLOAT")
    cues_out = {
        "about": "Every placed sound of out/audio-v5.wav. Times are output seconds of the v5 cut (edl-v5.json, 30 fps, 477.8 s). "
                 "Voices: first sample on the first frame of the line's speech bubble (out/vlog bubbles). Effects: 'out' is the "
                 "word's first painted frame; the sound's transient sits there (hit_offset_in_sound from the sound's start).",
        "length_samples": N5, "sample_rate": SR, "loudness_lufs": round(L, 2), "true_peak_dbtp": round(tp, 2),
        "master_gain_db": round(20 * math.log10(g), 2),
        "segments": segs, "music_sections": json.load(open(f"{STEMS}/music-sections.json")),
        "voices": vplaced, "sfx": placed, "no_sound_by_design": silent, "unplaced": unplaced, "notes": report,
        "logs": LOGS, "ducking": {"music_db": B.DUCK_DB, "sfx_db": B.SFX_UNDER_VOICE_DB},
    }
    json.dump(cues_out, open(OUT_CUES, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"wrote {OUT_WAV}: {N5} samples, {L:.2f} LUFS, true peak {tp:.2f} dBTP, master gain {20 * math.log10(g):+.2f} dB")
    print(f"{len(placed)} effects, {len(vplaced)} voices, {len(unplaced)} unplaced, {len(silent)} silent by design")
    for r in report: print(" ", r)
    for u in unplaced: print("  UNPLACED", u)
    for v in vplaced: print(f"  voice {v['id']:16} out {v['out']:8.3f}-{v['out_end']:8.3f} (brief {v['brief_out']:8.3f})  src bubble {v['src_bubble_first_frame']}")
    from collections import Counter
    for k, v in sorted(Counter(p["class"] for p in placed).items()): print(f"   {v:3d}  {k}")


if __name__ == "__main__":
    main()
