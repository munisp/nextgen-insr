"""Capital adapter tests. No MC math in Python — the adapter delegates to
actuary_kernels_py (PyO3) when importable, else the documented HTTP batch
client boundary. Tests use an httpx.MockTransport wire double at the HTTP
boundary (explicitly permitted); PyO3-path tests use a stand-in module
only to verify marshalling/selection, never compute assertions."""

import json

import httpx
import pytest

from actuary_analytics.capital import (
    CapitalBackendUnavailableError,
    LineSimSpec,
    PricingServiceBatchClient,
    get_backend,
    simulate_aggregate,
)
from actuary_analytics.capital.client import CAPITAL_BATCH_PATH

LINES = [
    LineSimSpec(line="motor", freq_dist="poisson", freq_params={"lambda": 0.15},
                sev_dist="gamma", sev_params={"shape": 4.0, "scale": 25000.0}),
    LineSimSpec(line="fire_property", freq_dist="poisson", freq_params={"lambda": 0.02},
                sev_dist="lognormal", sev_params={"mu": 12.5, "sigma": 1.1}),
]
CORR = [[1.0, 0.3], [0.3, 1.0]]


def _mock_transport(status=200, body=None):
    body = body or {"var_995": 12.5e6, "tvar_99": 9.1e6, "mean": 1.2e6,
                    "per_line_tvar": {"motor": 5.0e6, "fire_property": 4.1e6}}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == CAPITAL_BATCH_PATH
        payload = json.loads(request.content.decode())
        assert payload["nPaths"] == 1000
        assert payload["seed"] == 7
        assert len(payload["lines"]) == 2
        return httpx.Response(status, json=body)

    return httpx.MockTransport(handler)


class TestBackendSelection:
    def test_http_backend_when_pyo3_absent(self):
        backend = get_backend(
            pricing_service_url="http://pricing:7080", http_transport=_mock_transport()
        )
        assert isinstance(backend, PricingServiceBatchClient)

    def test_fail_closed_when_no_backend(self, monkeypatch):
        monkeypatch.delenv("PRICING_SERVICE_URL", raising=False)
        with pytest.raises(CapitalBackendUnavailableError):
            get_backend()

    def test_client_requires_base_url(self):
        with pytest.raises(CapitalBackendUnavailableError):
            PricingServiceBatchClient("")


class TestHttpBatchClient:
    def test_simulate_normalizes_result(self):
        client = PricingServiceBatchClient(
            "http://pricing:7080", transport=_mock_transport(), max_retries=0
        )
        result = simulate_aggregate(LINES, CORR, 1000, 7, backend=client)
        assert result.backend == "http_batch"
        assert result.var_995 == 12.5e6
        assert result.tvar_99 == 9.1e6
        assert result.per_line_tvar == {"motor": 5.0e6, "fire_property": 4.1e6}

    def test_wire_payload_uses_dist_codes(self):
        recorded = {}

        def handler(request: httpx.Request) -> httpx.Response:
            recorded.update(json.loads(request.content.decode()))
            return httpx.Response(200, json={"var_995": 1.0, "tvar_99": 1.0, "mean": 1.0})

        client = PricingServiceBatchClient(
            "http://pricing:7080", transport=httpx.MockTransport(handler), max_retries=0
        )
        simulate_aggregate(LINES, CORR, 1000, 7, backend=client)
        assert recorded["lines"][0]["freqDist"] == 0  # poisson
        assert recorded["lines"][0]["sevDist"] == 2  # gamma
        assert recorded["lines"][1]["sevDist"] == 3  # lognormal
        assert recorded["corr"] == CORR

    def test_retries_then_fails_closed(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(1)
            return httpx.Response(503, json={"error": "down"})

        client = PricingServiceBatchClient(
            "http://pricing:7080", transport=httpx.MockTransport(handler),
            max_retries=2, backoff_seconds=0.01,
        )
        with pytest.raises(CapitalBackendUnavailableError):
            simulate_aggregate(LINES, CORR, 1000, 7, backend=client)
        assert len(calls) == 3  # initial + 2 retries

    def test_malformed_response_fails_closed(self):
        client = PricingServiceBatchClient(
            "http://pricing:7080",
            transport=_mock_transport(body={"var_995": 1.0}),  # missing fields
            max_retries=0,
        )
        with pytest.raises(CapitalBackendUnavailableError):
            simulate_aggregate(LINES, CORR, 1000, 7, backend=client)


class TestPyo3Selection:
    def test_pyo3_module_preferred_when_supplied(self):
        """Backend selection prefers the kernels module; marshalling is
        verified with a stand-in that only records arguments (selection
        test — compute assertions live in W34-A's crate tests)."""

        class StandInKernels:
            def __init__(self):
                self.calls = []

            def montecarlo_aggregate(self, lines, corr, n_paths, seed):
                self.calls.append((lines, corr, n_paths, seed))
                return (10.0, 8.0, 1.0, [6.0, 2.0])

        kernels = StandInKernels()
        result = simulate_aggregate(LINES, CORR, 1000, 7, backend=kernels)
        assert result.backend == "pyo3"
        assert result.per_line_tvar == {"motor": 6.0, "fire_property": 2.0}
        lines_arg, corr_arg, n_paths, seed = kernels.calls[0]
        assert n_paths == 1000 and seed == 7
        assert lines_arg[0]["freqDist"] == 0  # wire codes match FFI contract
        assert corr_arg == [[1.0, 0.3], [0.3, 1.0]]

    def test_module_has_no_mc_math(self):
        """Guard: the Python capital package must contain no simulation
        implementation (design: single numeric implementation in Rust)."""
        import inspect

        import actuary_analytics.capital.backend as backend_mod
        import actuary_analytics.capital.client as client_mod

        banned = ("default_rng", "np.random.poisson", "np.random.gamma",
                  "np.random.normal", "numpy.random")
        for mod in (backend_mod, client_mod):
            src = inspect.getsource(mod)
            for token in banned:
                assert token not in src, f"{token} found in {mod.__name__}"
