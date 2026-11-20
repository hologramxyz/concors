#!/usr/bin/env python3
"""Synthesizes the extra agent notification sounds in apps/desktop/src/notifications/sounds.

They are generated rather than recorded so they carry no third-party license (the two Material
sounds, done.mp3 and request.mp3, are credited in third-party/source-notices.md). Each is a few
decaying sine partials: short, soft at the start, and quiet enough to sit next to the Material ones.

    python3 scripts/notification-sounds.py   # needs `lame` on PATH

Standard library only, so it runs anywhere Python does.
"""

import math
import os
import struct
import subprocess
import tempfile
import wave

RATE = 48000
OUT = os.path.join(os.path.dirname(__file__), "..", "apps/desktop/src/notifications/sounds")


def note(freq, start, length, partials=((1, 1.0),), decay=6.0, attack=0.004, bend=0.0):
    """One struck note: partials of `freq` (ratio, level), exponential decay, a click-free attack."""
    return (freq, start, length, partials, decay, attack, bend)


def render(notes, length, gain=0.5):
    samples = [0.0] * int(RATE * length)
    for freq, start, dur, partials, decay, attack, bend in notes:
        first = int(RATE * start)
        for i in range(int(RATE * dur)):
            t = i / RATE
            env = min(1.0, t / attack) * math.exp(-decay * t)
            # A downward bend gives "pop" its drop: the pitch falls linearly by `bend` over the
            # note, and the phase is its integral so the sweep stays smooth.
            phase = 2 * math.pi * freq * (t - bend * t * t / (2 * dur))
            value = sum(level * math.sin(ratio * phase) for ratio, level in partials)
            if first + i < len(samples):
                samples[first + i] += env * value
    peak = max(abs(s) for s in samples) or 1.0
    fade = int(RATE * 0.03)
    out = []
    for i, s in enumerate(samples):
        tail = min(1.0, (len(samples) - i) / fade)
        out.append(int(32767 * gain * tail * s / peak))
    return out


BELL = ((1, 1.0), (2.76, 0.35), (5.4, 0.12))
SOFT = ((1, 1.0), (2, 0.18), (3, 0.05))

SOUNDS = {
    "chime": render(
        [note(1318.5, 0, 0.9, SOFT, 5), note(1975.5, 0.11, 0.8, SOFT, 5)], 0.9, 0.32
    ),
    "ping": render([note(1760, 0, 0.6, SOFT, 9)], 0.6, 0.32),
    "pop": render([note(620, 0, 0.12, ((1, 1.0), (2, 0.1)), 30, 0.002, 0.45)], 0.16, 0.4),
    "bell": render([note(880, 0, 1.2, BELL, 3.5)], 1.2, 0.36),
    "rise": render(
        [note(1046.5, 0, 0.35, SOFT, 10), note(1568, 0.12, 0.6, SOFT, 7)], 0.7, 0.32
    ),
    "knock": render(
        [
            note(330, 0, 0.12, ((1, 1.0), (2.3, 0.3)), 35, 0.002),
            note(330, 0.14, 0.12, ((1, 1.0), (2.3, 0.3)), 35, 0.002),
        ],
        0.3,
        0.45,
    ),
}

for name, pcm in SOUNDS.items():
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        path = tmp.name
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(struct.pack(f"<{len(pcm)}h", *pcm))
    target = os.path.join(OUT, f"{name}.mp3")
    subprocess.run(["lame", "--quiet", "-b", "96", path, target], check=True)
    os.remove(path)
    print(target)
