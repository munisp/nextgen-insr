"""
Face Matching Service (port 8111) — 1:1 face verification for KYC.

Real pipeline: detect faces with OpenCV DNN/Haar, embed with a real CNN
(FaceNet via the `deepface` library when installed), cosine similarity
against a configurable match threshold. Fail-loud: when the embedding
backend is not installed the /verify endpoint returns 503 and /health
reports degraded — a face pair is NEVER "matched" by a stub.
"""

import base64
import math
import os
from typing import Optional

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

PORT = int(os.getenv("PORT", "8111"))
# Cosine similarity threshold for a positive match. Calibrated for
# Facenet512 embeddings (deepface default verifier threshold).
MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.68"))

app = FastAPI(title="Face Matching Service", version="1.0.0")


def _backend_available() -> bool:
    try:
        import cv2  # noqa: F401
        import deepface  # noqa: F401

        return True
    except ImportError:
        return False


def _decode_image(b64: str):
    import cv2

    raw = base64.b64decode(b64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="image did not decode")
    return image


def _embed(image) -> list:
    """Real face embedding via deepface/Facenet512."""
    from deepface import DeepFace

    reps = DeepFace.represent(image, model_name="Facenet512",
                              detector_backend="opencv", enforce_detection=True)
    return reps[0]["embedding"]


def _cosine_similarity(a: list, b: list) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if not na or not nb:
        return 0.0
    return dot / (na * nb)


class VerifyRequest(BaseModel):
    reference_image_base64: str
    probe_image_base64: str
    threshold: Optional[float] = None


@app.post("/verify")
def verify(req: VerifyRequest):
    if not _backend_available():
        raise HTTPException(
            status_code=503,
            detail="opencv/deepface not installed; face matching unavailable (fail-loud)",
        )
    ref = _decode_image(req.reference_image_base64)
    probe = _decode_image(req.probe_image_base64)
    try:
        ref_emb = _embed(ref)
    except Exception:
        raise HTTPException(status_code=422, detail="no face detected in reference image")
    try:
        probe_emb = _embed(probe)
    except Exception:
        raise HTTPException(status_code=422, detail="no face detected in probe image")

    similarity = _cosine_similarity(ref_emb, probe_emb)
    threshold = req.threshold if req.threshold is not None else MATCH_THRESHOLD
    match = similarity >= threshold
    return {
        "match": match,
        "similarity": round(similarity, 4),
        "threshold": threshold,
        "model": "Facenet512 (deepface) + cosine similarity",
    }


@app.get("/health")
def health():
    available = _backend_available()
    return {
        "status": "ok" if available else "degraded",
        "service": "face-matching",
        "embedding_backend_available": available,
        "match_threshold": MATCH_THRESHOLD,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
