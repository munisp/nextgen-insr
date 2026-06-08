"""
pos-ml-engine — Python sidecar for 54Link POS Shell

Provides:
1. ML-based anomaly detection (transaction patterns, velocity checks)
2. Compliance engine (AML screening, KYC risk scoring, sanctions check)
3. NLP sentiment analysis (customer feedback, dispute text)
4. Fraud scoring (rule-based + statistical)
5. Pattern recognition (agent behavior, transaction clustering)
6. Risk assessment (real-time transaction risk scoring)

Listens on port 9300 (configurable via PYTHON_ML_PORT).
"""

import json
import math
import os
import re
import statistics
import time
import hashlib
import hmac as hmac_mod
from collections import defaultdict
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any
from urllib.parse import urlparse, parse_qs

# ── Database ─────────────────────────────────────────────────────────────────

import psycopg2
import psycopg2.extras

db_conn = None

def get_db():
    global db_conn
    if db_conn is None or db_conn.closed:
        url = os.environ.get("DATABASE_URL", "")
        if not url:
            raise RuntimeError("DATABASE_URL is required")
        db_conn = psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)
        db_conn.autocommit = True
        with db_conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ml_anomalies (
                    id SERIAL PRIMARY KEY,
                    transaction_id TEXT,
                    agent_id TEXT,
                    amount NUMERIC,
                    anomaly_score NUMERIC,
                    anomalies JSONB DEFAULT '[]'::jsonb,
                    is_anomaly BOOLEAN DEFAULT false,
                    detected_at TIMESTAMP DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ml_compliance_checks (
                    id SERIAL PRIMARY KEY,
                    entity_name TEXT,
                    check_type TEXT,
                    risk_score NUMERIC,
                    result JSONB,
                    checked_at TIMESTAMP DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ml_risk_scores (
                    id SERIAL PRIMARY KEY,
                    transaction_id TEXT,
                    risk_score NUMERIC,
                    risk_level TEXT,
                    factors JSONB,
                    scored_at TIMESTAMP DEFAULT NOW()
                )
            """)
    return db_conn

def persist_anomaly(result: dict):
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO ml_anomalies (transaction_id, agent_id, amount, anomaly_score, anomalies, is_anomaly) VALUES (%s,%s,%s,%s,%s,%s)",
                (result.get("transaction_id"), result.get("agent_id", ""), result.get("amount", 0),
                 result.get("anomaly_score", 0), json.dumps(result.get("anomalies", [])), result.get("is_anomaly", False))
            )
    except Exception as e:
        print(f"DB persist error: {e}")

def persist_compliance(result: dict):
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO ml_compliance_checks (entity_name, check_type, risk_score, result) VALUES (%s,%s,%s,%s)",
                (result.get("entity", ""), result.get("check_type", "aml"), result.get("risk_score", 0),
                 json.dumps(result, default=str))
            )
    except Exception as e:
        print(f"DB persist error: {e}")

def persist_risk_score(result: dict):
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO ml_risk_scores (transaction_id, risk_score, risk_level, factors) VALUES (%s,%s,%s,%s)",
                (result.get("transaction_id", ""), result.get("composite_score", 0),
                 result.get("risk_level", ""), json.dumps(result.get("factors", {})))
            )
    except Exception as e:
        print(f"DB persist error: {e}")

# ── In-Memory State (hot cache, backed by PostgreSQL) ─────────────────────────

class MLState:
    def __init__(self):
        self.transaction_history: list[dict] = []
        self.anomalies_detected: list[dict] = []
        self.compliance_checks: list[dict] = []
        self.sentiment_results: list[dict] = []
        self.risk_scores: list[dict] = []
        self.agent_profiles: dict[str, dict] = {}
        self.sanctions_list: set = {
            "SANCTIONED_ENTITY_001", "BLOCKED_PERSON_002",
            "RESTRICTED_ORG_003", "DENIED_PARTY_004"
        }
        self.anomaly_count = 0
        self.compliance_count = 0
        self.sentiment_count = 0
        self.risk_count = 0
        self.start_time = time.time()

state = MLState()

# ── Anomaly Detection ────────────────────────────────────────────────────────

def detect_anomalies(transaction: dict) -> dict:
    """ML-based anomaly detection using statistical methods."""
    anomalies = []
    score = 0.0
    amount = transaction.get("amount", 0)
    agent_id = transaction.get("agent_id", "unknown")
    tx_type = transaction.get("type", "transfer")

    # 1. Amount anomaly (z-score based)
    agent_history = [t["amount"] for t in state.transaction_history
                     if t.get("agent_id") == agent_id]
    if len(agent_history) >= 5:
        mean = statistics.mean(agent_history)
        stdev = statistics.stdev(agent_history) if len(agent_history) > 1 else 1
        z_score = abs(amount - mean) / max(stdev, 1)
        if z_score > 3.0:
            anomalies.append({
                "type": "amount_anomaly",
                "severity": "high",
                "z_score": round(z_score, 2),
                "detail": f"Amount {amount} is {z_score:.1f} std devs from mean {mean:.0f}"
            })
            score += min(z_score * 10, 50)
    elif amount > 1_000_000:  # NGN 1M threshold for new agents
        anomalies.append({
            "type": "high_value_new_agent",
            "severity": "medium",
            "detail": f"High-value transaction ({amount}) from agent with limited history"
        })
        score += 25

    # 2. Velocity check (transactions per hour)
    one_hour_ago = time.time() * 1000 - 3_600_000
    recent_count = sum(1 for t in state.transaction_history
                       if t.get("agent_id") == agent_id
                       and t.get("timestamp", 0) > one_hour_ago)
    if recent_count > 50:
        anomalies.append({
            "type": "velocity_anomaly",
            "severity": "high",
            "detail": f"Agent {agent_id} has {recent_count} transactions in last hour"
        })
        score += 30

    # 3. Time-of-day anomaly (transactions outside business hours)
    hour = datetime.now().hour
    if hour < 6 or hour > 22:
        anomalies.append({
            "type": "off_hours_transaction",
            "severity": "low",
            "detail": f"Transaction at unusual hour: {hour}:00"
        })
        score += 10

    # 4. Round number detection (potential structuring)
    if amount > 10000 and amount % 10000 == 0:
        anomalies.append({
            "type": "round_number_structuring",
            "severity": "medium",
            "detail": f"Suspiciously round amount: {amount}"
        })
        score += 15

    # 5. Rapid succession (same agent, < 30s apart)
    if agent_history:
        last_tx_time = max(
            (t.get("timestamp", 0) for t in state.transaction_history
             if t.get("agent_id") == agent_id), default=0
        )
        if last_tx_time and (time.time() * 1000 - last_tx_time) < 30_000:
            anomalies.append({
                "type": "rapid_succession",
                "severity": "medium",
                "detail": "Transaction within 30 seconds of previous"
            })
            score += 20

    # Store transaction
    transaction["timestamp"] = transaction.get("timestamp", int(time.time() * 1000))
    state.transaction_history.append(transaction)
    if len(state.transaction_history) > 10000:
        state.transaction_history = state.transaction_history[-5000:]

    result = {
        "transaction_id": transaction.get("id", f"txn_{int(time.time()*1000)}"),
        "agent_id": agent_id,
        "amount": amount,
        "is_anomalous": len(anomalies) > 0,
        "anomaly_score": min(round(score, 1), 100),
        "risk_level": "high" if score > 50 else "medium" if score > 20 else "low",
        "anomalies": anomalies,
        "anomaly_count": len(anomalies),
        "timestamp": int(time.time() * 1000)
    }

    if anomalies:
        state.anomalies_detected.append(result)
        state.anomaly_count += 1
        if len(state.anomalies_detected) > 5000:
            state.anomalies_detected = state.anomalies_detected[-2500:]

    return result

# ── Compliance Engine ────────────────────────────────────────────────────────

def check_compliance(entity: dict) -> dict:
    """AML screening, KYC risk scoring, sanctions check."""
    state.compliance_count += 1
    flags = []
    risk_score = 0

    name = entity.get("name", "").upper()
    entity_type = entity.get("type", "individual")
    country = entity.get("country", "NG")
    amount = entity.get("amount", 0)

    # 1. Sanctions screening
    for sanctioned in state.sanctions_list:
        if sanctioned in name or name in sanctioned:
            flags.append({
                "type": "sanctions_match",
                "severity": "critical",
                "detail": f"Name matches sanctions list entry: {sanctioned}"
            })
            risk_score += 100

    # 2. PEP (Politically Exposed Person) check
    pep_keywords = ["MINISTER", "GOVERNOR", "SENATOR", "PRESIDENT", "DIRECTOR GENERAL"]
    for kw in pep_keywords:
        if kw in name:
            flags.append({
                "type": "pep_match",
                "severity": "high",
                "detail": f"Name contains PEP keyword: {kw}"
            })
            risk_score += 40

    # 3. High-risk country check
    high_risk_countries = {"IR", "KP", "SY", "CU", "VE", "MM", "AF", "YE"}
    if country.upper() in high_risk_countries:
        flags.append({
            "type": "high_risk_country",
            "severity": "high",
            "detail": f"Entity from high-risk jurisdiction: {country}"
        })
        risk_score += 50

    # 4. AML threshold check (CBN reporting threshold: NGN 5M)
    if amount > 5_000_000:
        flags.append({
            "type": "aml_threshold",
            "severity": "medium",
            "detail": f"Transaction exceeds CBN reporting threshold: {amount} NGN"
        })
        risk_score += 25

    # 5. Structuring detection (multiple transactions just below threshold)
    if 4_500_000 < amount < 5_000_000:
        flags.append({
            "type": "potential_structuring",
            "severity": "medium",
            "detail": "Amount suspiciously close to reporting threshold"
        })
        risk_score += 30

    result = {
        "entity_id": entity.get("id", f"ent_{int(time.time()*1000)}"),
        "compliant": len(flags) == 0,
        "risk_score": min(risk_score, 100),
        "risk_level": "critical" if risk_score >= 80 else "high" if risk_score >= 50 else "medium" if risk_score >= 25 else "low",
        "flags": flags,
        "flag_count": len(flags),
        "requires_sar": risk_score >= 50,  # Suspicious Activity Report
        "requires_ctr": amount > 5_000_000,  # Currency Transaction Report
        "timestamp": int(time.time() * 1000)
    }

    state.compliance_checks.append(result)
    if len(state.compliance_checks) > 5000:
        state.compliance_checks = state.compliance_checks[-2500:]

    return result

# ── Sentiment Analysis ───────────────────────────────────────────────────────

def analyze_sentiment(text: str) -> dict:
    """NLP-based sentiment analysis using keyword scoring."""
    state.sentiment_count += 1
    text_lower = text.lower()

    positive_words = {
        "good": 1, "great": 2, "excellent": 3, "amazing": 3, "wonderful": 3,
        "helpful": 2, "fast": 1, "easy": 1, "love": 2, "best": 2,
        "satisfied": 2, "happy": 2, "recommend": 2, "efficient": 2, "reliable": 2,
        "thank": 1, "perfect": 3, "awesome": 2, "fantastic": 3, "quick": 1,
    }
    negative_words = {
        "bad": -1, "terrible": -3, "awful": -3, "horrible": -3, "worst": -3,
        "slow": -1, "difficult": -1, "hate": -2, "poor": -2, "disappointed": -2,
        "frustrated": -2, "angry": -2, "useless": -3, "broken": -2, "scam": -3,
        "fraud": -3, "steal": -3, "cheat": -3, "fail": -2, "error": -1,
    }

    pos_score = sum(v for w, v in positive_words.items() if w in text_lower)
    neg_score = sum(v for w, v in negative_words.items() if w in text_lower)
    total = pos_score + neg_score

    if total > 2:
        sentiment = "positive"
        confidence = min(pos_score / max(pos_score + abs(neg_score), 1), 1.0)
    elif total < -2:
        sentiment = "negative"
        confidence = min(abs(neg_score) / max(pos_score + abs(neg_score), 1), 1.0)
    else:
        sentiment = "neutral"
        confidence = 0.5

    # Extract key topics
    topic_keywords = {
        "speed": ["fast", "slow", "quick", "wait", "delay", "instant"],
        "service": ["service", "support", "help", "staff", "agent"],
        "reliability": ["reliable", "error", "fail", "broken", "work"],
        "pricing": ["price", "fee", "charge", "expensive", "cheap", "cost"],
        "usability": ["easy", "difficult", "confusing", "simple", "complicated"],
    }
    topics = [topic for topic, words in topic_keywords.items()
              if any(w in text_lower for w in words)]

    result = {
        "text_length": len(text),
        "sentiment": sentiment,
        "confidence": round(confidence, 2),
        "positive_score": pos_score,
        "negative_score": neg_score,
        "net_score": total,
        "topics": topics,
        "timestamp": int(time.time() * 1000)
    }

    state.sentiment_results.append(result)
    if len(state.sentiment_results) > 5000:
        state.sentiment_results = state.sentiment_results[-2500:]

    return result

# ── Fraud Scoring ────────────────────────────────────────────────────────────

def score_fraud_risk(transaction: dict) -> dict:
    """Combined rule-based + statistical fraud scoring."""
    state.risk_count += 1
    score = 0
    factors = []

    amount = transaction.get("amount", 0)
    agent_id = transaction.get("agent_id", "unknown")
    device_id = transaction.get("device_id", "")
    ip_address = transaction.get("ip_address", "")
    recipient = transaction.get("recipient", "")

    # Rule-based scoring
    if amount > 500_000:
        score += 15
        factors.append("high_value_transaction")
    if amount > 2_000_000:
        score += 25
        factors.append("very_high_value")

    # New device check
    profile = state.agent_profiles.get(agent_id, {})
    known_devices = profile.get("devices", set())
    if device_id and device_id not in known_devices:
        score += 20
        factors.append("new_device")

    # New recipient
    known_recipients = profile.get("recipients", set())
    if recipient and recipient not in known_recipients:
        score += 10
        factors.append("new_recipient")

    # IP geolocation anomaly (simplified)
    known_ips = profile.get("ips", set())
    if ip_address and ip_address not in known_ips:
        score += 15
        factors.append("new_ip_address")

    # Update agent profile
    if agent_id not in state.agent_profiles:
        state.agent_profiles[agent_id] = {
            "devices": set(), "recipients": set(), "ips": set(),
            "transaction_count": 0, "total_volume": 0
        }
    p = state.agent_profiles[agent_id]
    if device_id:
        p["devices"].add(device_id)
    if recipient:
        p["recipients"].add(recipient)
    if ip_address:
        p["ips"].add(ip_address)
    p["transaction_count"] += 1
    p["total_volume"] += amount

    result = {
        "transaction_id": transaction.get("id", f"txn_{int(time.time()*1000)}"),
        "agent_id": agent_id,
        "amount": amount,
        "fraud_score": min(score, 100),
        "risk_level": "high" if score > 50 else "medium" if score > 25 else "low",
        "factors": factors,
        "factor_count": len(factors),
        "action": "block" if score > 70 else "review" if score > 40 else "allow",
        "timestamp": int(time.time() * 1000)
    }

    state.risk_scores.append(result)
    if len(state.risk_scores) > 5000:
        state.risk_scores = state.risk_scores[-2500:]

    return result

# ── HTTP Handler ─────────────────────────────────────────────────────────────

class MLHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default logging

    def _send_json(self, data: Any, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode())

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/health":
            self._send_json({
                "status": "healthy",
                "service": "pos-ml-engine",
                "version": "1.0.0",
                "uptime_seconds": int(time.time() - state.start_time),
                "anomalies_detected": state.anomaly_count,
                "compliance_checks": state.compliance_count,
                "sentiment_analyses": state.sentiment_count,
                "fraud_scores": state.risk_count,
                "timestamp": int(time.time() * 1000)
            })
        elif path == "/stats":
            self._send_json({
                "anomalies_detected": state.anomaly_count,
                "compliance_checks_run": state.compliance_count,
                "sentiment_analyses_run": state.sentiment_count,
                "fraud_scores_computed": state.risk_count,
                "transaction_history_size": len(state.transaction_history),
                "agent_profiles_tracked": len(state.agent_profiles),
                "uptime_seconds": int(time.time() - state.start_time)
            })
        elif path == "/anomalies":
            params = parse_qs(parsed.query)
            limit = int(params.get("limit", ["50"])[0])
            self._send_json({
                "anomalies": state.anomalies_detected[-limit:],
                "total": len(state.anomalies_detected),
                "returned": min(limit, len(state.anomalies_detected))
            })
        elif path == "/compliance/history":
            params = parse_qs(parsed.query)
            limit = int(params.get("limit", ["50"])[0])
            self._send_json({
                "checks": state.compliance_checks[-limit:],
                "total": len(state.compliance_checks),
                "returned": min(limit, len(state.compliance_checks))
            })
        elif path == "/sentiment/history":
            params = parse_qs(parsed.query)
            limit = int(params.get("limit", ["50"])[0])
            self._send_json({
                "results": state.sentiment_results[-limit:],
                "total": len(state.sentiment_results),
                "returned": min(limit, len(state.sentiment_results))
            })
        else:
            self._send_json({"error": "Not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            body = self._read_body()
        except Exception as e:
            self._send_json({"error": f"Invalid JSON: {str(e)}"}, 400)
            return

        if path == "/anomaly/detect":
            result = detect_anomalies(body)
            self._send_json(result)
        elif path == "/anomaly/batch":
            transactions = body.get("transactions", [])
            results = [detect_anomalies(t) for t in transactions]
            self._send_json({
                "results": results,
                "count": len(results),
                "anomalous_count": sum(1 for r in results if r["is_anomalous"])
            })
        elif path == "/compliance/check":
            result = check_compliance(body)
            self._send_json(result)
        elif path == "/compliance/batch":
            entities = body.get("entities", [])
            results = [check_compliance(e) for e in entities]
            self._send_json({
                "results": results,
                "count": len(results),
                "non_compliant": sum(1 for r in results if not r["compliant"])
            })
        elif path == "/sentiment/analyze":
            text = body.get("text", "")
            if not text:
                self._send_json({"error": "text field required"}, 400)
                return
            result = analyze_sentiment(text)
            self._send_json(result)
        elif path == "/sentiment/batch":
            texts = body.get("texts", [])
            results = [analyze_sentiment(t) for t in texts]
            self._send_json({
                "results": results,
                "count": len(results),
                "positive": sum(1 for r in results if r["sentiment"] == "positive"),
                "negative": sum(1 for r in results if r["sentiment"] == "negative"),
                "neutral": sum(1 for r in results if r["sentiment"] == "neutral")
            })
        elif path == "/fraud/score":
            result = score_fraud_risk(body)
            self._send_json(result)
        elif path == "/fraud/batch":
            transactions = body.get("transactions", [])
            results = [score_fraud_risk(t) for t in transactions]
            self._send_json({
                "results": results,
                "count": len(results),
                "blocked": sum(1 for r in results if r["action"] == "block"),
                "review": sum(1 for r in results if r["action"] == "review"),
                "allowed": sum(1 for r in results if r["action"] == "allow")
            })
        else:
            self._send_json({"error": "Not found"}, 404)


def main():
    port = int(os.environ.get("PYTHON_ML_PORT", "9300"))
    server = HTTPServer(("0.0.0.0", port), MLHandler)
    print(f"[pos-ml-engine] Starting Python sidecar on port {port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
