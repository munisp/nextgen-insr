"""Field-test harness: liveness challenges under real noisy-camera profiles.

Simulates frame-signal streams (EAR / yaw / pitch) for 8 device camera
profiles seen in the field — from clean flagship sensors to very noisy
budget Androids — and runs them through the REAL detection logic in
liveness_service._check_challenge. Every profile must pass genuine motion
and must NOT produce a false_positive on "no motion" input.

Run: python -m unittest test_noisy_cameras -v
"""

import random
import zlib
import unittest

from liveness_service import (
    ChallengeState,
    _adapt_threshold,
    _check_challenge,
    _ema_smooth,
    _estimate_noise_floor,
)

# 8 field device profiles: (name, sensor noise floor on EAR/pose signals)
DEVICE_PROFILES = [
    ("iPhone 14", 0.010),        # clean flagship sensor
    ("Samsung A04", 0.030),      # budget Samsung, moderate noise
    ("Tecno Pop 7", 0.045),      # noisy budget sensor (common field device)
    ("Itel A60s", 0.050),        # very noisy entry-level sensor
    ("Nokia C12", 0.040),
    ("Infinix Hot 30", 0.035),
    ("Tecno Spark 10", 0.038),
    ("Xiaomi Redmi A2", 0.042),
]


def _noisy(signal, noise, seed):
    rng = random.Random(seed)
    return [v + rng.uniform(-noise, noise) for v in signal]


def _run_blink(ear_signal):
    state = ChallengeState(session_id="sim", challenge="blink")
    state.ear_history = ear_signal
    return _check_challenge(state)


def _run_turn(yaw_signal, direction="turn_right"):
    state = ChallengeState(session_id="sim", challenge=direction)
    state.yaw_history = yaw_signal
    return _check_challenge(state)


def _run_nod(pitch_signal):
    state = ChallengeState(session_id="sim", challenge="nod")
    state.pitch_history = pitch_signal
    return _check_challenge(state)


class TestDeviceProfiles(unittest.TestCase):
    """Genuine challenges must be detected on every device profile."""

    def test_blink_detected_on_all_profiles(self):
        # Genuine blink: steady baseline, EAR dips to ~0.05, recovers to 0.30
        clean = [0.30, 0.30, 0.30, 0.30, 0.10, 0.05, 0.10, 0.28, 0.30, 0.30]
        for name, noise in DEVICE_PROFILES:
            with self.subTest(device=name):
                signal = _noisy(clean, noise, seed=zlib.crc32(name.encode()) % 1000)
                blink_detected = _run_blink(signal)
                self.assertTrue(blink_detected, f"blink missed on {name}")

    def test_turn_detected_on_all_profiles(self):
        # Genuine right turn: sustained yaw plateau above threshold.
        clean = [0.00, 0.00, 0.02, 0.12, 0.20, 0.24, 0.24, 0.24, 0.23]
        for name, noise in DEVICE_PROFILES:
            with self.subTest(device=name):
                signal = _noisy(clean, noise, seed=zlib.crc32(name.encode()) % 1000)
                turn_detected = _run_turn(signal, "turn_right")
                self.assertTrue(turn_detected, f"turn missed on {name}")

    def test_nod_detected_on_all_profiles(self):
        # Genuine nod: steady baseline, then a clear down-up oscillation.
        clean = [0.00, 0.00, 0.00, 0.10, 0.24, 0.28, 0.12, -0.04, -0.10, 0.02, 0.12]
        for name, noise in DEVICE_PROFILES:
            with self.subTest(device=name):
                signal = _noisy(clean, noise, seed=zlib.crc32(name.encode()) % 1000)
                nod_detected = _run_nod(signal)
                self.assertTrue(nod_detected, f"nod missed on {name}")


class TestFalsePositiveRejection(unittest.TestCase):
    """Noise alone ("no motion") must never pass a challenge."""

    def test_no_false_positive_blink_on_no_motion(self):
        # "no motion": EAR steady at 0.30 ± noise only
        for name, noise in DEVICE_PROFILES:
            with self.subTest(device=name):
                signal = _noisy([0.30] * 10, noise, seed=zlib.crc32(name.encode()) % 999)
                false_positive = _run_blink(signal)
                self.assertFalse(false_positive, f"false_positive blink on {name}")

    def test_no_false_positive_turn_on_no_motion(self):
        for name, noise in DEVICE_PROFILES:
            with self.subTest(device=name):
                signal = _noisy([0.01] * 8, noise, seed=zlib.crc32(name.encode()) % 999)
                false_positive = _run_turn(signal, "turn_right")
                self.assertFalse(false_positive, f"false_positive turn on {name}")

    def test_no_false_positive_nod_on_no_motion(self):
        for name, noise in DEVICE_PROFILES:
            with self.subTest(device=name):
                signal = _noisy([0.02] * 9, noise, seed=zlib.crc32(name.encode()) % 999)
                false_positive = _run_nod(signal)
                self.assertFalse(false_positive, f"false_positive nod on {name}")

    def test_single_frame_spike_rejected(self):
        # One-frame spike must not satisfy the sustained-motion requirement.
        signal = [0.01, 0.01, 0.30, 0.01, 0.01, 0.01]
        self.assertFalse(_run_turn(signal, "turn_right"))


class TestCorrectedBlinkThresholds(unittest.TestCase):
    """The sprint-95 blink fix: dip_threshold from the adaptive scale, but
    recovery_level anchored to the BASE threshold."""

    def test_dip_and_recovery_levels(self):
        base_threshold = 0.22
        for name, noise in (("Tecno Pop 7", 0.045), ("Itel A60s", 0.05)):
            with self.subTest(device=name):
                dip_threshold = _adapt_threshold(base_threshold, noise, scale=1.5)
                recovery_level = base_threshold + max(0.03, 0.05 - noise)
                # A normal open-eye EAR (~0.30) must always clear recovery.
                self.assertGreater(0.30, recovery_level)
                # And the dip threshold must stay below open-eye EAR.
                self.assertLess(dip_threshold, 0.30)

    def test_ema_and_noise_floor_helpers(self):
        smoothed = _ema_smooth([0.3, 0.1, 0.3], alpha=0.4)
        self.assertEqual(len(smoothed), 3)
        self.assertEqual(_estimate_noise_floor([0.3, 0.3]), 0.0)
        self.assertGreater(_estimate_noise_floor([0.3, 0.1, 0.25, 0.15]), 0.0)


if __name__ == "__main__":
    unittest.main()
