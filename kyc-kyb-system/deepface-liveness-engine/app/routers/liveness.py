"""Liveness detection and face verification API routes."""

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    EmbeddingRequest,
    EmbeddingResponse,
    FaceAnalysisRequest,
    FaceAnalysisResponse,
    FaceVerifyRequest,
    FaceVerifyResponse,
    LivenessRequest,
    LivenessResponse,
)
from app.services import deepface_service
from app.services.liveness_challenge import (
    complete_challenge,
    create_challenge_session,
    get_challenge_session,
)

router = APIRouter(prefix="/api/v1", tags=["liveness"])


@router.post("/liveness/detect", response_model=LivenessResponse)
async def detect_liveness(request: LivenessRequest) -> LivenessResponse:
    """Passive liveness detection with anti-spoofing analysis."""
    return await deepface_service.detect_liveness(request)


@router.post("/liveness/challenge/start")
async def start_challenge(session_id: str, challenge_type: str = "blink") -> dict:
    """Start an active liveness challenge session (blink, head_turn, smile)."""
    if challenge_type not in ("blink", "head_turn", "smile", "passive"):
        raise HTTPException(status_code=400, detail=f"Invalid challenge type: {challenge_type}")
    session = create_challenge_session(session_id, challenge_type)
    return {
        "session_id": session.session_id,
        "challenge_type": session.challenge_type,
        "instructions": _challenge_instructions(challenge_type),
    }


@router.post("/liveness/challenge/frame")
async def submit_challenge_frame(session_id: str, frame_data: dict) -> dict:
    """Submit a frame for an active liveness challenge."""
    session = get_challenge_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Challenge session not found")
    session.add_frame(frame_data)
    return {"session_id": session_id, "frames_received": len(session.frames)}


@router.post("/liveness/challenge/complete")
async def complete_liveness_challenge(session_id: str) -> dict:
    """Complete an active liveness challenge and get result."""
    result = complete_challenge(session_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Challenge session not found")
    return {"session_id": session_id, "challenge_result": result}


@router.post("/face/verify", response_model=FaceVerifyResponse)
async def verify_faces(request: FaceVerifyRequest) -> FaceVerifyResponse:
    """Compare two faces — selfie vs ID document photo."""
    return await deepface_service.verify_faces(request)


@router.post("/face/analyze", response_model=FaceAnalysisResponse)
async def analyze_face(request: FaceAnalysisRequest) -> FaceAnalysisResponse:
    """Analyze face attributes (age, gender, race, emotion)."""
    return await deepface_service.analyze_face(request)


@router.post("/face/embedding", response_model=EmbeddingResponse)
async def generate_embedding(request: EmbeddingRequest) -> EmbeddingResponse:
    """Generate face embedding vector for storage and comparison."""
    return await deepface_service.generate_embedding(request)


def _challenge_instructions(challenge_type: str) -> str:
    instructions = {
        "blink": "Please blink your eyes naturally while looking at the camera.",
        "head_turn": "Please slowly turn your head from left to right.",
        "smile": "Please start with a neutral expression, then smile.",
        "passive": "Please look directly at the camera.",
    }
    return instructions.get(challenge_type, "Please look at the camera.")
