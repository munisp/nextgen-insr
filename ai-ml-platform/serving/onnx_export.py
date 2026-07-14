"""
ONNX Model Export and Serving

Exports trained PyTorch models to ONNX format for:
- CPU-optimized inference via ONNX Runtime
- Cross-platform deployment
- Quantization for edge devices
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn

try:
    import onnx
    import onnxruntime as ort
    HAS_ONNX = True
except ImportError:
    HAS_ONNX = False


def export_to_onnx(
    model: nn.Module,
    input_shape: tuple[int, ...],
    save_path: str | Path,
    model_name: str = "model",
    opset_version: int = 17,
) -> Path:
    """Export a PyTorch model to ONNX format."""
    save_path = Path(save_path)
    save_path.parent.mkdir(parents=True, exist_ok=True)

    model.eval()
    dummy_input = torch.randn(1, *input_shape)

    torch.onnx.export(
        model,
        dummy_input,
        str(save_path),
        export_params=True,
        opset_version=opset_version,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={
            "input": {0: "batch_size"},
            "output": {0: "batch_size"},
        },
    )

    print(f"  [ONNX] Exported {model_name} -> {save_path}")

    # Validate
    if HAS_ONNX:
        onnx_model = onnx.load(str(save_path))
        onnx.checker.check_model(onnx_model)
        print(f"  [ONNX] Validation passed for {model_name}")

    return save_path


class ONNXInferenceEngine:
    """ONNX Runtime inference engine for serving models."""

    def __init__(self, model_path: str | Path) -> None:
        if not HAS_ONNX:
            raise RuntimeError("onnxruntime not installed")

        self.model_path = Path(model_path)
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess_options.intra_op_num_threads = 4

        self.session = ort.InferenceSession(
            str(model_path),
            sess_options,
            providers=["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name
        self.output_names = [o.name for o in self.session.get_outputs()]

    def predict(self, features: np.ndarray) -> np.ndarray:
        """Run inference on a batch of features."""
        if features.ndim == 1:
            features = features.reshape(1, -1)
        features = features.astype(np.float32)

        outputs = self.session.run(
            self.output_names,
            {self.input_name: features},
        )
        return outputs[0]

    def predict_proba(self, features: np.ndarray) -> np.ndarray:
        """Return sigmoid probability for binary classification."""
        logits = self.predict(features)
        return 1.0 / (1.0 + np.exp(-logits))

    def benchmark(self, n_samples: int = 1000, input_dim: int = 22) -> dict[str, float]:
        """Benchmark inference latency."""
        import time
        dummy = np.random.randn(n_samples, input_dim).astype(np.float32)

        # Warmup
        self.predict(dummy[:10])

        # Benchmark
        start = time.time()
        self.predict(dummy)
        elapsed = time.time() - start

        return {
            "total_samples": n_samples,
            "total_time_ms": round(elapsed * 1000, 2),
            "per_sample_ms": round(elapsed * 1000 / n_samples, 4),
            "throughput_per_sec": round(n_samples / elapsed, 0),
        }


def export_all_models(
    weights_dir: Path,
    onnx_dir: Path,
    models_config: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Export all trained models to ONNX format."""
    onnx_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []

    for cfg in models_config:
        model_name = cfg["name"]
        model_class = cfg["class"]
        model_kwargs = cfg.get("kwargs", {})
        input_dim = cfg["input_dim"]
        weights_path = weights_dir / f"{model_name}.pt"

        if not weights_path.exists():
            print(f"  [ONNX] Skipping {model_name} — no weights at {weights_path}")
            continue

        try:
            model = model_class(**model_kwargs)
            model.load_state_dict(torch.load(weights_path, weights_only=True))
            model.eval()

            onnx_path = export_to_onnx(
                model, (input_dim,), onnx_dir / f"{model_name}.onnx",
                model_name=model_name,
            )

            # Benchmark
            if HAS_ONNX:
                engine = ONNXInferenceEngine(onnx_path)
                bench = engine.benchmark(n_samples=1000, input_dim=input_dim)
                results.append({
                    "model_name": model_name,
                    "onnx_path": str(onnx_path),
                    "benchmark": bench,
                    "status": "success",
                })
            else:
                results.append({
                    "model_name": model_name,
                    "onnx_path": str(onnx_path),
                    "status": "exported_no_benchmark",
                })
        except Exception as e:
            print(f"  [ONNX] Failed to export {model_name}: {e}")
            results.append({
                "model_name": model_name,
                "status": "failed",
                "error": str(e),
            })

    return results
