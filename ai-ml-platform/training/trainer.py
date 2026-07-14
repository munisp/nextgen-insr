"""
Unified Training Engine — PyTorch

Real training loops with:
- Learning rate scheduling (OneCycleLR)
- Early stopping
- Focal loss for class imbalance
- Metric tracking (AUC-ROC, F1, precision, recall)
- Model checkpointing
- Mixed precision support
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, TensorDataset, random_split
from sklearn.metrics import (
    roc_auc_score, f1_score, precision_score, recall_score,
    accuracy_score, mean_squared_error, mean_absolute_error,
)
from sklearn.preprocessing import StandardScaler, LabelEncoder

import pandas as pd


# ── Loss Functions ────────────────────────────────────────────────────────────

class FocalLoss(nn.Module):
    """Focal Loss for handling class imbalance in fraud/churn detection."""

    def __init__(self, alpha: float = 0.25, gamma: float = 2.0) -> None:
        super().__init__()
        self.alpha = alpha
        self.gamma = gamma

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        bce = F.binary_cross_entropy_with_logits(logits, targets, reduction="none")
        pt = torch.exp(-bce)
        focal_weight = self.alpha * (1 - pt) ** self.gamma
        return (focal_weight * bce).mean()


class MultiTaskLoss(nn.Module):
    """Multi-task loss combining classification + regression."""

    def __init__(self, cls_weight: float = 1.0, reg_weight: float = 0.5) -> None:
        super().__init__()
        self.cls_weight = cls_weight
        self.reg_weight = reg_weight

    def forward(
        self,
        cls_logits: torch.Tensor,
        cls_targets: torch.Tensor,
        reg_pred: torch.Tensor,
        reg_targets: torch.Tensor,
    ) -> torch.Tensor:
        cls_loss = F.cross_entropy(cls_logits, cls_targets)
        reg_loss = F.mse_loss(reg_pred, reg_targets)
        return self.cls_weight * cls_loss + self.reg_weight * reg_loss


# ── Training Metrics ──────────────────────────────────────────────────────────

@dataclass
class TrainingMetrics:
    epoch: int = 0
    train_loss: float = 0.0
    val_loss: float = 0.0
    auc_roc: float = 0.0
    f1: float = 0.0
    precision: float = 0.0
    recall: float = 0.0
    accuracy: float = 0.0
    mse: float = 0.0
    mae: float = 0.0
    lr: float = 0.0
    elapsed_s: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {k: round(v, 6) if isinstance(v, float) else v for k, v in self.__dict__.items()}


@dataclass
class TrainingResult:
    model_name: str
    best_epoch: int = 0
    best_val_loss: float = float("inf")
    best_auc: float = 0.0
    best_f1: float = 0.0
    total_epochs: int = 0
    total_time_s: float = 0.0
    history: list[dict[str, Any]] = field(default_factory=list)
    feature_names: list[str] = field(default_factory=list)
    scaler_means: list[float] = field(default_factory=list)
    scaler_stds: list[float] = field(default_factory=list)

    def save_metadata(self, path: Path) -> None:
        with open(path, "w") as f:
            json.dump({
                "model_name": self.model_name,
                "best_epoch": self.best_epoch,
                "best_val_loss": self.best_val_loss,
                "best_auc": self.best_auc,
                "best_f1": self.best_f1,
                "total_epochs": self.total_epochs,
                "total_time_s": round(self.total_time_s, 2),
                "feature_names": self.feature_names,
                "scaler_means": [round(m, 6) for m in self.scaler_means],
                "scaler_stds": [round(s, 6) for s in self.scaler_stds],
                "history": self.history,
            }, f, indent=2)


# ── Data Preparation ──────────────────────────────────────────────────────────

def prepare_binary_classification_data(
    df: pd.DataFrame,
    feature_cols: list[str],
    target_col: str,
    categorical_cols: list[str] | None = None,
    val_split: float = 0.15,
    test_split: float = 0.15,
    batch_size: int = 512,
) -> tuple[DataLoader, DataLoader, DataLoader, StandardScaler, dict[str, LabelEncoder]]:
    """Prepare data loaders for binary classification tasks."""
    cat_encoders: dict[str, LabelEncoder] = {}

    # Encode categoricals
    if categorical_cols:
        for col in categorical_cols:
            le = LabelEncoder()
            df[col] = le.fit_transform(df[col].astype(str))
            cat_encoders[col] = le

    X = df[feature_cols].values.astype(np.float32)
    y = df[target_col].values.astype(np.float32)

    # Scale features
    scaler = StandardScaler()
    X = scaler.fit_transform(X).astype(np.float32)

    X_t = torch.from_numpy(X)
    y_t = torch.from_numpy(y)

    dataset = TensorDataset(X_t, y_t)
    n = len(dataset)
    n_test = int(n * test_split)
    n_val = int(n * val_split)
    n_train = n - n_val - n_test

    train_ds, val_ds, test_ds = random_split(
        dataset, [n_train, n_val, n_test],
        generator=torch.Generator().manual_seed(42),
    )

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, drop_last=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size * 2, shuffle=False)
    test_loader = DataLoader(test_ds, batch_size=batch_size * 2, shuffle=False)

    return train_loader, val_loader, test_loader, scaler, cat_encoders


def prepare_multitask_data(
    df: pd.DataFrame,
    feature_cols: list[str],
    cls_target_col: str,
    reg_target_col: str,
    val_split: float = 0.15,
    test_split: float = 0.15,
    batch_size: int = 512,
) -> tuple[DataLoader, DataLoader, DataLoader, StandardScaler, LabelEncoder]:
    """Prepare data for multi-task (classification + regression)."""
    le = LabelEncoder()
    cls_targets = le.fit_transform(df[cls_target_col].values)

    X = df[feature_cols].values.astype(np.float32)
    y_cls = cls_targets.astype(np.int64)
    y_reg = df[reg_target_col].values.astype(np.float32)

    scaler = StandardScaler()
    X = scaler.fit_transform(X).astype(np.float32)

    X_t = torch.from_numpy(X)
    y_cls_t = torch.from_numpy(y_cls)
    y_reg_t = torch.from_numpy(y_reg)

    dataset = TensorDataset(X_t, y_cls_t, y_reg_t)
    n = len(dataset)
    n_test = int(n * test_split)
    n_val = int(n * val_split)
    n_train = n - n_val - n_test

    train_ds, val_ds, test_ds = random_split(
        dataset, [n_train, n_val, n_test],
        generator=torch.Generator().manual_seed(42),
    )

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, drop_last=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size * 2, shuffle=False)
    test_loader = DataLoader(test_ds, batch_size=batch_size * 2, shuffle=False)

    return train_loader, val_loader, test_loader, scaler, le


# ── Training Loops ────────────────────────────────────────────────────────────

def train_binary_classifier(
    model: nn.Module,
    train_loader: DataLoader,
    val_loader: DataLoader,
    n_epochs: int = 50,
    lr: float = 1e-3,
    weight_decay: float = 1e-4,
    patience: int = 10,
    model_name: str = "model",
    save_dir: Path = Path("weights"),
    use_focal_loss: bool = True,
    focal_alpha: float = 0.25,
    focal_gamma: float = 2.0,
) -> TrainingResult:
    """Full training loop for binary classification with early stopping."""
    save_dir.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")  # CPU inference as required
    model = model.to(device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=lr * 3, epochs=n_epochs,
        steps_per_epoch=len(train_loader), pct_start=0.2,
    )

    criterion = FocalLoss(focal_alpha, focal_gamma) if use_focal_loss else nn.BCEWithLogitsLoss()

    result = TrainingResult(model_name=model_name)
    best_val_loss = float("inf")
    patience_counter = 0
    start_time = time.time()

    for epoch in range(1, n_epochs + 1):
        epoch_start = time.time()

        # ── Train ──
        model.train()
        train_losses: list[float] = []
        for X_batch, y_batch in train_loader:
            X_batch, y_batch = X_batch.to(device), y_batch.to(device)
            optimizer.zero_grad()
            logits = model(X_batch)
            loss = criterion(logits, y_batch)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            train_losses.append(loss.item())

        # ── Validate ──
        model.eval()
        val_losses: list[float] = []
        all_preds: list[np.ndarray] = []
        all_targets: list[np.ndarray] = []

        with torch.no_grad():
            for X_batch, y_batch in val_loader:
                X_batch, y_batch = X_batch.to(device), y_batch.to(device)
                logits = model(X_batch)
                loss = criterion(logits, y_batch)
                val_losses.append(loss.item())
                probs = torch.sigmoid(logits).cpu().numpy()
                all_preds.append(probs)
                all_targets.append(y_batch.cpu().numpy())

        preds = np.concatenate(all_preds)
        targets = np.concatenate(all_targets)
        binary_preds = (preds >= 0.5).astype(int)

        metrics = TrainingMetrics(
            epoch=epoch,
            train_loss=float(np.mean(train_losses)),
            val_loss=float(np.mean(val_losses)),
            auc_roc=float(roc_auc_score(targets, preds)) if len(np.unique(targets)) > 1 else 0.0,
            f1=float(f1_score(targets, binary_preds, zero_division=0)),
            precision=float(precision_score(targets, binary_preds, zero_division=0)),
            recall=float(recall_score(targets, binary_preds, zero_division=0)),
            accuracy=float(accuracy_score(targets, binary_preds)),
            lr=optimizer.param_groups[0]["lr"],
            elapsed_s=time.time() - epoch_start,
        )
        result.history.append(metrics.to_dict())

        print(
            f"  [{model_name}] Epoch {epoch:3d}/{n_epochs} | "
            f"train_loss={metrics.train_loss:.4f} val_loss={metrics.val_loss:.4f} | "
            f"AUC={metrics.auc_roc:.4f} F1={metrics.f1:.4f} | "
            f"lr={metrics.lr:.2e}"
        )

        # ── Checkpointing ──
        if metrics.val_loss < best_val_loss:
            best_val_loss = metrics.val_loss
            patience_counter = 0
            result.best_epoch = epoch
            result.best_val_loss = metrics.val_loss
            result.best_auc = metrics.auc_roc
            result.best_f1 = metrics.f1
            torch.save(model.state_dict(), save_dir / f"{model_name}.pt")
        else:
            patience_counter += 1
            if patience_counter >= patience:
                print(f"  [{model_name}] Early stopping at epoch {epoch}")
                break

    result.total_epochs = epoch
    result.total_time_s = time.time() - start_time

    # Load best checkpoint
    model.load_state_dict(torch.load(save_dir / f"{model_name}.pt", weights_only=True))
    print(
        f"  [{model_name}] Training complete: best_epoch={result.best_epoch} "
        f"AUC={result.best_auc:.4f} F1={result.best_f1:.4f} "
        f"time={result.total_time_s:.1f}s"
    )

    return result


def train_multitask_model(
    model: nn.Module,
    train_loader: DataLoader,
    val_loader: DataLoader,
    n_epochs: int = 50,
    lr: float = 1e-3,
    weight_decay: float = 1e-4,
    patience: int = 10,
    model_name: str = "model",
    save_dir: Path = Path("weights"),
    cls_weight: float = 1.0,
    reg_weight: float = 0.5,
) -> TrainingResult:
    """Training loop for multi-task (classification + regression)."""
    save_dir.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")
    model = model.to(device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=lr * 3, epochs=n_epochs,
        steps_per_epoch=len(train_loader), pct_start=0.2,
    )

    criterion = MultiTaskLoss(cls_weight, reg_weight)
    result = TrainingResult(model_name=model_name)
    best_val_loss = float("inf")
    patience_counter = 0
    start_time = time.time()

    for epoch in range(1, n_epochs + 1):
        epoch_start = time.time()

        model.train()
        train_losses: list[float] = []
        for X_batch, y_cls_batch, y_reg_batch in train_loader:
            X_batch = X_batch.to(device)
            y_cls_batch = y_cls_batch.to(device)
            y_reg_batch = y_reg_batch.to(device)

            optimizer.zero_grad()
            cls_logits, reg_pred = model(X_batch)
            loss = criterion(cls_logits, y_cls_batch, reg_pred, y_reg_batch)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            train_losses.append(loss.item())

        model.eval()
        val_losses: list[float] = []
        all_cls_preds: list[np.ndarray] = []
        all_cls_targets: list[np.ndarray] = []
        all_reg_preds: list[np.ndarray] = []
        all_reg_targets: list[np.ndarray] = []

        with torch.no_grad():
            for X_batch, y_cls_batch, y_reg_batch in val_loader:
                X_batch = X_batch.to(device)
                y_cls_batch = y_cls_batch.to(device)
                y_reg_batch = y_reg_batch.to(device)

                cls_logits, reg_pred = model(X_batch)
                loss = criterion(cls_logits, y_cls_batch, reg_pred, y_reg_batch)
                val_losses.append(loss.item())

                cls_pred = torch.argmax(cls_logits, dim=-1).cpu().numpy()
                all_cls_preds.append(cls_pred)
                all_cls_targets.append(y_cls_batch.cpu().numpy())
                all_reg_preds.append(reg_pred.cpu().numpy())
                all_reg_targets.append(y_reg_batch.cpu().numpy())

        cls_preds = np.concatenate(all_cls_preds)
        cls_targets = np.concatenate(all_cls_targets)
        reg_preds = np.concatenate(all_reg_preds)
        reg_targets = np.concatenate(all_reg_targets)

        metrics = TrainingMetrics(
            epoch=epoch,
            train_loss=float(np.mean(train_losses)),
            val_loss=float(np.mean(val_losses)),
            f1=float(f1_score(cls_targets, cls_preds, average="weighted", zero_division=0)),
            accuracy=float(accuracy_score(cls_targets, cls_preds)),
            mse=float(mean_squared_error(reg_targets, reg_preds)),
            mae=float(mean_absolute_error(reg_targets, reg_preds)),
            lr=optimizer.param_groups[0]["lr"],
            elapsed_s=time.time() - epoch_start,
        )
        result.history.append(metrics.to_dict())

        print(
            f"  [{model_name}] Epoch {epoch:3d}/{n_epochs} | "
            f"train_loss={metrics.train_loss:.4f} val_loss={metrics.val_loss:.4f} | "
            f"F1={metrics.f1:.4f} acc={metrics.accuracy:.4f} MAE={metrics.mae:.4f}"
        )

        if metrics.val_loss < best_val_loss:
            best_val_loss = metrics.val_loss
            patience_counter = 0
            result.best_epoch = epoch
            result.best_val_loss = metrics.val_loss
            result.best_f1 = metrics.f1
            torch.save(model.state_dict(), save_dir / f"{model_name}.pt")
        else:
            patience_counter += 1
            if patience_counter >= patience:
                print(f"  [{model_name}] Early stopping at epoch {epoch}")
                break

    result.total_epochs = epoch
    result.total_time_s = time.time() - start_time
    model.load_state_dict(torch.load(save_dir / f"{model_name}.pt", weights_only=True))

    return result


def train_vae(
    model: nn.Module,
    train_loader: DataLoader,
    val_loader: DataLoader,
    n_epochs: int = 40,
    lr: float = 1e-3,
    weight_decay: float = 1e-5,
    patience: int = 8,
    beta: float = 0.5,
    model_name: str = "vae",
    save_dir: Path = Path("weights"),
) -> TrainingResult:
    """Training loop for VAE anomaly detection."""
    save_dir.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")
    model = model.to(device)

    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="min", factor=0.5, patience=5,
    )

    result = TrainingResult(model_name=model_name)
    best_val_loss = float("inf")
    patience_counter = 0
    start_time = time.time()

    for epoch in range(1, n_epochs + 1):
        epoch_start = time.time()

        model.train()
        train_losses: list[float] = []
        for batch in train_loader:
            X_batch = batch[0].to(device)
            optimizer.zero_grad()
            x_recon, mu, logvar = model(X_batch)
            # Use input_bn output as reconstruction target
            with torch.no_grad():
                x_normed = model.input_bn(X_batch)
            loss = model.vae_loss(x_normed, x_recon, mu, logvar, beta)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            train_losses.append(loss.item())

        model.eval()
        val_losses: list[float] = []
        with torch.no_grad():
            for batch in val_loader:
                X_batch = batch[0].to(device)
                x_recon, mu, logvar = model(X_batch)
                x_normed = model.input_bn(X_batch)
                loss = model.vae_loss(x_normed, x_recon, mu, logvar, beta)
                val_losses.append(loss.item())

        avg_val = float(np.mean(val_losses))
        scheduler.step(avg_val)

        metrics = TrainingMetrics(
            epoch=epoch,
            train_loss=float(np.mean(train_losses)),
            val_loss=avg_val,
            lr=optimizer.param_groups[0]["lr"],
            elapsed_s=time.time() - epoch_start,
        )
        result.history.append(metrics.to_dict())

        print(
            f"  [{model_name}] Epoch {epoch:3d}/{n_epochs} | "
            f"train_loss={metrics.train_loss:.4f} val_loss={metrics.val_loss:.4f} | "
            f"lr={metrics.lr:.2e}"
        )

        if avg_val < best_val_loss:
            best_val_loss = avg_val
            patience_counter = 0
            result.best_epoch = epoch
            result.best_val_loss = avg_val
            torch.save(model.state_dict(), save_dir / f"{model_name}.pt")
        else:
            patience_counter += 1
            if patience_counter >= patience:
                print(f"  [{model_name}] Early stopping at epoch {epoch}")
                break

    result.total_epochs = epoch
    result.total_time_s = time.time() - start_time
    model.load_state_dict(torch.load(save_dir / f"{model_name}.pt", weights_only=True))

    return result
