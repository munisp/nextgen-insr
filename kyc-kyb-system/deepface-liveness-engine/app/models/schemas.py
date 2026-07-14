from pydantic import BaseModel, Field
from enum import Enum
from typing import Optional
from datetime import datetime


class LivenessResult(str, Enum):
    REAL = "real"
    SPOOF = "spoof"
    UNCERTAIN = "uncertain"


class VerificationStatus(str, Enum):
    MATCH = "match"
    NO_MATCH = "no_match"
    ERROR = "error"


class LivenessRequest(BaseModel):
    image_base64: str = Field(..., description="Base64-encoded selfie image")
    session_id: str = Field(..., description="Verification session ID")
    challenge_type: str = Field(default="passive", description="passive|blink|head_turn|smile")


class LivenessResponse(BaseModel):
    session_id: str
    result: LivenessResult
    confidence: float = Field(..., ge=0.0, le=1.0)
    anti_spoof_score: float = Field(..., ge=0.0, le=1.0)
    face_detected: bool
    face_count: int
    face_quality_score: float = Field(default=0.0, ge=0.0, le=1.0)
    landmarks_detected: bool = Field(default=False)
    processing_time_ms: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    details: dict = Field(default_factory=dict)


class FaceVerifyRequest(BaseModel):
    source_image_base64: str = Field(..., description="Base64-encoded ID document photo")
    target_image_base64: str = Field(..., description="Base64-encoded selfie photo")
    session_id: str
    model_name: str = Field(default="VGG-Face", description="VGG-Face|Facenet|Facenet512|ArcFace|SFace")
    detector_backend: str = Field(default="retinaface", description="retinaface|mtcnn|ssd|opencv|mediapipe")
    distance_metric: str = Field(default="cosine", description="cosine|euclidean|euclidean_l2")


class FaceVerifyResponse(BaseModel):
    session_id: str
    status: VerificationStatus
    verified: bool
    distance: float
    threshold: float
    model: str
    detector_backend: str
    similarity_pct: float = Field(..., ge=0.0, le=100.0)
    source_face_detected: bool
    target_face_detected: bool
    processing_time_ms: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class FaceAnalysisRequest(BaseModel):
    image_base64: str
    session_id: str
    actions: list[str] = Field(default=["age", "gender", "race", "emotion"])


class FaceAnalysisResponse(BaseModel):
    session_id: str
    age: Optional[int] = None
    dominant_gender: Optional[str] = None
    gender_confidence: Optional[float] = None
    dominant_race: Optional[str] = None
    dominant_emotion: Optional[str] = None
    face_confidence: float = 0.0
    region: dict = Field(default_factory=dict)
    processing_time_ms: float = 0.0
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class EmbeddingRequest(BaseModel):
    image_base64: str
    session_id: str
    model_name: str = Field(default="Facenet512")


class EmbeddingResponse(BaseModel):
    session_id: str
    embedding: list[float]
    embedding_dim: int
    model: str
    face_detected: bool
    processing_time_ms: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class HealthResponse(BaseModel):
    status: str
    version: str
    models_loaded: list[str]
    uptime_seconds: float
