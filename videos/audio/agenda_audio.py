# agenda_audio.py: the sound for v4 = a 7.0 s agenda bed + the v3 cut's sound (with the Voicebox voices).
#   D:/AI/seed-vc/.venv/Scripts/python.exe audio/agenda_audio.py
# The agenda bed is 7.0 s of the explainer's light music (v3 231.0-238.0, music stem before the ducking), at the same gain
# the build gives the music (MUSIC_GAIN_DB and the master gain from the cues), faded in and out, so the story's own
# downbeat lands at 7.0 s on its first frame. Writes out/audio-v4.wav (48 kHz stereo float).
import json, numpy as np, soundfile as sf
P = "D:/ripple-c2/film/promo"
SR, AG = 48000, 7.0
cues = json.load(open(f"{P}/out/audio-v3-cues.json", encoding="utf-8"))
master = cues["master_gain_db"]
music, sr = sf.read(f"{P}/audio/stems/music.wav", dtype="float64"); assert sr == SR
seg = music[int(231.0 * SR): int((231.0 + AG) * SR)].copy()
g = 10 ** ((-3.0 + master) / 20); seg *= g
fi, fo = int(0.4 * SR), int(0.8 * SR)
seg[:fi] *= np.linspace(0, 1, fi)[:, None]; seg[-fo:] *= np.linspace(1, 0, fo)[:, None]
# the agenda's own hits: TA-DA as the cast appears (0.22 s, from out/log-800-807-agenda.json) and a swish as each part
# card slides in (1.10, 1.90, 2.70 s), from the film's effect library, set well under the music peak
import sys; sys.path.insert(0, f"{P}/audio")
import sfxlib
rng = np.random.default_rng(800)
def put(x, t, gain_db):
    if isinstance(x, tuple): x, hit = x; t -= (hit or 0.0)  # library sounds return (audio, time of the hit in the sound or None)
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1: x = np.stack([x, x], 1)
    x = x / (np.abs(x).max() + 1e-9) * 10 ** (gain_db / 20)
    i = int(t * SR); m = min(len(x), len(seg) - i)
    if m > 0: seg[i:i + m] += x[:m]
put(sfxlib.tada(rng), 0.22, -14.0)
for t in (1.10, 1.90, 2.70): put(sfxlib.whoosh(rng, dur=0.35, fa=600, fb=2600), t - 0.12, -20.0)
rest, sr2 = sf.read(f"{P}/out/audio-v3-vb.wav", dtype="float64"); assert sr2 == SR
out = np.concatenate([seg, rest])
pk = np.abs(out).max()
if pk > 0.89: out *= 0.89 / pk
sf.write(f"{P}/out/audio-v4.wav", out.astype(np.float32), SR, subtype="FLOAT")
print(f"audio-v4: {len(out)} samples = {len(out) / SR:.3f} s (agenda {AG} s + v3 {len(rest) / SR:.3f} s), agenda gain {20*np.log10(g):.2f} dB, peak {20*np.log10(np.abs(out).max()):.2f} dBFS")
