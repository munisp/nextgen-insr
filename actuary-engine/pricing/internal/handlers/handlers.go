// Package handlers is the HTTP surface of the pricing service (Appendix D
// endpoints), following the reinsurance-management layout conventions:
// net/http ServeMux with Go 1.22 pattern routes, writeJSON/writeError
// helpers, thin handlers delegating to the service package.
//
// AuthN/Z posture (Appendix D/G): the platform gateway (APISix + Keycloak)
// validates JWTs; this service enforces role claims on the two admin
// endpoints via the gateway-injected X-Actuary-Roles header, and can
// authenticate the caller itself with the service-to-service HMAC scheme
// Leg D implements (X-Actuary-Timestamp + X-Actuary-Signature =
// hex(HMAC-SHA256(secret, ts + "." + body))) when PRICING_HMAC_SECRET is
// set. Without the secret the service runs in trusted-gateway mode (dev).
package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/unified-insurance/actuary-engine/pricing/internal/models"
	"github.com/unified-insurance/actuary-engine/pricing/internal/observability"
	"github.com/unified-insurance/actuary-engine/pricing/internal/reinsurance"
	"github.com/unified-insurance/actuary-engine/pricing/internal/repository"
	"github.com/unified-insurance/actuary-engine/pricing/internal/service"
)

// Handler is the HTTP front of the service.
type Handler struct {
	svc       *service.Service
	metrics   *observability.Registry
	hmacKey   []byte
	hmacSkew  time.Duration
	readiness func() (bool, map[string]string)
}

// New builds the handler. hmacSecret "" disables request authentication
// (trusted-gateway dev mode).
func New(svc *service.Service, metrics *observability.Registry, hmacSecret string, readiness func() (bool, map[string]string)) *Handler {
	h := &Handler{
		svc: svc, metrics: metrics, hmacSkew: 5 * time.Minute,
		readiness: readiness,
	}
	if hmacSecret != "" {
		h.hmacKey = []byte(hmacSecret)
	}
	return h
}

// RegisterRoutes wires the Appendix D endpoints (plus the documented Leg B
// adequacy-callback extension and the probes/metrics surface).
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	authed := func(fn http.HandlerFunc) http.HandlerFunc {
		return h.requireHMAC(fn)
	}
	mux.HandleFunc("POST /v1/rate", authed(h.rate))
	mux.HandleFunc("GET /v1/rate/versions", authed(h.rateVersions))
	mux.HandleFunc("POST /v1/rate/versions/{id}/activate", authed(h.requireRole(h.activateRateVersion, "actuary_admin")))
	mux.HandleFunc("GET /v1/accumulation/{line}/{geoCell}", authed(h.accumulation))
	mux.HandleFunc("POST /v1/exposure/check", authed(h.exposureCheck))
	mux.HandleFunc("GET /v1/referrals", authed(h.listReferrals))
	mux.HandleFunc("POST /v1/referrals/{id}/decide", authed(h.requireRole(h.decideReferral, "underwriter", "actuary")))
	mux.HandleFunc("POST /v1/capital/summary", authed(h.capitalSummary))
	mux.HandleFunc("POST /v1/reinsurance/evaluate", authed(h.reinsuranceEvaluate))
	mux.HandleFunc("POST /v1/adequacy/evaluate", authed(h.adequacyEvaluate))
	mux.HandleFunc("GET /healthz", h.healthz)
	mux.HandleFunc("GET /readyz", h.readyz)
	mux.HandleFunc("GET /metrics", h.metrics.Handler().ServeHTTP)
}

// ─── middleware ────────────────────────────────────────────────────────────

// requireHMAC enforces the service-to-service signature when configured.
// Verification is fail-closed: missing/invalid signature → 401.
func (h *Handler) requireHMAC(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.hmacKey == nil {
			next(w, r)
			return
		}
		ts := r.Header.Get("X-Actuary-Timestamp")
		sig := r.Header.Get("X-Actuary-Signature")
		if ts == "" || sig == "" {
			writeError(w, http.StatusUnauthorized, "missing signature headers")
			return
		}
		sec, err := strconv.ParseInt(ts, 10, 64)
		if err != nil || time.Since(time.Unix(sec, 0)) > h.hmacSkew || time.Until(time.Unix(sec, 0)) > h.hmacSkew {
			writeError(w, http.StatusUnauthorized, "stale or malformed timestamp")
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeError(w, http.StatusBadRequest, "unreadable body")
			return
		}
		r.Body = io.NopCloser(strings.NewReader(string(body)))
		mac := hmac.New(sha256.New, h.hmacKey)
		mac.Write([]byte(ts + "."))
		mac.Write(body)
		want := mac.Sum(nil)
		got, err := hex.DecodeString(sig)
		if err != nil || !hmac.Equal(got, want) {
			writeError(w, http.StatusUnauthorized, "invalid signature")
			return
		}
		next(w, r)
	}
}

// requireRole enforces gateway-injected role claims on admin endpoints.
// The gateway (APISix) validates the JWT and forwards the claims; absent
// claims → 401, insufficient role → 403 (fail-closed both ways).
func (h *Handler) requireRole(next http.HandlerFunc, roles ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := r.Header.Get("X-Actuary-Roles")
		if claims == "" {
			writeError(w, http.StatusUnauthorized, "role claims required")
			return
		}
		have := map[string]bool{}
		for _, c := range strings.Split(claims, ",") {
			have[strings.TrimSpace(c)] = true
		}
		for _, want := range roles {
			if have[want] {
				next(w, r)
				return
			}
		}
		writeError(w, http.StatusForbidden, "insufficient role: want one of "+strings.Join(roles, ","))
	}
}

// ─── endpoint handlers ─────────────────────────────────────────────────────

func (h *Handler) rate(w http.ResponseWriter, r *http.Request) {
	var req models.RateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "body is not valid JSON: "+err.Error())
		return
	}
	resp, err := h.svc.Rate(r.Context(), req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidInput):
			writeError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, service.ErrUnknownLine):
			writeError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, service.ErrNoRateVersion):
			// Fail-closed contract: 503, never a fabricated premium
			// (product-builder treats this as pricing-unavailable, §7.1).
			writeError(w, http.StatusServiceUnavailable, err.Error())
		case errors.Is(err, service.ErrNotReady):
			writeError(w, http.StatusServiceUnavailable, err.Error())
		default:
			log.Printf("ERROR: rate failed: %v", err)
			writeError(w, http.StatusInternalServerError, "rating failed")
		}
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) rateVersions(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.RateVersions(r.URL.Query().Get("line"))
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handler) activateRateVersion(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "id must be numeric")
		return
	}
	if err := h.svc.ActivateRateVersion(r.Context(), id); err != nil {
		switch {
		case errors.Is(err, repository.ErrNotFound):
			writeError(w, http.StatusNotFound, err.Error())
		case errors.Is(err, repository.ErrConflict):
			writeError(w, http.StatusConflict, err.Error())
		default:
			log.Printf("ERROR: activate version %d: %v", id, err)
			writeError(w, http.StatusInternalServerError, "activation failed")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "approved"})
}

func (h *Handler) accumulation(w http.ResponseWriter, r *http.Request) {
	cell, err := h.svc.Accumulation(r.Context(), r.PathValue("line"), r.PathValue("geoCell"))
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cell)
}

func (h *Handler) exposureCheck(w http.ResponseWriter, r *http.Request) {
	var req models.ExposureCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "body is not valid JSON: "+err.Error())
		return
	}
	resp, err := h.svc.ExposureCheck(r.Context(), req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidInput), errors.Is(err, service.ErrUnknownLine):
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			writeError(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) listReferrals(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Repo.ListReferrals(r.Context(), r.URL.Query().Get("status"))
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handler) decideReferral(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "id must be numeric")
		return
	}
	var body struct {
		Decision      string `json:"decision"` // accepted | declined
		UnderwriterID *int64 `json:"underwriterId,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "body is not valid JSON: "+err.Error())
		return
	}
	if body.Decision != "accepted" && body.Decision != "declined" {
		writeError(w, http.StatusBadRequest, "decision must be accepted|declined")
		return
	}
	if err := h.svc.Repo.DecideReferral(r.Context(), id, body.Decision, body.UnderwriterID); err != nil {
		switch {
		case errors.Is(err, repository.ErrNotFound):
			writeError(w, http.StatusNotFound, err.Error())
		case errors.Is(err, repository.ErrConflict):
			writeError(w, http.StatusConflict, err.Error())
		default:
			log.Printf("ERROR: decide referral %d: %v", id, err)
			writeError(w, http.StatusInternalServerError, "decide failed")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": body.Decision})
}

func (h *Handler) capitalSummary(w http.ResponseWriter, r *http.Request) {
	summary, err := h.svc.CapitalSummary(r.Context())
	if err != nil {
		if errors.Is(err, service.ErrNotFound) {
			writeError(w, http.StatusNotFound, "no approved capital run")
			return
		}
		log.Printf("ERROR: capital summary: %v", err)
		writeError(w, http.StatusServiceUnavailable, "capital summary unavailable")
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (h *Handler) reinsuranceEvaluate(w http.ResponseWriter, r *http.Request) {
	var req reinsurance.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "body is not valid JSON: "+err.Error())
		return
	}
	resp, err := h.svc.ReinsuranceEvaluate(r.Context(), req)
	if err != nil {
		// Kernel failures are client-visible input/domain errors here, not
		// internal errors: the request described an unsimulatable structure.
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) adequacyEvaluate(w http.ResponseWriter, r *http.Request) {
	var req service.AdequacyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "body is not valid JSON: "+err.Error())
		return
	}
	resp, err := h.svc.AdequacyEvaluate(r.Context(), req)
	if err != nil {
		if errors.Is(err, service.ErrInvalidInput) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		log.Printf("ERROR: adequacy evaluate: %v", err)
		writeError(w, http.StatusServiceUnavailable, "adequacy evaluation failed")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// readyz reports PG connectivity, rating snapshot state and the cdylib
// link (Appendix D boot-sequence probes). Not-ready → 503 with the failing
// checks named.
func (h *Handler) readyz(w http.ResponseWriter, _ *http.Request) {
	ready, checks := h.readiness()
	if !ready {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "not_ready", "checks": checks})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready", "checks": checks})
}

// ─── helpers (reinsurance-management conventions) ──────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
