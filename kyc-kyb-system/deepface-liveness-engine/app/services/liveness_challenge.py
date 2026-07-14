"""Active liveness challenge service — blink detection, head pose, smile detection."""

import base64
import io
import json
import os
import time
from typing import Optional

import numpy as np
import structlog
from PIL import Image

try:
    import redis
    _redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    _redis = redis.Redis.from_url(_redis_url, decode_responses=True)
    _redis.ping()
    _use_redis = True
except Exception:
    _redis = None
    _use_redis = False

logger = structlog.get_logger(__name__)


def _decode_image(b64: str) -> np.ndarray:
    return np.array(Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB"))


def _eye_aspect_ratio(landmarks: dict) -> Optional[float]:
    """Compute eye aspect ratio from facial landmarks for blink detection."""
    try:
        left_eye = landmarks.get("left_eye")
        right_eye = landmarks.get("right_eye")
        if not left_eye or not right_eye:
            return None
        le = np.array(left_eye)
        re = np.array(right_eye)
        l_dist = float(np.linalg.norm(le[1] - le[5]) + np.linalg.norm(le[2] - le[4]))
        l_width = float(np.linalg.norm(le[0] - le[3]))
        r_dist = float(np.linalg.norm(re[1] - re[5]) + np.linalg.norm(re[2] - re[4]))
        r_width = float(np.linalg.norm(re[0] - re[3]))
        ear = (l_dist / max(2.0 * l_width, 1e-6) + r_dist / max(2.0 * r_width, 1e-6)) / 2.0
        return round(ear, 4)
    except Exception:
        return None


def _estimate_head_pose(face_region: dict) -> dict:
    """Estimate head pose (yaw, pitch) from face bounding box proportions."""
    x = face_region.get("x", 0)
    y = face_region.get("y", 0)
    w = face_region.get("w", 1)
    h = face_region.get("h", 1)
    aspect = w / max(h, 1)
    center_x_ratio = (x + w / 2.0) / max(x + w + 100, 1)
    yaw_estimate = (center_x_ratio - 0.5) * 60.0
    pitch_estimate = (aspect - 1.0) * 30.0
    return {
        "yaw_estimate": round(yaw_estimate, 2),
        "pitch_estimate": round(pitch_estimate, 2),
        "face_aspect_ratio": round(aspect, 4),
    }


class ChallengeSession:
    """Manages multi-frame active liveness challenge."""

    def __init__(self, session_id: str, challenge_type: str):
        self.session_id = session_id
        self.challenge_type = challenge_type
        self.frames: list[dict] = []
        self.started_at = time.monotonic()

    def add_frame(self, frame_data: dict) -> None:
        self.frames.append({**frame_data, "timestamp": time.monotonic() - self.started_at})

    def evaluate_blink(self) -> dict:
        """Check if a blink was detected across the frame sequence."""
        ears = [f.get("ear") for f in self.frames if f.get("ear") is not None]
        if len(ears) < 3:
            return {"passed": False, "reason": "insufficient_frames", "frame_count": len(ears)}
        min_ear = min(ears)
        max_ear = max(ears)
        blink_detected = (max_ear - min_ear) > 0.05 and min_ear < 0.22
        return {
            "passed": blink_detected,
            "min_ear": round(min_ear, 4),
            "max_ear": round(max_ear, 4),
            "ear_delta": round(max_ear - min_ear, 4),
            "frame_count": len(ears),
        }

    def evaluate_head_turn(self) -> dict:
        """Check if head turn was performed."""
        yaws = [f.get("yaw", 0) for f in self.frames if "yaw" in f]
        if len(yaws) < 3:
            return {"passed": False, "reason": "insufficient_frames"}
        yaw_range = max(yaws) - min(yaws)
        return {
            "passed": yaw_range > 10.0,
            "yaw_range": round(yaw_range, 2),
            "min_yaw": round(min(yaws), 2),
            "max_yaw": round(max(yaws), 2),
        }

    def evaluate_smile(self) -> dict:
        """Check if smile was detected in frame sequence."""
        emotions = [f.get("dominant_emotion") for f in self.frames if f.get("dominant_emotion")]
        happy_count = sum(1 for e in emotions if e == "happy")
        neutral_count = sum(1 for e in emotions if e == "neutral")
        total = len(emotions)
        if total < 2:
            return {"passed": False, "reason": "insufficient_frames"}
        has_transition = neutral_count > 0 and happy_count > 0
        return {
            "passed": has_transition and happy_count >= 1,
            "happy_frames": happy_count,
            "neutral_frames": neutral_count,
            "total_frames": total,
        }

    def evaluate(self) -> dict:
        """Run the appropriate challenge evaluation."""
        if self.challenge_type == "blink":
            return self.evaluate_blink()
        elif self.challenge_type == "head_turn":
            return self.evaluate_head_turn()
        elif self.challenge_type == "smile":
            return self.evaluate_smile()
        else:
            return {"passed": True, "reason": "passive_liveness"}


_REDIS_PREFIX = "liveness:session:"
_SESSION_TTL = 600  # 10 minutes

# Fallback in-memory store when Redis is unavailable
_sessions: dict[str, ChallengeSession] = {}


def _serialize_session(session: ChallengeSession) -> str:
    return json.dumps({
        "session_id": session.session_id,
        "challenge_type": session.challenge_type,
        "frames": session.frames,
        "started_at": session.started_at,
    })


def _deserialize_session(data: str) -> ChallengeSession:
    d = json.loads(data)
    s = ChallengeSession(d["session_id"], d["challenge_type"])
    s.frames = d["frames"]
    s.started_at = d["started_at"]
    return s


def create_challenge_session(session_id: str, challenge_type: str) -> ChallengeSession:
    session = ChallengeSession(session_id, challenge_type)
    if _use_redis and _redis:
        try:
            _redis.setex(f"{_REDIS_PREFIX}{session_id}", _SESSION_TTL, _serialize_session(session))
            return session
        except Exception as e:
            logger.warning("redis_store_failed", error=str(e), session_id=session_id)
    _sessions[session_id] = session
    return session


def get_challenge_session(session_id: str) -> Optional[ChallengeSession]:
    if _use_redis and _redis:
        try:
            data = _redis.get(f"{_REDIS_PREFIX}{session_id}")
            if data:
                return _deserialize_session(data)
        except Exception as e:
            logger.warning("redis_get_failed", error=str(e), session_id=session_id)
    return _sessions.get(session_id)


def _save_session(session: ChallengeSession) -> None:
    if _use_redis and _redis:
        try:
            _redis.setex(f"{_REDIS_PREFIX}{session.session_id}", _SESSION_TTL, _serialize_session(session))
            return
        except Exception as e:
            logger.warning("redis_save_failed", error=str(e))
    _sessions[session.session_id] = session


def complete_challenge(session_id: str) -> Optional[dict]:
    session: Optional[ChallengeSession] = None
    if _use_redis and _redis:
        try:
            data = _redis.getdel(f"{_REDIS_PREFIX}{session_id}")
            if data:
                session = _deserialize_session(data)
        except Exception as e:
            logger.warning("redis_delete_failed", error=str(e), session_id=session_id)
    if session is None:
        session = _sessions.pop(session_id, None)
    if session is None:
        return None
    return session.evaluate()
