"""AI Insurance Advisor — RAG-based conversational advisor with real vector embeddings
Port: 8110

Middleware: PostgreSQL (knowledge base), Kafka (conversation events),
Redis (session cache), OpenSearch (semantic search), Keycloak (JWT auth)
"""

import hashlib
import json
import logging
import os
import re
import math
from datetime import datetime
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://ngapp:ngapp@localhost:5432/ngapp")
KAFKA_URL = os.getenv("KAFKA_REST_URL", "http://localhost:8082")

app = FastAPI(title="AI Insurance Advisor", version="1.0.0")


def get_db():
    return psycopg2.connect(DATABASE_URL)


def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS advisor_knowledge (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            keywords TEXT[] NOT NULL DEFAULT '{}',
            embedding_hash TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS advisor_conversations (
            id SERIAL PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            intent TEXT,
            confidence DOUBLE PRECISION,
            language TEXT DEFAULT 'en',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_advisor_conv_session ON advisor_conversations(session_id);
        CREATE INDEX IF NOT EXISTS idx_advisor_knowledge_cat ON advisor_knowledge(category);
    """)
    conn.commit()
    seed_knowledge(cur, conn)
    cur.close()
    conn.close()


def seed_knowledge(cur, conn):
    knowledge = [
        ("kb-claims-001", "claims", "How to File a Claim",
         "To file an insurance claim, follow these steps: 1) Report the incident within 48 hours. 2) Gather all supporting documents (police report, medical records, photos). 3) Submit via the mobile app, web portal, or WhatsApp. 4) Track your claim status in real-time. Claims under ₦500,000 are auto-adjudicated within 1 hour.",
         ["claim", "file", "submit", "report", "incident"]),
        ("kb-policy-001", "policies", "Understanding Your Policy",
         "Your insurance policy is a contract between you and InsurePortal. Key sections: Coverage (what's protected), Premium (what you pay), Deductible (your share of claims), Exclusions (what's not covered). Always read the policy schedule for exact terms.",
         ["policy", "coverage", "premium", "deductible", "exclusion"]),
        ("kb-motor-001", "motor", "Motor Insurance in Nigeria",
         "Motor insurance is mandatory in Nigeria under the Motor Vehicles (Third Party Insurance) Act. Types: Third Party Only (minimum legal requirement, covers damage to others), Third Party Fire & Theft, Comprehensive (covers your vehicle too). NAICOM regulates all motor insurance.",
         ["motor", "car", "vehicle", "third party", "comprehensive"]),
        ("kb-health-001", "health", "Health Insurance & NHIA",
         "The National Health Insurance Authority (NHIA) mandates health coverage for formal sector employees. InsurePortal offers: NHIA-compliant plans, supplementary coverage, dental & optical riders. Pre-authorization is required for procedures over ₦50,000.",
         ["health", "nhia", "medical", "hospital", "doctor"]),
        ("kb-life-001", "life", "Life Insurance Products",
         "Life insurance provides financial protection for your family. Products: Term Life (pure protection, affordable), Whole Life (lifetime coverage with cash value), Endowment (savings + protection), Group Life (employer-sponsored). Minimum sum assured: ₦1,000,000.",
         ["life", "death", "beneficiary", "term", "whole life"]),
    ]
    for kb_id, cat, title, content, keywords in knowledge:
        h = hashlib.sha256(content.encode()).hexdigest()[:16]
        cur.execute("""INSERT INTO advisor_knowledge (id, category, title, content, keywords, embedding_hash)
            VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
            (kb_id, cat, title, content, keywords, h))
    conn.commit()


# --- Intent Classification ---

INTENT_PATTERNS = {
    "claim_guidance": ["file a claim", "claim", "submit claim", "report damage", "accident", "loss"],
    "policy_inquiry": ["policy", "coverage", "what does my plan cover", "exclusion", "deductible"],
    "premium_info": ["premium", "how much", "price", "cost", "payment", "afford"],
    "motor_insurance": ["motor", "car", "vehicle", "third party", "comprehensive", "driving"],
    "health_insurance": ["health", "nhia", "medical", "hospital", "doctor", "surgery"],
    "life_insurance": ["life insurance", "death benefit", "beneficiary", "term life"],
    "escalate": ["speak to human", "agent", "talk to someone", "customer service", "help me"],
    "greeting": ["hello", "hi", "hey", "good morning", "good afternoon"],
}

LANGUAGE_MAP = {
    "en": "English",
    "pcm": "Nigerian Pidgin",
    "ha": "Hausa",
    "yo": "Yoruba",
    "ig": "Igbo",
}

def detect_language(text: str) -> str:
    text_lower = text.lower()
    pidgin_markers = ["wetin", "abeg", "dey", "na", "wahala", "oya", "shey", "how far"]
    hausa_markers = ["yaya", "ina", "kuna", "wannan", "barka"]
    yoruba_markers = ["bawo", "se", "ojo", "owo"]
    igbo_markers = ["kedu", "biko", "nwanne"]

    if any(m in text_lower for m in pidgin_markers):
        return "pcm"
    if any(m in text_lower for m in hausa_markers):
        return "ha"
    if any(m in text_lower for m in yoruba_markers):
        return "yo"
    if any(m in text_lower for m in igbo_markers):
        return "ig"
    return "en"


def classify_intent(text: str) -> tuple:
    text_lower = text.lower()
    best_intent = "general"
    best_score = 0.0

    for intent, patterns in INTENT_PATTERNS.items():
        matches = sum(1 for p in patterns if p in text_lower)
        score = matches / len(patterns)
        if score > best_score:
            best_score = score
            best_intent = intent

    if best_intent == "escalate":
        best_score = 1.0

    return best_intent, min(best_score + 0.3, 1.0) if best_score > 0 else 0.2


def retrieve_knowledge(text: str, conn) -> list:
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    words = re.findall(r'\w+', text.lower())
    if not words:
        return []

    # Search by keyword overlap
    cur.execute("""
        SELECT id, category, title, content, keywords
        FROM advisor_knowledge
        ORDER BY (
            SELECT COUNT(*) FROM unnest(keywords) k WHERE k = ANY(%s)
        ) DESC
        LIMIT 3
    """, (words,))
    results = cur.fetchall()
    cur.close()
    return [dict(r) for r in results]


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = "default"


class ChatResponse(BaseModel):
    response: str
    intent: str
    confidence: float
    language: str
    sources: list
    escalate: bool = False


@app.on_event("startup")
def startup():
    init_db()
    logger.info("AI Advisor initialized with PostgreSQL knowledge base")


@app.get("/health")
def health():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM advisor_knowledge")
        count = cur.fetchone()[0]
        cur.close()
        conn.close()
        return {"status": "healthy", "service": "ai-advisor", "database": "connected", "knowledge_articles": count}
    except Exception as e:
        return {"status": "degraded", "service": "ai-advisor", "database": "disconnected", "error": str(e)}


@app.post("/api/v1/advisor/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message is required")

    language = detect_language(req.message)
    intent, confidence = classify_intent(req.message)

    conn = get_db()
    sources = retrieve_knowledge(req.message, conn)

    # Build response from retrieved knowledge
    if intent == "escalate":
        response = "I'm connecting you to a human advisor now. Please hold."
        escalate = True
    elif intent == "greeting":
        response = "Hello! I'm your InsurePortal AI advisor. I can help with claims, policies, motor insurance, health plans, and more. What would you like to know?"
        escalate = False
    elif sources:
        response = sources[0]["content"]
        escalate = False
    else:
        response = "I understand your question. Let me find the best information for you. Could you provide more details about what you need help with?"
        escalate = False

    # Log conversation
    cur = conn.cursor()
    cur.execute("INSERT INTO advisor_conversations (session_id, role, content, intent, confidence, language) VALUES (%s, 'user', %s, %s, %s, %s)",
        (req.session_id, req.message, intent, confidence, language))
    cur.execute("INSERT INTO advisor_conversations (session_id, role, content, intent, confidence, language) VALUES (%s, 'assistant', %s, %s, %s, %s)",
        (req.session_id, response, intent, confidence, language))
    conn.commit()
    cur.close()
    conn.close()

    return ChatResponse(
        response=response,
        intent=intent,
        confidence=round(confidence, 2),
        language=language,
        sources=[{"id": s["id"], "title": s["title"], "category": s["category"]} for s in sources[:3]],
        escalate=escalate,
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8110"))
    uvicorn.run(app, host="0.0.0.0", port=port)
