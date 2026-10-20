"""Técnico → Sensibilidade: caller audio below a level reaches the voice model as silence.

GPT-Live takes turns from the audio it hears and has no VAD setting, so sensitivity acts on what it hears:
lower sensitivity mutes quiet background noise and distant voices; maximum sensitivity sends everything.
"""
import math

import numpy as np
from livekit import rtc

# stays open across short pauses so word endings and soft consonants are not cut
HOLD_SECONDS = 0.5


def floor_for(sensitivity) -> float:
    """RMS floor (full scale = 1.0) for a 0–1 sensitivity: 1 → off, 0.5 → -52 dBFS, 0 → -34 dBFS."""
    if isinstance(sensitivity, bool) or not isinstance(sensitivity, (int, float)) or not math.isfinite(sensitivity):
        sensitivity = 0.5
    s = min(1.0, max(0.0, float(sensitivity)))
    if s >= 0.99:
        return 0.0
    return 10 ** ((-70 + 36 * (1 - s)) / 20)


def rms(frame: rtc.AudioFrame) -> float:
    samples = np.frombuffer(frame.data, dtype=np.int16).astype(np.float32)
    return float(np.sqrt(np.mean(np.square(samples)))) / 32768.0 if samples.size else 0.0


class InputNoiseGate:
    """Opens on the first frame at or above the floor and closes HOLD_SECONDS after the last one."""

    def __init__(self, floor: float) -> None:
        self.floor = floor
        self._hold = 0.0
        self.muted_seconds = 0.0

    def apply(self, frame: rtc.AudioFrame) -> rtc.AudioFrame:
        if self.floor <= 0:
            return frame
        if rms(frame) >= self.floor:
            self._hold = HOLD_SECONDS
            return frame
        if self._hold > 0:
            self._hold -= frame.duration
            return frame
        self.muted_seconds += frame.duration
        return rtc.AudioFrame.create(frame.sample_rate, frame.num_channels, frame.samples_per_channel)


def gate_session(live_session, gate: InputNoiseGate):
    """Route the session's caller audio through the gate; the session keeps everything else."""
    if gate.floor > 0:
        push_audio = live_session.push_audio
        live_session.push_audio = lambda frame: push_audio(gate.apply(frame))
    return live_session
