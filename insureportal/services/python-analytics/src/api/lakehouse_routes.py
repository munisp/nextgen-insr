"""Lakehouse ETL API routes."""
from typing import Optional
from fastapi import APIRouter, Query
from src.lakehouse.etl import LakehouseETL

router = APIRouter()
etl = LakehouseETL()

@router.get("/health")
def health(): return {"status": etl.health()}

@router.post("/export/{table_name}")
def export_table(table_name: str, tenant_id: Optional[str] = None):
    return etl.export_table(table_name, tenant_id=tenant_id)

@router.post("/export/full")
def full_export(tenant_id: Optional[str] = None):
    return etl.run_full_export(tenant_id=tenant_id)

@router.get("/snapshots")
def list_snapshots(prefix: str = Query("exports/")):
    return {"snapshots": etl.list_snapshots(prefix)}
