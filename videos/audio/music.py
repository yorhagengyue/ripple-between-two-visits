# The score, composed and synthesised here (no samples): F major, plucked and mallet lead, soft bass, light drums.
#   story     0-205      96 BPM, 82 bars of 4/4; each chapter changes mood on the bar line nearest its cut
#   explainer 205-292.8  100.7 BPM (36 bars land the resolving chord on 290.8, the EMPOWERING stamp), lighter
#   sober     292.8-445.8 an unpulsed bed of slow chords, no drums, low and dark; the chords change gently on the
#             part's slide changes (output 296.8, 314.8, 339.8, 369.8, 387.8, 401.8, 424.8, 437.8)
#   end card  445.8-455.8 a resolving sting on its own downbeat
# Writes audio/stems/music.wav (48 kHz stereo, exactly the cut's length) and audio/stems/music-sections.json.
import json, math, os
import numpy as np, soundfile as sf
from common import (SR, AUD, n_, tt, lp, hp, bp, peaking, pink, sine_f, pan_st, mtof, add_at, make_ir, reverb,
                    timeline, total_samples, undb, compress)

rng = np.random.default_rng(2026)
N = total_samples()
DRY = np.zeros((N, 2)); SEND = np.zeros((N, 2))

# ---- instruments ---------------------------------------------------------------------------------------------------------
def marimba(m, vel=1.0):
    f = mtof(m); tau = float(np.clip(0.5 * (440 / f) ** 0.5, 0.16, 1.0)); t = tt(tau * 4.5)
    y = np.sin(2 * np.pi * f * t) * np.exp(-t / tau)
    if 3.93 * f < 20000: y += 0.3 * np.sin(2 * np.pi * 3.93 * f * t) * np.exp(-t / (tau / 4))
    if 9.3 * f < 20000: y += 0.08 * np.sin(2 * np.pi * 9.3 * f * t) * np.exp(-t / (tau / 10))
    y *= np.minimum(1, t / 0.0015)
    y += 0.05 * lp(rng.standard_normal(len(t)), 2500) * np.exp(-t / 0.003)
    return vel * y


def glock(m, vel=1.0, dur=1.2):
    f = mtof(m); t = tt(dur); y = np.zeros_like(t)
    for r, a, d in [(1, 1, 0.8), (2.76, 0.3, 0.2), (5.4, 0.1, 0.07)]:
        if r * f < 20000: y += a * np.sin(2 * np.pi * r * f * t) * np.exp(-t / d)
    return vel * y * np.minimum(1, t / 0.0008)


def pluck(m, vel=1.0, t60=1.3, bright=0.55):
    """Karplus-Strong, a nylon-string pluck (ukulele / pizzicato); vectorised one period at a time"""
    f = mtof(m); P = max(2, int(round(SR / f))); total = n_(t60 * 0.9 + 0.05)
    d = math.exp(math.log(0.001) / (t60 * f))
    exc = rng.uniform(-1, 1, P)
    k = max(1, int((1 - bright) * 8)); exc = np.convolve(exc, np.ones(k) / k, "same")
    y = np.zeros(total + P + 1); y[1:P + 1] = exc
    i = P + 1
    while i < len(y):
        m_ = min(P, len(y) - i)
        y[i:i + m_] = d * 0.5 * (y[i - P:i - P + m_] + y[i - P - 1:i - P - 1 + m_]); i += m_
    y = y[1:total + 1]
    y *= np.minimum(1, np.arange(len(y)) / n_(0.001))
    fo = n_(0.03); y[-fo:] *= np.linspace(1, 0, fo)
    return vel * y * 0.9


def bass(m, dur, vel=1.0, rel=0.05):
    f = mtof(m); t = tt(dur + max(0.12, rel * 5))
    e = np.minimum(1, t / 0.005) * (0.6 + 0.4 * np.exp(-t / 0.18)) * np.where(t < dur, 1, np.exp(-(t - dur) / rel))
    y = np.sin(2 * np.pi * f * t) + 0.28 * np.sin(4 * np.pi * f * t) + 0.08 * np.sin(6 * np.pi * f * t)
    y = np.tanh(1.3 * y * e) + 0.12 * lp(rng.standard_normal(len(t)), 500) * np.exp(-t / 0.008)
    return vel * y


def saw_blep(f, n, ph0=None):
    dt = f / SR; ph = ((rng.uniform() if ph0 is None else ph0) + np.cumsum(np.full(n, dt))) % 1.0
    y = 2 * ph - 1
    a = ph < dt; x = ph[a] / dt; y[a] -= x + x - x * x - 1
    b = ph > 1 - dt; x = (ph[b] - 1) / dt; y[b] -= x * x + x + x + 1
    return y


def pad(ms, dur, vel=1.0, cutoff=1400, attack=0.6, release=1.5, det=0.006, t_abs=None):
    """detuned saws through a low-pass. With t_abs, every oscillator's phase is locked to the film clock, so a note two
    overlapping chords share adds up cleanly in the crossfade instead of beating"""
    n = n_(dur + release); t = np.arange(n) / SR
    L = np.zeros(n); R = np.zeros(n)
    ph = (lambda fr, k: None) if t_abs is None else (lambda fr, k: (fr * t_abs + 0.37 * k) % 1.0)
    for m in ms:
        f = mtof(m)
        L += saw_blep(f * (1 - det), n, ph(f * (1 - det), 1)) + 0.5 * saw_blep(f * (1 + det * 0.3), n, ph(f * (1 + det * 0.3), 2))
        R += saw_blep(f * (1 + det), n, ph(f * (1 + det), 3)) + 0.5 * saw_blep(f * (1 - det * 0.3), n, ph(f * (1 - det * 0.3), 4))
    e = np.minimum(1, t / attack) * np.where(t < dur, 1, np.exp(-(t - dur) / (release / 3)))
    y = np.stack([lp(L, cutoff, 2), lp(R, cutoff, 2)], 1) * e[:, None] / (len(ms) * 1.5)
    return vel * y


def soft_sine_pad(ms, dur, vel=1.0, attack=1.5, release=2.0, t_abs=0.0):
    n = n_(dur + release); t = np.arange(n) / SR; y = np.zeros((n, 2))
    for k, m in enumerate(ms):
        f = mtof(m); trem = 1 + 0.12 * np.sin(2 * np.pi * (0.13 + 0.05 * m % 7 * 0.01) * (t + t_abs) + m)
        s = (np.sin(2 * np.pi * f * (t + t_abs)) + 0.15 * np.sin(4 * np.pi * f * (t + t_abs))) * trem
        p = -0.4 + 0.8 * k / max(1, len(ms) - 1); a = (p + 1) * np.pi / 4
        y += np.stack([s * np.cos(a), s * np.sin(a)], 1)
    e = np.minimum(1, t / attack) * np.where(t < dur, 1, np.exp(-(t - dur) / (release / 3)))
    return vel * y * e[:, None] / len(ms)


def kick(vel=1.0):
    t = tt(0.4); f = 47 + 70 * np.exp(-t / 0.028)
    y = sine_f(f) * np.exp(-t / 0.16) + 0.15 * hp(rng.standard_normal(len(t)), 2500) * np.exp(-t / 0.002)
    return vel * y


def rim(vel=1.0):
    t = tt(0.12)
    y = 0.6 * np.sin(2 * np.pi * 1720 * t) * np.exp(-t / 0.012) + 0.5 * bp(rng.standard_normal(len(t)), 2000, 6000) * np.exp(-t / 0.006) \
        + 0.3 * np.sin(2 * np.pi * 420 * t) * np.exp(-t / 0.015)
    return vel * y


def brush(vel=1.0):
    t = tt(0.25)
    y = bp(rng.standard_normal(len(t)), 1200, 7000) * np.exp(-t / 0.07) * np.minimum(1, t / 0.004) + 0.4 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.04)
    return vel * y


def shaker(vel=1.0):
    t = tt(0.09)
    return vel * bp(rng.standard_normal(len(t)), 4500, 11000) * np.minimum(1, t / 0.008) * np.exp(-t / 0.025)


def hat(vel=1.0):
    t = tt(0.06)
    return vel * hp(rng.standard_normal(len(t)), 7500) * np.exp(-t / 0.012)


def woodblock(m=84, vel=1.0):
    f = mtof(m); t = tt(0.15)
    return vel * (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.03) + 0.3 * np.sin(2 * np.pi * 2.47 * f * t) * np.exp(-t / 0.012))


# ---- placing notes ------------------------------------------------------------------------------------------------------
def put(x, t, gain, pan=0.0, send=0.25, jitter=0.006):
    if t is None: return
    t = t + (rng.uniform(-jitter, jitter) if jitter else 0)
    g = gain * (1 + rng.uniform(-0.07, 0.07))
    s = pan_st(x, pan) if x.ndim == 1 else x
    add_at(DRY, s * g, t)
    if send: add_at(SEND, s * g * send, t)


# chords: name -> notes in the octave above the root (MIDI) and the bass root
CH = {
    "F": ([65, 69, 72], 41), "Dm": ([62, 65, 69], 38), "Bb": ([58, 62, 65], 46), "C": ([60, 64, 67], 36), "Am": ([57, 60, 64], 45),
    "Gm": ([55, 58, 62], 43), "C7": ([60, 64, 67, 70], 36), "Fmaj7": ([65, 69, 72, 76], 41), "Bbmaj7": ([58, 62, 65, 69], 46),
    "Dm7": ([62, 65, 69, 72], 38), "Am7": ([57, 60, 64, 67], 45), "Csus4": ([60, 65, 67], 36), "Fadd9": ([65, 67, 69, 72], 41),
    "Gm7": ([55, 58, 62, 65], 43), "Bbadd9": ([58, 60, 62, 65], 46),
}


class Grid:
    def __init__(self, t0, beat, swing=0.56):
        self.t0, self.beat, self.swing = t0, beat, swing

    def t(self, bar, b):
        whole = math.floor(b + 1e-9); frac = b - whole
        if abs(frac - 0.5) < 1e-6: frac = self.swing  # swung eighths
        elif abs(frac - 0.25) < 1e-6: frac = self.swing / 2
        elif abs(frac - 0.75) < 1e-6: frac = self.swing + (1 - self.swing) / 2
        return self.t0 + (bar * 4 + whole + frac) * self.beat


# ---- melodies (bar-relative beats, length in beats, MIDI) ------------------------------------------------------------
THEME_A = [
    [(0, .5, 72), (.5, .5, 69), (1, 1, 72), (2, 1, 77), (3, .5, 76), (3.5, .5, 74)],
    [(0, .5, 74), (.5, .5, 77), (1, 1.5, 81), (2.5, .5, 79), (3, 1, 77)],
    [(0, 1, 74), (1, .5, 77), (1.5, .5, 79), (2, 1, 77), (3, 1, 74)],
    [(0, .5, 76), (.5, .5, 79), (1, 1, 84), (2, .5, 82), (2.5, .5, 81), (3, 1, 79)],
    [(0, .5, 81), (.5, .5, 79), (1, 1, 77), (2, 1, 72), (3, .5, 69), (3.5, .5, 72)],
    [(0, 1, 74), (1, .5, 69), (1.5, .5, 74), (2, 1.5, 77), (3.5, .5, 76)],
    [(0, 1, 74), (1, 1, 77), (2, .5, 76), (2.5, .5, 79), (3, 1, 84)],
    [(0, 1, 81), (1, 2, 77)],
]
THEME_B = [
    [(0, 1.5, 77), (1.5, .5, 74), (2, .5, 77), (2.5, 1.5, 79)],
    [(0, 1.5, 76), (1.5, .5, 72), (2, .5, 76), (2.5, 1.5, 79)],
    [(0, 1, 81), (1, .5, 79), (1.5, .5, 76), (2, 1, 72), (3, 1, 76)],
    [(0, 2, 74), (2, 1, 77), (3, 1, 81)],
    [(0, 1, 82), (1, .5, 81), (1.5, .5, 79), (2, 1, 77), (3, 1, 74)],
    [(0, 1, 76), (1, 1, 79), (2, 1, 84), (3, 1, 82)],
    [(0, 1.5, 81), (1.5, .5, 79), (2, 2, 77)],
    [(0, 1, 79), (1, 1, 76), (2, 1, 72)],
]


def lead(g, bar, phrase, inst="marimba", gain=0.32, oct=0, pan=0.1, sparse=False):
    for b, d, m in phrase:
        if sparse and b not in (0, 2, 1): continue
        x = marimba(m + 12 * oct) if inst == "marimba" else pluck(m + 12 * oct, t60=1.0, bright=0.7) if inst == "pluck" else glock(m + 12 * oct)
        put(x, g.t(bar, b), gain, pan, send=0.3)


def arp(g, bar, ch, pattern, gain=0.18, inst="pluck", octs=0, beats=4, pan=-0.15, step=0.5, t60=0.9):
    notes = CH[ch][0]
    for k, idx in enumerate(pattern):
        b = k * step
        if b >= beats or idx is None: continue
        m = notes[idx % len(notes)] + 12 * (idx // len(notes)) + 12 * octs
        x = pluck(m, t60=t60, bright=0.5) if inst == "pluck" else marimba(m)
        put(x, g.t(bar, b), gain * (1.0 if k % 2 == 0 else 0.8), pan, send=0.3)


def strum(g, bar, ch, beats=(0.5, 1.5, 2.5, 3.5), gain=0.13, pan=-0.3, maxb=4):
    notes = CH[ch][0]
    for b in beats:
        if b >= maxb: continue
        t0 = g.t(bar, b)
        for k, m in enumerate(notes + [notes[0] + 12]):
            put(pluck(m, t60=0.7, bright=0.6), t0 + k * 0.009, gain * (0.85 if k else 1), pan, send=0.25, jitter=0.002)


def bassline(g, bar, ch, kind="half", gain=0.42, maxb=4):
    r = CH[ch][1]; fifth = r + 7
    pat = {"whole": [(0, 3.97, r)], "half": [(0, 1.97, r), (2, 1.97, fifth if fifth < 50 else r - 5)],
           "bounce": [(0, 1.45, r), (1.5, .45, r + 12), (2, 1.45, fifth if fifth < 50 else r - 5), (3.5, .45, r + 12)],
           "eighths": [(k * .5, .42, r if k % 4 != 3 else r + 12) for k in range(8)],
           "walk": [(0, .9, r), (1, .9, r + 4 if ch in ("F", "C", "Bb") else r + 3), (2, .9, r + 7), (3, .9, r + 9 if ch in ("F", "C", "Bb") else r + 10)],
           "pizz": [(0, .5, r), (2, .5, fifth if fifth < 50 else r - 5)]}[kind]
    for b, d, m in pat:
        if b >= maxb: continue
        if kind == "pizz": put(pluck(m + 12, t60=0.6, bright=0.2), g.t(bar, b), gain * 0.85, 0.0, send=0.15)
        else: put(bass(m, d * g.beat, 1.0), g.t(bar, b), gain * 0.7, 0.0, send=0.05)  # legato, a touch under the mids


def drums(g, bar, kind="light", gain=1.0, maxb=4):
    def at(b): return g.t(bar, b) if b < maxb else None
    if kind in ("light", "groove", "office", "train", "lab"):
        put(kick(), at(0), 0.3 * gain, 0, send=0)
        if kind in ("groove", "office", "lab"): put(kick(), at(2.5 if kind != "lab" else 2), 0.21 * gain, 0, send=0)
        if kind == "train":
            for b in (1, 2, 3): put(kick(), at(b), 0.23 * gain, 0, send=0)
        for b in (1, 3): put(rim() if kind != "groove" else brush(), at(b), (0.15 if kind != "groove" else 0.22) * gain, 0.12, send=0.15)
    step = 0.25 if kind in ("office", "train") else 0.5
    k = 0; b = 0.0
    while b < 4 and b < maxb:
        acc = 1.0 if (abs(b % 1 - 0.5) < 1e-6) else 0.55
        if kind in ("office",): put(hat(), at(b), 0.07 * acc * gain, 0.35, send=0.05)
        else: put(shaker(), at(b), 0.09 * acc * gain, 0.3, send=0.08)
        b += step; k += 1


def pad_bar(g, bar, ch, beats=4, gain=0.12, cutoff=1300, attack=0.5, oct=0):
    ms = [m + 12 * oct for m in CH[ch][0]]
    put(pad(ms, beats * g.beat, cutoff=cutoff, attack=attack, release=1.2), g.t(bar, 0), gain, 0, send=0.45, jitter=0)


# ---- the score ------------------------------------------------------------------------------------------------------------
SECTIONS = []


def story():
    g = Grid(0.0, 60 / 96)
    plan = []  # (bar, chord, style)
    c01 = ["F", "F", "Bb", "C", "F", "C"]
    c02 = ["F", "Dm", "Bb", "C", "F"]
    c03 = ["F", "Dm", "Bb", "C", "F", "Dm", "Bb", "F", "Bb", "C", "Am", "Dm", "Bb", "C", "F"]
    c04 = ["Dm", "Bb", "F", "C", "Dm", "Bb", "F", "C"]
    c05 = ["Bb", "C", "Am", "Dm", "Bb", "C", "F", "F", "Bb", "C", "F", "F"]
    c06 = ["F", "C", "Dm", "Bb", "C"]
    c07 = ["F", "Am", "Bb", "C"] * 6
    c08 = ["Bb", "C", "Am", "Dm", "Bb", "C", "F"]
    for name, chs in [("c01", c01), ("c02", c02), ("c03", c03), ("c04", c04), ("c05", c05), ("c06", c06), ("c07", c07), ("c08", c08)]:
        b0 = len(plan)
        for ch in chs: plan.append((len(plan), ch, name))
        SECTIONS.append({"section": f"story {name}", "start": round(g.t(b0, 0), 3), "end": round(g.t(len(plan), 0), 3), "bpm": 96, "bars": len(chs)})
    assert len(plan) == 82, len(plan)
    for bar, ch, st in plan:
        if st == "c01":  # dawn: a warm chord on the opening downbeat, the theme sparse on the mallet, no drums
            pad_bar(g, bar, ch, gain=0.13, cutoff=1000, attack=0.9 if bar else 0.02)
            bassline(g, bar, ch, "whole", gain=0.3)
            if bar == 0:
                for k, m in enumerate([65, 72, 77, 81]): put(glock(m + 12, 0.8), g.t(0, 0) + k * 0.06, 0.12, 0.2, send=0.5, jitter=0)
                put(marimba(65), 0.0, 0.3, 0, send=0.3, jitter=0)
            if 1 <= bar <= 4: lead(g, bar, THEME_A[bar - 1], gain=0.26, sparse=True)
            if bar == 5: arp(g, bar, ch, [0, 1, 2, 3, 2, 3, 4, 5], gain=0.13, inst="marimba", pan=0.15)
        elif st == "c02":  # tai chi: woodblock and a pentatonic pluck
            pad_bar(g, bar, ch, gain=0.08, cutoff=1100)
            bassline(g, bar, ch, "half", gain=0.32)
            for b in (0, 1, 2, 3): put(woodblock(84 if b % 2 == 0 else 79), g.t(bar, b), 0.1 if b else 0.14, -0.25, send=0.2)
            k = bar - 6
            run = [[72, 74, 77, 79, 81, 84, 81, 79], [74, 77, 81, 79, 77, 74, 72, 74], [70, 74, 77, 79, 77, 74, 72, 70],
                   [72, 76, 79, 84, 79, 76, 74, 72], [77, 81, 84, 89, 84, None, None, None]][k]
            for i, m in enumerate(run):
                if m: put(pluck(m, t60=1.1, bright=0.75), g.t(bar, i * 0.5), 0.16 if i % 2 else 0.2, 0.2, send=0.35)
            if k in (1, 3): lead(g, bar, THEME_A[k], inst="marimba", gain=0.15, oct=-1, pan=-0.1)
        elif st == "c03":  # blood pressure: the main groove and the theme
            k = bar - 11
            drums(g, bar, "groove" if k >= 1 else "light", gain=0.9)
            bassline(g, bar, ch, "bounce" if k >= 1 else "half", gain=0.4)
            strum(g, bar, ch, gain=0.1)
            pad_bar(g, bar, ch, gain=0.05, cutoff=1500)
            phrase = (THEME_A + THEME_B)[k] if k < 15 else None
            if k == 7: phrase = THEME_A[7]
            if phrase: lead(g, bar, phrase, gain=0.27 if k < 3 else 0.2)  # the panel takes over from 35.6: the lead steps back
        elif st == "c04":  # the office: busier, hats on sixteenths, a pluck riff
            k = bar - 26
            drums(g, bar, "office", gain=0.9)
            bassline(g, bar, ch, "eighths", gain=0.34)
            arp(g, bar, ch, [0, 1, 2, 1, 3, 2, 1, 2], gain=0.13, pan=-0.25)
            pad_bar(g, bar, ch, gain=0.05, cutoff=1700)
            if k in (2, 3, 6, 7): lead(g, bar, THEME_B[k % 4 + 4], inst="pluck", gain=0.16, pan=0.25)
        elif st == "c05":  # four boxes: tip-toe thinking for four bars, then the groove comes back gently
            k = bar - 34
            if k < 4:
                bassline(g, bar, ch, "pizz", gain=0.3)
                arp(g, bar, ch, [0, None, 2, None, 1, None, 3, None], gain=0.14, inst="marimba", pan=0.2)
                put(shaker(), g.t(bar, 1.5), 0.05, 0.3)
            else:
                drums(g, bar, "light", gain=0.75)
                bassline(g, bar, ch, "half", gain=0.34)
                strum(g, bar, ch, beats=(0.5, 1.5, 2.5, 3.5), gain=0.08)
                if k in (4, 5): lead(g, bar, THEME_A[k - 4], gain=0.18, sparse=True)
            pad_bar(g, bar, ch, gain=0.06, cutoff=1200)
        elif st == "c06":  # the MRT: driving eighths
            drums(g, bar, "train", gain=0.85)
            bassline(g, bar, ch, "eighths", gain=0.36)
            strum(g, bar, ch, beats=(0.5, 1.5, 2.5, 3.5), gain=0.09)
            if bar - 46 in (1, 3): lead(g, bar, THEME_B[(bar - 46) // 2 + 4], gain=0.16)
            pad_bar(g, bar, ch, gain=0.05, cutoff=1500)
        elif st == "c07":  # the clinic: voices most of the time; soft arpeggios and bass only
            k = bar - 51
            pad_bar(g, bar, ch, gain=0.08, cutoff=1100)
            bassline(g, bar, ch, "half", gain=0.28)
            arp(g, bar, ch, [0, 1, 2, 1, 3, 2, 1, 2], gain=0.09, pan=-0.2, t60=0.8)
            if k < 2: drums(g, bar, "light", gain=0.5)
            else: put(shaker(), g.t(bar, 1.5), 0.05, 0.3); put(shaker(), g.t(bar, 3.5), 0.05, 0.3)
            if k == 23:  # the high-five bar: a lift
                drums(g, bar, "groove", gain=0.8)
                for i, m in enumerate([77, 81, 84, 89]): put(glock(m, 0.9), g.t(bar, 0) + i * 0.07, 0.1, 0.2, send=0.4)
        elif st == "c08":  # the evening: no drums, the theme slow on the mallet, the day resolves on F
            k = bar - 75
            pad_bar(g, bar, ch, gain=0.12, cutoff=1000, attack=0.8 if k else 0.3)
            bassline(g, bar, ch, "whole", gain=0.3)
            if k < 6: lead(g, bar, THEME_B[k], gain=0.2, sparse=True)
            if k == 6:
                for i, m in enumerate([65, 69, 72, 77]): put(marimba(m), g.t(bar, 0) + i * 0.09, 0.2, 0.1, send=0.4)
                put(glock(89, 1.4), g.t(bar, 0) + 0.4, 0.08, 0.2, send=0.5)
    return g


def explainer():
    t0, t1, bars = 205.0, 290.8, 36
    g = Grid(t0, (t1 - t0) / bars / 4, swing=0.55)
    c09 = ["Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "C", "C"]
    c10 = ["F", "C", "Dm", "Bb", "C", "F", "Bb", "C", "F", "C"]
    c11 = ["F", "Bb", "C", "F", "Dm", "Bb", "C", "C", "F", "Bb", "C", "Am", "Dm", "Bb", "Gm", "C", "C"]
    plan = [(i, ch, "c09") for i, ch in enumerate(c09)]
    plan += [(len(plan) + i, ch, "c10") for i, ch in enumerate(c10)]
    plan += [(len(plan) + i, ch, "c11") for i, ch in enumerate(c11)]
    assert len(plan) == bars
    for name, a, b in [("c09", 0, 9), ("c10", 9, 19), ("c11", 19, 36)]:
        SECTIONS.append({"section": f"explainer {name}", "start": round(g.t(a, 0), 3), "end": round(g.t(b, 0), 3), "bpm": round(60 / g.beat, 2), "bars": b - a})
    for bar, ch, st in plan:
        if st == "c09":  # the problem: curious, a pizzicato ostinato and the glockenspiel
            bassline(g, bar, ch, "pizz", gain=0.45)
            bassline(g, bar, ch, "whole", gain=0.14)
            arp(g, bar, ch, [0, 2, 1, 2, 0, 2, 3, 2], gain=0.2, inst="pluck", pan=-0.2, t60=0.7)
            drums(g, bar, "light", gain=0.8 if bar else 0.6)
            if bar in (2, 3, 6, 7): lead(g, bar, THEME_A[bar % 4 + 4] if bar < 4 else THEME_A[bar - 4], inst="glock", gain=0.12, pan=0.25)
            pad_bar(g, bar, ch, gain=0.08, cutoff=1100)
        elif st == "c10":  # the tour: brighter, the B theme on the mallet
            k = bar - 9
            drums(g, bar, "groove", gain=0.75)
            bassline(g, bar, ch, "bounce", gain=0.36)
            strum(g, bar, ch, gain=0.085)
            lead(g, bar, THEME_B[k % 8], gain=0.2)
            pad_bar(g, bar, ch, gain=0.05, cutoff=1500)
        else:  # the trust lab: a marimba ostinato, pizzicato bass
            k = bar - 19
            drums(g, bar, "lab", gain=0.75 if k >= 1 else 0.5)
            bassline(g, bar, ch, "pizz" if k % 8 < 4 else "half", gain=0.32)
            arp(g, bar, ch, [0, 1, 2, 3, 2, 1, 2, 3], gain=0.13, inst="marimba", pan=0.2)
            if k in (2, 3, 10, 11): lead(g, bar, THEME_A[k % 8], inst="glock", gain=0.06, pan=-0.25)
            pad_bar(g, bar, ch, gain=0.05, cutoff=1300)
    # the resolving chord on 290.8, under the EMPOWERING stamp; it rings into the sober part's crossfade
    tF = g.t(36, 0)
    put(pad([53, 57, 60, 65, 69], 1.6, cutoff=1400, attack=0.02, release=3.0), tF, 0.15, 0, send=0.5, jitter=0)
    put(bass(41, 1.2, rel=0.9), tF, 0.3, 0, send=0.05, jitter=0)
    put(kick(), tF, 0.24, 0, send=0, jitter=0)
    for i, m in enumerate([65, 69, 72, 77]): put(marimba(m + 12), tF + i * 0.08, 0.22, 0.15, send=0.4, jitter=0)
    put(glock(89, 1.6), tF + 0.35, 0.07, 0.2, send=0.5, jitter=0)
    return g


def sober():
    """an unpulsed bed under the technical part: slow chords, dark, a soft sub; nothing that pulls the eye. The chords
    change gently on the part's slide changes (source 604, 622, 647, 677, 695, 709, 732, 745 = output 296.8 ... 437.8);
    long slides get a second (or third) chord half way."""
    t0, t1 = 292.8, 445.8
    cuts = [t0] + [292.8 + (s_ - 600) for s_ in (604, 622, 647, 677, 695, 709, 732, 745)] + [t1]
    per_slide = [["Fadd9"], ["Am7", "Bbmaj7"], ["Fmaj7", "Dm7"], ["Bbadd9", "Gm7", "Csus4"], ["Fadd9", "Am7"], ["Bbmaj7"],
                 ["Fadd9", "Am7"], ["Bbmaj7"], ["Csus4"]]
    slots = []
    for (a_, b_), chs in zip(zip(cuts, cuts[1:]), per_slide):
        d_ = (b_ - a_) / len(chs)
        for k, ch in enumerate(chs): slots.append((a_ + k * d_, a_ + (k + 1) * d_, ch))
    SECTIONS.append({"section": "sober bed", "start": t0, "end": t1, "bpm": None, "slide_changes": [round(c, 2) for c in cuts[1:-1]],
                     "chords": [(round(a_, 2), ch) for a_, _, ch in slots]})
    for i, (a_, b_, ch) in enumerate(slots):
        ts = a_ - (0.8 if i else 1.4)  # the first chord swells in under the explainer's last chord
        ms = [m - 12 for m in CH[ch][0]]
        last = i == len(slots) - 1
        hold = (b_ - ts) + (0.6 if not last else 0.2)
        put(pad(ms, hold, cutoff=850, attack=2.0 if i else 2.5, release=3.0, det=0.004, t_abs=ts), ts, 0.16, 0, send=0.6, jitter=0)
        put(soft_sine_pad([m + 12 for m in CH[ch][0][:3]], hold, attack=2.5, release=3.0, t_abs=ts + 0.3), ts + 0.3, 0.035, 0, send=0.7, jitter=0)
        r = CH[ch][1]
        sh = b_ - a_ + (0.0 if not last else 0.0)  # the sub moves cleanly on the change (two low roots overlapping beat)
        lead_in = 0.25 if i else 1.0
        t = tt(sh + lead_in + 1.5); e = np.minimum(1, t / (2 * lead_in)) * np.where(t < sh + lead_in, 1, np.exp(-(t - sh - lead_in) / 0.3))
        put(np.sin(2 * np.pi * mtof(r) * t) * e, a_ - lead_in, 0.12, 0, send=0.0, jitter=0)
    # the last chord turns from Csus4 to C, and a two-note pickup leads into the end card's downbeat
    put(pad([48, 52, 55], 4.0, cutoff=900, attack=2.0, release=0.6), t1 - 4.0, 0.08, 0, send=0.5, jitter=0)
    put(marimba(72), t1 - 0.6, 0.12, 0.1, send=0.4, jitter=0)
    put(marimba(76), t1 - 0.3, 0.14, 0.1, send=0.4, jitter=0)


def sting():
    t0 = 445.8; beat = 0.6
    SECTIONS.append({"section": "end card sting", "start": t0, "end": 455.8, "bpm": 100})
    put(kick(), t0, 0.45, 0, send=0, jitter=0)
    put(bass(29, 2.5, rel=2.2), t0, 0.4, 0, send=0.05, jitter=0)
    put(bass(41, 2.5, rel=2.0), t0, 0.22, 0, send=0.05, jitter=0)
    put(pad([53, 57, 60, 65, 67, 69], 3.0, cutoff=1800, attack=0.03, release=6.0), t0, 0.15, 0, send=0.55, jitter=0)
    for i, m in enumerate([77, 81, 84, 89]): put(marimba(m), t0 + i * beat / 4, 0.28, 0.12, send=0.4, jitter=0)
    for i, m in enumerate([65, 69, 72, 77]): put(pluck(m, t60=2.2, bright=0.6), t0 + 0.6 + i * 0.012, 0.13, -0.3, send=0.4, jitter=0)
    put(glock(89, 2.5), t0 + 0.45, 0.12, 0.25, send=0.6, jitter=0)
    put(glock(96, 2.5), t0 + 0.6, 0.07, -0.2, send=0.6, jitter=0)
    put(rim(), t0 + 2 * beat, 0.1, 0.1, send=0.2, jitter=0)
    put(soft_sine_pad([65, 72, 77], 4.0, attack=0.5, release=5.0), t0 + 0.3, 0.06, 0, send=0.6, jitter=0)


if __name__ == "__main__":
    os.makedirs(f"{AUD}/stems", exist_ok=True)
    story(); explainer(); sober(); sting()
    ir = make_ir(rt=1.5, pre=0.015, seed=11, lp_hz=7000)
    mix = DRY + reverb(SEND, ir, wet=1.0) * 0.55
    mix = hp(mix.T, 30, 2).T
    mix = np.stack([peaking(mix[:, ch], 230, -2.5, 0.8) for ch in range(2)], 1)  # less mud in the low mids
    mix = compress(mix / max(1e-9, np.abs(mix).max()), -12.0, ratio=2.0, attack=0.004, release=0.15)  # a little glue on the peaks
    # level each section to its target (smooth 0.4 s ramps at the joins), measured on this render
    import pyloudnorm as pyln
    meter = pyln.Meter(SR)
    TARGET = {"story c01": -19.0, "story c02": -18.0, "story c03": -17.5, "story c04": -17.5, "story c05": -19.0, "story c06": -17.5,
              "story c07": -19.5, "story c08": -19.0, "explainer c09": -18.5, "explainer c10": -17.5, "explainer c11": -18.0,
              "sober bed": -25.5, "end card sting": -21.0}
    corr = []
    for s in SECTIONS:
        a, b = s["start"], s["end"]
        L = meter.integrated_loudness(mix[int(a * SR):int(b * SR)])
        c = float(np.clip(TARGET[s["section"]] - L, -10, 10)); s["measured_lufs"] = round(L, 2); s["trim_db"] = round(c, 2)
        corr.append((a, b, c))
    T = np.arange(N) / SR
    trim = np.zeros(N)
    for a, b, c in corr: trim[(T >= a) & (T < b)] = c
    trim[T >= corr[-1][1]] = corr[-1][2]
    trim[(T >= 290.8) & (T < 292.8)] = corr[10][2]  # the resolving chord keeps the lab's level
    k = n_(0.4); c = np.cumsum(np.pad(trim, (k, k), mode="edge")); trim = (c[2 * k:] - c[:-2 * k])[: N] / (2 * k)
    mix *= (10 ** (trim / 20))[:, None]
    # section levels and the seams: story and explainer at 0 dB; the sober bed lower; crossfades at the joins
    T = np.arange(N) / SR
    def ramp(a, b, va, vb):
        k = np.clip((T - a) / (b - a), 0, 1); return va + (vb - va) * k
    gain_db = np.zeros(N)
    gain_db = np.where(T < 292.3, 0.0, gain_db)
    gain_db = np.where((T >= 292.3) & (T < 445.8), 0.0, gain_db)
    gain_db = np.where(T >= 445.8, 0.0, gain_db)

    g = 10 ** (gain_db / 20)
    # the explainer's tail fades out under the sober bed (the bed itself is rendered at its own level)
    mix *= g[:, None]
    # the end: everything gone by the last frame
    e = np.clip((455.8 - T) / 1.6, 0, 1) ** 1.5
    mix *= e[:, None]
    assert len(mix) == N
    pk = np.abs(mix).max(); print("music peak", round(float(pk), 3))
    sf.write(f"{AUD}/stems/music.wav", (mix / max(1.0, pk / 0.95)).astype(np.float32), SR, subtype="FLOAT")
    json.dump(SECTIONS, open(f"{AUD}/stems/music-sections.json", "w"), indent=1)
    for s in SECTIONS: print(s)
