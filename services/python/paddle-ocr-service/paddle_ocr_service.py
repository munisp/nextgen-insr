"""
PaddleOCR Service (port 8113) — document text extraction for KYC.

Real OCR via PaddleOCR (deep-learning detector + recognizer). Extracted
text lines are returned with their real confidence scores and bounding
boxes; a lightweight field extractor pulls common ID fields (name, date of
birth, document number, expiry) from the OCR text with explicit regex
patterns — no field is ever invented.

Fail-loud: without paddleocr installed /extract returns 503 and /health
reports degraded. An image with no detectable text returns an honest empty
result, not a fabricated one.
"""

import base64
import os
import re
from typing import Dict, List, Optional

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

PORT = int(os.getenv("PORT", "8113"))

app = FastAPI(title="PaddleOCR Service", version="1.0.0")

_ocr = None


def _get_ocr():
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR

        _ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    return _ocr


def _ocr_available() -> bool:
    try:
        import cv2  # noqa: F401
        import paddleocr  # noqa: F401

        return np is not None
    except ImportError:
        return False


DATE_RE = re.compile(r"\b(\d{2}[/-]\d{2}[/-]\d{4}|\d{4}[/-]\d{2}[/-]\d{2})\b")
DOCNUM_RE = re.compile(r"\b[A-Z0-9]{8,12}\b")


def _extract_fields(lines: List[str]) -> Dict[str, Optional[str]]:
    """Extract common ID fields from OCR text with explicit patterns."""
    joined = "\n".join(lines)
    dates = DATE_RE.findall(joined)
    doc_numbers = [m for m in DOCNUM_RE.findall(joined) if any(c.isdigit() for c in m)]
    fields: Dict[str, Optional[str]] = {
        "document_number": doc_numbers[0] if doc_numbers else None,
        "date_of_birth": None,
        "expiry_date": None,
    }
    upper = joined.upper()
    for line in joined.splitlines():
        u = line.upper()
        if ("BIRTH" in u or "DOB" in u) and DATE_RE.search(line):
            fields["date_of_birth"] = DATE_RE.search(line).group(1)
        if ("EXP" in u or "VALID" in u) and DATE_RE.search(line):
            fields["expiry_date"] = DATE_RE.search(line).group(1)
    if fields["date_of_birth"] is None and dates:
        fields["date_of_birth"] = dates[0]
    if fields["expiry_date"] is None and len(dates) > 1:
        fields["expiry_date"] = dates[-1]
    _ = upper
    return fields


class ExtractRequest(BaseModel):
    document_image_base64: str


@app.post("/extract")
def extract(req: ExtractRequest):
    if not _ocr_available():
        raise HTTPException(
            status_code=503,
            detail="paddleocr not installed; text extraction unavailable (fail-loud)",
        )
    import cv2

    raw = base64.b64decode(req.document_image_base64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="document image did not decode")

    result = _get_ocr().ocr(image, cls=True)
    lines: List[str] = []
    confidences: List[float] = []
    boxes = []
    for page in result or []:
        for entry in page or []:
            box, (text, conf) = entry
            lines.append(text)
            confidences.append(float(conf))
            boxes.append(box)

    return {
        "text": "\n".join(lines),
        "lines": lines,
        "line_confidences": [round(c, 4) for c in confidences],
        "mean_confidence": round(sum(confidences) / len(confidences), 4) if confidences else 0.0,
        "boxes": boxes,
        "fields": _extract_fields(lines),
        "engine": "PaddleOCR (real detection + recognition)",
    }


@app.get("/health")
def health():
    available = _ocr_available()
    return {
        "status": "ok" if available else "degraded",
        "service": "paddle-ocr-service",
        "ocr_engine_available": available,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
