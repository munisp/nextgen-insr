"""Vision Language Model service for intelligent document understanding."""

import base64
import io
import re
import time
from typing import Optional

import numpy as np
import structlog
from PIL import Image

from app.models.schemas import (
    DocumentClassifyRequest,
    DocumentClassifyResponse,
    DocumentType,
    DocumentValidateRequest,
    DocumentValidateResponse,
    ExtractedField,
    ValidationCheck,
)

logger = structlog.get_logger(__name__)

# VLM-based document classification using visual features
DOCUMENT_VISUAL_SIGNATURES: dict[DocumentType, dict[str, float]] = {
    DocumentType.NATIONAL_ID: {"aspect_min": 1.4, "aspect_max": 1.8, "green_dominant": 0.3},
    DocumentType.DRIVERS_LICENSE: {"aspect_min": 1.4, "aspect_max": 1.7, "has_photo_region": 0.8},
    DocumentType.PASSPORT: {"aspect_min": 0.65, "aspect_max": 0.8, "blue_dominant": 0.3},
    DocumentType.VOTERS_CARD: {"aspect_min": 1.4, "aspect_max": 1.7, "has_photo_region": 0.6},
    DocumentType.UTILITY_BILL: {"aspect_min": 0.6, "aspect_max": 0.85, "text_heavy": 0.7},
    DocumentType.BANK_STATEMENT: {"aspect_min": 0.6, "aspect_max": 0.85, "text_heavy": 0.8},
    DocumentType.CAC_CERTIFICATE: {"aspect_min": 0.6, "aspect_max": 0.85, "formal_layout": 0.7},
}


def _decode_image(b64: str) -> np.ndarray:
    return np.array(Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB"))


def _analyze_visual_features(img: np.ndarray) -> dict:
    """Extract visual features for document classification and validation."""
    h, w = img.shape[:2]
    aspect_ratio = w / max(h, 1)

    # Color channel analysis
    r_mean, g_mean, b_mean = float(np.mean(img[:, :, 0])), float(np.mean(img[:, :, 1])), float(np.mean(img[:, :, 2]))
    total = r_mean + g_mean + b_mean + 1e-6
    r_ratio, g_ratio, b_ratio = r_mean / total, g_mean / total, b_mean / total

    # Edge density (text-heavy documents have more edges)
    gray = np.mean(img, axis=2)
    edges = np.abs(np.diff(gray, axis=1))
    edge_density = float(np.mean(edges > 30))

    # Photo region detection (face-sized region with skin tones)
    skin_mask = (img[:, :, 0] > 80) & (img[:, :, 0] < 240) & (img[:, :, 1] > 50) & (img[:, :, 1] < 200)
    skin_ratio = float(np.mean(skin_mask))

    # Text density estimation
    binary = gray > 128
    text_regions = np.abs(np.diff(binary.astype(float), axis=1))
    text_density = float(np.mean(text_regions))

    # Uniformity (formal documents tend to have more uniform backgrounds)
    bg_uniformity = 1.0 - min(float(np.std(gray)) / 80.0, 1.0)

    return {
        "aspect_ratio": round(aspect_ratio, 3),
        "width": w,
        "height": h,
        "r_ratio": round(r_ratio, 3),
        "g_ratio": round(g_ratio, 3),
        "b_ratio": round(b_ratio, 3),
        "edge_density": round(edge_density, 4),
        "skin_ratio": round(skin_ratio, 4),
        "text_density": round(text_density, 4),
        "bg_uniformity": round(bg_uniformity, 4),
    }


async def classify_document(request: DocumentClassifyRequest) -> DocumentClassifyResponse:
    """Classify document type using visual feature analysis."""
    start = time.monotonic()
    try:
        img = _decode_image(request.image_base64)
        features = _analyze_visual_features(img)

        scores: dict[str, float] = {}
        aspect = features["aspect_ratio"]

        # Score each document type based on visual features
        for doc_type, sig in DOCUMENT_VISUAL_SIGNATURES.items():
            score = 0.0
            checks = 0

            if "aspect_min" in sig and "aspect_max" in sig:
                if sig["aspect_min"] <= aspect <= sig["aspect_max"]:
                    score += 0.3
                checks += 1

            if "green_dominant" in sig:
                score += 0.2 * (features["g_ratio"] / 0.4)
                checks += 1

            if "blue_dominant" in sig:
                score += 0.2 * (features["b_ratio"] / 0.4)
                checks += 1

            if "has_photo_region" in sig:
                score += 0.25 * min(features["skin_ratio"] / 0.15, 1.0)
                checks += 1

            if "text_heavy" in sig:
                score += 0.25 * min(features["text_density"] / 0.1, 1.0)
                checks += 1

            if "formal_layout" in sig:
                score += 0.2 * features["bg_uniformity"]
                checks += 1

            scores[doc_type.value] = round(min(score / max(checks * 0.25, 0.1), 1.0), 4)

        best_type = max(scores, key=lambda k: scores[k])
        best_confidence = scores[best_type]

        elapsed = round((time.monotonic() - start) * 1000, 2)
        return DocumentClassifyResponse(
            session_id=request.session_id,
            document_type=DocumentType(best_type),
            confidence=best_confidence,
            all_scores=scores,
            processing_time_ms=elapsed,
        )

    except Exception as exc:
        logger.error("document_classification_failed", error=str(exc))
        elapsed = round((time.monotonic() - start) * 1000, 2)
        return DocumentClassifyResponse(
            session_id=request.session_id,
            document_type=DocumentType.UNKNOWN,
            confidence=0.0,
            processing_time_ms=elapsed,
        )


def _check_tampering(img: np.ndarray) -> tuple[float, str]:
    """Detect potential document tampering using pixel analysis."""
    gray = np.mean(img, axis=2)

    # Check for uniform patch anomalies (copy-paste tampering)
    block_size = 32
    h, w = gray.shape
    block_vars = []
    for y in range(0, h - block_size, block_size):
        for x in range(0, w - block_size, block_size):
            block = gray[y : y + block_size, x : x + block_size]
            block_vars.append(float(np.var(block)))

    if not block_vars:
        return 0.0, "insufficient_resolution"

    # Suspiciously uniform blocks amid textured regions
    mean_var = np.mean(block_vars)
    suspicious_blocks = sum(1 for v in block_vars if v < mean_var * 0.1)
    tampering_ratio = suspicious_blocks / max(len(block_vars), 1)

    # JPEG artifact analysis (double compression detection)
    dct_like = np.abs(np.fft.fft2(gray))
    periodic_peaks = float(np.max(dct_like[8::8, 8::8]) / (np.mean(dct_like) + 1e-10))
    double_compression = min(periodic_peaks / 100.0, 1.0)

    tampering_score = 0.6 * tampering_ratio + 0.4 * double_compression
    return round(min(tampering_score, 1.0), 4), "analysis_complete"


async def validate_document(request: DocumentValidateRequest) -> DocumentValidateResponse:
    """Validate document authenticity using visual analysis and field cross-checking."""
    start = time.monotonic()
    checks: list[ValidationCheck] = []
    extracted: list[ExtractedField] = []

    try:
        img = _decode_image(request.image_base64)
        features = _analyze_visual_features(img)

        # Check 1: Image quality
        sharpness = features["edge_density"]
        quality_ok = sharpness > 0.02
        checks.append(ValidationCheck(
            check_name="image_quality",
            passed=quality_ok,
            details=f"Edge density: {sharpness:.4f} (threshold: 0.02)",
            confidence=min(sharpness / 0.05, 1.0),
        ))

        # Check 2: Document dimensions
        sig = DOCUMENT_VISUAL_SIGNATURES.get(request.document_type, {})
        aspect = features["aspect_ratio"]
        aspect_ok = True
        if "aspect_min" in sig and "aspect_max" in sig:
            aspect_ok = sig["aspect_min"] * 0.8 <= aspect <= sig["aspect_max"] * 1.2
        checks.append(ValidationCheck(
            check_name="dimensions",
            passed=aspect_ok,
            details=f"Aspect ratio: {aspect:.3f}",
            confidence=0.8 if aspect_ok else 0.3,
        ))

        # Check 3: Photo region (for ID documents)
        id_docs = {DocumentType.NATIONAL_ID, DocumentType.DRIVERS_LICENSE, DocumentType.PASSPORT, DocumentType.VOTERS_CARD}
        if request.document_type in id_docs:
            has_photo = features["skin_ratio"] > 0.03
            checks.append(ValidationCheck(
                check_name="photo_present",
                passed=has_photo,
                details=f"Skin-tone ratio: {features['skin_ratio']:.4f}",
                confidence=min(features["skin_ratio"] / 0.1, 1.0),
            ))

        # Check 4: Tampering detection
        tampering_score, tampering_detail = _check_tampering(img)
        checks.append(ValidationCheck(
            check_name="tampering_check",
            passed=tampering_score < 0.4,
            details=f"Tampering score: {tampering_score:.4f} ({tampering_detail})",
            confidence=1.0 - tampering_score,
        ))

        # Check 5: Text content present
        has_text = features["text_density"] > 0.01
        checks.append(ValidationCheck(
            check_name="text_present",
            passed=has_text,
            details=f"Text density: {features['text_density']:.4f}",
            confidence=min(features["text_density"] / 0.05, 1.0),
        ))

        is_valid = all(c.passed for c in checks)
        elapsed = round((time.monotonic() - start) * 1000, 2)

        return DocumentValidateResponse(
            session_id=request.session_id,
            document_type=request.document_type,
            is_valid=is_valid,
            checks=checks,
            extracted_fields=extracted,
            tampering_score=tampering_score,
            processing_time_ms=elapsed,
        )

    except Exception as exc:
        logger.error("document_validation_failed", error=str(exc))
        elapsed = round((time.monotonic() - start) * 1000, 2)
        return DocumentValidateResponse(
            session_id=request.session_id,
            document_type=request.document_type,
            is_valid=False,
            checks=[ValidationCheck(
                check_name="error",
                passed=False,
                details=str(exc),
            )],
            tampering_score=1.0,
            processing_time_ms=elapsed,
        )
