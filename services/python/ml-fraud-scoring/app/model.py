"""
Fraud Detection ML Model — Insurance Claims Fraud Scoring
Real scikit-learn ensemble: RandomForest + GradientBoosting (VotingClassifier)
Trains on PostgreSQL data at startup. Falls back to synthetic data if DB unavailable.
CPU inference only — no GPU required.
"""
import os
import logging
import pickle
import numpy as np
from typing import Any, Optional

logger = logging.getLogger("ml-fraud-scoring.model")

try:
    from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier, VotingClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import Pipeline
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import roc_auc_score, precision_score, recall_score, f1_score
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logger.warning("scikit-learn not installed — using rule-based fallback")

MODEL_PATH = os.getenv("MODEL_PATH", "/models/fraud_model.pkl")
DATABASE_URL = os.getenv("DATABASE_URL", "")

FEATURE_NAMES = [
    "claim_frequency_90d", "amount_deviation", "days_since_policy_start",
    "description_similarity", "previous_claims_total", "time_of_incident_night",
    "no_witnesses", "no_police_report", "high_claim_ratio",
]
FEATURE_WEIGHTS = np.array([0.185, 0.162, 0.143, 0.128, 0.098, 0.087, 0.072, 0.065, 0.060])


def _load_training_data():
    if not DATABASE_URL:
        return None
    try:
        import psycopg2
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        cur.execute("""
            SELECT
                LEAST(COALESCE((SELECT COUNT(*)::float FROM claims c2
                    WHERE c2.customer_id = c.customer_id
                    AND c2.created_at > NOW() - INTERVAL '90 days' AND c2.id != c.id), 0) / 10.0, 1.0),
                CASE WHEN p.sum_insured > 0 THEN LEAST(c.claim_amount::float / p.sum_insured::float, 2.0) ELSE 0.5 END,
                LEAST(EXTRACT(EPOCH FROM (c.created_at - p.start_date)) / (3*365*86400), 1.0),
                0.5,
                LEAST(COALESCE((SELECT SUM(c2.claim_amount)::float FROM claims c2
                    WHERE c2.customer_id = c.customer_id AND c2.id != c.id), 0) / 5000000.0, 1.0),
                CASE WHEN EXTRACT(HOUR FROM c.incident_date) BETWEEN 22 AND 23
                          OR EXTRACT(HOUR FROM c.incident_date) BETWEEN 0 AND 6 THEN 1.0 ELSE 0.0 END,
                CASE WHEN COALESCE(c.witnesses_count, 0) = 0 THEN 1.0 ELSE 0.0 END,
                CASE WHEN COALESCE(c.police_report_number, '') = '' THEN 1.0 ELSE 0.0 END,
                CASE WHEN p.sum_insured > 0 THEN LEAST(c.claim_amount::float / p.sum_insured::float, 1.0) ELSE 0.0 END,
                CASE WHEN c.fraud_flag = true OR c.status = 'rejected_fraud' THEN 1 ELSE 0 END
            FROM claims c JOIN policies p ON p.id = c.policy_id
            WHERE c.created_at > NOW() - INTERVAL '3 years' AND c.claim_amount > 0
            LIMIT 50000
        """)
        rows = cur.fetchall()
        cur.close(); conn.close()
        if len(rows) < 100:
            return None
        data = np.array(rows, dtype=float)
        logger.info(f"Loaded {len(rows)} training samples from PostgreSQL")
        return data[:, :9], data[:, 9].astype(int)
    except Exception as e:
        logger.warning(f"Could not load training data: {e}")
        return None


def _synthetic_data(n=10000):
    rng = np.random.RandomState(42)
    n_legit = int(n * 0.80)
    n_fraud = n - n_legit
    legit = np.clip(np.column_stack([
        rng.exponential(0.1, n_legit), rng.normal(0.3, 0.15, n_legit),
        rng.uniform(0.1, 1.0, n_legit), rng.normal(0.3, 0.1, n_legit),
        rng.exponential(0.15, n_legit), rng.binomial(1, 0.25, n_legit).astype(float),
        rng.binomial(1, 0.30, n_legit).astype(float), rng.binomial(1, 0.20, n_legit).astype(float),
        rng.normal(0.25, 0.15, n_legit),
    ]), 0, 1)
    fraud = np.clip(np.column_stack([
        rng.exponential(0.5, n_fraud), rng.normal(0.75, 0.15, n_fraud),
        rng.uniform(0.0, 0.3, n_fraud), rng.normal(0.7, 0.1, n_fraud),
        rng.exponential(0.4, n_fraud), rng.binomial(1, 0.65, n_fraud).astype(float),
        rng.binomial(1, 0.80, n_fraud).astype(float), rng.binomial(1, 0.75, n_fraud).astype(float),
        rng.normal(0.70, 0.15, n_fraud),
    ]), 0, 1)
    X = np.vstack([legit, fraud])
    y = np.concatenate([np.zeros(n_legit), np.ones(n_fraud)]).astype(int)
    idx = rng.permutation(len(y))
    return X[idx], y[idx]


class FraudModel:
    """Real scikit-learn ensemble fraud detection model for insurance claims."""

    def __init__(self):
        self.version = "3.0.0"
        self.pipeline = None
        self.is_loaded = False
        self.prediction_count = 0
        self.trained_on = "none"
        self.metrics = {"accuracy": 0.0, "precision": 0.0, "recall": 0.0, "f1_score": 0.0, "auc_roc": 0.0}
        self.feature_importance = [{"feature": n, "importance": float(w)} for n, w in zip(FEATURE_NAMES, FEATURE_WEIGHTS)]
        self._load_or_train()

    def _load_or_train(self):
        if os.path.exists(MODEL_PATH):
            try:
                with open(MODEL_PATH, "rb") as f:
                    saved = pickle.load(f)
                self.pipeline = saved["pipeline"]
                self.metrics = saved.get("metrics", self.metrics)
                self.trained_on = saved.get("trained_on", "disk")
                self.is_loaded = True
                logger.info(f"Loaded model from {MODEL_PATH} AUC={self.metrics['auc_roc']:.3f}")
                return
            except Exception as e:
                logger.warning(f"Could not load model: {e}")
        if SKLEARN_AVAILABLE:
            self._train()
        else:
            self.is_loaded = True

    def _train(self):
        logger.info("Training fraud detection model...")
        data = _load_training_data()
        if data:
            X, y = data
            self.trained_on = "postgresql"
        else:
            X, y = _synthetic_data(10000)
            self.trained_on = "synthetic"
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
        rf = RandomForestClassifier(n_estimators=100, max_depth=8, min_samples_leaf=5,
                                    class_weight="balanced", random_state=42, n_jobs=-1)
        gb = GradientBoostingClassifier(n_estimators=100, max_depth=4, learning_rate=0.1,
                                        subsample=0.8, random_state=42)
        ensemble = VotingClassifier(estimators=[("rf", rf), ("gb", gb)], voting="soft")
        self.pipeline = Pipeline([("scaler", StandardScaler()), ("model", ensemble)])
        self.pipeline.fit(X_train, y_train)
        y_pred = self.pipeline.predict(X_test)
        y_prob = self.pipeline.predict_proba(X_test)[:, 1]
        self.metrics = {
            "accuracy": float(np.mean(y_pred == y_test)),
            "precision": float(precision_score(y_test, y_pred, zero_division=0)),
            "recall": float(recall_score(y_test, y_pred, zero_division=0)),
            "f1_score": float(f1_score(y_test, y_pred, zero_division=0)),
            "auc_roc": float(roc_auc_score(y_test, y_prob)),
        }
        rf_model = self.pipeline.named_steps["model"].estimators_[0]
        self.feature_importance = sorted(
            [{"feature": n, "importance": float(i)} for n, i in zip(FEATURE_NAMES, rf_model.feature_importances_)],
            key=lambda x: x["importance"], reverse=True
        )
        self.is_loaded = True
        logger.info(f"Model trained: auc={self.metrics['auc_roc']:.3f} source={self.trained_on}")
        try:
            os.makedirs(os.path.dirname(MODEL_PATH) or ".", exist_ok=True)
            with open(MODEL_PATH, "wb") as f:
                pickle.dump({"pipeline": self.pipeline, "metrics": self.metrics,
                             "trained_on": self.trained_on, "version": self.version}, f)
        except Exception as e:
            logger.warning(f"Could not save model: {e}")

    def predict(self, features: np.ndarray) -> dict[str, Any]:
        self.prediction_count += 1
        feat = features[:9] if len(features) >= 9 else np.pad(features, (0, 9 - len(features)))
        if self.pipeline is not None and SKLEARN_AVAILABLE:
            prob = float(self.pipeline.predict_proba(feat.reshape(1, -1))[0][1])
            score = prob * 100
            confidence = min(0.95, 0.60 + abs(prob - 0.5) * 0.7)
        else:
            raw = float(np.dot(feat, FEATURE_WEIGHTS))
            score = min(max(raw * 100, 0), 100)
            confidence = min(float(np.count_nonzero(feat)) / 9 * 0.95, 0.85)
        top_indicators = sorted(
            [{"feature": n, "contribution": round(float(feat[i] * w), 4), "value": round(float(feat[i]), 4)}
             for i, (n, w) in enumerate(zip(FEATURE_NAMES, FEATURE_WEIGHTS)) if i < len(feat) and feat[i] > 0.2],
            key=lambda x: x["contribution"], reverse=True
        )
        return {"score": round(score, 2), "confidence": round(confidence, 4), "top_indicators": top_indicators[:5]}
