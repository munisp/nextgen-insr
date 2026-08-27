# InsurePortal TigerBeetle Sidecar

The TB sidecar is a Go 1.22 HTTP microservice that is a **strict, transparent
proxy** in front of the configured TigerBeetle upstream. It serves the JSON
API consumed by `server/tbClient.ts`.

## Honesty posture (DD-TB remediation)

- **No canned responses.** Every request is forwarded to the upstream and the
  upstream's status code and body are returned unmodified. The previous
  implementation was a mock that always replied `"committed"` / `"synced"`
  without writing anything anywhere (and did not compile); that code is gone.
- **Fail-loud.** If `TIGERBEETLE_ADDRESS` is unset the process exits at
  startup. If the upstream is unreachable, `/health` returns 503 and
  money-path requests return 502 with an explicit "NOT committed" error —
  callers must treat that as "the ledger write did not happen".
- **No fabricated IDs.** Transfer/account IDs come from the upstream ledger
  or the caller, never from the wall clock.

## Configuration

| Variable              | Default | Meaning |
|-----------------------|---------|---------|
| `PORT`                | `7070`  | Listen port. |
| `TIGERBEETLE_ADDRESS` | —       | **Required.** Upstream address: an `http(s)://` URL of a TigerBeetle HTTP gateway, or a bare `host:port` of a raw TigerBeetle cluster. |
| `TB_ADDRESS`          | —       | Legacy alias for `TIGERBEETLE_ADDRESS`. |
| `UPSTREAM_TIMEOUT`    | `10s`   | Per-request upstream timeout. |
| `TB_REQUIRE_UPSTREAM` | `false` | If `true`, exit(1) at startup when the upstream probe fails. |

## Endpoints

- `GET /health` — 200 only when the upstream is reachable (503 otherwise,
  with the precise reason). HTTP upstreams are probed via `GET /health`;
  bare `host:port` upstreams are probed with a TCP dial.
- All other paths — transparently proxied to the upstream
  (`POST /transfers`, `POST /accounts`, `POST /accounts/batch`,
  `GET /agent/{id}/balance`, `GET /sync/status`, …).

## External dependency (not faked)

Stock TigerBeetle speaks the binary VSR protocol, not HTTP. When
`TIGERBEETLE_ADDRESS` points at a bare `host:port`, the sidecar can
health-probe the cluster but ledger operations return **501** until an
HTTP-speaking TigerBeetle gateway is provisioned and
`TIGERBEETLE_ADDRESS`/`TB_GATEWAY_URL` is pointed at it. Provisioning that
gateway (and the TigerBeetle cluster itself) is deployment infrastructure
outside this repository — the sidecar never pretends otherwise.

## Building

```bash
cd tb-sidecar
go build -o tb-sidecar .   # stdlib only, no module downloads
```

Or with Docker:

```bash
docker build -t insureportal-tb-sidecar ./tb-sidecar
```

Requires Go 1.22+.
