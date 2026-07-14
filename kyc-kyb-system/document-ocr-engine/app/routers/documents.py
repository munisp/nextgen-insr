"""Document OCR, classification, validation, and parsing API routes."""

from fastapi import APIRouter

from app.models.schemas import (
    DoclingParseRequest,
    DoclingParseResponse,
    DocumentClassifyRequest,
    DocumentClassifyResponse,
    DocumentValidateRequest,
    DocumentValidateResponse,
    OCRRequest,
    OCRResponse,
)
from app.services import paddleocr_service, vlm_service, docling_service

router = APIRouter(prefix="/api/v1", tags=["documents"])


@router.post("/ocr/extract", response_model=OCRResponse)
async def extract_text(request: OCRRequest) -> OCRResponse:
    """Extract text from document image using PaddleOCR."""
    return await paddleocr_service.extract_text(request)


@router.post("/document/classify", response_model=DocumentClassifyResponse)
async def classify_document(request: DocumentClassifyRequest) -> DocumentClassifyResponse:
    """Classify document type using visual feature analysis (VLM)."""
    return await vlm_service.classify_document(request)


@router.post("/document/validate", response_model=DocumentValidateResponse)
async def validate_document(request: DocumentValidateRequest) -> DocumentValidateResponse:
    """Validate document authenticity — tampering, quality, dimensions."""
    return await vlm_service.validate_document(request)


@router.post("/document/parse", response_model=DoclingParseResponse)
async def parse_document(request: DoclingParseRequest) -> DoclingParseResponse:
    """Parse complex documents (PDF, multi-page) using Docling."""
    return await docling_service.parse_document(request)


@router.post("/ocr/extract-and-validate")
async def extract_and_validate(request: OCRRequest) -> dict:
    """Combined: OCR extraction + document validation in one call."""
    ocr_result = await paddleocr_service.extract_text(request)

    validate_req = DocumentValidateRequest(
        image_base64=request.image_base64,
        session_id=request.session_id,
        document_type=ocr_result.document_type,
    )
    validation = await vlm_service.validate_document(validate_req)

    return {
        "session_id": request.session_id,
        "ocr": ocr_result.model_dump(),
        "validation": validation.model_dump(),
    }
