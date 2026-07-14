"""Docling integration for structured document parsing (PDF, complex layouts)."""

import base64
import io
import time
from typing import Optional

import structlog

from app.models.schemas import (
    DoclingParseRequest,
    DoclingParseResponse,
    ExtractionStatus,
)

logger = structlog.get_logger(__name__)


async def parse_document(request: DoclingParseRequest) -> DoclingParseResponse:
    """Parse a PDF or image document using Docling for structured extraction."""
    start = time.monotonic()
    try:
        file_bytes = base64.b64decode(request.file_base64)

        from docling.document_converter import DocumentConverter

        converter = DocumentConverter()

        # Write temp file for Docling processing
        import tempfile
        import os

        suffix = ".pdf" if request.file_type == "pdf" else ".png"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        try:
            result = converter.convert(tmp_path)
            doc = result.document

            # Extract text content
            text_content = doc.export_to_markdown() if hasattr(doc, "export_to_markdown") else str(doc)

            # Extract tables
            tables = []
            if hasattr(doc, "tables"):
                for idx, table in enumerate(doc.tables):
                    table_data = {
                        "index": idx,
                        "rows": [],
                    }
                    if hasattr(table, "export_to_dataframe"):
                        df = table.export_to_dataframe()
                        table_data["headers"] = list(df.columns)
                        table_data["rows"] = df.values.tolist()
                    tables.append(table_data)

            # Extract metadata
            metadata = {}
            if hasattr(doc, "metadata"):
                metadata = {
                    "title": getattr(doc.metadata, "title", None),
                    "author": getattr(doc.metadata, "author", None),
                    "pages": getattr(doc.metadata, "page_count", 1),
                }
            if hasattr(result, "pages"):
                metadata["pages"] = len(result.pages)

            elapsed = round((time.monotonic() - start) * 1000, 2)
            return DoclingParseResponse(
                session_id=request.session_id,
                status=ExtractionStatus.SUCCESS,
                pages=metadata.get("pages", 1),
                text_content=text_content[:50000],  # Cap at 50KB
                tables=tables,
                metadata=metadata,
                processing_time_ms=elapsed,
            )

        finally:
            os.unlink(tmp_path)

    except ImportError:
        logger.warning("docling_not_available", session_id=request.session_id)
        elapsed = round((time.monotonic() - start) * 1000, 2)
        return DoclingParseResponse(
            session_id=request.session_id,
            status=ExtractionStatus.FAILED,
            metadata={"error": "docling not installed"},
            processing_time_ms=elapsed,
        )
    except Exception as exc:
        logger.error("docling_parse_failed", error=str(exc), session_id=request.session_id)
        elapsed = round((time.monotonic() - start) * 1000, 2)
        return DoclingParseResponse(
            session_id=request.session_id,
            status=ExtractionStatus.FAILED,
            metadata={"error": str(exc)},
            processing_time_ms=elapsed,
        )
