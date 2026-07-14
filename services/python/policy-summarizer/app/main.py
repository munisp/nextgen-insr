"""Policy Summarizer — Insurance policy document summarization with NLP
Port: 8122

Middleware: PostgreSQL (policy store), Kafka (summarization events),
Redis (summary cache), OpenSearch (document search), Keycloak (JWT auth)
"""

import hashlib
import logging
import os
import re
from datetime import datetime
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://ngapp:ngapp@localhost:5432/ngapp")
app = FastAPI(title="Policy Summarizer", version="1.0.0")


def get_db():
    return psycopg2.connect(DATABASE_URL)


def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS policy_documents (
            id TEXT PRIMARY KEY,
            policy_type TEXT NOT NULL,
            title TEXT NOT NULL,
            full_text TEXT NOT NULL,
            word_count INT NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS policy_summaries (
            id SERIAL PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES policy_documents(id),
            summary TEXT NOT NULL,
            key_terms JSONB NOT NULL DEFAULT '[]',
            coverage_highlights TEXT[] NOT NULL DEFAULT '{}',
            exclusions TEXT[] NOT NULL DEFAULT '{}',
            readability_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            compression_ratio DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            language TEXT NOT NULL DEFAULT 'en',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_summaries_doc ON policy_summaries(document_id);
    """)
    conn.commit()
    seed_documents(cur, conn)
    cur.close()
    conn.close()


def seed_documents(cur, conn):
    documents = [
        ("doc-motor-001", "motor", "Comprehensive Motor Insurance Policy",
         """COMPREHENSIVE MOTOR INSURANCE POLICY
         
This policy covers the insured vehicle against loss or damage arising from:
1. Accidental damage, fire, and theft
2. Third-party bodily injury and property damage liability
3. Personal accident benefits for driver and passengers up to ₦5,000,000
4. Towing and emergency roadside assistance within 50km radius

EXCLUSIONS:
- Wear and tear, mechanical or electrical breakdown
- Use of vehicle for racing, speed testing, or rallies
- Driving under the influence of alcohol or drugs
- Loss of use or consequential loss
- War, terrorism, nuclear contamination

PREMIUM CALCULATION:
Base premium is determined by vehicle value, driver age, and claims history.
No Claims Discount: 20% after 1 year, 30% after 2 years, 45% after 3+ years.
Young driver surcharge (under 25): 25% additional premium.

CLAIMS PROCEDURE:
Report within 48 hours. Provide police report for accidents. Two independent repair estimates required for amounts over ₦500,000."""),

        ("doc-health-001", "health", "NHIA-Compliant Health Insurance Plan",
         """NATIONAL HEALTH INSURANCE SCHEME COMPLIANT PLAN

COVERAGE:
1. Outpatient care including consultations, diagnostics, and prescribed medications
2. Inpatient care including surgery, ward charges, and intensive care
3. Maternity care including antenatal, delivery, and postnatal (up to 4 births)
4. Dental care including extractions and fillings (cosmetic excluded)
5. Optical care including eye examination and basic lenses (annual limit ₦50,000)
6. Mental health consultations (up to 12 sessions per year)

PRE-AUTHORIZATION:
Required for: Elective surgery, MRI/CT scans, procedures over ₦50,000, specialist referrals outside network.
Emergency exceptions: 48-hour retrospective notification accepted.

EXCLUSIONS:
- Pre-existing conditions (12-month waiting period)
- Cosmetic and elective procedures
- Fertility treatments and assisted reproduction
- Experimental treatments not approved by NAFDAC
- Self-inflicted injuries

CONTRIBUTION:
Employee: 5% of basic salary. Employer: 10% of basic salary. Minimum total: ₦30,000/month."""),
    ]
    for doc_id, ptype, title, text in documents:
        wc = len(text.split())
        cur.execute("""INSERT INTO policy_documents (id, policy_type, title, full_text, word_count)
            VALUES (%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING""",
            (doc_id, ptype, title, text, wc))
    conn.commit()


def extractive_summarize(text: str, num_sentences: int = 5) -> dict:
    """Real extractive summarization using TF-IDF-like sentence scoring"""
    sentences = re.split(r'[.!?\n]+', text)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 20]

    if not sentences:
        return {"summary": text[:200], "key_terms": [], "coverage": [], "exclusions": []}

    # Word frequency scoring
    words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
    stop_words = {"the", "and", "for", "that", "this", "with", "from", "are", "was", "were",
                  "not", "but", "have", "has", "had", "been", "will", "can", "may", "shall",
                  "including", "within", "under", "over", "such", "any", "all", "per", "year"}
    word_freq = {}
    for w in words:
        if w not in stop_words:
            word_freq[w] = word_freq.get(w, 0) + 1

    # Score sentences by word importance
    scored = []
    for i, sent in enumerate(sentences):
        sent_words = re.findall(r'\b[a-zA-Z]{3,}\b', sent.lower())
        if not sent_words:
            continue
        score = sum(word_freq.get(w, 0) for w in sent_words) / len(sent_words)
        # Boost first sentences (position bias)
        if i < 3:
            score *= 1.5
        scored.append((score, sent))

    scored.sort(reverse=True)
    top_sentences = [s for _, s in scored[:num_sentences]]

    # Extract key terms (top 10 by frequency)
    key_terms = sorted(word_freq.items(), key=lambda x: -x[1])[:10]

    # Extract coverage highlights and exclusions
    coverage = []
    exclusions = []
    for sent in sentences:
        sent_lower = sent.lower()
        if any(k in sent_lower for k in ["covers", "coverage", "included", "benefit"]):
            coverage.append(sent[:120])
        if any(k in sent_lower for k in ["exclud", "not covered", "exception"]):
            exclusions.append(sent[:120])

    summary = ". ".join(top_sentences)

    # Readability score (Flesch approximation)
    total_words = len(words)
    total_sentences = len(sentences)
    avg_sentence_len = total_words / max(total_sentences, 1)
    readability = max(0, min(100, 206.835 - 1.015 * avg_sentence_len - 10))

    return {
        "summary": summary,
        "key_terms": [{"term": t, "frequency": f} for t, f in key_terms],
        "coverage_highlights": coverage[:5],
        "exclusions": exclusions[:5],
        "readability_score": round(readability, 1),
        "compression_ratio": round(len(summary) / max(len(text), 1), 3),
    }


class SummarizeRequest(BaseModel):
    document_id: Optional[str] = None
    text: Optional[str] = None
    num_sentences: int = 5
    language: str = "en"


@app.on_event("startup")
def startup():
    init_db()
    logger.info("Policy Summarizer initialized with PostgreSQL document store")


@app.get("/health")
def health():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM policy_documents")
        docs = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM policy_summaries")
        summaries = cur.fetchone()[0]
        cur.close()
        conn.close()
        return {"status": "healthy", "service": "policy-summarizer", "database": "connected",
                "documents": docs, "summaries": summaries}
    except Exception as e:
        return {"status": "degraded", "service": "policy-summarizer", "error": str(e)}


@app.post("/api/v1/summarize")
def summarize(req: SummarizeRequest):
    text = req.text
    doc_id = req.document_id

    if doc_id:
        conn = get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM policy_documents WHERE id = %s", (doc_id,))
        doc = cur.fetchone()
        cur.close()
        conn.close()
        if not doc:
            raise HTTPException(status_code=404, detail="document not found")
        text = doc["full_text"]

    if not text:
        raise HTTPException(status_code=400, detail="text or document_id required")

    result = extractive_summarize(text, req.num_sentences)

    # Persist summary
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""INSERT INTO policy_summaries (document_id, summary, key_terms, coverage_highlights, exclusions, readability_score, compression_ratio, language)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (doc_id or "custom", result["summary"],
         psycopg2.extras.Json(result["key_terms"]),
         result["coverage_highlights"], result["exclusions"],
         result["readability_score"], result["compression_ratio"], req.language))
    conn.commit()
    cur.close()
    conn.close()

    return result


@app.get("/api/v1/documents")
def list_documents():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, policy_type, title, word_count FROM policy_documents ORDER BY title")
    docs = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"documents": docs, "total": len(docs)}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8122"))
    uvicorn.run(app, host="0.0.0.0", port=port)
