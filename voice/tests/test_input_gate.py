import math
import sys
from pathlib import Path

import numpy as np
from livekit import rtc

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from input_gate import HOLD_SECONDS, InputNoiseGate, floor_for, gate_session, rms  # noqa: E402

RATE, SAMPLES = 16000, 320  # 20 ms frames


def tone(level: float) -> rtc.AudioFrame:
    """A 440 Hz frame whose RMS is `level` of full scale."""
    t = np.arange(SAMPLES) / RATE
    data = (np.sin(2 * math.pi * 440 * t) * level * math.sqrt(2) * 32767).astype(np.int16)
    return rtc.AudioFrame(data.tobytes(), RATE, 1, SAMPLES)


def test_floor_mapping():
    assert floor_for(1) == 0.0 and floor_for(0.995) == 0.0
    assert math.isclose(20 * math.log10(floor_for(0.5)), -52, abs_tol=0.01)
    assert math.isclose(20 * math.log10(floor_for(0)), -34, abs_tol=0.01)
    assert floor_for(0.2) > floor_for(0.5) > floor_for(0.8) > 0
    for bad in (None, 'x', True, float('nan')):
        assert floor_for(bad) == floor_for(0.5)


def test_gate_mutes_noise_keeps_speech_and_tails():
    gate = InputNoiseGate(floor_for(0.5))
    noise, speech = tone(10 ** (-60 / 20)), tone(10 ** (-30 / 20))
    assert rms(gate.apply(noise)) == 0.0, 'quiet background noise reaches the model as silence'
    assert math.isclose(rms(gate.apply(speech)), rms(speech), rel_tol=1e-6), 'speech passes untouched'
    held = round(HOLD_SECONDS / 0.02)
    assert all(rms(gate.apply(noise)) > 0 for _ in range(held)), 'the tail after speech is kept'
    assert rms(gate.apply(noise)) == 0.0, 'then the gate closes again'
    assert gate.muted_seconds > 0


def test_max_sensitivity_and_low_sensitivity():
    soft = tone(10 ** (-45 / 20))
    assert rms(InputNoiseGate(floor_for(1)).apply(soft)) > 0, 'maximum sensitivity sends everything'
    assert rms(InputNoiseGate(floor_for(0.5)).apply(soft)) > 0, 'default keeps a soft voice (-45 dBFS)'
    assert rms(InputNoiseGate(floor_for(0)).apply(soft)) == 0.0, 'minimum sensitivity ignores it'


def test_session_wrapper_gates_only_caller_audio():
    pushed = []

    class FakeSession:
        def push_audio(self, frame):
            pushed.append(rms(frame))

    s = gate_session(FakeSession(), InputNoiseGate(floor_for(0.5)))
    s.push_audio(tone(10 ** (-60 / 20)))
    s.push_audio(tone(10 ** (-30 / 20)))
    assert pushed[0] == 0.0 and pushed[1] > 0
    untouched = FakeSession()
    assert gate_session(untouched, InputNoiseGate(floor_for(1))).push_audio.__func__ is FakeSession.push_audio, 'maximum sensitivity leaves the session as is'


if __name__ == '__main__':
    for name, fn in list(globals().items()):
        if name.startswith('test_'):
            fn()
            print('ok', name)
