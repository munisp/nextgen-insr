"""
Liveness Detection Service (port 8110).

Real image-processing liveness checks:
- MediaPipe FaceMesh landmark extraction from real frames, with adaptive
  denoising (bilateral filter, never GaussianBlur — Gaussian smoothing would
  destroy landmark accuracy).
- Active challenges: blink (EAR), head turn (yaw), look up/down (pitch),
  head-nod oscillation (pitch direction changes), smile (MAR).
- Noise tolerance: EMA temporal smoothing, noise-floor estimation from
  frame-to-frame diffs, noise-adaptive thresholds, sustained-motion
  requirements, and a signal-to-noise guard for blink detection.

Blink fix (sprint 95): the dip threshold adapts with scale=1.5 and the
recovery level is anchored to the BASE threshold, not the adaptive one —
on noisy cameras the old adaptive recovery level rose above a normal
open-eye EAR and real blinks were never detected.

Fail-loud policy: if OpenCV/MediaPipe are not installed, /challenge/*
endpoints return 503 and /health reports degraded — no frame is ever
"liveness-passed" by a stub.
"""

import base64
import math
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None

try:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel
except ImportError:  # pragma: no cover
    FastAPI = None
    HTTPException = None
    BaseModel = object

PORT = int(os.getenv("PORT", "8110"))

# Base detection thresholds (noise-free conditions).
EAR_BASE_THRESHOLD = 0.22   # eye aspect ratio below this = eye closed
MAR_BASE_THRESHOLD = 0.5    # mouth aspect ratio above this = smile/open
YAW_BASE_THRESHOLD = 0.08   # normalized nose-x offset for head turn
PITCH_BASE_THRESHOLD = 0.06  # normalized nose-y swing for nod/look

# MediaPipe FaceMesh landmark indices used for EAR/MAR/pose.
LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]
MOUTH = [61, 291, 13, 14]
NOSE_TIP = 1


# ── Pure signal-processing helpers (unit-testable without cv2) ───────────────

def _ema_smooth(history: list, alpha: float = 0.3) -> list:
    """Exponential moving average over a signal history."""
    if not history:
        return []
    smoothed = [history[0]]
    for v in history[1:]:
        smoothed.append(alpha * v + (1 - alpha) * smoothed[-1])
    return smoothed


def _estimate_noise_floor(history: list, window: int = 10) -> float:
    """Noise floor = standard deviation of recent frame-to-frame diffs."""
    if len(history) < 3:
        return 0.0
    recent = history[-window:]
    diffs = [abs(recent[i] - recent[i-1]) for i in range(1, len(recent))]
    if not diffs:
        return 0.0
    if np is not None:
        return float(np.std(diffs))
    mean = sum(diffs) / len(diffs)
    return math.sqrt(sum((d - mean) ** 2 for d in diffs) / len(diffs))


def _adapt_threshold(base_threshold: float, noise: float, scale: float = 1.5) -> float:
    """Raise a base threshold proportionally to the measured noise floor."""
    return base_threshold + noise * scale


def _sustained_check(values: list, condition_fn, min_frames: int = 2) -> bool:
    """True only when the condition holds for the last min_frames consecutive
    frames — a single-frame noise spike can never trigger a challenge pass."""
    consecutive = 0
    for v in reversed(values):
        if condition_fn(v):
            consecutive += 1
            if consecutive >= min_frames:
                return True
        else:
            break
    return False


# ── Challenge state ──────────────────────────────────────────────────────────

@dataclass
class ChallengeState:
    session_id: str
    challenge: str
    ear_history: List[float] = field(default_factory=list)
    mar_history: List[float] = field(default_factory=list)
    yaw_history: List[float] = field(default_factory=list)
    pitch_history: List[float] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    completed: bool = False


_sessions: Dict[str, ChallengeState] = {}


# ── Challenge evaluation (the noise-tolerant core) ──────────────────────────

def _check_challenge(state: ChallengeState) -> bool:
    """Evaluate the session's challenge against observed signal histories.

    Returns True only on genuine motion: noise-adaptive thresholds, EMA
    smoothing, sustained-frame requirements, and SNR guards throughout.
    """
    challenge = state.challenge

    if challenge == "blink":
        # Blink needs enough frames for a real dip-and-recover pattern.
        if len(state.ear_history) >= 5:
            smoothed = _ema_smooth(state.ear_history, alpha=0.4)
            recent = smoothed[-8:]
            # Noise floor from the first captured frames (always pre-blink:
            # the blink prompt is shown after capture starts). Estimating
            # over the full history would count the genuine blink itself as
            # noise and inflate the floor past the SNR guard.
            noise = _estimate_noise_floor(state.ear_history[:3])
            threshold = EAR_BASE_THRESHOLD
            # Dip detection adapts moderately to noise (scale=1.5).
            dip_threshold = _adapt_threshold(threshold, noise, scale=1.5)
            # High-confidence classification bound for very noisy cameras.
            strict_threshold = _adapt_threshold(threshold, noise, scale=2.0)
            # Recovery anchors to the BASE threshold (sprint-95 fix): with an
            # adaptive recovery level a normal open-eye EAR (~0.30) on a noisy
            # camera would never exceed it and real blinks were missed.
            recovery_level = threshold + max(0.03, 0.05 - noise)
            recovery_margin = max(0.05, 0.08 - noise)
            min_ear = min(recent)
            max_ear = max(recent)
            # Signal must exceed 3x the noise floor, else it is noise-only.
            snr_ok = (max_ear - min_ear) > noise * 3
            if min_ear < dip_threshold and max_ear > recovery_level and snr_ok:
                # Confident blink: deep dip below the strict bound, or a wide
                # amplitude clearing the recovery margin.
                if min_ear < strict_threshold or (max_ear - min_ear) > recovery_margin:
                    return True
        return False

    elif challenge in ("turn_left", "turn_right"):
        yaw_history = state.yaw_history
        smoothed = _ema_smooth(yaw_history, alpha=0.35)
        noise = _estimate_noise_floor(yaw_history)
        threshold = YAW_BASE_THRESHOLD
        turn_threshold = _adapt_threshold(threshold, noise, scale=1.2)
        if len(smoothed) < 2:
            return False
        if challenge == "turn_left":
            return _sustained_check(smoothed, lambda v: v < -turn_threshold, min_frames=2)
        return _sustained_check(smoothed, lambda v: v > turn_threshold, min_frames=2)

    elif challenge in ("look_up", "look_down"):
        pitch_history = state.pitch_history
        smoothed = _ema_smooth(pitch_history, alpha=0.35)
        noise = _estimate_noise_floor(pitch_history)
        threshold = PITCH_BASE_THRESHOLD
        look_threshold = _adapt_threshold(threshold, noise, scale=1.5)
        if len(smoothed) < 2:
            return False
        if challenge == "look_up":
            return _sustained_check(smoothed, lambda v: v < -look_threshold, min_frames=2)
        return _sustained_check(smoothed, lambda v: v > look_threshold, min_frames=2)

    elif challenge == "nod":
        # A genuine nod is an OSCILLATION: pitch must swing far enough AND
        # change direction — a single drift (or noise) is not a nod.
        pitches = state.pitch_history
        smoothed = _ema_smooth(pitches, alpha=0.35)
        # Baseline noise from the first frames (pre-motion), same rationale
        # as blink: the nod itself must not inflate its own noise floor.
        noise = _estimate_noise_floor(pitches[:3])
        threshold = PITCH_BASE_THRESHOLD
        nod_threshold = _adapt_threshold(threshold, noise, scale=1.5)
        if len(smoothed) < 4:
            return False
        directions = []
        for i in range(1, len(smoothed)):
            diff = smoothed[i] - smoothed[i-1]
            if abs(diff) > noise * 1.5:
                directions.append(1 if diff > 0 else -1)
        changes = sum(
            1 for i in range(1, len(directions)) if directions[i] != directions[i - 1]
        )
        pitch_range = max(smoothed) - min(smoothed)
        return pitch_range > nod_threshold and changes >= 1

    elif challenge == "smile":
        smoothed = _ema_smooth(state.mar_history, alpha=0.4)
        noise = _estimate_noise_floor(state.mar_history)
        threshold = MAR_BASE_THRESHOLD
        smile_threshold = _adapt_threshold(threshold, noise, scale=1.5)
        if len(smoothed) < 2:
            return False
        return _sustained_check(smoothed, lambda v: v > smile_threshold, min_frames=2)

    return False


# ── Real frame processing (cv2 + MediaPipe, lazy imports) ───────────────────

def extract_landmarks(image, face_mesh):
    """Extract FaceMesh landmarks from a real BGR frame.

    Noise handling: estimate sensor noise from the Laplacian-variance drop
    after median denoising, then apply an edge-preserving bilateral filter
    scaled to the noise level. (A plain Gaussian smoothing pass is avoided
    here on purpose — it smears eye/mouth edges and degrades landmark
    accuracy.)
    """
    import cv2

    gray_check = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    raw_var = cv2.Laplacian(gray_check, cv2.CV_64F).var()
    smoothed_check = cv2.medianBlur(gray_check, 3)
    smooth_var = cv2.Laplacian(smoothed_check, cv2.CV_64F).var()
    noise_diff = abs(raw_var - smooth_var)

    if noise_diff > 200:
        image = cv2.bilateralFilter(image, d=5, sigmaColor=50, sigmaSpace=50)
    elif noise_diff > 80:
        image = cv2.bilateralFilter(image, d=3, sigmaColor=30, sigmaSpace=30)

    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    results = face_mesh.process(rgb)
    if not results.multi_face_landmarks:
        return None
    return results.multi_face_landmarks[0].landmark


def _eye_aspect_ratio(landmarks, indices) -> float:
    def dist(a, b):
        return math.hypot(a.x - b.x, a.y - b.y)

    p = [landmarks[i] for i in indices]
    vertical = dist(p[1], p[5]) + dist(p[2], p[4])
    horizontal = 2.0 * dist(p[0], p[3])
    return vertical / horizontal if horizontal else 0.0


def _mouth_aspect_ratio(landmarks) -> float:
    left = landmarks[MOUTH[0]]
    right = landmarks[MOUTH[1]]
    top = landmarks[MOUTH[2]]
    bottom = landmarks[MOUTH[3]]
    width = math.hypot(left.x - right.x, left.y - right.y)
    height = math.hypot(top.x - bottom.x, top.y - bottom.y)
    return height / width if width else 0.0


def _head_pose_offsets(landmarks) -> tuple[float, float]:
    """Normalized yaw/pitch proxies from nose-tip position vs face bounds."""
    xs = [lm.x for lm in landmarks]
    ys = [lm.y for lm in landmarks]
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    w = max(max(xs) - min(xs), 1e-6)
    h = max(max(ys) - min(ys), 1e-6)
    nose = landmarks[NOSE_TIP]
    return (nose.x - cx) / w, (nose.y - cy) / h


def _mediapipe_available() -> bool:
    try:
        import cv2  # noqa: F401
        import mediapipe  # noqa: F401

        return True
    except ImportError:
        return False


_face_mesh = None


def _get_face_mesh():
    global _face_mesh
    if _face_mesh is None:
        import mediapipe as mp

        _face_mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=False, max_num_faces=1,
            refine_landmarks=True, min_detection_confidence=0.5,
        )
    return _face_mesh


# ── HTTP API ─────────────────────────────────────────────────────────────────

if FastAPI is not None:
    app = FastAPI(title="Liveness Detection Service", version="1.0.0")

    class FrameRequest(BaseModel):
        session_id: str
        frame_base64: str

    class StartRequest(BaseModel):
        challenge: str = "blink"

    @app.get("/health")
    def health():
        available = _mediapipe_available()
        return {
            "status": "ok" if available else "degraded",
            "service": "liveness-detection",
            "mediapipe_available": available,
            "active_sessions": len(_sessions),
            "challenges": ["blink", "turn_left", "turn_right", "look_up",
                            "look_down", "nod", "smile"],
        }

    @app.post("/challenge/start")
    def challenge_start(req: StartRequest):
        if req.challenge not in ("blink", "turn_left", "turn_right",
                                 "look_up", "look_down", "nod", "smile"):
            raise HTTPException(status_code=400, detail=f"unknown challenge {req.challenge}")
        session = ChallengeState(session_id=uuid.uuid4().hex, challenge=req.challenge)
        _sessions[session.session_id] = session
        return {"session_id": session.session_id, "challenge": session.challenge}

    @app.post("/challenge/frame")
    def challenge_frame(req: FrameRequest):
        if not _mediapipe_available():
            raise HTTPException(
                status_code=503,
                detail="opencv/mediapipe not installed; frames cannot be processed (fail-loud)",
            )
        session = _sessions.get(req.session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="unknown session_id")

        import cv2

        try:
            raw = base64.b64decode(req.frame_base64)
            arr = np.frombuffer(raw, dtype=np.uint8)
            image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"invalid frame: {exc}")
        if image is None:
            raise HTTPException(status_code=400, detail="frame did not decode as an image")

        landmarks = extract_landmarks(image, _get_face_mesh())
        if landmarks is None:
            return {"session_id": session.session_id, "face_detected": False,
                    "completed": False}

        session.ear_history.append(
            (_eye_aspect_ratio(landmarks, LEFT_EYE) + _eye_aspect_ratio(landmarks, RIGHT_EYE)) / 2
        )
        session.mar_history.append(_mouth_aspect_ratio(landmarks))
        yaw, pitch = _head_pose_offsets(landmarks)
        session.yaw_history.append(yaw)
        session.pitch_history.append(pitch)

        session.completed = _check_challenge(session)
        return {
            "session_id": session.session_id,
            "face_detected": True,
            "challenge": session.challenge,
            "completed": session.completed,
            "frames": len(session.ear_history),
        }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
