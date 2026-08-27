// tb-sidecar — TigerBeetle ledger sidecar for the insurance platform.
//
// HONESTY POSTURE (DD-TB remediation):
// This service is a strict, transparent HTTP proxy in front of a configured
// TigerBeetle upstream. It contains NO canned responses, NO fabricated
// transfer IDs, and NO mock "committed" replies. Every money-path request is
// forwarded to the upstream verbatim and the upstream's status code and body
// are returned unmodified. If the upstream is unreachable the sidecar fails
// LOUD (502 Bad Gateway / 503 on /health) — callers must treat any
// non-2xx as "the ledger write did NOT happen".
//
// Configuration:
//   PORT                  — listen port (default 7070)
//   TIGERBEETLE_ADDRESS   — upstream address. Either an HTTP(S) URL
//                           (e.g. http://tb-gateway:3000) serving the TB JSON
//                           API, or a bare host:port for a raw TigerBeetle
//                           cluster (binary VSR protocol). REQUIRED — the
//                           process exits at startup if unset.
//   TB_ADDRESS            — legacy alias for TIGERBEETLE_ADDRESS.
//   UPSTREAM_TIMEOUT      — per-request upstream timeout (default 10s)
//   TB_REQUIRE_UPSTREAM   — if "true", exit(1) at startup when the upstream
//                           probe fails (default "false": start, but /health
//                           reports 503 until the upstream is reachable).
//
// EXTERNAL DEPENDENCY (not faked here): a provisioned TigerBeetle cluster
// fronted by an HTTP gateway that implements the TB JSON API consumed by
// server/tbClient.ts (POST /transfers, POST /accounts, POST /accounts/batch,
// GET /agent/{id}/balance, GET /sync/status). Stock TigerBeetle speaks the
// binary VSR protocol only; when TIGERBEETLE_ADDRESS points at a bare
// host:port the sidecar can health-probe it (TCP dial) but transfer requests
// return 501 until an HTTP-speaking gateway is provisioned.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	defaultPort            = "7070"
	defaultUpstreamTimeout = 10 * time.Second
	healthProbeTimeout     = 3 * time.Second
	maxRequestBody         = 1 << 20 // 1 MiB — ledger payloads are tiny
)

// upstream is the resolved TigerBeetle upstream configuration.
type upstream struct {
	raw     string   // as configured
	httpURL *url.URL // non-nil when the upstream speaks HTTP
}

// isHTTP reports whether the upstream is an HTTP(S) gateway.
func (u *upstream) isHTTP() bool { return u.httpURL != nil }

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.SetPrefix("[tb-sidecar] ")

	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	up, err := resolveUpstream()
	if err != nil {
		// Fail-loud: a ledger sidecar with no ledger upstream must not run.
		log.Fatalf("FATAL: %v", err)
	}

	timeout := defaultUpstreamTimeout
	if raw := os.Getenv("UPSTREAM_TIMEOUT"); raw != "" {
		if d, perr := time.ParseDuration(raw); perr == nil && d > 0 {
			timeout = d
		} else {
			log.Printf("WARN: invalid UPSTREAM_TIMEOUT %q — using %s", raw, defaultUpstreamTimeout)
		}
	}

	s := &server{
		up:     up,
		client: &http.Client{Timeout: timeout},
	}

	// Startup probe: never silent about upstream state.
	if err := s.probeUpstream(); err != nil {
		if strings.EqualFold(os.Getenv("TB_REQUIRE_UPSTREAM"), "true") {
			log.Fatalf("FATAL: TigerBeetle upstream %q unreachable at startup (TB_REQUIRE_UPSTREAM=true): %v", up.raw, err)
		}
		log.Printf("WARN: TigerBeetle upstream %q unreachable at startup: %v — /health will report 503 and money-path requests will fail until it is reachable", up.raw, err)
	} else {
		log.Printf("TigerBeetle upstream %q reachable (mode=%s)", up.raw, s.mode())
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.healthHandler)
	// Everything else is a transparent proxy to the upstream.
	mux.HandleFunc("/", s.proxyHandler)

	log.Printf("listening on :%s — proxying to TigerBeetle upstream %q", port, up.raw)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

// server holds the proxy state.
type server struct {
	up     *upstream
	client *http.Client
}

func (s *server) mode() string {
	if s.up.isHTTP() {
		return "http-forward"
	}
	return "tcp-probe-only (binary VSR upstream — money paths return 501 until an HTTP gateway is configured)"
}

// resolveUpstream reads and validates the upstream configuration.
func resolveUpstream() (*upstream, error) {
	raw := strings.TrimSpace(os.Getenv("TIGERBEETLE_ADDRESS"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("TB_ADDRESS"))
	}
	if raw == "" {
		return nil, fmt.Errorf("TIGERBEETLE_ADDRESS is not set — refusing to start a ledger sidecar with no ledger upstream")
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" {
			return nil, fmt.Errorf("invalid TIGERBEETLE_ADDRESS %q: %v", raw, err)
		}
		u.Path = strings.TrimSuffix(u.Path, "/")
		return &upstream{raw: raw, httpURL: u}, nil
	}
	// Bare host:port (optionally tcp://-prefixed) — raw TigerBeetle binary endpoint.
	raw = strings.TrimPrefix(raw, "tcp://")
	if _, _, err := net.SplitHostPort(raw); err != nil {
		return nil, fmt.Errorf("invalid TIGERBEETLE_ADDRESS %q: expected http(s)://host:port or host:port (%v)", raw, err)
	}
	return &upstream{raw: raw}, nil
}

// probeUpstream checks upstream liveness.
//   - HTTP upstream: GET /health (any response < 500 counts as reachable).
//   - Bare host:port: TCP dial (the cluster port accepting connections is the
//     only honest liveness signal available without the TB binary client).
func (s *server) probeUpstream() error {
	if s.up.isHTTP() {
		ctx, cancel := context.WithTimeout(context.Background(), healthProbeTimeout)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.up.httpURL.String()+"/health", nil)
		if err != nil {
			return err
		}
		resp, err := s.client.Do(req)
		if err != nil {
			return err
		}
		_ = resp.Body.Close()
		if resp.StatusCode >= 500 {
			return fmt.Errorf("upstream /health returned %d", resp.StatusCode)
		}
		return nil
	}
	conn, err := net.DialTimeout("tcp", s.up.raw, healthProbeTimeout)
	if err != nil {
		return err
	}
	_ = conn.Close()
	return nil
}

// healthHandler reports real upstream reachability. 200 only when the
// upstream answers; otherwise 503 with the precise reason.
func (s *server) healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if err := s.probeUpstream(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status":   "unhealthy",
			"upstream": s.up.raw,
			"mode":     s.mode(),
			"error":    err.Error(),
		})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "ok",
		"upstream": s.up.raw,
		"mode":     s.mode(),
	})
}

// proxyHandler transparently forwards the request to the upstream.
// No response is ever synthesized here: the upstream's status code, content
// type and body are passed through byte-for-byte. Failures are 5xx with an
// honest error body — never a fabricated success.
func (s *server) proxyHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !s.up.isHTTP() {
		// The upstream is a raw TigerBeetle binary endpoint. We can probe it
		// for health but cannot speak the VSR protocol without the TB client
		// library (excluded by the no-new-deps constraint). Fail loud.
		w.WriteHeader(http.StatusNotImplemented)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"error":    "TigerBeetle upstream is a raw binary endpoint; an HTTP-speaking TB gateway is required for ledger operations",
			"upstream": s.up.raw,
			"hint":     "set TIGERBEETLE_ADDRESS to an http(s):// URL of a TigerBeetle HTTP gateway",
		})
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBody))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "failed to read request body: " + err.Error()})
		return
	}
	_ = r.Body.Close()

	target := s.up.httpURL.String() + r.URL.Path
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.client.Timeout)
	defer cancel()
	upReq, err := http.NewRequestWithContext(ctx, r.Method, target, bytes.NewReader(body))
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "failed to build upstream request: " + err.Error()})
		return
	}
	upReq.Header = r.Header.Clone()
	upReq.Header.Del("Connection")
	upReq.Header.Del("Keep-Alive")
	upReq.ContentLength = int64(len(body))

	resp, err := s.client.Do(upReq)
	if err != nil {
		// Fail-loud: the ledger write did NOT happen.
		log.Printf("ERROR: upstream %s %s failed: %v", r.Method, r.URL.Path, err)
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error":    "TigerBeetle upstream unreachable — ledger operation NOT committed",
			"upstream": s.up.raw,
			"detail":   err.Error(),
		})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "failed to read upstream response: " + err.Error()})
		return
	}

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBody)

	if resp.StatusCode >= 400 {
		log.Printf("WARN: upstream %s %s rejected with %d: %s", r.Method, r.URL.Path, resp.StatusCode, truncate(respBody, 300))
	}
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "…"
}
