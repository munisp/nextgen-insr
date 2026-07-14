from pydantic import BaseModel, Field
from enum import Enum
from typing import Optional
from datetime import datetime


class DocumentType(str, Enum):
    NATIONAL_ID = "national_id"
    DRIVERS_LICENSE = "drivers_license"
    PASSPORT = "passport"
    VOTERS_CARD = "voters_card"
    UTILITY_BILL = "utility_bill"
    BANK_STATEMENT = "bank_statement"
    CAC_CERTIFICATE = "cac_certificate"
    MEMART = "memart"
    BOARD_RESOLUTION = "board_resolution"
    TAX_CLEARANCE = "tax_clearance"
    BVN_SLIP = "bvn_slip"
    NIN_SLIP = "nin_slip"
    UNKNOWN = "unknown"


class ExtractionStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"


class OCRRequest(BaseModel):
    image_base64: str = Field(..., description="Base64-encoded document image")
    session_id: str
    document_type: Optional[DocumentType] = None
    language: str = Field(default="en", description="OCR language: en|fr|ar|ha|yo|ig")
    extract_fields: bool = Field(default=True, description="Run structured field extraction")


class OCRTextBlock(BaseModel):
    text: str
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: list[list[float]] = Field(default_factory=list, description="Bounding box coordinates")
    line_number: int = 0


class ExtractedField(BaseModel):
    field_name: str
    value: str
    confidence: float = Field(ge=0.0, le=1.0)
    source: str = Field(default="paddleocr", description="paddleocr|vlm|docling|ensemble")


class OCRResponse(BaseModel):
    session_id: str
    status: ExtractionStatus
    document_type: DocumentType
    raw_text: str
    text_blocks: list[OCRTextBlock] = Field(default_factory=list)
    extracted_fields: list[ExtractedField] = Field(default_factory=list)
    overall_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    page_count: int = 1
    processing_time_ms: float = 0.0
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class DocumentClassifyRequest(BaseModel):
    image_base64: str
    session_id: str


class DocumentClassifyResponse(BaseModel):
    session_id: str
    document_type: DocumentType
    confidence: float = Field(ge=0.0, le=1.0)
    all_scores: dict[str, float] = Field(default_factory=dict)
    processing_time_ms: float = 0.0


class DocumentValidateRequest(BaseModel):
    image_base64: str
    session_id: str
    document_type: DocumentType
    expected_name: Optional[str] = None
    expected_id_number: Optional[str] = None


class ValidationCheck(BaseModel):
    check_name: str
    passed: bool
    details: str
    confidence: float = 0.0


class DocumentValidateResponse(BaseModel):
    session_id: str
    document_type: DocumentType
    is_valid: bool
    checks: list[ValidationCheck] = Field(default_factory=list)
    extracted_fields: list[ExtractedField] = Field(default_factory=list)
    tampering_score: float = Field(default=0.0, ge=0.0, le=1.0)
    processing_time_ms: float = 0.0


class DoclingParseRequest(BaseModel):
    file_base64: str = Field(..., description="Base64-encoded PDF or image")
    session_id: str
    file_type: str = Field(default="pdf", description="pdf|image")


class DoclingParseResponse(BaseModel):
    session_id: str
    status: ExtractionStatus
    pages: int = 0
    text_content: str = ""
    tables: list[dict] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)
    processing_time_ms: float = 0.0


class HealthResponse(BaseModel):
    status: str
    version: str
    ocr_engine: str
    uptime_seconds: float
