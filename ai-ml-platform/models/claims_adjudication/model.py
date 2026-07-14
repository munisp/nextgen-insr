"""
Claims Adjudication Neural Network — PyTorch

Architecture: Multi-task network that predicts both the claim outcome
(approved/partial/denied) and the payout ratio simultaneously.

Input: 18 engineered features from claims data
Output: (outcome_logits[3], payout_ratio[1])
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class ClaimsAdjudicationNet(nn.Module):
    """Multi-task claims adjudication network.

    Shared trunk with two heads:
    - Classification head: 3-class (approved, partially_approved, denied)
    - Regression head: payout ratio [0, 1]
    """

    OUTCOME_CLASSES = ["approved", "partially_approved", "denied"]

    FEATURE_NAMES = [
        "claim_amount_ngn", "policy_limit_ngn", "claim_to_limit_ratio",
        "n_docs_required", "n_docs_submitted", "doc_completeness",
        "days_since_incident", "days_since_policy_start",
        "is_within_waiting_period", "prior_claims_count",
        "prior_claims_approved_pct", "prior_fraud_flags",
        "doc_authenticity_score", "witness_available",
        "police_report_filed", "hospital_report", "fraud_risk_score",
    ]

    def __init__(
        self,
        n_features: int = 17,
        hidden_dim: int = 112,
        n_classes: int = 3,
        dropout: float = 0.25,
    ) -> None:
        super().__init__()
        self.n_classes = n_classes

        # Shared trunk
        self.trunk = nn.Sequential(
            nn.BatchNorm1d(n_features),
            nn.Linear(n_features, hidden_dim),
            nn.BatchNorm1d(hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, hidden_dim),
            nn.BatchNorm1d(hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, hidden_dim),
            nn.BatchNorm1d(hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
        )

        # Classification head
        self.cls_head = nn.Sequential(
            nn.Linear(hidden_dim, 48),
            nn.BatchNorm1d(48),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(48, n_classes),
        )

        # Regression head (payout ratio)
        self.reg_head = nn.Sequential(
            nn.Linear(hidden_dim, 48),
            nn.BatchNorm1d(48),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(48, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        shared = self.trunk(x)
        cls_logits = self.cls_head(shared)
        payout = self.reg_head(shared).squeeze(-1)
        return cls_logits, payout

    def predict(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Return class probabilities, predicted class, and payout ratio."""
        with torch.no_grad():
            cls_logits, payout = self.forward(x)
            probs = F.softmax(cls_logits, dim=-1)
            predicted_class = torch.argmax(probs, dim=-1)
            return probs, predicted_class, payout
