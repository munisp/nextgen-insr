"""
Transaction Anomaly Detection Autoencoder — PyTorch

Architecture: Variational Autoencoder (VAE) that learns normal transaction
patterns. Anomalies are detected by high reconstruction error.

Input: 10 transaction features
Output: Reconstruction + latent representation
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class TransactionAutoencoder(nn.Module):
    """Variational Autoencoder for transaction anomaly detection.

    Training: Learns to reconstruct normal transactions.
    Inference: High reconstruction error = anomaly.
    """

    FEATURE_NAMES = [
        "amount_ngn", "hour", "day_of_week",
        "avg_txn_amount_30d", "txn_count_24h", "txn_count_1h",
        "days_since_last_txn", "amount_deviation",
    ]

    def __init__(
        self,
        n_features: int = 8,
        encoder_dims: tuple[int, ...] = (64, 32),
        latent_dim: int = 12,
        dropout: float = 0.15,
    ) -> None:
        super().__init__()
        self.n_features = n_features
        self.latent_dim = latent_dim
        self.input_bn = nn.BatchNorm1d(n_features)

        # Encoder
        enc_layers: list[nn.Module] = []
        prev = n_features
        for dim in encoder_dims:
            enc_layers.extend([
                nn.Linear(prev, dim),
                nn.BatchNorm1d(dim),
                nn.GELU(),
                nn.Dropout(dropout),
            ])
            prev = dim
        self.encoder = nn.Sequential(*enc_layers)

        # VAE: mean and log-variance
        self.fc_mu = nn.Linear(encoder_dims[-1], latent_dim)
        self.fc_logvar = nn.Linear(encoder_dims[-1], latent_dim)

        # Decoder
        dec_dims = list(reversed(encoder_dims))
        dec_layers: list[nn.Module] = [
            nn.Linear(latent_dim, dec_dims[0]),
            nn.BatchNorm1d(dec_dims[0]),
            nn.GELU(),
        ]
        for i in range(len(dec_dims) - 1):
            dec_layers.extend([
                nn.Linear(dec_dims[i], dec_dims[i + 1]),
                nn.BatchNorm1d(dec_dims[i + 1]),
                nn.GELU(),
            ])
        dec_layers.append(nn.Linear(dec_dims[-1], n_features))
        self.decoder = nn.Sequential(*dec_layers)

    def encode(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        h = self.encoder(self.input_bn(x))
        return self.fc_mu(h), self.fc_logvar(h)

    def reparameterize(self, mu: torch.Tensor, logvar: torch.Tensor) -> torch.Tensor:
        if self.training:
            std = torch.exp(0.5 * logvar)
            eps = torch.randn_like(std)
            return mu + eps * std
        return mu

    def decode(self, z: torch.Tensor) -> torch.Tensor:
        return self.decoder(z)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        mu, logvar = self.encode(x)
        z = self.reparameterize(mu, logvar)
        x_recon = self.decode(z)
        return x_recon, mu, logvar

    def reconstruction_error(self, x: torch.Tensor) -> torch.Tensor:
        """Per-sample reconstruction error (anomaly score)."""
        with torch.no_grad():
            x_normed = self.input_bn(x)
            x_recon, _, _ = self.forward(x)
            return F.mse_loss(x_recon, x_normed, reduction="none").mean(dim=-1)

    @staticmethod
    def vae_loss(
        x: torch.Tensor,
        x_recon: torch.Tensor,
        mu: torch.Tensor,
        logvar: torch.Tensor,
        beta: float = 0.5,
    ) -> torch.Tensor:
        """VAE loss = reconstruction + KL divergence."""
        recon_loss = F.mse_loss(x_recon, x, reduction="mean")
        kl_loss = -0.5 * torch.mean(1 + logvar - mu.pow(2) - logvar.exp())
        return recon_loss + beta * kl_loss
