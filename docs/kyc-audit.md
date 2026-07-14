# KYC/KYB Engine Audit — /home/ubuntu

## Existing Services Found

Three KYC/KYB services already exist in `/home/ubuntu/platform/platform/services/`:

### 1. `compliance-kyc` (Python/FastAPI)

- **Stack**: FastAPI + SQLAlchemy (async) + PostgreSQL
- **Capabilities**: KYC record CRUD, document management, check lifecycle
- **Endpoints**: `/records`, `/documents`, `/checks`
- **Status**: Scaffold-level — no OCR/biometric engine wired in

### 2. `kyc-enhanced` (Python/FastAPI)

- **Stack**: FastAPI + SQLAlchemy (sync) + PostgreSQL
- **Capabilities**: Enhanced KYC cases, EDD (Enhanced Due Diligence), PEP screening, transaction monitoring
- **Endpoints**: `/cases`, `/cases/{id}/details`
- **Status**: Scaffold-level — no OCR/biometric engine wired in

### 3. `video-kyc` (Python/Flask + Go)

- **Stack**: Flask + OpenCV + dlib + MediaPipe + PyTorch + Go (face detection, video storage)
- **Capabilities**:
  - `liveness_detection_service.py`: Full liveness detection with passive/active/challenge-response modes, anti-spoofing CNN, texture analysis, motion analysis
  - `face_recognition_service.py`: Face matching
  - `document_tampering_detection.py`: Tamper detection
  - `biometric_matching_service.py`: Biometric comparison
  - `video_kyc_orchestrator.py`: Full orchestration
- **Status**: Most complete — production-ready liveness detection with Flask API routes

### 4. PaddleOCR Engine (`python-services/enhanced_paddleocr_service.py`)

- **Stack**: PaddleOCR + OLMOCR + GOT-OCR2.0 + EasyOCR
- **Capabilities**: Multi-engine document OCR, field extraction, fraud indicator detection, batch processing
- **Document types**: NIN, BVN card, passport, drivers licence, voter card
- **Status**: Production-ready OCR engine, Flask API with `/process-document`, `/validate-document`, `/batch-process`

### 5. Customer Onboarding (`python-ai/customer-onboarding/main.py`)

- **Stack**: Flask + face_recognition + dlib + EasyOCR + GOT-OCR2.0 + Redis + PostgreSQL
- **Capabilities**: Full onboarding pipeline — document OCR, biometric verification, liveness, fraud detection, edge/offline support
- **Status**: Most complete end-to-end pipeline

## Integration Plan for InsurePortal Platform

The InsurePortal Platform KYC flow will:

1. Call the `video-kyc` liveness detection service for liveness check (challenge-response)
2. Call the `enhanced_paddleocr_service` for document OCR (NIN/BVN card/passport)
3. Store results via `compliance-kyc` FastAPI service
4. Expose a `trpc.kyc.*` bridge in the Node.js server that proxies to these Python microservices
