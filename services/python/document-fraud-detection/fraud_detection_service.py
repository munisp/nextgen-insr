"""
Document Fraud Detection Service (port 8112) — ID document authenticity.

Real image-forensic checks (OpenCV):
- Error Level Analysis (ELA): recompression-residual variance exposes
  tampered/spliced regions.
- Metadata/EXIF consistency inspection (Pillow).
- Copy-move detection via block-matching of DCT-free grayscale tiles.
- Edge-density / blur forensics for screen-recapture (photo-of-screen) signs.

Every check produces a real measured score; the verdict is authentic /
suspect / forgery-likely from explicit thresholds. Fail-loud: without
opencv/Pillow the /analyze endpoint returns 503 — a document is NEVER
declared authentic by a stub.
"""

import base64
import io
import os
from typing import Dict, List

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

PORT = int(os.getenv("PORT", "8112"))

app = FastAPI(title="Document Fraud Detection Service", version="1.0.0")

ELA_TAMPER_THRESHOLD = 15.0      # mean ELA residual indicating tamper
COPY_MOVE_MIN_MATCHES = 8        # duplicated tiles indicating copy-move
BLUR_SCREEN_THRESHOLD = 60.0     # Laplacian variance below = likely recapture


def _deps_available() -> bool:
    try:
        import cv2  # noqa: F401
        import PIL  # noqa: F401

        return np is not None
    except ImportError:
        return False


def _error_level_analysis(image_bgr, quality: int = 90) -> float:
    """Real ELA: recompress at known quality, measure mean absolute residual."""
    import cv2

    ok, buf = cv2.imencode(".jpg", image_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("jpeg re-encode failed")
    recompressed = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    diff = cv2.absdiff(image_bgr, recompressed)
    return float(diff.mean())


def _copy_move_score(image_bgr, tile: int = 32, stride: int = 16) -> int:
    """Count near-identical non-adjacent tiles (copy-move forgery signal)."""
    import cv2

    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    tiles: Dict[tuple, tuple] = {}
    matches = 0
    for y in range(0, h - tile, stride):
        for x in range(0, w - tile, stride):
            block = gray[y : y + tile, x : x + tile].tobytes()
            key = hash(block)
            if key in tiles:
                py, px = tiles[key]
                if abs(py - y) > tile or abs(px - x) > tile:
                    matches += 1
            else:
                tiles[key] = (y, x)
    return matches


def _blur_score(image_bgr) -> float:
    import cv2

    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _exif_findings(raw: bytes) -> List[str]:
    from PIL import Image
    from PIL.ExifTags import TAGS

    findings: List[str] = []
    try:
        img = Image.open(io.BytesIO(raw))
        exif = img.getexif()
        if not exif:
            findings.append("no EXIF metadata (common for scans; neutral)")
        for tag_id, value in exif.items():
            tag = TAGS.get(tag_id, str(tag_id))
            if tag == "Software" and any(
                k in str(value).lower() for k in ("photoshop", "gimp", "paint")
            ):
                findings.append(f"editing software in EXIF: {value}")
    except Exception:
        findings.append("unreadable metadata container")
    return findings


class AnalyzeRequest(BaseModel):
    document_image_base64: str


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    if not _deps_available():
        raise HTTPException(
            status_code=503,
            detail="opencv/Pillow not installed; document forensics unavailable (fail-loud)",
        )
    import cv2

    raw = base64.b64decode(req.document_image_base64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="document image did not decode")

    ela = _error_level_analysis(image)
    copy_move = _copy_move_score(image)
    blur = _blur_score(image)
    exif_findings = _exif_findings(raw)

    signals: List[str] = []
    if ela > ELA_TAMPER_THRESHOLD:
        signals.append(f"tamper indicator: ELA residual {ela:.1f} > {ELA_TAMPER_THRESHOLD}")
    if copy_move >= COPY_MOVE_MIN_MATCHES:
        signals.append(f"forgery indicator: {copy_move} copy-moved tile pairs")
    if blur < BLUR_SCREEN_THRESHOLD:
        signals.append(f"possible screen recapture: blur score {blur:.1f}")
    signals.extend(exif_findings)

    hard_forgery = copy_move >= COPY_MOVE_MIN_MATCHES or any(
        "editing software" in f for f in exif_findings
    )
    if hard_forgery:
        verdict = "forgery_likely"
    elif signals:
        verdict = "suspect"
    else:
        verdict = "authentic"

    return {
        "verdict": verdict,
        "authentic": verdict == "authentic",
        "scores": {
            "ela_residual": round(ela, 2),
            "copy_move_matches": copy_move,
            "blur_score": round(blur, 2),
        },
        "signals": signals,
        "method": "ELA + copy-move block matching + blur forensics + EXIF inspection",
    }


@app.get("/health")
def health():
    available = _deps_available()
    return {
        "status": "ok" if available else "degraded",
        "service": "document-fraud-detection",
        "forensics_deps_available": available,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
