"""Feature extraction pipeline for fraud detection model."""

import numpy as np
from datetime import datetime


class FeatureExtractor:
    """Extract numerical features from claim data for ML model input."""

    def extract(self, claim) -> np.ndarray:
        """Transform a ClaimInput into a feature vector for the fraud model.
        
        Features (9 dimensions):
        0: claim_frequency_90d - normalized claim count in 90 days (0-1)
        1: amount_deviation - how far claim amount deviates from policy type average
        2: days_since_policy_start - normalized early-claim indicator
        3: description_similarity - placeholder for NLP similarity score
        4: previous_claims_total - normalized total of past claims
        5: time_of_incident_night - binary (11pm-5am)
        6: no_witnesses - binary (no witnesses reported)
        7: no_police_report - binary (no police report for high-value claim)
        8: high_claim_ratio - claim amount vs sum insured ratio
        """
        features = np.zeros(9)

        # Feature 0: Claim frequency (normalized 0-1, 5+ claims in 90 days = 1.0)
        freq = min(claim.previous_claims_count / 5.0, 1.0)
        features[0] = freq

        # Feature 1: Amount deviation from average for policy type
        avg_amounts = {
            "motor": 250000,
            "health": 150000,
            "life": 5000000,
            "property": 1000000,
            "travel": 100000,
        }
        avg = avg_amounts.get(claim.policy_type, 500000)
        deviation = abs(claim.claim_amount - avg) / avg
        features[1] = min(deviation, 1.0)

        # Feature 2: Days since policy start (early claims are suspicious)
        try:
            policy_start = datetime.fromisoformat(claim.policy_start_date.replace("Z", "+00:00"))
            claim_date = datetime.fromisoformat(claim.claim_date.replace("Z", "+00:00"))
            days_elapsed = (claim_date - policy_start).days
            # Very early claims (< 30 days) get high score
            if days_elapsed < 30:
                features[2] = 0.9
            elif days_elapsed < 60:
                features[2] = 0.5
            elif days_elapsed < 90:
                features[2] = 0.3
            else:
                features[2] = max(0, 1.0 - days_elapsed / 365.0)
        except (ValueError, TypeError):
            features[2] = 0.0

        # Feature 3: Description similarity (would use NLP embeddings in production)
        if claim.description:
            # Simple heuristic: very short or very generic descriptions are suspicious
            desc_len = len(claim.description)
            if desc_len < 20:
                features[3] = 0.7  # Too short
            elif desc_len > 500:
                features[3] = 0.2  # Detailed = less suspicious
            else:
                features[3] = 0.4  # Average
        else:
            features[3] = 0.8  # No description at all

        # Feature 4: Previous claims total (normalized)
        if claim.previous_claims_total > 0:
            features[4] = min(claim.previous_claims_total / 2000000, 1.0)

        # Feature 5: Time of incident (night = suspicious for some claim types)
        if claim.time_of_incident:
            try:
                hour = int(claim.time_of_incident.split(":")[0])
                if 23 <= hour or hour < 5:
                    features[5] = 0.8
            except (ValueError, IndexError):
                pass

        # Feature 6: No witnesses
        if claim.witnesses is not None:
            features[6] = 1.0 if claim.witnesses == 0 else 0.0
        else:
            features[6] = 0.5  # Unknown

        # Feature 7: No police report (suspicious for motor/property claims)
        if claim.police_report is not None:
            if not claim.police_report and claim.policy_type in ("motor", "property"):
                features[7] = 0.9
        else:
            features[7] = 0.3

        # Feature 8: High claim-to-average ratio
        if claim.claim_amount > avg * 3:
            features[8] = 0.9
        elif claim.claim_amount > avg * 2:
            features[8] = 0.6
        elif claim.claim_amount > avg:
            features[8] = 0.3
        else:
            features[8] = 0.0

        return features
