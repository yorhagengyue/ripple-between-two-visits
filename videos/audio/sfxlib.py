# The sound-effect library, synthesised in numpy (no samples). Every maker takes a random generator (so repeats differ
# a little) and returns (signal, hit_at): a mono or stereo float array and the seconds from its start to the transient
# that must land on the drawn word's first frame (None = find it with the onset detector).
# classify(word, source_time) maps a logged sound word to a maker, a base level and a few flags.
import re
import numpy as np
from common import (SR, n_, tt, lp, hp, bp, peaking, sweep_bp, sweep_lp, pink, brown, sine_f, partials, fade, undb, db,
                    mtof, first_onset)

# F major: the music's key (tonal effects are tuned to it)
F4, G4, A4, Bb4, C5, D5, E5, F5, G5, A5, Bb5, C6, D6, E6, F6, A6, C7 = 65, 67, 69, 70, 72, 74, 76, 77, 79, 81, 82, 84, 86, 88, 89, 93, 96


def _p(rng, semis=0.5):
    return 2 ** (rng.uniform(-semis, semis) / 12)


def _noise(rng, n): return rng.standard_normal(n)


def _st(y, spread=0.0, rng=None):
    """mono to a slightly wide stereo pair (decorrelated by a short delay on one side)"""
    if y.ndim == 2: return y
    if spread <= 0: return np.stack([y, y], 1)
    d = n_(0.0004 + 0.0008 * spread)
    r = np.concatenate([np.zeros(d), y[:-d]])
    return np.stack([y, (1 - spread) * y + spread * r], 1)


def finish(y):
    """every sound ends with a short fade (a cut-off tail clicks, and the onset check would hear the click)"""
    y = np.asarray(y, dtype=np.float64)
    m = min(len(y) // 3, n_(0.02)); r = np.linspace(1, 0, m) ** 2
    y = y.copy()
    if y.ndim == 1: y[-m:] *= r; y[: n_(0.0004)] *= np.linspace(0, 1, n_(0.0004))
    else: y[-m:] *= r[:, None]; y[: n_(0.0004)] *= np.linspace(0, 1, n_(0.0004))[:, None]
    return y


def _place(buf, x, t):
    x = finish(x) if len(x) > n_(0.06) else x
    i = n_(t) if t > 0 else 0
    m = min(len(x), len(buf) - i)
    if m > 0: buf[i:i + m] += x[:m]


# ---- alarms and electronic beeps --------------------------------------------------------------------------------------
def alarm(rng, groups=1):
    f = 2960 * _p(rng, 0.15); per, pip, gg = 0.1, 0.06, 0.55
    y = np.zeros(n_((groups - 1) * gg + 4 * per + 0.08))
    for g in range(groups):
        for k in range(4):
            t = tt(pip)
            s = np.sin(2 * np.pi * f * t) + np.sin(2 * np.pi * 3 * f * t) / 3 + np.sin(2 * np.pi * 5 * f * t) / 6
            e = np.minimum(1, t / 0.002) * np.minimum(1, (pip - t) / 0.005)
            _place(y, s * e * (1 - 0.06 * k), g * gg + k * per)
    y = y + 0.35 * bp(y, 850, 1300)  # the little plastic case
    return hp(y, 300), 0.0


def monitor_beep(rng):
    f = mtof(C7) * _p(rng, 0.1); t = tt(0.32)
    y = (np.sin(2 * np.pi * f * t) + 0.12 * np.sin(4 * np.pi * f * t)) * np.minimum(1, t / 0.003) * np.minimum(1, (0.32 - t) / 0.04)
    return y, 0.0


def boop(rng):
    t = tt(0.16); f = mtof(A5) * (1 - 0.03 * t / 0.16)
    y = sine_f(f) * np.minimum(1, t / 0.004) * np.exp(-t / 0.07)
    return y, 0.0


def blip(rng, note=None):
    note = note or rng.choice([C6, D6, F6, A5])
    t = tt(0.16); f = mtof(note) * (0.82 + 0.18 * np.minimum(1, t / 0.018))
    y = sine_f(f) * np.minimum(1, t / 0.002) * np.exp(-t / 0.05)
    y += 0.18 * sine_f(2 * f) * np.exp(-t / 0.025)
    return y, 0.0


def rec(rng):
    y = np.zeros(n_(0.3))
    for t0, m, d in [(0, A5, 0.06), (0.075, E6, 0.12)]:
        t = tt(d + 0.05); f = mtof(m)
        s = (np.sin(2 * np.pi * f * t) + 0.2 * np.sin(6 * np.pi * f * t)) * np.minimum(1, t / 0.002) * np.exp(-np.maximum(0, t - d) / 0.015)
        _place(y, s, t0)
    return y, 0.0


# ---- knocks, bonks, thumps ---------------------------------------------------------------------------------------------
def bonk(rng):
    t = tt(0.5); p = _p(rng, 0.8)
    f = (235 + 340 * np.exp(-t / 0.03)) * p
    body = sine_f(f) * np.exp(-t / 0.12)
    ring = (np.sin(2 * np.pi * 1190 * p * t) * np.exp(-t / 0.07) * 0.22 + np.sin(2 * np.pi * 1745 * p * t) * np.exp(-t / 0.045) * 0.1)
    click = bp(_noise(rng, len(t)), 1500, 6500) * np.exp(-t / 0.004) * 0.7
    thud = lp(_noise(rng, len(t)), 280) * np.exp(-t / 0.03) * 0.9
    return np.tanh(1.4 * (body + ring + click + thud)), 0.0


def thunk(rng, kind="door"):
    t = tt(0.45); p = _p(rng, 0.6)
    if kind == "door":
        y = (np.sin(2 * np.pi * 82 * p * t) * np.exp(-t / 0.11) + 0.5 * np.sin(2 * np.pi * 370 * p * t) * np.exp(-t / 0.035)
             + 0.8 * lp(_noise(rng, len(t)), 700) * np.exp(-t / 0.025) + 0.25 * bp(_noise(rng, len(t)), 1500, 5000) * np.exp(-t / 0.006))
    else:  # a rubber stamp on paper on a table
        y = (np.sin(2 * np.pi * 150 * p * t) * np.exp(-t / 0.06) + 0.35 * np.sin(2 * np.pi * 245 * p * t) * np.exp(-t / 0.09)
             + 0.7 * bp(_noise(rng, len(t)), 800, 5000) * np.exp(-t / 0.009) + 0.4 * lp(_noise(rng, len(t)), 1200) * np.exp(-t / 0.04))
    return np.tanh(1.3 * y), 0.0


def plonk(rng, small=False):
    t = tt(0.4); p = _p(rng, 0.7) * (1.45 if small else 1.0)
    f = (205 + 60 * np.exp(-t / 0.02)) * p
    y = sine_f(f) * np.exp(-t / 0.15) + 0.35 * sine_f(2.92 * f) * np.exp(-t / 0.05) + 0.2 * sine_f(5.1 * f) * np.exp(-t / 0.02)
    y += 0.5 * lp(_noise(rng, len(t)), 500) * np.exp(-t / 0.02)
    return y, 0.0


def pat(rng, n=2):
    y = np.zeros(n_(0.2 * n + 0.15))
    for k in range(n):
        t = tt(0.12); g = 1 - 0.2 * k
        s = lp(_noise(rng, len(t)), 450) * np.exp(-t / 0.02) * 1.2 + np.sin(2 * np.pi * 105 * _p(rng) * t) * np.exp(-t / 0.035)
        _place(y, g * s * np.minimum(1, t / 0.002), k * (0.17 + rng.uniform(-0.01, 0.01)))
    return y, 0.0


def tok(rng):
    t = tt(0.3); f = 1240 * _p(rng, 0.7)
    y = partials(f, [1, 2.32, 4.1, 6.3], [1, 0.45, 0.25, 0.1], [0.09, 0.05, 0.03, 0.015], 0.3, 0.0008)
    y += 0.8 * np.sin(2 * np.pi * 150 * t) * np.exp(-t / 0.03) + 0.4 * bp(_noise(rng, len(t)), 2000, 8000) * np.exp(-t / 0.003)
    return y, 0.0


def grab(rng):
    pre = 0.11; y = np.zeros(n_(pre + 0.3)); n = n_(pre); t = np.arange(n) / SR
    sw = sweep_bp(_noise(rng, n), 600 + 2400 * t / pre, 1.5) * (t / pre) ** 2
    _place(y, 0.6 * sw, 0)
    t2 = tt(0.25)
    th = lp(_noise(rng, len(t2)), 900) * np.exp(-t2 / 0.03) + 0.8 * np.sin(2 * np.pi * 120 * t2) * np.exp(-t2 / 0.04)
    _place(y, th, pre)
    return y, pre


# ---- taps, clicks, switches -------------------------------------------------------------------------------------------
def tap(rng, soft=1.0):
    t = tt(0.08)
    y = (bp(_noise(rng, len(t)), 1200, 6000) * np.exp(-t / 0.0028) + 0.45 * np.sin(2 * np.pi * 175 * _p(rng) * t) * np.exp(-t / 0.012)
         + 0.15 * np.sin(2 * np.pi * 3200 * _p(rng) * t) * np.exp(-t / 0.006))
    return y * soft, 0.0


def key(rng, g=1.0):
    y = np.zeros(n_(0.14)); p = _p(rng, 1.5)
    for dt, a in [(0, 1.0), (0.055 + rng.uniform(-0.01, 0.01), 0.45)]:
        t = tt(0.06)
        s = (bp(_noise(rng, len(t)), 1500, 5500) * np.exp(-t / 0.0035) + 0.3 * np.sin(2 * np.pi * 2250 * p * t) * np.exp(-t / 0.01)
             + 0.45 * np.sin(2 * np.pi * 260 * p * t) * np.exp(-t / 0.018))
        _place(y, a * g * s, dt)
    return y, 0.0


def typing(rng, n=3):
    y = np.zeros(n_(0.13 * n + 0.2)); t0 = 0.0
    for k in range(n):
        s, _ = key(rng, g=rng.uniform(0.7, 1.0) if k else 1.0)
        _place(y, s, t0); t0 += rng.uniform(0.075, 0.12)
    return y, 0.0


def ui_click(rng):
    t = tt(0.07); p = _p(rng, 1)
    y = (bp(_noise(rng, len(t)), 2000, 9000) * np.exp(-t / 0.0022) + 0.3 * np.sin(2 * np.pi * 1850 * p * t) * np.exp(-t / 0.008)
         + 0.25 * np.sin(2 * np.pi * 420 * p * t) * np.exp(-t / 0.01))
    return y, 0.0


def switch_click(rng, heavy=1.0):
    y = np.zeros(n_(0.25)); p = _p(rng, 0.8)
    for dt, a in [(0, 1.0), (0.0065, 0.55)]:
        t = tt(0.2)
        s = (bp(_noise(rng, len(t)), 1000, 5500) * np.exp(-t / 0.004) + 0.45 * np.sin(2 * np.pi * 690 * p * t) * np.exp(-t / 0.022)
             + 0.6 * heavy * np.sin(2 * np.pi * 140 * p * t) * np.exp(-t / 0.03) + 0.12 * np.sin(2 * np.pi * 3550 * p * t) * np.exp(-t / 0.015))
        _place(y, a * s, dt)
    return y, 0.0


def tick(rng):
    t = tt(0.06)
    e = np.minimum(1, t / 0.002) * np.exp(-t / 0.009)
    return bp(_noise(rng, len(t)), 2500, 8500) * e + 0.15 * np.sin(2 * np.pi * 4100 * t) * np.exp(-t / 0.004), 0.0


def tsk(rng):
    y = np.zeros(n_(0.3))
    for dt in (0, 0.16 + rng.uniform(-0.01, 0.01)):
        t = tt(0.05)
        s = bp(_noise(rng, len(t)), 1800, 4500) * np.exp(-t / 0.003) + 0.3 * np.sin(2 * np.pi * 2600 * _p(rng) * t) * np.exp(-t / 0.006)
        _place(y, s, dt)
    return y, 0.0


def rail_clack(rng):
    y = np.zeros(n_(0.45))
    for dt, a in [(0, 1.0), (0.13 + rng.uniform(-0.01, 0.01), 0.8)]:
        t = tt(0.3); p = _p(rng, 0.5)
        s = (partials(330 * p, [1, 2.4, 4.3], [0.8, 0.4, 0.2], [0.04, 0.025, 0.015], 0.3, 0.0008)
             + 0.7 * bp(_noise(rng, len(t)), 300, 2500) * np.exp(-t / 0.015) + 0.8 * np.sin(2 * np.pi * 68 * t) * np.exp(-t / 0.06))
        _place(y, a * s, dt)
    return y, 0.0


# ---- bells and chimes -------------------------------------------------------------------------------------------------
def ding(rng, note=None, kind="notify"):
    if kind == "door":  # a shop-door bell, struck three times as the door swings
        y = np.zeros(n_(1.4)); f = mtof(A6) * _p(rng, 0.2)
        for dt, a in [(0, 1.0), (0.075, 0.45), (0.16, 0.25)]:
            _place(y, a * partials(f, [1, 2.41, 3.93, 5.6], [1, 0.4, 0.25, 0.1], [0.55, 0.25, 0.12, 0.06], 1.2, 0.0006), dt)
        return y, 0.0
    if kind == "ting":
        f = mtof(note or F6 + 12) * _p(rng, 0.1)
        return partials(f, [1, 2.76], [1, 0.3], [0.3, 0.08], 0.6, 0.0006), 0.0
    f = mtof(note or C6) * _p(rng, 0.08)
    y = partials(f, [1, 2.0, 2.76, 5.4], [1, 0.22, 0.28, 0.07], [0.9, 0.45, 0.25, 0.08], 1.5, 0.0008)
    return y, 0.0


def dingdong(rng):
    y = np.zeros(n_(2.2))
    for dt, m in [(0, A5), (0.45, F5)]:
        t = tt(1.7); f = mtof(m)
        s = partials(f, [1, 4.0, 10.0], [1, 0.18, 0.05], [1.2, 0.3, 0.08], 1.7, 0.001) * (1 + 0.12 * np.sin(2 * np.pi * 5.5 * t))
        _place(y, s, dt)
    return y, 0.0


def phone_ring(rng):
    d = 0.9; y = np.zeros(n_(d + 0.4)); rate = 24
    for k in range(int(d * rate)):
        f = 1420 if k % 2 == 0 else 1180
        s = partials(f * _p(rng, 0.05), [1, 2.12, 3.4], [1, 0.4, 0.2], [0.05, 0.03, 0.02], 0.25 if k == int(d * rate) - 1 else 0.06, 0.0005)
        if k == int(d * rate) - 1: s = partials(f, [1, 2.12, 3.4], [1, 0.4, 0.2], [0.25, 0.12, 0.06], 0.4, 0.0005)
        _place(y, s * min(1, (k + 1) / 2), k / rate)
    return y, 0.0


def plink(rng):
    y = np.zeros(n_(0.6)); f = mtof(C7) * _p(rng, 0.3)
    for dt, a, ff in [(0, 1.0, 1.0), (0.07, 0.35, 1.03), (0.12, 0.15, 0.98)]:
        _place(y, a * partials(f * ff, [1, 2.32, 4.25, 6.1], [1, 0.4, 0.2, 0.1], [0.2, 0.08, 0.05, 0.03], 0.4, 0.0005), dt)
    return y, 0.0


# ---- pops, gulps, slurps ----------------------------------------------------------------------------------------------
def pop(rng, n=1):
    y = np.zeros(n_(0.16 * n + 0.15))
    for k in range(n):
        t = tt(0.08); p = _p(rng, 2) * (1 + 0.08 * k)
        f = (280 + 950 * np.exp(-t / 0.007)) * p
        s = sine_f(f) * np.minimum(1, t / 0.0008) * np.exp(-t / 0.018) + 0.3 * bp(_noise(rng, len(t)), 1500, 6000) * np.exp(-t / 0.002)
        _place(y, s, k * (0.14 + rng.uniform(-0.015, 0.015)))
    return y, 0.0


def gulp(rng):
    y = np.zeros(n_(0.5))
    for dt, a, f0, f1 in [(0, 1.0, 135, 420), (0.13, 0.45, 170, 360)]:
        t = tt(0.12); p = _p(rng, 0.8)
        f = (f0 + (f1 - f0) * np.minimum(1, t / 0.07)) * p
        s = sine_f(f) * np.minimum(1, t / 0.004) * np.exp(-t / 0.05) + 0.4 * lp(_noise(rng, len(t)), 260) * np.exp(-t / 0.025)
        s += (0.35 if dt == 0 else 0.1) * bp(_noise(rng, len(t)), 600, 3000) * np.exp(-t / 0.004)  # the throat click
        _place(y, a * s, dt)
    return y, 0.0


def slurp(rng):
    d = 0.7; n = n_(d); t = np.arange(n) / SR
    fc = 650 + 800 * np.sin(np.pi * np.minimum(1, t / (d * 0.8))) * _p(rng, 2)
    x = sweep_bp(pink(n, rng), fc, 3.5)
    # turbulent bursts: a rough amplitude at about 14 a second
    k = np.repeat(rng.uniform(0.25, 1.0, int(d * 16) + 2), n_(1 / 16))[:n]
    k = np.convolve(k, np.ones(n_(0.01)) / n_(0.01), "same")
    e = np.minimum(1, t / 0.02) * np.minimum(1, (d - t) / 0.12)
    y = x * k * e
    for _ in range(4):  # little bubbles
        t0 = rng.uniform(0.05, d - 0.15); tb = tt(0.04)
        b = sine_f((420 + 600 * tb / 0.04) * _p(rng, 2)) * np.exp(-tb / 0.012) * 0.25
        _place(y, b, t0)
    return lp(y, 5000), 0.0


# ---- swishes ----------------------------------------------------------------------------------------------------------
def whoosh(rng, dur=0.5, fa=450, fb=2200, attack=0.03, q=1.4, flutter=0.0, rise_only=False, travel=0.5, tone=None):
    n = n_(dur); t = np.arange(n) / SR; p = _p(rng, 1.5)
    x = lp(0.85 * pink(n, rng) + 0.15 * _noise(rng, n), 7000, 2)
    if rise_only: fc = (fa + (fb - fa) * np.minimum(1, t / (dur * 0.7))) * p
    else: fc = np.where(t < attack, fa + (fb - fa) * t / attack, fa * 0.6 + (fb - fa * 0.6) * np.exp(-(t - attack) / (dur * 0.35))) * p
    y = sweep_bp(x, fc, q)
    e = np.where(t < attack, (t / attack) ** 1.3, np.exp(-(t - attack) / (dur * 0.3)))
    if flutter:  # fabric: a rustle in the amplitude
        r = lp(_noise(rng, n), 35); r = r / (np.abs(r).max() + 1e-9)
        e = e * (1 + flutter * r)
    y = y * e
    if tone:  # a pitched sweep inside the air (ZOOM)
        f = tone[0] * (tone[1] / tone[0]) ** np.minimum(1, t / (dur * 0.55))
        y = y / (np.abs(y).max() + 1e-9) + 0.35 * sine_f(f) * np.minimum(1, t / 0.01) * np.exp(-t / (dur * 0.35))
    d = rng.choice([-1, 1]); pan = np.clip(-travel + 2 * travel * t / dur, -1, 1) * d
    a = (pan + 1) * np.pi / 4
    return np.stack([y * np.cos(a), y * np.sin(a)], 1) * 1.414, None


def fwump(rng):
    pre = 0.16; y = np.zeros((n_(pre + 0.45), 2))
    sw, _ = whoosh(rng, dur=pre + 0.1, fa=300, fb=1400, attack=pre * 0.9, q=1.2, flutter=0.5, travel=0.3)
    y[: len(sw)] += 0.8 * finish(sw)
    t = tt(0.4)
    th = lp(_noise(rng, len(t)), 500) * np.exp(-t / 0.05) + 0.9 * np.sin(2 * np.pi * 78 * t) * np.exp(-t / 0.09)
    y[n_(pre): n_(pre) + len(th)] += np.stack([th, th], 1)
    return y, pre


# ---- snaps --------------------------------------------------------------------------------------------------------------
def fan_snap(rng):
    pre = 0.07; y = np.zeros(n_(pre + 0.35))
    n = n_(pre); t = np.arange(n) / SR
    fl = bp(_noise(rng, n), 2200, 7000) * (t / pre) ** 2 * 0.5
    for k in range(5):  # the ribs closing
        _place(fl, 0.4 * bp(_noise(rng, n_(0.004)), 2500, 6000) * np.exp(-np.arange(n_(0.004)) / SR / 0.001), pre * (0.3 + 0.13 * k))
    _place(y, fl, 0)
    for dt, a in [(0, 1.0), (0.007, 0.65)]:
        t2 = tt(0.12)
        c = (bp(_noise(rng, len(t2)), 1800, 5500) * np.exp(-t2 / 0.006) + 0.4 * np.sin(2 * np.pi * 2380 * t2) * np.exp(-t2 / 0.012)
             + 0.35 * np.sin(2 * np.pi * 880 * t2) * np.exp(-t2 / 0.02) + 0.3 * np.sin(2 * np.pi * 190 * t2) * np.exp(-t2 / 0.02))
        _place(y, a * c, pre + dt)
    return y, pre


def shutter(rng):
    y = np.zeros(n_(0.3)); p = _p(rng, 0.7)
    for dt, a, f in [(0, 1.0, 1650), (0.058, 0.75, 1350)]:
        t = tt(0.1)
        s = (bp(_noise(rng, len(t)), 900, 5000) * np.exp(-t / 0.004) + 0.4 * np.sin(2 * np.pi * f * p * t) * np.exp(-t / 0.012)
             + 0.35 * np.sin(2 * np.pi * 240 * p * t) * np.exp(-t / 0.015))
        _place(y, a * s, dt)
    t = tt(0.05)  # the blade spring
    _place(y, 0.12 * np.sign(np.sin(2 * np.pi * 330 * t)) * np.exp(-t / 0.02), 0.008)
    return lp(y, 9000), 0.0


# ---- buzz, zap, hiss, rip -----------------------------------------------------------------------------------------------
def buzz(rng, dur=0.36, g=1.0):
    n = n_(dur); t = np.arange(n) / SR; f = 172 * _p(rng, 0.5)
    m = sum(np.sin(2 * np.pi * k * f * t) / k for k in (1, 3, 5, 7, 9, 11))
    m = m * (1 + 0.45 * np.sign(np.sin(np.pi * f * t)))  # rattling on the table
    rattle = bp(_noise(rng, n), 900, 3200) * (0.5 + 0.5 * np.sin(2 * np.pi * f * t)) * 0.35
    e = np.minimum(1, t / 0.012) * np.minimum(1, (dur - t) / 0.035)
    return lp((m * 0.5 + rattle) * e * g, 4000), 0.0


def zap(rng):
    d = 0.6; n = n_(d); t = np.arange(n) / SR
    f = 98 * np.where(t < d - 0.18, 1, 1 - 0.35 * (t - (d - 0.18)) / 0.18) * _p(rng)
    ph = np.cumsum(f) / SR
    saw = 2 * (ph % 1) - 1 + 0.6 * (2 * ((ph * 1.5) % 1) - 1)
    crack = np.repeat(rng.uniform(0.3, 1, int(d * 70) + 2), n_(1 / 70))[:n]
    siz = hp(_noise(rng, n), 4500) * (rng.uniform(0, 1, n) > 0.985) * 3
    y = bp(saw, 250, 3500) * crack + 0.25 * siz
    e = np.minimum(1, t / 0.006) * np.minimum(1, (d - t) / 0.05)
    return np.tanh(1.6 * y * e), 0.0


def hiss(rng, kind="cuff"):
    if kind == "cuff":
        d = 0.95; n = n_(d); t = np.arange(n) / SR
        x = bp(hp(_noise(rng, n), 1200), 2500, 7500)
        w = 1 + 0.25 * np.sin(2 * np.pi * 7 * t + rng.uniform(0, 6))
        e = np.minimum(1, t / 0.03) * np.where(t < 0.65, 1, np.exp(-(t - 0.65) / 0.09))
        hum = 0.12 * np.sign(np.sin(2 * np.pi * 61 * t)) * e  # the little pump
        return lp(x * w * e + bp(hum, 100, 1500), 9000), 0.0
    d = 0.7; n = n_(d); t = np.arange(n) / SR  # a pneumatic door
    x = sweep_bp(_noise(rng, n), 6000 * np.exp(-t / 0.4) + 1800, 1.0)
    e = np.minimum(1, t / 0.005) * np.exp(-t / 0.22)
    th = 0.4 * lp(_noise(rng, n), 300) * np.exp(-t / 0.04)
    return x * e + th, 0.0


def rip(rng):
    d = 0.45 * _p(rng, 2); n = n_(d); y = np.zeros(n)
    t = 0.0
    while t < d - 0.004:
        k = t / d; dens = 0.0035 if 0.05 < k < 0.85 else 0.008
        g = rng.uniform(0.3, 1) * (min(1, k / 0.05) if k < 0.05 else (1 - (k - 0.85) / 0.15 * 0.7 if k > 0.85 else 1))
        m = n_(0.0018); _place(y, g * _noise(rng, m) * np.hanning(m), t)
        t += rng.exponential(dens)
    y = bp(y, 1500, 7500) + 0.15 * bp(_noise(rng, n), 2000, 6000) * np.minimum(1, np.arange(n) / SR / 0.02) * np.minimum(1, (d - np.arange(n) / SR) / 0.05)
    return y, 0.0


# ---- creatures --------------------------------------------------------------------------------------------------------
def bird(rng, kind="tweet"):
    y = np.zeros(n_(0.6))
    if kind == "tweet":
        syl = [(0, 0.075, 4300, 2900), (0.13, 0.07, 4500, 3000)] + ([(0.25, 0.05, 4100, 3300)] if rng.uniform() > 0.4 else [])
    else:
        syl = [(0, 0.04, 2800, 4600), (0.07, 0.04, 2900, 4700), (0.14, 0.045, 3000, 4900)]
    p = _p(rng, 1.5)
    for t0, d, fa, fb in syl:
        t = tt(d); f = (fa + (fb - fa) * (t / d) ** 0.7) * p
        s = (sine_f(f) + 0.12 * sine_f(2 * f)) * np.sin(np.pi * t / d) ** 1.5
        _place(y, s, t0)
    return y, None


def crickets(rng, dur=2.6):
    n = n_(dur); t = np.arange(n) / SR; y = np.zeros(n)
    for fc, per, ph, g in [(4700, 0.38, 0.0, 1.0), (5150, 0.46, 0.17, 0.6)]:
        gate = np.zeros(n)
        for g0 in np.arange(ph, dur, per):
            for k in range(3):
                i = n_(g0 + k / 28); m = n_(0.022)
                if i + m < n: gate[i:i + m] += np.hanning(m)
        y += g * np.sin(2 * np.pi * fc * t) * gate
    e = np.minimum(1, t / 0.15) * np.minimum(1, (dur - t) / 0.7)
    return y * e, 0.0


def flap(rng, n=4, g0=1.0):
    y = np.zeros((n_(0.15 * n + 0.2), 2)); t0 = 0.0
    for k in range(n):
        t = tt(0.1)
        s = (lp(_noise(rng, len(t)), 1200) * np.exp(-t / 0.035) * np.minimum(1, t / 0.005) * 1.4
             + 0.5 * np.sin(2 * np.pi * 160 * _p(rng) * t) * np.exp(-t / 0.025) + 0.2 * bp(_noise(rng, len(t)), 3000, 7000) * np.exp(-t / 0.012))
        pan = -0.3 + 0.6 * k / max(1, n - 1); a = (pan + 1) * np.pi / 4
        gg = g0 * (1 - 0.13 * k)
        y[n_(t0): n_(t0) + len(s)] += np.stack([s * np.cos(a), s * np.sin(a)], 1) * gg * 1.414
        t0 += rng.uniform(0.11, 0.15)
    return y, 0.0


# ---- machines -----------------------------------------------------------------------------------------------------------
def screech(rng):
    d = 1.35; n = n_(d); t = np.arange(n) / SR; y = np.zeros(n)
    for f, a in [(2950, 1.0), (3115, 0.7), (4380, 0.35), (1475, 0.3)]:
        fm = f * _p(rng, 0.3) + 40 * np.sin(2 * np.pi * rng.uniform(3, 7) * t + rng.uniform(0, 6)) + 25 * lp(_noise(rng, n), 8) * 30
        y += a * sine_f(fm)
    y += 0.35 * bp(_noise(rng, n), 2000, 6000)
    e = np.minimum(1, t / 0.06) ** 1.5 * np.minimum(1, (d - t) / 0.4) * (1 + 0.15 * np.sin(2 * np.pi * 2.3 * t))
    rum = 0.6 * lp(brown(n, rng), 120) * np.minimum(1, t / 0.1) * np.minimum(1, (d - t) / 0.5)
    return lp(y * e, 8000) * 0.5 + rum, 0.0


def rumble(rng, kind="train"):
    if kind == "train":
        d = 1.9; n = n_(d); t = np.arange(n) / SR
        x = lp(brown(n, rng), 160, 2) * (1 + 0.3 * np.sin(2 * np.pi * 6 * t))
        rails = bp(_noise(rng, n), 300, 900) * 0.15 * (1 + np.sign(np.sin(2 * np.pi * 3.3 * t)))
        e = np.minimum(1, t / 0.35) * np.minimum(1, (d - t) / 0.6)
        return (x + rails) * e, 0.0
    d = 0.95; n = n_(d); t = np.arange(n) / SR  # a tummy
    g = 0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(9 + 6 * np.sin(2 * np.pi * 1.3 * t)) / SR)
    x = lp(_noise(rng, n), 320) * g + 0.6 * sine_f(95 * (1 + 0.08 * np.sin(2 * np.pi * 4.5 * t))) * g
    e = np.minimum(1, t / 0.05) * np.minimum(1, (d - t) / 0.25)
    return x * e, 0.0


def whirr(rng):
    d = 1.6; n = n_(d); t = np.arange(n) / SR
    f = np.where(t < 1.25, 150 - 110 * np.exp(-t / 0.18), 150 * np.exp(-(t - 1.25) / 0.5)) * _p(rng)
    ph = np.cumsum(f) / SR
    saw = sum(np.sin(2 * np.pi * k * ph) / k for k in range(1, 18))
    y = bp(saw, 150, 2600) + 0.2 * bp(_noise(rng, n), 1000, 4000) * (f / 150)
    e = np.minimum(1, t / 0.04) * np.minimum(1, (d - t) / 0.3)
    return y * e, 0.0


def creak(rng):
    d = 0.65; n = n_(d); y = np.zeros(n); t = 0.0
    while t < d:
        r = 32 + 45 * np.sin(np.pi * t / d); m = n_(0.003)
        _place(y, _noise(rng, m) * np.hanning(m) * (0.6 + 0.4 * rng.uniform()), t); t += 1 / r
    z = 0.8 * bp(y, 520, 760, 2) + 0.6 * bp(y, 1150, 1500, 2) + 0.3 * bp(y, 2300, 2700, 2)
    tt_ = np.arange(n) / SR
    return z * np.minimum(1, tt_ / 0.02) * np.minimum(1, (d - tt_) / 0.1), 0.0


def boing(rng, wobble=False):
    if wobble:
        d = 1.05; t = tt(d); f0 = 330 * _p(rng)
        f = f0 * (1 + 0.12 * np.sin(2 * np.pi * 6 * t))
        y = (sine_f(f) + 0.25 * sine_f(2 * f)) * np.minimum(1, t / 0.02) * np.exp(-t / 0.5) * (1 + 0.3 * np.sin(2 * np.pi * 6 * t))
        return y, 0.0
    d = 0.8; t = tt(d); f0 = 196 * _p(rng)
    f = f0 * (1 + 0.35 * np.minimum(1, t / 0.35)) * (1 + 0.2 * np.exp(-t / 0.3) * np.sin(2 * np.pi * 11 * t))
    y = lp(np.tanh(3 * sine_f(f)), 2800) * np.minimum(1, t / 0.003) * np.exp(-t / 0.32)
    tw = 0.3 * bp(_noise(rng, n_(0.02)), 1500, 5000) * np.exp(-np.arange(n_(0.02)) / SR / 0.004)
    y[: len(tw)] += tw
    return y, 0.0


# ---- claps, cheers, stings --------------------------------------------------------------------------------------------
def clap(rng, big=True):
    t = tt(0.4)
    y = bp(_noise(rng, len(t)), 700, 4200) * np.minimum(1, t / 0.0008) * np.exp(-t / 0.022)
    y += 0.5 * np.sin(2 * np.pi * 215 * t) * np.exp(-t / 0.015)
    tail = bp(_noise(rng, len(t)), 500, 3000) * np.exp(-t / 0.09) * 0.12 * np.minimum(1, t / 0.01)
    return y + tail, 0.0


def applause(rng, dur=1.3, people=8):
    y = np.zeros((n_(dur + 0.2), 2))
    for _ in range(people):
        pan = rng.uniform(-0.6, 0.6); a = (pan + 1) * np.pi / 4; t0 = rng.uniform(0, 0.08); rate = rng.uniform(4.5, 6.5)
        lo = rng.uniform(700, 1300)
        while t0 < dur:
            t = tt(0.05)
            s = bp(_noise(rng, len(t)), lo, lo * 3) * np.exp(-t / rng.uniform(0.008, 0.018))
            g = rng.uniform(0.5, 1) * min(1, (dur - t0) / 0.4)
            y[n_(t0): n_(t0) + len(s)] += np.stack([s * np.cos(a), s * np.sin(a)], 1) * g
            t0 += 1 / rate + rng.uniform(-0.02, 0.02)
    return y, 0.0


def glock(note, dur=0.8, vel=1.0):
    f = mtof(note)
    return vel * partials(f, [1, 2.76, 5.4, 8.93], [1, 0.35, 0.12, 0.04], [0.7, 0.2, 0.08, 0.04], dur, 0.0008)


def brass_chord(rng, notes, dur, bright=1.0):
    n = n_(dur); t = np.arange(n) / SR; y = np.zeros(n)
    for m in notes:
        f = mtof(m)
        for det in (-0.004, 0.004):
            ph = np.cumsum(f * (1 + det) * (1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(1, t / 0.3))) / SR
            y += sum(np.sin(2 * np.pi * k * ph) / k for k in range(1, 14) if k * f < 12000)
    fc = 700 + 2600 * bright * np.minimum(1, t / 0.04) * np.exp(-np.maximum(0, t - 0.04) / 0.5) + 900
    y = sweep_lp(y, fc, 0.9)
    e = np.minimum(1, t / 0.012) * np.where(t < dur - 0.25, 1, np.maximum(0, (dur - t) / 0.25))
    return y * e / len(notes)


def tada(rng, small=False):
    """ta (a C chord stab) - DA (F major, held), with a glockenspiel sparkle on top: in the music's key"""
    gd = 0.14; y = np.zeros(n_(gd + 1.5))
    _place(y, 0.75 * brass_chord(rng, [C5 - 12, E5 - 12, G4, C5] if not small else [E5 - 12, C5], 0.12, 1.0), 0)
    main = brass_chord(rng, [F4 - 12, F4, A4, C5, F5] if not small else [F4, A4, C5], 1.2 if not small else 0.7, 1.0)
    _place(y, main, gd)
    for k, m in enumerate([F6, A6, C7] if not small else [A6, C7]):
        _place(y, 0.35 * glock(m, 0.8), gd + 0.03 + 0.05 * k)
    return y, 0.0


def cheer(rng):
    y, _ = applause(rng, 1.25, 7)
    sp = np.zeros(n_(1.0))
    for k, m in enumerate([F5 + 12, A5 + 12, C6 + 12]):
        _place(sp, 0.25 * glock(m, 0.6), 0.02 + 0.06 * k)
    y[: len(sp)] += np.stack([sp, sp], 1)
    return y, 0.0


# ---- gestures for vocal or emotional words (soft, never a fake voice) ----------------------------------------------------
def mallet(note, dur=0.6, vel=1.0, bend=None):
    t = tt(dur); f = mtof(note) * (np.ones_like(t) if bend is None else bend(t))
    y = sine_f(f) * np.exp(-t / 0.35) + 0.3 * sine_f(3.93 * f) * np.exp(-t / 0.06) + 0.08 * sine_f(9.3 * f) * np.exp(-t / 0.015)
    return vel * y * np.minimum(1, t / 0.002)


def question(rng, kind="?"):
    y = np.zeros(n_(0.9))
    up = lambda a, b, d: (lambda t: 2 ** (((a + (b - a) * np.minimum(1, t / d)) - a) / 12))
    if kind == "huh":
        _place(y, mallet(G4, 0.5, 0.9, lambda t: 2 ** ((-3 * np.minimum(1, t / 0.12) + 5 * np.clip((t - 0.15) / 0.15, 0, 1)) / 12)), 0)
    else:
        _place(y, mallet(C5, 0.45, 1.0, up(C5, F5, 0.11)), 0)
        if kind == "??": _place(y, mallet(D5, 0.45, 0.8, up(D5, A5, 0.1)), 0.2)
        if kind == "?!": _place(y, 0.6 * glock(C6 + 12, 0.4), 0.17)
        if kind == "!?": _place(y, 0.6 * glock(F6, 0.3), 0.0)
    return y, 0.0


def idea(rng):
    y = np.zeros(n_(0.8)); a, b = [(C6, F6), (A5, D6), (C6, A6)][int(rng.integers(3))]
    _place(y, glock(int(a), 0.5), 0); _place(y, glock(int(b), 0.6, 0.9), 0.07)
    return y, 0.0


def shimmer(rng, short=False):
    notes = [F5, A5, C6, F6] if not short else [A5, C6]
    y = np.zeros(n_(1.2))
    for k, m in enumerate(notes): _place(y, 0.6 * glock(m, 0.8), 0.055 * k)
    n = n_(0.9); t = np.arange(n) / SR
    air = bp(_noise(rng, n), 4000, 9000) * np.minimum(1, t / 0.12) * np.exp(-t / 0.3) * 0.15
    _place(y, air, 0)
    return y, 0.0


def breath(rng, kind="sigh"):
    if kind == "sigh": d, f0, f1, att, g = 0.95, 1300, 450, 0.12, 1.0
    elif kind == "yawn": d, f0, f1, att, g = 1.4, 500, 380, 0.3, 1.0
    elif kind == "hmph": d, f0, f1, att, g = 0.16, 600, 380, 0.01, 0.9
    else: d, f0, f1, att, g = 0.22, 1000, 700, 0.015, 0.9  # huff / puff
    n = n_(d); t = np.arange(n) / SR
    fc = f0 + (f1 - f0) * t / d
    if kind == "yawn": fc = 500 + 700 * np.sin(np.pi * t / d) ** 2 * (t < d * 0.6) + 380
    x = sweep_bp(pink(n, rng), fc * _p(rng, 1), 1.3)
    e = np.minimum(1, t / att) * np.minimum(1, (d - t) / (d * 0.5))
    return lp(x * e * g, 2800, 2), 0.0


def hmm(rng):
    y = np.zeros(n_(1.0))
    _place(y, mallet(A4, 0.6, 0.8), 0); _place(y, mallet(F4, 0.7, 0.6), 0.28)
    return y, 0.0


def blink(rng):
    y = np.zeros(n_(0.3))
    for dt in (0, 0.14):
        t = tt(0.06); _place(y, np.sin(2 * np.pi * mtof(A6 + 12) * _p(rng, 0.3) * t) * np.exp(-t / 0.012), dt)
    return y, 0.0


def scribble(rng):
    """a pencil scribbling on paper: a few quick strokes of filtered scratch noise"""
    y = np.zeros(n_(0.8)); t0 = 0.0
    for k in range(int(rng.integers(5, 8))):
        d = rng.uniform(0.06, 0.12); n = n_(d); t = np.arange(n) / SR
        lo = rng.uniform(1500, 2500)
        s = bp(_noise(rng, n), lo, lo * 2.6) * np.sin(np.pi * t / d) ** 0.7 * (0.7 + 0.3 * rng.uniform())
        _place(y, s, t0); t0 += d + rng.uniform(0.015, 0.04)
        if t0 > 0.7: break
    return y, 0.0


def stamp_thump(rng):
    return thunk(rng, "stamp")


# ---- the map from words to sounds -----------------------------------------------------------------------------------------
# base: level in dB relative to the library's reference loudness; soft: no sharp transient (checked loosely)
STAMPS = ("BETWEEN TWO VISITS", "STRICTLY BOUNDED", "HONEST ABOUT UNCERTAINTY", "SAFE", "EMPOWERING")


# effective level: the table's base x 0.6 (its range was drawn wide), then a trim per class
TRIM = {"breath gesture": -5.0, "whoosh/swish": -1.5, "question gesture": -1.0, "shimmer gesture": -1.5, "hmm gesture": -3.0}


def classify(txt, src):
    """(class name, maker, kwargs, level dB, soft onset) for a logged word at source time src; None = no sound"""
    c = _classify(txt, src)
    if c is None or c == "unknown": return c
    name, fn, kw, base, soft = c
    return name, fn, kw, round(base * 0.6 + TRIM.get(name, 0.0), 2), soft


def _classify(txt, src):
    raw = txt.strip()
    if raw and set(raw) <= set("!?"):  # punctuation-only words: a soft question glide or an idea pling
        if raw == "!": return ("idea pling", idea, {}, -14, False)
        kind = {"?!": "?!", "!?": "!?", "??": "??"}.get(raw, "?")
        return ("question gesture", question, {"kind": kind}, -15 if kind != "?" else -16, False)
    k = re.sub(r"[^A-Z\- ]", "", raw.upper()).strip()
    W = lambda base, **kw: ("whoosh/swish", whoosh, kw, base, False)
    if k in ("ZZZ", "NOD", "NOD NOD", "HEH", "NOM"): return None
    if k == "SCRIBBLE": return ("scribble", scribble, {}, -12, False)
    if k == "HUH": return ("question gesture", question, {"kind": "huh"}, -15, False)
    if k == "BEEP BEEP": return ("alarm beeps", alarm, {"groups": 2}, -6, False)
    if k == "BEEP": return ("alarm beeps", alarm, {"groups": 1}, -7, False) if src < 15 else ("beep (monitor)", monitor_beep, {}, -9, False)
    if k == "BOOP": return ("beep (monitor)", boop, {}, -12, False)
    if k == "BONK": return ("bonk", bonk, {}, -2, False)
    if k == "YAAAWN": return ("breath gesture", breath, {"kind": "yawn"}, -16, True)
    if k == "SIGH": return ("breath gesture", breath, {"kind": "sigh"}, -15, True)
    if k in ("HUFF", "PUFF"): return ("breath gesture", breath, {"kind": "puff"}, -16, False)
    if k == "HMPH": return ("breath gesture", breath, {"kind": "hmph"}, -16, False)
    if k == "BZZZT": return ("zap / BZZT", zap, {}, -7, False)
    if k == "BZZT": return ("buzz", buzz, {"g": 1.0 if "!" in raw else 0.85}, -8, False)
    if k == "WHOOSH":
        if "~" in raw: return W(-13, dur=0.6, fa=300, fb=1200, attack=0.04, q=1.4, travel=0.3)
        if "!" in raw: return W(-6, dur=0.42, fa=380, fb=1900, attack=0.03, q=1.5, flutter=0.25, travel=0.45)
        if 205 <= src < 210: return W(-4, dur=0.9, fa=220, fb=1700, attack=0.05, q=1.1, travel=0.7)
        return W(-5, dur=0.55, fa=300, fb=2000, attack=0.035, q=1.2, travel=0.6)
    if k == "SWISH" and "!" in raw: return W(-6, dur=0.75, fa=300, fb=1700, attack=0.04, q=1.1, flutter=0.6, travel=0.6)
    if k in ("SWOOSH", "SWISH"): return W(-10, dur=0.35, fa=500, fb=3200, attack=0.03, q=1.6, travel=0.4)
    if k == "SHHK": return W(-11, dur=0.22, fa=900, fb=4500, attack=0.02, q=1.8, travel=0.2)
    if k == "FWIP": return W(-9, dur=0.2, fa=1200, fb=5200, attack=0.02, q=1.8, travel=0.3)
    if k == "HUP": return W(-14, dur=0.24, fa=400, fb=2400, attack=0.03, q=1.6, rise_only=True, travel=0.15)
    if k == "ZOOM": return ("whoosh/swish (zoom)", whoosh, {"dur": 0.45, "fa": 500, "fb": 2600, "attack": 0.03, "q": 1.4, "travel": 0.2, "tone": (520, 1560)}, -12, False)
    if k == "FWUMP": return ("whoosh/swish", fwump, {}, -5, False)
    if k == "GRAB": return ("thunk/clunk/thwack", grab, {}, -7, False)
    if k == "TWEET": return ("chirp/tweet", bird, {"kind": "tweet"}, -9, False)
    if k == "CHIRP": return ("chirp/tweet", bird, {"kind": "chirp"}, -10, False)
    if k.startswith("CRI-CRI"): return ("crickets", crickets, {}, -12, True)
    if k == "FLAP FLAP": return ("flap", flap, {"n": 4}, -8, False)
    if k == "FLAP": return ("flap", flap, {"n": 2, "g0": 1.0}, -7, False)
    if k == "SNAP": return ("snap (fan)", fan_snap, {}, -4, False) if src < 27 else ("snap (camera)", shutter, {}, -10, False)
    if k == "RRRIP": return ("rip RRRIP", rip, {}, -6, False)
    if k == "PSSSHH": return ("hiss PSSSHH", hiss, {"kind": "door"}, -10, False) if 115 <= src < 127 else ("hiss PSSSHH", hiss, {"kind": "cuff"}, -9, False)
    if k == "TAP": return ("tap/click", tap, {}, -9, False)
    if k == "TAP TAP": return ("tap/click (typing)", typing, {"n": 2}, -9, False)
    if k == "TAP TAP TAP": return ("tap/click (typing)", typing, {"n": 3}, -9, False)
    if k == "CLICK":
        if 205 <= src < 210 or 362 <= src < 370 or 187 <= src < 205: return ("tap/click (switch)", switch_click, {"heavy": 1.0}, -9, False)
        return ("tap/click", ui_click, {}, -10, False)
    if k == "CLACK": return ("tap/click (switch)", switch_click, {"heavy": 1.4}, -7, False)
    if k == "CLACK-CLACK": return ("thunk/clunk/thwack (rail clack)", rail_clack, {}, -9, False)
    if k == "TICK": return ("tap/click", tick, {}, -11, False)
    if k == "TSK TSK": return ("tap/click (tsk)", tsk, {}, -17, False)
    if k == "BLINK BLINK": return ("pop/plink (blink)", blink, {}, -19, False)
    if k == "PAT PAT": return ("thunk/clunk/thwack (pat)", pat, {}, -12, False)
    if k == "TOK": return ("thunk/clunk/thwack (tok)", tok, {}, -9, False)
    if k == "DING": return ("ding (door bell)", ding, {"kind": "door"}, -8, False) if 127 <= src < 128 else ("ding", ding, {}, -8, False)
    if k == "TING": return ("ding", ding, {"kind": "ting"}, -14, False)
    if k == "DING-DONG": return ("ding-dong chime", dingdong, {}, -6, False)
    if k == "BRRING": return ("ring (phone)", phone_ring, {}, -5, False)
    if k == "SLURP": return ("slurp", slurp, {}, -9, False)
    if k == "GULP": return ("gulp", gulp, {}, -5, False)
    if k == "POP POP": return ("pop/plink", pop, {"n": 2}, -8, False)
    if k == "POP": return ("pop/plink", pop, {"n": 1}, -8 if "!" in raw else -10, False)
    if k == "PLINK": return ("pop/plink", plink, {}, -8, False)
    if k == "PLONK": return ("pop/plink (plonk)", plonk, {"small": raw.islower()}, -11 if raw.islower() else -7, False)
    if k == "BLIP": return ("pop/plink (blip)", blip, {}, -17, False)
    if k == "REC": return ("pop/plink (blip)", rec, {}, -13, False)
    if k == "THUNK": return ("thunk/clunk/thwack (stamp)", stamp_thump, {}, -3, False) if "!" in raw else ("thunk/clunk/thwack", thunk, {"kind": "door"}, -5, False)
    if k == "RMMMBLE": return ("rumble", rumble, {"kind": "train"}, -8, True)
    if k == "GRRUMBLE": return ("rumble", rumble, {"kind": "tummy"}, -12, True)
    if k.startswith("SCREE"): return ("screech", screech, {}, -9, False)
    if k == "CLAP": return ("clap/applause/hooray", clap, {}, -3, False)
    if k == "CLAP CLAP": return ("clap/applause/hooray", applause, {"dur": 0.6, "people": 2}, -6, False)
    if k in ("YAY", "HOORAY"): return ("clap/applause/hooray", cheer, {}, -9, False)
    if k == "YES": return ("ta-da", tada, {"small": True}, -9, False)
    if k == "TA-DA": return ("ta-da", tada, {}, -6 if src < 400 else -11, False)  # the end card's sits on the music's sting
    if k == "CREAK": return ("creak", creak, {}, -10, False)
    if k == "WOBBLE": return ("boing (wobble)", boing, {"wobble": True}, -13, False)
    if k == "BOING": return ("boing", boing, {}, -4, False)
    if k in ("WHIRRR", "WHIRR"): return ("whirr", whirr, {}, -10, False)
    if k == "HMM": return ("hmm gesture", hmm, {}, -15, False)
    if k in ("OHH", "AHH", "OOH"): return ("shimmer gesture", shimmer, {}, -15, False)
    if k == "AH": return ("shimmer gesture", shimmer, {"short": True}, -15, False)
    if k in STAMPS: return ("thunk/clunk/thwack (stamp)", stamp_thump, {}, -4, False)
    return "unknown"
