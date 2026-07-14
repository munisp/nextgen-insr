"""
Synthetic data generation for Nigerian insurance platform ML models.

Generates realistic data across all domains:
- Fraud detection (claims with fraud signals)
- Churn prediction (policy/payment/interaction history)
- Claims adjudication (claims with outcomes)
- Credit scoring (telco + financial data)
- Anomaly detection (transaction sequences)
- Graph data (entity relationships for GNN)
- Risk modeling (actuarial data for MCMC)

All data uses Nigerian demographics, currency (NGN), and insurance patterns.
"""

from __future__ import annotations

import datetime
import json
import math
import random
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


# ── Nigerian Context Constants ────────────────────────────────────────────────

NIGERIAN_FIRST_NAMES_M = [
    "Adebayo", "Chinedu", "Emeka", "Femi", "Ibrahim", "Kunle", "Musa",
    "Obinna", "Segun", "Tunde", "Uche", "Yusuf", "Aliyu", "Dayo",
    "Hassan", "Jide", "Kola", "Nnamdi", "Olu", "Sani",
]
NIGERIAN_FIRST_NAMES_F = [
    "Aisha", "Blessing", "Chioma", "Fatima", "Grace", "Halima", "Ifeoma",
    "Joy", "Kemi", "Lola", "Mercy", "Ngozi", "Oluchi", "Patience",
    "Rita", "Shade", "Titilayo", "Uju", "Wura", "Yemi",
]
NIGERIAN_LAST_NAMES = [
    "Adeyemi", "Bello", "Chukwu", "Danladi", "Eze", "Fagbemi", "Garba",
    "Ibrahim", "Johnson", "Kehinde", "Lawal", "Mohammed", "Nwosu",
    "Okafor", "Peters", "Quadri", "Rabiu", "Suleiman", "Thomas", "Usman",
    "Williams", "Yakubu", "Zubairu", "Abubakar", "Ogundimu", "Olawale",
    "Okeke", "Abdullahi", "Bakare", "Obi",
]
NIGERIAN_STATES = [
    "Lagos", "Abuja", "Kano", "Rivers", "Oyo", "Kaduna", "Enugu",
    "Ogun", "Delta", "Edo", "Anambra", "Imo", "Abia", "Borno",
    "Bauchi", "Plateau", "Kwara", "Osun", "Ondo", "Cross River",
]
INSURANCE_PRODUCTS = [
    "motor_comprehensive", "motor_third_party", "health_individual",
    "health_family", "life_term", "life_whole", "travel_domestic",
    "travel_international", "property_home", "property_commercial",
    "marine_cargo", "marine_hull", "agriculture_crop",
    "agriculture_livestock", "professional_indemnity", "microinsurance",
]
DOCUMENT_TYPES = ["national_id", "drivers_license", "passport", "voters_card", "bvn_slip"]
CLAIM_TYPES = [
    "auto_accident", "health_treatment", "property_damage", "theft",
    "fire_damage", "natural_disaster", "death_benefit", "travel_delay",
    "crop_failure", "livestock_loss", "liability", "marine_loss",
]
PAYMENT_METHODS = ["bank_transfer", "ussd", "mobile_money", "card", "cash"]
DEVICE_TYPES = ["android", "ios", "web_chrome", "web_firefox", "web_safari", "ussd_device"]
BANKS = [
    "First Bank", "GTBank", "Access Bank", "Zenith Bank", "UBA",
    "Stanbic IBTC", "Fidelity Bank", "Sterling Bank", "Polaris Bank",
    "Wema Bank", "Ecobank", "Union Bank",
]
OCCUPATIONS = [
    "trader", "civil_servant", "farmer", "teacher", "engineer",
    "doctor", "driver", "artisan", "student", "business_owner",
    "banker", "lawyer", "nurse", "mechanic", "tailor",
]


def _rand_nin() -> str:
    return "".join([str(random.randint(0, 9)) for _ in range(11)])


def _rand_bvn() -> str:
    return "".join([str(random.randint(0, 9)) for _ in range(11)])


def _rand_phone() -> str:
    prefixes = ["0803", "0805", "0807", "0809", "0810", "0813", "0814",
                "0816", "0703", "0706", "0708", "0802", "0812", "0815"]
    return random.choice(prefixes) + "".join([str(random.randint(0, 9)) for _ in range(7)])


def _rand_ip() -> str:
    return f"{random.randint(1, 223)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"


def _rand_date(start_year: int = 2020, end_year: int = 2024) -> str:
    start = datetime.date(start_year, 1, 1)
    end = datetime.date(end_year, 12, 31)
    delta = (end - start).days
    d = start + datetime.timedelta(days=random.randint(0, delta))
    return d.isoformat()


def _rand_name() -> tuple[str, str, str]:
    gender = random.choice(["M", "F"])
    first = random.choice(NIGERIAN_FIRST_NAMES_M if gender == "M" else NIGERIAN_FIRST_NAMES_F)
    last = random.choice(NIGERIAN_LAST_NAMES)
    return first, last, gender


# ── Fraud Detection Data ──────────────────────────────────────────────────────

def generate_fraud_dataset(n_samples: int = 50_000, fraud_rate: float = 0.08) -> pd.DataFrame:
    """Generate realistic fraud detection training data.

    Features engineered to have real predictive signal:
    - High claim velocity in short windows -> fraud signal
    - Mismatched document types -> fraud signal
    - Claims shortly after policy inception -> fraud signal
    - Multiple claims to same bank account -> fraud signal
    - Device/IP anomalies -> fraud signal
    """
    rng = np.random.default_rng(42)
    records: list[dict[str, Any]] = []

    for i in range(n_samples):
        is_fraud = rng.random() < fraud_rate
        customer_id = f"CUST-{i:06d}"
        first, last, gender = _rand_name()

        # Policy details
        policy_age_days = int(rng.integers(1, 3650))
        if is_fraud:
            policy_age_days = int(rng.choice([
                rng.integers(1, 90),      # Very new policy (suspicious)
                rng.integers(1, 3650),     # Some fraudsters have old policies
            ], p=[0.7, 0.3]))

        premium_ngn = float(rng.integers(5_000, 500_000))
        claim_amount_ngn = float(rng.integers(10_000, 5_000_000))

        # Fraud signal: claim/premium ratio
        if is_fraud:
            claim_amount_ngn = premium_ngn * float(rng.uniform(3.0, 20.0))
        else:
            claim_amount_ngn = premium_ngn * float(rng.uniform(0.1, 2.5))

        # Velocity features
        claims_last_30d = int(rng.poisson(0.3)) if not is_fraud else int(rng.poisson(2.5))
        claims_last_90d = claims_last_30d + int(rng.poisson(0.5 if not is_fraud else 3.0))
        claims_last_365d = claims_last_90d + int(rng.poisson(1.0 if not is_fraud else 5.0))

        # Document features
        doc_type = random.choice(DOCUMENT_TYPES)
        doc_verified = not is_fraud or rng.random() > 0.4
        doc_ocr_confidence = float(rng.uniform(0.85, 0.99)) if not is_fraud else float(rng.uniform(0.4, 0.95))

        # Biometric features
        face_match_score = float(rng.uniform(0.8, 0.99)) if not is_fraud else float(rng.uniform(0.3, 0.85))
        liveness_score = float(rng.uniform(0.85, 0.99)) if not is_fraud else float(rng.uniform(0.2, 0.9))

        # Device/IP features
        device_type = random.choice(DEVICE_TYPES)
        unique_devices_30d = int(rng.integers(1, 3)) if not is_fraud else int(rng.integers(2, 8))
        unique_ips_30d = int(rng.integers(1, 5)) if not is_fraud else int(rng.integers(3, 20))
        ip_country_match = not is_fraud or rng.random() > 0.5

        # Time features
        hour_of_submission = int(rng.integers(8, 18)) if not is_fraud else int(rng.choice(
            list(range(0, 6)) + list(range(8, 18)) + list(range(22, 24)),
        ))
        is_weekend = bool(rng.random() < 0.1) if not is_fraud else bool(rng.random() < 0.4)

        # Bank features
        bank = random.choice(BANKS)
        same_bank_claims_count = int(rng.integers(0, 2)) if not is_fraud else int(rng.integers(1, 6))

        # Agent features
        agent_id = f"AGT-{rng.integers(1, 500):04d}"
        agent_fraud_rate = float(rng.uniform(0.0, 0.05)) if not is_fraud else float(rng.uniform(0.05, 0.3))

        # Add noise to make it realistic
        if not is_fraud and rng.random() < 0.05:  # 5% false-positive-like noise
            claims_last_30d = int(rng.poisson(2.0))
            face_match_score = float(rng.uniform(0.5, 0.75))

        records.append({
            "customer_id": customer_id,
            "claim_id": f"CLM-{uuid.uuid4().hex[:8].upper()}",
            "first_name": first,
            "last_name": last,
            "gender": gender,
            "state": random.choice(NIGERIAN_STATES),
            "policy_product": random.choice(INSURANCE_PRODUCTS),
            "policy_age_days": policy_age_days,
            "premium_ngn": round(premium_ngn, 2),
            "claim_amount_ngn": round(claim_amount_ngn, 2),
            "claim_premium_ratio": round(claim_amount_ngn / max(premium_ngn, 1), 4),
            "claim_type": random.choice(CLAIM_TYPES),
            "claims_last_30d": claims_last_30d,
            "claims_last_90d": claims_last_90d,
            "claims_last_365d": claims_last_365d,
            "doc_type": doc_type,
            "doc_verified": int(doc_verified),
            "doc_ocr_confidence": round(doc_ocr_confidence, 4),
            "face_match_score": round(face_match_score, 4),
            "liveness_score": round(liveness_score, 4),
            "device_type": device_type,
            "unique_devices_30d": unique_devices_30d,
            "unique_ips_30d": unique_ips_30d,
            "ip_country_match": int(ip_country_match),
            "hour_of_submission": hour_of_submission,
            "is_weekend": int(is_weekend),
            "bank": bank,
            "same_bank_claims_count": same_bank_claims_count,
            "agent_id": agent_id,
            "agent_fraud_rate": round(agent_fraud_rate, 4),
            "occupation": random.choice(OCCUPATIONS),
            "is_fraud": int(is_fraud),
        })

    return pd.DataFrame(records)


# ── Churn Prediction Data ─────────────────────────────────────────────────────

def generate_churn_dataset(n_samples: int = 40_000, churn_rate: float = 0.15) -> pd.DataFrame:
    """Generate realistic churn prediction training data."""
    rng = np.random.default_rng(43)
    records: list[dict[str, Any]] = []

    for i in range(n_samples):
        will_churn = rng.random() < churn_rate
        customer_id = f"CUST-{i:06d}"
        first, last, gender = _rand_name()

        tenure_months = int(rng.integers(1, 120))
        if will_churn:
            tenure_months = int(rng.choice([
                rng.integers(1, 12),
                rng.integers(1, 120),
            ], p=[0.6, 0.4]))

        n_policies = int(rng.integers(1, 5)) if not will_churn else int(rng.integers(1, 3))
        total_premium_ngn = float(rng.integers(10_000, 1_000_000))
        n_claims_filed = int(rng.poisson(1.5)) if not will_churn else int(rng.poisson(2.5))
        n_claims_approved = int(min(n_claims_filed, rng.poisson(1.2))) if not will_churn else int(min(n_claims_filed, rng.poisson(0.8)))
        claim_approval_rate = n_claims_approved / max(n_claims_filed, 1)

        # Payment behaviour
        late_payments_12m = int(rng.poisson(0.5)) if not will_churn else int(rng.poisson(2.5))
        missed_payments_12m = int(rng.poisson(0.1)) if not will_churn else int(rng.poisson(1.5))
        payment_method = random.choice(PAYMENT_METHODS)
        auto_renewal = not will_churn or rng.random() > 0.6

        # Engagement
        app_logins_30d = int(rng.poisson(5.0)) if not will_churn else int(rng.poisson(1.0))
        support_calls_90d = int(rng.poisson(0.5)) if not will_churn else int(rng.poisson(2.0))
        complaints_12m = int(rng.poisson(0.2)) if not will_churn else int(rng.poisson(1.5))
        nps_score = int(rng.integers(7, 10)) if not will_churn else int(rng.integers(1, 7))
        last_interaction_days = int(rng.integers(0, 30)) if not will_churn else int(rng.integers(15, 180))

        # Demographics
        age = int(rng.integers(18, 70))
        state = random.choice(NIGERIAN_STATES)
        income_bracket = random.choice(["low", "medium", "high"])

        # Product mix
        has_motor = rng.random() < 0.6
        has_health = rng.random() < 0.4
        has_life = rng.random() < 0.3
        has_property = rng.random() < 0.2

        # Competitor signals
        competitor_quote_requested = bool(rng.random() < 0.1) if not will_churn else bool(rng.random() < 0.5)
        premium_increase_pct = float(rng.uniform(0, 10)) if not will_churn else float(rng.uniform(5, 30))

        records.append({
            "customer_id": customer_id,
            "first_name": first,
            "last_name": last,
            "gender": gender,
            "age": age,
            "state": state,
            "occupation": random.choice(OCCUPATIONS),
            "income_bracket": income_bracket,
            "tenure_months": tenure_months,
            "n_policies": n_policies,
            "total_premium_ngn": round(total_premium_ngn, 2),
            "n_claims_filed": n_claims_filed,
            "n_claims_approved": n_claims_approved,
            "claim_approval_rate": round(claim_approval_rate, 4),
            "late_payments_12m": late_payments_12m,
            "missed_payments_12m": missed_payments_12m,
            "payment_method": payment_method,
            "auto_renewal": int(auto_renewal),
            "app_logins_30d": app_logins_30d,
            "support_calls_90d": support_calls_90d,
            "complaints_12m": complaints_12m,
            "nps_score": nps_score,
            "last_interaction_days": last_interaction_days,
            "has_motor": int(has_motor),
            "has_health": int(has_health),
            "has_life": int(has_life),
            "has_property": int(has_property),
            "competitor_quote_requested": int(competitor_quote_requested),
            "premium_increase_pct": round(premium_increase_pct, 2),
            "churned": int(will_churn),
        })

    return pd.DataFrame(records)


# ── Claims Adjudication Data ──────────────────────────────────────────────────

def generate_claims_dataset(n_samples: int = 30_000) -> pd.DataFrame:
    """Generate claims adjudication training data with outcome labels."""
    rng = np.random.default_rng(44)
    records: list[dict[str, Any]] = []

    for i in range(n_samples):
        claim_id = f"CLM-{i:06d}"
        first, last, gender = _rand_name()

        claim_type = random.choice(CLAIM_TYPES)
        product = random.choice(INSURANCE_PRODUCTS)
        claim_amount = float(rng.integers(5_000, 5_000_000))
        policy_limit = claim_amount * float(rng.uniform(1.0, 5.0))
        claim_to_limit_ratio = claim_amount / max(policy_limit, 1)

        # Document completeness
        n_docs_required = int(rng.integers(2, 6))
        n_docs_submitted = int(rng.integers(max(1, n_docs_required - 2), n_docs_required + 1))
        doc_completeness = min(1.0, n_docs_submitted / max(n_docs_required, 1))

        # Timing features
        days_since_incident = int(rng.integers(0, 365))
        days_since_policy_start = int(rng.integers(30, 3650))
        is_within_waiting_period = days_since_policy_start < 90

        # History
        prior_claims_count = int(rng.poisson(1.5))
        prior_claims_approved_pct = float(rng.uniform(0.5, 1.0))
        prior_fraud_flags = int(rng.poisson(0.1))

        # Verification scores
        doc_authenticity_score = float(rng.uniform(0.7, 1.0))
        witness_available = bool(rng.random() < 0.6)
        police_report_filed = bool(rng.random() < 0.4) if claim_type in ["theft", "auto_accident"] else False
        hospital_report = bool(rng.random() < 0.8) if claim_type == "health_treatment" else False

        # Fraud risk score from fraud model
        fraud_risk_score = float(rng.uniform(0.0, 0.3))
        if rng.random() < 0.1:
            fraud_risk_score = float(rng.uniform(0.3, 0.9))

        # Determine outcome based on features
        approve_prob = 0.7
        if doc_completeness < 0.8:
            approve_prob -= 0.2
        if is_within_waiting_period:
            approve_prob -= 0.3
        if fraud_risk_score > 0.5:
            approve_prob -= 0.3
        if claim_to_limit_ratio > 0.9:
            approve_prob -= 0.1
        if prior_fraud_flags > 0:
            approve_prob -= 0.2

        approve_prob = max(0.05, min(0.95, approve_prob))
        r = rng.random()
        if r < approve_prob:
            outcome = "approved"
            payout_ratio = float(rng.uniform(0.6, 1.0))
        elif r < approve_prob + (1 - approve_prob) * 0.4:
            outcome = "partially_approved"
            payout_ratio = float(rng.uniform(0.2, 0.6))
        else:
            outcome = "denied"
            payout_ratio = 0.0

        records.append({
            "claim_id": claim_id,
            "customer_id": f"CUST-{rng.integers(0, 50000):06d}",
            "first_name": first,
            "last_name": last,
            "claim_type": claim_type,
            "product": product,
            "claim_amount_ngn": round(claim_amount, 2),
            "policy_limit_ngn": round(policy_limit, 2),
            "claim_to_limit_ratio": round(claim_to_limit_ratio, 4),
            "n_docs_required": n_docs_required,
            "n_docs_submitted": n_docs_submitted,
            "doc_completeness": round(doc_completeness, 4),
            "days_since_incident": days_since_incident,
            "days_since_policy_start": days_since_policy_start,
            "is_within_waiting_period": int(is_within_waiting_period),
            "prior_claims_count": prior_claims_count,
            "prior_claims_approved_pct": round(prior_claims_approved_pct, 4),
            "prior_fraud_flags": prior_fraud_flags,
            "doc_authenticity_score": round(doc_authenticity_score, 4),
            "witness_available": int(witness_available),
            "police_report_filed": int(police_report_filed),
            "hospital_report": int(hospital_report),
            "fraud_risk_score": round(fraud_risk_score, 4),
            "outcome": outcome,
            "payout_ratio": round(payout_ratio, 4),
        })

    return pd.DataFrame(records)


# ── Credit Scoring Data ───────────────────────────────────────────────────────

def generate_credit_dataset(n_samples: int = 35_000) -> pd.DataFrame:
    """Generate telco + financial credit scoring data for Nigerian market."""
    rng = np.random.default_rng(45)
    records: list[dict[str, Any]] = []

    for i in range(n_samples):
        customer_id = f"CUST-{i:06d}"
        first, last, gender = _rand_name()
        age = int(rng.integers(18, 65))

        # Telco features (from airtime/data usage)
        monthly_airtime_ngn = float(rng.lognormal(7.5, 1.0))
        monthly_data_gb = float(rng.lognormal(1.0, 0.8))
        active_sim_months = int(rng.integers(1, 120))
        calls_per_day = float(rng.poisson(5))
        sms_per_day = float(rng.poisson(3))
        unique_contacts_30d = int(rng.integers(5, 200))
        network_operator = random.choice(["MTN", "Glo", "Airtel", "9mobile"])
        recharge_frequency_30d = int(rng.integers(1, 30))
        data_consistency_score = float(rng.uniform(0.3, 1.0))

        # Financial features
        bank_account_age_months = int(rng.integers(0, 240))
        monthly_income_ngn = float(rng.lognormal(11.0, 1.0))
        monthly_expenses_ngn = monthly_income_ngn * float(rng.uniform(0.4, 0.95))
        savings_ratio = max(0, (monthly_income_ngn - monthly_expenses_ngn) / max(monthly_income_ngn, 1))
        existing_loans = int(rng.poisson(0.5))
        loan_repayment_history = float(rng.uniform(0.5, 1.0)) if existing_loans > 0 else 0.0
        debt_to_income = float(rng.uniform(0.0, 0.6))

        # BVN/NIN verification
        bvn_verified = bool(rng.random() < 0.8)
        nin_verified = bool(rng.random() < 0.7)
        address_verified = bool(rng.random() < 0.6)

        # Mobile money
        mobile_money_active = bool(rng.random() < 0.5)
        mobile_money_txn_30d = int(rng.poisson(10)) if mobile_money_active else 0
        mobile_money_volume_30d = float(rng.lognormal(9.0, 1.5)) if mobile_money_active else 0

        # Calculate credit score (300-850 range)
        base_score = 550.0
        base_score += min(active_sim_months, 60) * 0.5
        base_score += min(bank_account_age_months, 120) * 0.3
        base_score += savings_ratio * 80
        base_score += loan_repayment_history * 50
        base_score -= debt_to_income * 100
        base_score += (30 if bvn_verified else 0) + (20 if nin_verified else 0)
        base_score += data_consistency_score * 30
        base_score += float(rng.normal(0, 20))  # noise

        credit_score = int(max(300, min(850, base_score)))
        credit_grade = (
            "A" if credit_score >= 750 else
            "B" if credit_score >= 700 else
            "C" if credit_score >= 650 else
            "D" if credit_score >= 600 else
            "E" if credit_score >= 550 else "F"
        )

        # Default probability
        default_prob = max(0.01, min(0.95, 1.0 - (credit_score - 300) / 550))
        defaulted = bool(rng.random() < default_prob)

        records.append({
            "customer_id": customer_id,
            "first_name": first,
            "last_name": last,
            "gender": gender,
            "age": age,
            "state": random.choice(NIGERIAN_STATES),
            "occupation": random.choice(OCCUPATIONS),
            "monthly_airtime_ngn": round(monthly_airtime_ngn, 2),
            "monthly_data_gb": round(monthly_data_gb, 2),
            "active_sim_months": active_sim_months,
            "calls_per_day": round(calls_per_day, 1),
            "sms_per_day": round(sms_per_day, 1),
            "unique_contacts_30d": unique_contacts_30d,
            "network_operator": network_operator,
            "recharge_frequency_30d": recharge_frequency_30d,
            "data_consistency_score": round(data_consistency_score, 4),
            "bank_account_age_months": bank_account_age_months,
            "monthly_income_ngn": round(monthly_income_ngn, 2),
            "monthly_expenses_ngn": round(monthly_expenses_ngn, 2),
            "savings_ratio": round(savings_ratio, 4),
            "existing_loans": existing_loans,
            "loan_repayment_history": round(loan_repayment_history, 4),
            "debt_to_income": round(debt_to_income, 4),
            "bvn_verified": int(bvn_verified),
            "nin_verified": int(nin_verified),
            "address_verified": int(address_verified),
            "mobile_money_active": int(mobile_money_active),
            "mobile_money_txn_30d": mobile_money_txn_30d,
            "mobile_money_volume_30d": round(mobile_money_volume_30d, 2),
            "credit_score": credit_score,
            "credit_grade": credit_grade,
            "defaulted": int(defaulted),
        })

    return pd.DataFrame(records)


# ── Anomaly Detection Data ────────────────────────────────────────────────────

def generate_anomaly_dataset(n_samples: int = 100_000, anomaly_rate: float = 0.03) -> pd.DataFrame:
    """Generate transaction data with anomalies for autoencoder training."""
    rng = np.random.default_rng(46)
    records: list[dict[str, Any]] = []

    for i in range(n_samples):
        is_anomaly = rng.random() < anomaly_rate
        txn_id = f"TXN-{i:08d}"
        customer_id = f"CUST-{rng.integers(0, 20000):06d}"

        # Normal transaction patterns
        amount = float(rng.lognormal(9.5, 1.2))
        if is_anomaly:
            anomaly_type = rng.choice(["amount", "velocity", "pattern", "location"])
            if anomaly_type == "amount":
                amount = float(rng.lognormal(13.0, 1.0))  # Much larger
            elif anomaly_type == "velocity":
                amount = float(rng.lognormal(9.5, 1.2))  # Normal amount but high frequency
        else:
            anomaly_type = "none"

        hour = int(rng.integers(0, 24))
        if is_anomaly and anomaly_type == "pattern":
            hour = int(rng.choice([2, 3, 4]))  # Unusual hours

        day_of_week = int(rng.integers(0, 7))
        txn_type = random.choice(["premium_payment", "claim_payout", "refund", "transfer", "fee"])
        channel = random.choice(["mobile_app", "web", "ussd", "bank_transfer", "pos"])

        # Behavioral features
        avg_txn_amount_30d = amount * float(rng.uniform(0.8, 1.2)) if not is_anomaly else amount * float(rng.uniform(0.1, 0.3))
        txn_count_24h = int(rng.poisson(2)) if not is_anomaly else int(rng.poisson(15))
        txn_count_1h = int(rng.poisson(0.3)) if not is_anomaly else int(rng.poisson(5))
        days_since_last_txn = int(rng.integers(0, 30)) if not is_anomaly else int(rng.integers(0, 3))
        amount_deviation = abs(amount - avg_txn_amount_30d) / max(avg_txn_amount_30d, 1)

        records.append({
            "txn_id": txn_id,
            "customer_id": customer_id,
            "amount_ngn": round(amount, 2),
            "hour": hour,
            "day_of_week": day_of_week,
            "txn_type": txn_type,
            "channel": channel,
            "avg_txn_amount_30d": round(avg_txn_amount_30d, 2),
            "txn_count_24h": txn_count_24h,
            "txn_count_1h": txn_count_1h,
            "days_since_last_txn": days_since_last_txn,
            "amount_deviation": round(amount_deviation, 4),
            "is_anomaly": int(is_anomaly),
            "anomaly_type": anomaly_type,
        })

    return pd.DataFrame(records)


# ── Graph Data for GNN ────────────────────────────────────────────────────────

def generate_graph_dataset(
    n_customers: int = 10_000,
    n_agents: int = 500,
    n_claims: int = 15_000,
    n_banks: int = 12,
    fraud_ring_count: int = 30,
) -> dict[str, Any]:
    """Generate entity relationship graph data for GNN fraud detection.

    Creates nodes (customers, agents, claims, banks) and edges (relationships)
    with realistic fraud ring patterns.
    """
    rng = np.random.default_rng(47)

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    fraud_ring_members: set[str] = set()

    # Generate fraud rings first
    for ring_id in range(fraud_ring_count):
        ring_size = int(rng.integers(3, 12))
        ring_agent = f"AGT-{rng.integers(0, n_agents):04d}"
        ring_bank = random.choice(BANKS)
        ring_address = f"{rng.integers(1, 100)} {random.choice(['Broad St', 'Marina', 'Awolowo Rd', 'Adeola Odeku'])}, {random.choice(NIGERIAN_STATES)}"

        ring_customer_ids = [f"CUST-{rng.integers(0, n_customers):06d}" for _ in range(ring_size)]
        fraud_ring_members.update(ring_customer_ids)

        # Connect ring members to each other
        for j, c1 in enumerate(ring_customer_ids):
            for c2 in ring_customer_ids[j + 1:]:
                edges.append({
                    "source": c1, "target": c2,
                    "edge_type": "shared_address",
                    "weight": float(rng.uniform(0.7, 1.0)),
                    "ring_id": ring_id,
                })
            edges.append({
                "source": c1, "target": ring_agent,
                "edge_type": "agent_customer",
                "weight": float(rng.uniform(0.8, 1.0)),
                "ring_id": ring_id,
            })

    # Customer nodes
    for i in range(n_customers):
        cid = f"CUST-{i:06d}"
        first, last, gender = _rand_name()
        is_in_ring = cid in fraud_ring_members
        nodes.append({
            "node_id": cid,
            "node_type": "customer",
            "name": f"{first} {last}",
            "state": random.choice(NIGERIAN_STATES),
            "n_policies": int(rng.integers(1, 5)),
            "total_premium": float(rng.integers(10_000, 500_000)),
            "n_claims": int(rng.poisson(2.0 if is_in_ring else 1.0)),
            "risk_score": float(rng.uniform(0.5, 0.95)) if is_in_ring else float(rng.uniform(0.0, 0.4)),
            "is_fraudulent": int(is_in_ring),
        })

    # Agent nodes
    for i in range(n_agents):
        aid = f"AGT-{i:04d}"
        first, last, _ = _rand_name()
        nodes.append({
            "node_id": aid,
            "node_type": "agent",
            "name": f"{first} {last}",
            "state": random.choice(NIGERIAN_STATES),
            "n_customers": int(rng.integers(10, 200)),
            "total_premium_sold": float(rng.integers(500_000, 50_000_000)),
            "fraud_flag_count": int(rng.poisson(0.3)),
            "is_fraudulent": 0,
        })

    # Bank nodes
    for i, bank_name in enumerate(BANKS[:n_banks]):
        nodes.append({
            "node_id": f"BANK-{i:03d}",
            "node_type": "bank",
            "name": bank_name,
            "n_accounts": int(rng.integers(1000, 50000)),
            "is_fraudulent": 0,
        })

    # Claim nodes
    for i in range(n_claims):
        clid = f"CLM-{i:06d}"
        customer = f"CUST-{rng.integers(0, n_customers):06d}"
        is_fraud_claim = customer in fraud_ring_members and rng.random() < 0.6
        nodes.append({
            "node_id": clid,
            "node_type": "claim",
            "claim_type": random.choice(CLAIM_TYPES),
            "amount": float(rng.integers(10_000, 3_000_000)),
            "is_fraudulent": int(is_fraud_claim),
        })
        edges.append({
            "source": customer, "target": clid,
            "edge_type": "filed_claim",
            "weight": 1.0,
            "ring_id": -1,
        })

    # Normal edges (non-fraud)
    for i in range(n_customers):
        cid = f"CUST-{i:06d}"
        # Customer-Agent
        agent = f"AGT-{rng.integers(0, n_agents):04d}"
        edges.append({
            "source": cid, "target": agent,
            "edge_type": "agent_customer",
            "weight": float(rng.uniform(0.3, 0.8)),
            "ring_id": -1,
        })
        # Customer-Bank
        bank = f"BANK-{rng.integers(0, n_banks):03d}"
        edges.append({
            "source": cid, "target": bank,
            "edge_type": "has_account",
            "weight": float(rng.uniform(0.3, 0.7)),
            "ring_id": -1,
        })

    return {
        "nodes": pd.DataFrame(nodes),
        "edges": pd.DataFrame(edges),
        "fraud_ring_count": fraud_ring_count,
        "fraud_ring_members": list(fraud_ring_members),
    }


# ── MCMC Risk Data ────────────────────────────────────────────────────────────

def generate_risk_dataset(n_policies: int = 20_000, n_years: int = 5) -> pd.DataFrame:
    """Generate actuarial data for Bayesian/MCMC risk modeling."""
    rng = np.random.default_rng(48)
    records: list[dict[str, Any]] = []

    for i in range(n_policies):
        policy_id = f"POL-{i:06d}"
        product = random.choice(INSURANCE_PRODUCTS)
        state = random.choice(NIGERIAN_STATES)

        # Risk factors
        age = int(rng.integers(18, 70))
        gender = random.choice(["M", "F"])
        occupation_risk = float(rng.uniform(0.1, 0.9))

        # Premium and exposure
        premium = float(rng.lognormal(10.5, 1.0))
        sum_insured = premium * float(rng.uniform(10, 100))
        exposure_years = float(rng.uniform(0.5, float(n_years)))

        # Loss history
        base_loss_rate = 0.15
        if product.startswith("motor"):
            base_loss_rate = 0.25
        elif product.startswith("health"):
            base_loss_rate = 0.35
        elif product.startswith("agriculture"):
            base_loss_rate = 0.20

        # Age adjustment
        if age > 55:
            base_loss_rate *= 1.3
        elif age < 25:
            base_loss_rate *= 1.2

        n_losses = int(rng.poisson(base_loss_rate * exposure_years))
        total_loss = 0.0
        loss_amounts: list[float] = []
        for _ in range(n_losses):
            loss = float(rng.lognormal(math.log(premium * 0.5), 0.8))
            loss = min(loss, sum_insured)
            loss_amounts.append(loss)
            total_loss += loss

        loss_ratio = total_loss / max(premium * exposure_years, 1)

        records.append({
            "policy_id": policy_id,
            "product": product,
            "state": state,
            "age": age,
            "gender": gender,
            "occupation_risk": round(occupation_risk, 4),
            "premium_ngn": round(premium, 2),
            "sum_insured_ngn": round(sum_insured, 2),
            "exposure_years": round(exposure_years, 2),
            "n_losses": n_losses,
            "total_loss_ngn": round(total_loss, 2),
            "loss_ratio": round(loss_ratio, 4),
            "max_single_loss_ngn": round(max(loss_amounts) if loss_amounts else 0, 2),
            "avg_loss_ngn": round(sum(loss_amounts) / len(loss_amounts) if loss_amounts else 0, 2),
        })

    return pd.DataFrame(records)


# ── Master Generator ──────────────────────────────────────────────────────────

def generate_all_datasets(output_dir: str | Path = "data") -> dict[str, Path]:
    """Generate all synthetic datasets and save as parquet files."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    paths: dict[str, Path] = {}

    print("Generating fraud detection dataset (50,000 samples)...")
    fraud_df = generate_fraud_dataset(50_000)
    p = output_dir / "fraud_detection.parquet"
    fraud_df.to_parquet(p, index=False)
    paths["fraud"] = p
    print(f"  -> {p} ({len(fraud_df)} rows, fraud rate: {fraud_df['is_fraud'].mean():.2%})")

    print("Generating churn prediction dataset (40,000 samples)...")
    churn_df = generate_churn_dataset(40_000)
    p = output_dir / "churn_prediction.parquet"
    churn_df.to_parquet(p, index=False)
    paths["churn"] = p
    print(f"  -> {p} ({len(churn_df)} rows, churn rate: {churn_df['churned'].mean():.2%})")

    print("Generating claims adjudication dataset (30,000 samples)...")
    claims_df = generate_claims_dataset(30_000)
    p = output_dir / "claims_adjudication.parquet"
    claims_df.to_parquet(p, index=False)
    paths["claims"] = p
    print(f"  -> {p} ({len(claims_df)} rows)")

    print("Generating credit scoring dataset (35,000 samples)...")
    credit_df = generate_credit_dataset(35_000)
    p = output_dir / "credit_scoring.parquet"
    credit_df.to_parquet(p, index=False)
    paths["credit"] = p
    print(f"  -> {p} ({len(credit_df)} rows, default rate: {credit_df['defaulted'].mean():.2%})")

    print("Generating anomaly detection dataset (100,000 samples)...")
    anomaly_df = generate_anomaly_dataset(100_000)
    p = output_dir / "anomaly_detection.parquet"
    anomaly_df.to_parquet(p, index=False)
    paths["anomaly"] = p
    print(f"  -> {p} ({len(anomaly_df)} rows, anomaly rate: {anomaly_df['is_anomaly'].mean():.2%})")

    print("Generating graph dataset (10,000 customers, 500 agents, 15,000 claims)...")
    graph_data = generate_graph_dataset()
    nodes_p = output_dir / "graph_nodes.parquet"
    edges_p = output_dir / "graph_edges.parquet"
    graph_data["nodes"].to_parquet(nodes_p, index=False)
    graph_data["edges"].to_parquet(edges_p, index=False)
    paths["graph_nodes"] = nodes_p
    paths["graph_edges"] = edges_p
    meta_p = output_dir / "graph_meta.json"
    with open(meta_p, "w") as f:
        json.dump({
            "fraud_ring_count": graph_data["fraud_ring_count"],
            "fraud_ring_member_count": len(graph_data["fraud_ring_members"]),
        }, f, indent=2)
    print(f"  -> {nodes_p} ({len(graph_data['nodes'])} nodes)")
    print(f"  -> {edges_p} ({len(graph_data['edges'])} edges)")

    print("Generating risk/actuarial dataset (20,000 policies)...")
    risk_df = generate_risk_dataset(20_000)
    p = output_dir / "risk_actuarial.parquet"
    risk_df.to_parquet(p, index=False)
    paths["risk"] = p
    print(f"  -> {p} ({len(risk_df)} rows, avg loss ratio: {risk_df['loss_ratio'].mean():.2%})")

    print(f"\nAll datasets generated in {output_dir}/")
    return paths


if __name__ == "__main__":
    generate_all_datasets()
