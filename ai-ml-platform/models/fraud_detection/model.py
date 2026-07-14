"""
Fraud Detection Neural Network — PyTorch

Architecture: Multi-layer MLP with skip connections, batch normalization,
and dropout for tabular fraud classification.

Input: 22 engineered features from claims/policy data
Output: Binary fraud probability
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class ResidualBlock(nn.Module):
    """Residual block for tabular data with BN + dropout."""

    def __init__(self, dim: int, dropout: float = 0.3) -> None:
        super().__init__()
        self.fc1 = nn.Linear(dim, dim)
        self.bn1 = nn.BatchNorm1d(dim)
        self.fc2 = nn.Linear(dim, dim)
        self.bn2 = nn.BatchNorm1d(dim)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = x
        out = F.gelu(self.bn1(self.fc1(x)))
        out = self.dropout(out)
        out = self.bn2(self.fc2(out))
        out = self.dropout(out)
        return F.gelu(out + residual)


class FraudDetectionNet(nn.Module):
    """Deep fraud detection network for insurance claims.

    Features:
    - Input embedding layer for mixed categorical/continuous features
    - 3 residual blocks with skip connections
    - Attention-weighted feature aggregation
    - Calibrated probability output via sigmoid
    """

    NUMERIC_FEATURES = [
        "policy_age_days", "premium_ngn", "claim_amount_ngn", "claim_premium_ratio",
        "claims_last_30d", "claims_last_90d", "claims_last_365d",
        "doc_ocr_confidence", "face_match_score", "liveness_score",
        "unique_devices_30d", "unique_ips_30d", "hour_of_submission",
        "same_bank_claims_count", "agent_fraud_rate",
    ]
    BINARY_FEATURES = ["doc_verified", "ip_country_match", "is_weekend"]
    # Categorical features are encoded externally before feeding to the model

    def __init__(
        self,
        n_numeric: int = 15,
        n_binary: int = 3,
        n_categorical_embed: int = 4,  # Additional encoded cat features
        hidden_dim: int = 128,
        n_residual_blocks: int = 3,
        dropout: float = 0.3,
    ) -> None:
        super().__init__()
        input_dim = n_numeric + n_binary + n_categorical_embed

        self.input_bn = nn.BatchNorm1d(input_dim)
        self.input_proj = nn.Linear(input_dim, hidden_dim)
        self.input_bn2 = nn.BatchNorm1d(hidden_dim)

        self.res_blocks = nn.ModuleList([
            ResidualBlock(hidden_dim, dropout) for _ in range(n_residual_blocks)
        ])

        # Feature attention
        self.attention = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 4),
            nn.Tanh(),
            nn.Linear(hidden_dim // 4, hidden_dim),
            nn.Sigmoid(),
        )

        self.head = nn.Sequential(
            nn.Linear(hidden_dim, 64),
            nn.BatchNorm1d(64),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(64, 32),
            nn.BatchNorm1d(32),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(32, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.input_bn(x)
        x = F.gelu(self.input_bn2(self.input_proj(x)))

        for block in self.res_blocks:
            x = block(x)

        # Attention weighting
        attn_weights = self.attention(x)
        x = x * attn_weights

        logits = self.head(x)
        return logits.squeeze(-1)

    def predict_proba(self, x: torch.Tensor) -> torch.Tensor:
        """Return calibrated probability."""
        with torch.no_grad():
            logits = self.forward(x)
            return torch.sigmoid(logits)
