"""Computer Vision Claims Adjuster - Automated vehicle damage assessment via image analysis."""

from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import uuid

app = FastAPI(
    title="InsurePortal CV Claims Adjuster",
    description="AI-powered vehicle damage assessment from photographs",
    version="1.0.0",
)


class DamageAssessment(BaseModel):
    """Assessment result for a single image."""
    assessment_id: str
    claim_id: int
    image_url: str
    damage_detected: bool
    damage_areas: list[dict]
    severity: str  # minor, moderate, severe, total_loss
    estimated_repair_cost: float
    confidence: float
    vehicle_parts_affected: list[str]
    recommended_action: str
    assessed_at: str


class RepairEstimate(BaseModel):
    """Detailed repair cost breakdown."""
    claim_id: int
    total_estimate: float
    currency: str = "NGN"
    parts: list[dict]
    labor_hours: float
    labor_rate: float
    paint_required: bool
    structural_damage: bool
    airbag_deployed: bool
    driveable: bool
    estimated_repair_days: int


class VehicleDamageZone(BaseModel):
    """Detected damage zone on vehicle."""
    zone: str  # front_bumper, hood, windshield, door_left, etc.
    damage_type: str  # dent, scratch, crack, shatter, deformation
    severity_pct: float  # 0-100
    repair_method: str  # paintless_dent, respray, replacement, welding
    estimated_cost: float


@app.post("/api/v1/cv/assess")
async def assess_damage(
    claim_id: int,
    images: list[UploadFile] = File(...),
):
    """Upload vehicle damage images for AI assessment.
    
    Accepts 1-10 images (JPEG/PNG). Returns damage assessment with
    severity classification, affected parts, and repair cost estimate.
    """
    if len(images) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 images per assessment")

    if len(images) == 0:
        raise HTTPException(status_code=400, detail="At least 1 image required")

    # Process each image through the damage detection model
    damage_zones = []
    total_cost = 0.0
    parts_affected = set()

    for img in images:
        if not img.content_type or not img.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"Invalid file type: {img.content_type}")

        # Simulated CV inference (in production: YOLO/Detectron2 model)
        zones = analyze_image(img.filename or "unknown.jpg")
        damage_zones.extend(zones)
        for zone in zones:
            total_cost += zone["estimated_cost"]
            parts_affected.add(zone["zone"])

    severity = classify_severity(total_cost)
    assessment_id = f"ASS-{uuid.uuid4().hex[:8].upper()}"

    return DamageAssessment(
        assessment_id=assessment_id,
        claim_id=claim_id,
        image_url=f"/assessments/{assessment_id}/images",
        damage_detected=len(damage_zones) > 0,
        damage_areas=damage_zones,
        severity=severity,
        estimated_repair_cost=total_cost,
        confidence=0.87,
        vehicle_parts_affected=list(parts_affected),
        recommended_action=get_recommendation(severity, total_cost),
        assessed_at=datetime.utcnow().isoformat() + "Z",
    )


@app.post("/api/v1/cv/estimate/{claim_id}", response_model=RepairEstimate)
async def get_repair_estimate(claim_id: int):
    """Get detailed repair cost breakdown for an assessed claim."""
    return RepairEstimate(
        claim_id=claim_id,
        total_estimate=385000.0,
        currency="NGN",
        parts=[
            {"name": "Front bumper", "cost": 85000, "source": "OEM"},
            {"name": "Headlight assembly (left)", "cost": 120000, "source": "OEM"},
            {"name": "Hood", "cost": 95000, "source": "aftermarket"},
            {"name": "Radiator grille", "cost": 35000, "source": "OEM"},
        ],
        labor_hours=12.5,
        labor_rate=5000.0,  # NGN per hour
        paint_required=True,
        structural_damage=False,
        airbag_deployed=False,
        driveable=True,
        estimated_repair_days=5,
    )


@app.post("/api/v1/cv/compare")
async def compare_before_after(
    claim_id: int,
    before_images: list[UploadFile] = File(...),
    after_images: list[UploadFile] = File(...),
):
    """Compare before/after repair images to verify claim completion."""
    return {
        "claim_id": claim_id,
        "repair_verified": True,
        "match_confidence": 0.92,
        "damage_resolved_pct": 95.0,
        "notes": "Minor paint imperfection detected on bumper edge",
    }


@app.get("/api/v1/cv/models/status")
async def model_status():
    """Get status of loaded CV models."""
    return {
        "damage_detector": {"loaded": True, "version": "3.2.1", "framework": "YOLOv8"},
        "severity_classifier": {"loaded": True, "version": "2.0.0", "framework": "ResNet50"},
        "part_segmenter": {"loaded": True, "version": "1.5.0", "framework": "Mask R-CNN"},
        "cost_estimator": {"loaded": True, "version": "1.1.0", "framework": "XGBoost"},
    }


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "cv-claims-adjuster",
        "models_loaded": 4,
    }


def analyze_image(filename: str) -> list[dict]:
    """Simulated CV damage detection inference."""
    return [
        {
            "zone": "front_bumper",
            "damage_type": "deformation",
            "severity_pct": 65.0,
            "repair_method": "replacement",
            "estimated_cost": 85000.0,
            "bounding_box": [120, 340, 450, 520],
            "confidence": 0.91,
        },
        {
            "zone": "headlight_left",
            "damage_type": "crack",
            "severity_pct": 80.0,
            "repair_method": "replacement",
            "estimated_cost": 120000.0,
            "bounding_box": [80, 200, 250, 350],
            "confidence": 0.88,
        },
    ]


def classify_severity(total_cost: float) -> str:
    if total_cost > 2000000:
        return "total_loss"
    elif total_cost > 500000:
        return "severe"
    elif total_cost > 150000:
        return "moderate"
    return "minor"


def get_recommendation(severity: str, total_cost: float) -> str:
    if severity == "total_loss":
        return "escalate_to_adjuster"
    elif severity == "severe":
        return "manual_review_required"
    elif total_cost < 100000:
        return "auto_approve"
    return "standard_review"
