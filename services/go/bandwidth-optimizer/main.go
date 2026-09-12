// bandwidth-optimizer — decides how the platform should talk to terminals
// on constrained networks: which protocol, which compression, what payload
// budget. Decisions are derived from REAL client-reported telemetry
// (latency / downstream bandwidth / packet loss); nothing is simulated.
//
// Endpoints:
//
//	POST /api/v1/optimize  {latency_ms, bandwidth_kbps, packet_loss_pct, payload_bytes}
//	    -> {tier, protocol, compression, max_payload_bytes, batch, reason}
//	POST /api/v1/compress  {data: base64} -> real gzip-compressed response
//	GET  /health
package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
)

// BandwidthTier classifies the client's effective link quality.
type BandwidthTier string

const (
	TierOffline BandwidthTier = "offline"
	Tier2GGPRS  BandwidthTier = "2g_gprs"
	Tier2GEdge  BandwidthTier = "2g_edge"
	Tier3G      BandwidthTier = "3g"
	Tier4GLTE   BandwidthTier = "4g_lte"
	Tier5GWifi  BandwidthTier = "5g_wifi"
)

// Telemetry is the real measured link quality reported by the terminal.
type Telemetry struct {
	LatencyMs     float64 `json:"latency_ms"`
	BandwidthKbps float64 `json:"bandwidth_kbps"`
	PacketLossPct float64 `json:"packet_loss_pct"`
	PayloadBytes  int     `json:"payload_bytes"`
}

// Decision is the optimizer's recommendation.
type Decision struct {
	Tier            BandwidthTier `json:"tier"`
	Protocol        string        `json:"protocol"`    // http1_json | http2_binary | websocket | sms_ussd_fallback
	Compression     string        `json:"compression"` // none | gzip | gzip_aggressive
	MaxPayloadBytes int           `json:"max_payload_bytes"`
	Batch           bool          `json:"batch"`
	Reason          string        `json:"reason"`
}

// BandwidthOptimizer turns telemetry into transport decisions.
type BandwidthOptimizer struct{}

// classify maps measured link quality to a tier. Thresholds follow the
// platform's NCC-baseline connectivity model used by the resilience router.
func (o *BandwidthOptimizer) classify(t Telemetry) BandwidthTier {
	switch {
	case t.BandwidthKbps <= 0:
		return TierOffline
	case t.BandwidthKbps < 50 || t.LatencyMs > 2000 || t.PacketLossPct > 20:
		return Tier2GGPRS
	case t.BandwidthKbps < 250 || t.LatencyMs > 1000 || t.PacketLossPct > 10:
		return Tier2GEdge
	case t.BandwidthKbps < 2000 || t.LatencyMs > 400:
		return Tier3G
	case t.BandwidthKbps < 10000 || t.LatencyMs > 150:
		return Tier4GLTE
	default:
		return Tier5GWifi
	}
}

// SelectProtocol picks the transport protocol for a tier.
func (o *BandwidthOptimizer) SelectProtocol(tier BandwidthTier) string {
	switch tier {
	case TierOffline, Tier2GGPRS:
		return "sms_ussd_fallback"
	case Tier2GEdge:
		return "http1_json"
	case Tier3G:
		return "http2_binary"
	default: // 4g_lte, 5g_wifi
		return "websocket"
	}
}

// SelectCompression picks the compression strategy for a tier.
func (o *BandwidthOptimizer) SelectCompression(tier BandwidthTier) string {
	switch tier {
	case TierOffline, Tier2GGPRS, Tier2GEdge:
		return "gzip_aggressive"
	case Tier3G:
		return "gzip"
	default:
		return "none"
	}
}

// Optimize produces the full decision for a telemetry sample.
func (o *BandwidthOptimizer) Optimize(t Telemetry) Decision {
	tier := o.classify(t)
	d := Decision{
		Tier:        tier,
		Protocol:    o.SelectProtocol(tier),
		Compression: o.SelectCompression(tier),
	}
	switch tier {
	case TierOffline:
		d.MaxPayloadBytes = 0
		d.Batch = true
		d.Reason = "no usable bandwidth — queue locally and fall back to SMS/USSD"
	case Tier2GGPRS:
		d.MaxPayloadBytes = 4 * 1024
		d.Batch = true
		d.Reason = "extremely constrained link — tiny batched payloads, aggressive gzip"
	case Tier2GEdge:
		d.MaxPayloadBytes = 32 * 1024
		d.Batch = true
		d.Reason = "2G edge link — small batched payloads with aggressive gzip"
	case Tier3G:
		d.MaxPayloadBytes = 256 * 1024
		d.Batch = t.PayloadBytes > d.MaxPayloadBytes
		d.Reason = "3G link — gzip text payloads, moderate payload budget"
	default:
		d.MaxPayloadBytes = 4 * 1024 * 1024
		d.Batch = false
		d.Reason = "broadband link — full-fidelity realtime transport"
	}
	return d
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8097"
	}
	opt := &BandwidthOptimizer{}
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "bandwidth-optimizer"})
	})

	mux.HandleFunc("/api/v1/optimize", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
			return
		}
		var t Telemetry
		if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid telemetry JSON: " + err.Error()})
			return
		}
		if t.BandwidthKbps < 0 || t.LatencyMs < 0 || t.PacketLossPct < 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "telemetry values must be non-negative measured values"})
			return
		}
		writeJSON(w, http.StatusOK, opt.Optimize(t))
	})

	mux.HandleFunc("/api/v1/compress", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
			return
		}
		var body struct {
			Data string `json:"data"` // base64
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON: " + err.Error()})
			return
		}
		raw, err := base64.StdEncoding.DecodeString(body.Data)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "data must be base64: " + err.Error()})
			return
		}
		var buf bytes.Buffer
		gw := gzip.NewWriter(&buf)
		if _, err := gw.Write(raw); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if err := gw.Close(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"compressed":      base64.StdEncoding.EncodeToString(buf.Bytes()),
			"original_size":   len(raw),
			"compressed_size": buf.Len(),
			"algorithm":       "gzip",
		})
	})

	// real passthrough of raw bodies for terminals that cannot do JSON
	mux.HandleFunc("/api/v1/compress-raw", func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(io.LimitReader(r.Body, 16<<20))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		gw := gzip.NewWriter(w)
		_, _ = gw.Write(raw)
		_ = gw.Close()
	})

	log.Printf("bandwidth-optimizer listening on :%s", port)
	fmt.Println("bandwidth-optimizer: telemetry-driven transport decisions, no simulated tiers")
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
