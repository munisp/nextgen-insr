"""
Churn Prediction Neural Network — PyTorch

Architecture: TabNet-inspired architecture with sequential attention
for customer churn classification.

Input: 20 engineered features from customer/policy/engagement data
Output: Binary churn probability
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class GatedLinearUnit(nn.Module):
    """GLU for tabular feature selection."""

    def __init__(self, in_dim: int, out_dim: int) -> None:
        super().__init__()
        self.fc = nn.Linear(in_dim, out_dim)
        self.gate = nn.Linear(in_dim, out_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.fc(x) * torch.sigmoid(self.gate(x))


class AttentionBlock(nn.Module):
    """Feature attention block — learns which features matter for each sample."""

    def __init__(self, dim: int, n_heads: int = 4) -> None:
        super().__init__()
        self.n_heads = n_heads
        self.head_dim = dim // n_heads
        assert dim % n_heads == 0

        self.query = nn.Linear(dim, dim)
        self.key = nn.Linear(dim, dim)
        self.value = nn.Linear(dim, dim)
        self.out_proj = nn.Linear(dim, dim)
        self.norm = nn.LayerNorm(dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B = x.size(0)
        # Treat features as a sequence of length 1 with self-attention
        # Reshape for multi-head attention
        q = self.query(x).view(B, self.n_heads, self.head_dim)
        k = self.key(x).view(B, self.n_heads, self.head_dim)
        v = self.value(x).view(B, self.n_heads, self.head_dim)

        attn = torch.bmm(
            q.transpose(0, 1),
            k.transpose(0, 1).transpose(1, 2),
        ) / (self.head_dim ** 0.5)
        attn = F.softmax(attn, dim=-1)
        out = torch.bmm(attn, v.transpose(0, 1))
        out = out.transpose(0, 1).contiguous().view(B, -1)
        out = self.out_proj(out)
        return self.norm(out + x)


class ChurnPredictionNet(nn.Module):
    """Churn prediction network with gated linear units and feature attention.

    Architecture:
    - Input normalization + projection
    - 2 GLU layers for feature selection
    - Feature attention mechanism
    - Classification head with calibrated output
    """

    FEATURE_NAMES = [
        "tenure_months", "n_policies", "total_premium_ngn",
        "n_claims_filed", "n_claims_approved", "claim_approval_rate",
        "late_payments_12m", "missed_payments_12m", "auto_renewal",
        "app_logins_30d", "support_calls_90d", "complaints_12m",
        "nps_score", "last_interaction_days",
        "has_motor", "has_health", "has_life", "has_property",
        "competitor_quote_requested", "premium_increase_pct",
    ]

    def __init__(
        self,
        n_features: int = 20,
        hidden_dim: int = 96,
        dropout: float = 0.25,
    ) -> None:
        super().__init__()
        self.input_bn = nn.BatchNorm1d(n_features)

        self.glu1 = GatedLinearUnit(n_features, hidden_dim)
        self.bn1 = nn.BatchNorm1d(hidden_dim)
        self.drop1 = nn.Dropout(dropout)

        self.glu2 = GatedLinearUnit(hidden_dim, hidden_dim)
        self.bn2 = nn.BatchNorm1d(hidden_dim)
        self.drop2 = nn.Dropout(dropout)

        self.attention = AttentionBlock(hidden_dim, n_heads=4)

        self.head = nn.Sequential(
            nn.Linear(hidden_dim, 48),
            nn.BatchNorm1d(48),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(48, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.input_bn(x)
        x = self.drop1(self.bn1(self.glu1(x)))
        x = self.drop2(self.bn2(self.glu2(x)))
        x = self.attention(x)
        return self.head(x).squeeze(-1)

    def predict_proba(self, x: torch.Tensor) -> torch.Tensor:
        with torch.no_grad():
            return torch.sigmoid(self.forward(x))
