"""
Credit Scoring Neural Network — PyTorch

Architecture: Wide & Deep network combining memorization (wide)
and generalization (deep) for telco + financial credit scoring.

Input: 22 features (telco usage + financial + verification)
Output: (credit_score[1], default_probability[1])
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class CreditScoringNet(nn.Module):
    """Wide & Deep credit scoring network.

    - Wide path: linear model for memorization of feature interactions
    - Deep path: DNN for generalization
    - Combined output: credit score regression + default classification
    """

    FEATURE_NAMES = [
        "monthly_airtime_ngn", "monthly_data_gb", "active_sim_months",
        "calls_per_day", "sms_per_day", "unique_contacts_30d",
        "recharge_frequency_30d", "data_consistency_score",
        "bank_account_age_months", "monthly_income_ngn",
        "monthly_expenses_ngn", "savings_ratio", "existing_loans",
        "loan_repayment_history", "debt_to_income",
        "bvn_verified", "nin_verified", "address_verified",
        "mobile_money_active", "mobile_money_txn_30d",
        "mobile_money_volume_30d",
    ]

    def __init__(
        self,
        n_features: int = 21,
        wide_dim: int = 64,
        deep_dims: tuple[int, ...] = (128, 96, 64),
        dropout: float = 0.2,
    ) -> None:
        super().__init__()
        self.input_bn = nn.BatchNorm1d(n_features)

        # Wide path
        self.wide = nn.Linear(n_features, wide_dim)

        # Deep path
        deep_layers: list[nn.Module] = []
        prev_dim = n_features
        for dim in deep_dims:
            deep_layers.extend([
                nn.Linear(prev_dim, dim),
                nn.BatchNorm1d(dim),
                nn.GELU(),
                nn.Dropout(dropout),
            ])
            prev_dim = dim
        self.deep = nn.Sequential(*deep_layers)

        combined_dim = wide_dim + deep_dims[-1]

        # Credit score head (regression, 300-850)
        self.score_head = nn.Sequential(
            nn.Linear(combined_dim, 48),
            nn.BatchNorm1d(48),
            nn.GELU(),
            nn.Linear(48, 1),
        )

        # Default probability head (binary classification)
        self.default_head = nn.Sequential(
            nn.Linear(combined_dim, 48),
            nn.BatchNorm1d(48),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(48, 1),
        )

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        x = self.input_bn(x)
        wide_out = F.gelu(self.wide(x))
        deep_out = self.deep(x)
        combined = torch.cat([wide_out, deep_out], dim=-1)

        # Credit score in [300, 850]
        raw_score = self.score_head(combined).squeeze(-1)
        credit_score = 300.0 + torch.sigmoid(raw_score) * 550.0

        # Default logit
        default_logit = self.default_head(combined).squeeze(-1)

        return credit_score, default_logit

    def predict(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """Return credit score and default probability."""
        with torch.no_grad():
            score, logit = self.forward(x)
            return score, torch.sigmoid(logit)
