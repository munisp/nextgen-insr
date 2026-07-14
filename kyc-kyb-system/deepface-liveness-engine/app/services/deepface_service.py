"""DeepFace integration service for liveness detection and face verification."""

import base64
import io
import time
from typing import Optional

import numpy as np
import structlog
from deepface import DeepFace
from PIL import Image

from app.models.schemas import (
    EmbeddingRequest,
    EmbeddingResponse,
    FaceAnalysisRequest,
    FaceAnalysisResponse,
    FaceVerifyRequest,
    FaceVerifyResponse,
    LivenessRequest,
    LivenessResponse,
    LivenessResult,
    VerificationStatus,
)

logger = structlog.get_logger(__name__)

SPOOF_THRESHOLD = 0.5
QUALITY_THRESHOLD = 0.4
MODELS_CACHE: dict[str, bool] = {}


def _decode_image(base64_str: str) -> np.ndarray:
    """Decode base64 string to numpy array for DeepFace."""
    image_bytes = base64.b64decode(base64_str)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return np.array(image)


def _compute_quality_score(img: np.ndarray) -> float:
    """Compute face image quality based on sharpness, brightness, contrast."""
    gray = np.mean(img, axis=2) if len(img.shape) == 3 else img
    laplacian_var = np.var(np.gradient(np.gradient(gray, axis=0), axis=1))
    sharpness = min(laplacian_var / 500.0, 1.0)
    brightness = np.mean(gray) / 255.0
    brightness_score = 1.0 - abs(brightness - 0.5) * 2.0
    contrast = np.std(gray) / 128.0
    contrast_score = min(contrast, 1.0)
    return round(0.5 * sharpness + 0.25 * brightness_score + 0.25 * contrast_score, 4)


def _detect_spoof_indicators(img: np.ndarray) -> tuple[float, dict]:
    """Multi-signal anti-spoof analysis using texture, frequency, and edge analysis."""
    details: dict = {}
    gray = np.mean(img, axis=2).astype(np.float64) if len(img.shape) == 3 else img.astype(np.float64)

    # Texture analysis (Local Binary Pattern approximation)
    dx = np.diff(gray, axis=1)
    dy = np.diff(gray, axis=0)
    texture_variance = float(np.var(dx) + np.var(dy))
    texture_score = min(texture_variance / 2000.0, 1.0)
    details["texture_score"] = round(texture_score, 4)

    # Frequency domain analysis (high-freq content indicates real face)
    fft = np.fft.fft2(gray)
    fft_shift = np.fft.fftshift(fft)
    magnitude = np.abs(fft_shift)
    h, w = magnitude.shape
    center_h, center_w = h // 2, w // 2
    high_freq_mask = np.ones_like(magnitude, dtype=bool)
    radius = min(h, w) // 8
    y_coords, x_coords = np.ogrid[:h, :w]
    high_freq_mask[(y_coords - center_h) ** 2 + (x_coords - center_w) ** 2 <= radius ** 2] = False
    high_freq_energy = float(np.mean(magnitude[high_freq_mask]))
    total_energy = float(np.mean(magnitude))
    freq_ratio = high_freq_energy / max(total_energy, 1e-10)
    details["frequency_score"] = round(min(freq_ratio * 5.0, 1.0), 4)

    # Edge density analysis (real faces have more natural edge patterns)
    edges_x = np.abs(dx)
    edges_y = np.abs(dy[:, :min(dx.shape[1], dy.shape[1])])
    edge_density = float(np.mean(edges_x[:min(edges_x.shape[0], edges_y.shape[0]), :edges_y.shape[1]] + edges_y))
    edge_score = min(edge_density / 30.0, 1.0)
    details["edge_score"] = round(edge_score, 4)

    # Color distribution analysis (screen-captured faces have narrower color range)
    if len(img.shape) == 3:
        color_std = float(np.mean([np.std(img[:, :, c]) for c in range(3)]))
        color_score = min(color_std / 60.0, 1.0)
        details["color_score"] = round(color_score, 4)
    else:
        color_score = 0.5

    # Weighted ensemble
    anti_spoof = 0.3 * texture_score + 0.3 * details["frequency_score"] + 0.2 * edge_score + 0.2 * color_score
    return round(anti_spoof, 4), details


async def detect_liveness(request: LivenessRequest) -> LivenessResponse:
    """Run liveness detection using DeepFace anti-spoofing + multi-signal analysis."""
    start = time.monotonic()
    try:
        img = _decode_image(request.image_base64)

        # DeepFace face detection (validates face presence and extracts region)
        faces = DeepFace.extract_faces(
            img_path=img,
            detector_backend="retinaface",
            enforce_detection=False,
            anti_spoofing=True,
        )

        face_detected = len(faces) > 0 and faces[0].get("confidence", 0) > 0.5
        face_count = sum(1 for f in faces if f.get("confidence", 0) > 0.5)
        landmarks_detected = face_detected and "landmarks" in faces[0] if faces else False

        if not face_detected:
            return LivenessResponse(
                session_id=request.session_id,
                result=LivenessResult.UNCERTAIN,
                confidence=0.0,
                anti_spoof_score=0.0,
                face_detected=False,
                face_count=0,
                processing_time_ms=round((time.monotonic() - start) * 1000, 2),
                details={"error": "no_face_detected"},
            )

        # DeepFace built-in anti-spoofing score
        deepface_spoof = faces[0].get("is_real", None)
        deepface_antispoof_score = faces[0].get("antispoof_score", 0.5)

        # Multi-signal spoof detection
        anti_spoof_score, spoof_details = _detect_spoof_indicators(img)

        # Quality assessment
        quality = _compute_quality_score(img)

        # Ensemble: combine DeepFace anti-spoof with texture/freq analysis
        if deepface_spoof is not None:
            combined_score = 0.6 * deepface_antispoof_score + 0.4 * anti_spoof_score
        else:
            combined_score = anti_spoof_score

        # Determine result
        if combined_score >= SPOOF_THRESHOLD and quality >= QUALITY_THRESHOLD:
            result = LivenessResult.REAL
            confidence = min(combined_score, 1.0)
        elif combined_score < SPOOF_THRESHOLD * 0.6:
            result = LivenessResult.SPOOF
            confidence = 1.0 - combined_score
        else:
            result = LivenessResult.UNCERTAIN
            confidence = 0.5

        elapsed = round((time.monotonic() - start) * 1000, 2)
        return LivenessResponse(
            session_id=request.session_id,
            result=result,
            confidence=round(confidence, 4),
            anti_spoof_score=round(combined_score, 4),
            face_detected=True,
            face_count=face_count,
            face_quality_score=quality,
            landmarks_detected=landmarks_detected,
            processing_time_ms=elapsed,
            details={
                "deepface_is_real": deepface_spoof,
                "deepface_antispoof_score": deepface_antispoof_score,
                "multi_signal": spoof_details,
                "quality_score": quality,
                "challenge_type": request.challenge_type,
            },
        )

    except Exception as exc:
        logger.error("liveness_detection_failed", error=str(exc), session_id=request.session_id)
        elapsed = round((time.monotonic() - start) * 1000, 2)
        return LivenessResponse(
            session_id=request.session_id,
            result=LivenessResult.UNCERTAIN,
            confidence=0.0,
            anti_spoof_score=0.0,
            face_detected=False,
            face_count=0,
            processing_time_ms=elapsed,
            details={"error": str(exc)},
        )


async def verify_faces(request: FaceVerifyRequest) -> FaceVerifyResponse:
    """Compare two faces using DeepFace (ID document vs selfie)."""
    start = time.monotonic()
    try:
        source_img = _decode_image(request.source_image_base64)
        target_img = _decode_image(request.target_image_base64)

        result = DeepFace.verify(
            img1_path=source_img,
            img2_path=target_img,
            model_name=request.model_name,
            detector_backend=request.detector_backend,
            distance_metric=request.distance_metric,
            enforce_detection=False,
            anti_spoofing=True,
        )

        distance = result.get("distance", 1.0)
        threshold = result.get("threshold", 0.4)
        verified = result.get("verified", False)

        # Compute similarity percentage
        if request.distance_metric == "cosine":
            similarity_pct = round((1.0 - distance) * 100, 2)
        else:
            similarity_pct = round(max(0, (1.0 - distance / max(threshold * 2, 1e-10))) * 100, 2)

        elapsed = round((time.monotonic() - start) * 1000, 2)
        return FaceVerifyResponse(
            session_id=request.session_id,
            status=VerificationStatus.MATCH if verified else VerificationStatus.NO_MATCH,
            verified=verified,
            distance=round(distance, 6),
            threshold=round(threshold, 6),
            model=request.model_name,
            detector_backend=request.detector_backend,
            similarity_pct=max(0.0, min(100.0, similarity_pct)),
            source_face_detected=True,
            target_face_detected=True,
            processing_time_ms=elapsed,
        )

    except Exception as exc:
        logger.error("face_verification_failed", error=str(exc), session_id=request.session_id)
        elapsed = round((time.monotonic() - start) * 1000, 2)
        return FaceVerifyResponse(
            session_id=request.session_id,
            status=VerificationStatus.ERROR,
            verified=False,
            distance=1.0,
            threshold=0.0,
            model=request.model_name,
            detector_backend=request.detector_backend,
            similarity_pct=0.0,
            source_face_detected=False,
            target_face_detected=False,
            processing_time_ms=elapsed,
        )


async def analyze_face(request: FaceAnalysisRequest) -> FaceAnalysisResponse:
    """Analyze face attributes (age, gender, race, emotion)."""
    start = time.monotonic()
    try:
        img = _decode_image(request.image_base64)
        results = DeepFace.analyze(
            img_path=img,
            actions=request.actions,
            detector_backend="retinaface",
            enforce_detection=False,
            silent=True,
        )

        if isinstance(results, list) and len(results) > 0:
            r = results[0]
        else:
            r = results

        elapsed = round((time.monotonic() - start) * 1000, 2)
        return FaceAnalysisResponse(
            session_id=request.session_id,
            age=r.get("age"),
            dominant_gender=r.get("dominant_gender"),
            gender_confidence=r.get("gender", {}).get(r.get("dominant_gender", ""), 0) if isinstance(r.get("gender"), dict) else None,
            dominant_race=r.get("dominant_race"),
            dominant_emotion=r.get("dominant_emotion"),
            face_confidence=r.get("face_confidence", 0.0),
            region=r.get("region", {}),
            processing_time_ms=elapsed,
        )

    except Exception as exc:
        logger.error("face_analysis_failed", error=str(exc), session_id=request.session_id)
        elapsed = round((time.monotonic() - start) * 1000, 2)
        return FaceAnalysisResponse(
            session_id=request.session_id,
            processing_time_ms=elapsed,
        )


async def generate_embedding(request: EmbeddingRequest) -> EmbeddingResponse:
    """Generate face embedding vector for storage and comparison."""
    start = time.monotonic()
    try:
        img = _decode_image(request.image_base64)
        embeddings = DeepFace.represent(
            img_path=img,
            model_name=request.model_name,
            detector_backend="retinaface",
            enforce_detection=False,
        )

        if isinstance(embeddings, list) and len(embeddings) > 0:
            embedding = embeddings[0].get("embedding", [])
        else:
            embedding = []

        elapsed = round((time.monotonic() - start) * 1000, 2)
        return EmbeddingResponse(
            session_id=request.session_id,
            embedding=embedding,
            embedding_dim=len(embedding),
            model=request.model_name,
            face_detected=len(embedding) > 0,
            processing_time_ms=elapsed,
        )

    except Exception as exc:
        logger.error("embedding_generation_failed", error=str(exc), session_id=request.session_id)
        elapsed = round((time.monotonic() - start) * 1000, 2)
        return EmbeddingResponse(
            session_id=request.session_id,
            embedding=[],
            embedding_dim=0,
            model=request.model_name,
            face_detected=False,
            processing_time_ms=elapsed,
        )


def preload_models() -> list[str]:
    """Pre-load DeepFace models for faster inference."""
    loaded = []
    for model in ["VGG-Face", "Facenet512", "ArcFace"]:
        try:
            DeepFace.build_model(model)
            loaded.append(model)
            MODELS_CACHE[model] = True
            logger.info("model_loaded", model=model)
        except Exception as exc:
            logger.warning("model_load_failed", model=model, error=str(exc))
    return loaded
