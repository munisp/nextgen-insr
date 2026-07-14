"""PaddleOCR integration for document text extraction."""

import base64
import io
import re
import time
from typing import Optional

import numpy as np
import structlog
from paddleocr import PaddleOCR
from PIL import Image

from app.models.schemas import (
    DocumentType,
    ExtractionStatus,
    ExtractedField,
    OCRRequest,
    OCRResponse,
    OCRTextBlock,
)

logger = structlog.get_logger(__name__)

_ocr_instances: dict[str, PaddleOCR] = {}

LANG_MAP = {
    "en": "en",
    "fr": "fr",
    "ar": "ar",
    "ha": "en",  # Hausa uses Latin script
    "yo": "en",  # Yoruba uses Latin script
    "ig": "en",  # Igbo uses Latin script
}

# Field extraction patterns for Nigerian identity documents
NIN_PATTERN = re.compile(r"\b\d{11}\b")
BVN_PATTERN = re.compile(r"\b\d{11}\b")
PHONE_PATTERN = re.compile(r"\b(?:0|\+?234)\d{10}\b")
DATE_PATTERN = re.compile(r"\b\d{2}[/\-\.]\d{2}[/\-\.]\d{4}\b")
RC_NUMBER_PATTERN = re.compile(r"\b(?:RC|rc)\s*\d{4,8}\b")
PASSPORT_PATTERN = re.compile(r"\b[A-Z]\d{8}\b")
LICENSE_PATTERN = re.compile(r"\b[A-Z]{3}\d{5,12}[A-Z]{0,2}\b")

FIELD_EXTRACTORS: dict[DocumentType, dict[str, re.Pattern]] = {  # type: ignore[type-arg]
    DocumentType.NATIONAL_ID: {
        "nin_number": NIN_PATTERN,
        "date_of_birth": DATE_PATTERN,
        "phone": PHONE_PATTERN,
    },
    DocumentType.DRIVERS_LICENSE: {
        "license_number": LICENSE_PATTERN,
        "date_of_birth": DATE_PATTERN,
        "expiry_date": DATE_PATTERN,
    },
    DocumentType.PASSPORT: {
        "passport_number": PASSPORT_PATTERN,
        "date_of_birth": DATE_PATTERN,
        "expiry_date": DATE_PATTERN,
    },
    DocumentType.BVN_SLIP: {
        "bvn_number": BVN_PATTERN,
        "phone": PHONE_PATTERN,
    },
    DocumentType.CAC_CERTIFICATE: {
        "rc_number": RC_NUMBER_PATTERN,
    },
    DocumentType.NIN_SLIP: {
        "nin_number": NIN_PATTERN,
        "date_of_birth": DATE_PATTERN,
    },
}

NAME_KEYWORDS = ["name", "surname", "first name", "last name", "given name", "family name", "full name"]
ADDRESS_KEYWORDS = ["address", "residence", "house", "street", "road", "close", "avenue"]


def _get_ocr(lang: str) -> PaddleOCR:
    """Get or create a PaddleOCR instance for the given language."""
    paddle_lang = LANG_MAP.get(lang, "en")
    if paddle_lang not in _ocr_instances:
        _ocr_instances[paddle_lang] = PaddleOCR(
            use_angle_cls=True,
            lang=paddle_lang,
            show_log=False,
            use_gpu=False,
        )
    return _ocr_instances[paddle_lang]


def _decode_image(b64: str) -> np.ndarray:
    return np.array(Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB"))


def _extract_name_near_keyword(text_blocks: list[OCRTextBlock]) -> Optional[str]:
    """Find name value near a name keyword label."""
    for i, block in enumerate(text_blocks):
        lower = block.text.lower()
        for kw in NAME_KEYWORDS:
            if kw in lower:
                # Check if value is on same line after colon
                if ":" in block.text:
                    val = block.text.split(":", 1)[1].strip()
                    if val:
                        return val
                # Check next block
                if i + 1 < len(text_blocks):
                    return text_blocks[i + 1].text.strip()
    return None


def _extract_address_near_keyword(text_blocks: list[OCRTextBlock]) -> Optional[str]:
    """Find address value near an address keyword label."""
    for i, block in enumerate(text_blocks):
        lower = block.text.lower()
        for kw in ADDRESS_KEYWORDS:
            if kw in lower:
                if ":" in block.text:
                    val = block.text.split(":", 1)[1].strip()
                    if val:
                        return val
                if i + 1 < len(text_blocks):
                    return text_blocks[i + 1].text.strip()
    return None


async def extract_text(request: OCRRequest) -> OCRResponse:
    """Run PaddleOCR on document image, extract structured fields."""
    start = time.monotonic()
    try:
        img = _decode_image(request.image_base64)
        ocr = _get_ocr(request.language)
        result = ocr.ocr(img, cls=True)

        text_blocks: list[OCRTextBlock] = []
        raw_lines: list[str] = []

        if result and result[0]:
            for idx, line in enumerate(result[0]):
                bbox = line[0]
                text = line[1][0]
                conf = float(line[1][1])
                text_blocks.append(OCRTextBlock(
                    text=text,
                    confidence=round(conf, 4),
                    bbox=bbox,
                    line_number=idx + 1,
                ))
                raw_lines.append(text)

        raw_text = "\n".join(raw_lines)
        overall_conf = sum(b.confidence for b in text_blocks) / max(len(text_blocks), 1)

        # Classify document type if not provided
        doc_type = request.document_type or _classify_from_text(raw_text)

        # Extract structured fields
        extracted_fields: list[ExtractedField] = []
        if request.extract_fields and doc_type != DocumentType.UNKNOWN:
            extracted_fields = _extract_fields(doc_type, raw_text, text_blocks)

        elapsed = round((time.monotonic() - start) * 1000, 2)

        status = ExtractionStatus.SUCCESS if text_blocks else ExtractionStatus.FAILED
        if text_blocks and not extracted_fields and request.extract_fields:
            status = ExtractionStatus.PARTIAL

        return OCRResponse(
            session_id=request.session_id,
            status=status,
            document_type=doc_type,
            raw_text=raw_text,
            text_blocks=text_blocks,
            extracted_fields=extracted_fields,
            overall_confidence=round(overall_conf, 4),
            processing_time_ms=elapsed,
        )

    except Exception as exc:
        logger.error("ocr_extraction_failed", error=str(exc), session_id=request.session_id)
        elapsed = round((time.monotonic() - start) * 1000, 2)
        return OCRResponse(
            session_id=request.session_id,
            status=ExtractionStatus.FAILED,
            document_type=request.document_type or DocumentType.UNKNOWN,
            raw_text="",
            processing_time_ms=elapsed,
        )


def _classify_from_text(text: str) -> DocumentType:
    """Classify document type from OCR text content."""
    lower = text.lower()
    scores: dict[DocumentType, int] = {}

    classifications = [
        (DocumentType.NATIONAL_ID, ["national identity", "national id", "nin", "nimc", "identity card"]),
        (DocumentType.DRIVERS_LICENSE, ["driver", "license", "licence", "driving", "frsc"]),
        (DocumentType.PASSPORT, ["passport", "travel document", "republic of nigeria"]),
        (DocumentType.VOTERS_CARD, ["voter", "inec", "permanent voter", "pvc"]),
        (DocumentType.UTILITY_BILL, ["electricity", "water", "phcn", "ekedc", "ikedc", "utility"]),
        (DocumentType.BANK_STATEMENT, ["bank", "statement", "account", "balance", "transaction"]),
        (DocumentType.CAC_CERTIFICATE, ["corporate affairs", "cac", "certificate of incorporation", "rc number"]),
        (DocumentType.MEMART, ["memorandum", "articles of association", "memart"]),
        (DocumentType.TAX_CLEARANCE, ["tax", "clearance", "firs", "revenue"]),
        (DocumentType.BVN_SLIP, ["bvn", "bank verification"]),
        (DocumentType.NIN_SLIP, ["nin", "national identification number"]),
    ]

    for doc_type, keywords in classifications:
        score = sum(1 for kw in keywords if kw in lower)
        if score > 0:
            scores[doc_type] = score

    if not scores:
        return DocumentType.UNKNOWN
    return max(scores, key=lambda k: scores[k])


def _extract_fields(
    doc_type: DocumentType,
    raw_text: str,
    text_blocks: list[OCRTextBlock],
) -> list[ExtractedField]:
    """Extract structured fields based on document type."""
    fields: list[ExtractedField] = []
    patterns = FIELD_EXTRACTORS.get(doc_type, {})

    for field_name, pattern in patterns.items():
        matches = pattern.findall(raw_text)
        if matches:
            fields.append(ExtractedField(
                field_name=field_name,
                value=matches[0],
                confidence=0.85,
                source="paddleocr",
            ))

    # Name extraction (heuristic)
    name = _extract_name_near_keyword(text_blocks)
    if name:
        fields.append(ExtractedField(
            field_name="full_name",
            value=name,
            confidence=0.7,
            source="paddleocr",
        ))

    # Address extraction (heuristic)
    if doc_type in (DocumentType.UTILITY_BILL, DocumentType.NATIONAL_ID):
        address = _extract_address_near_keyword(text_blocks)
        if address:
            fields.append(ExtractedField(
                field_name="address",
                value=address,
                confidence=0.65,
                source="paddleocr",
            ))

    return fields
