// Package observability exposes the pricing service's Prometheus metrics
// (design Appendix G) in the official text exposition format. It is
// deliberately stdlib-only: the convention that matters operationally is
// the metric names/labels and the scrape format, and this keeps the
// service's dependency graph at the three pinned modules (pq, go-redis,
// miniredis for tests).
//
// Pinned metric surface (Appendix G):
//
//	rating_latency_seconds      histogram (no labels)
//	referral_total{reason}      counter
//	accumulation_breach_total   counter
package observability

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Histogram buckets for rating_latency_seconds, chosen around the Appendix
// D budget (p99 ≤ 5 ms handler / ≤ 1 ms kernel in-process).
var latencyBuckets = []float64{0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25}

type histogram struct {
	buckets []uint64 // cumulative counts aligned with latencyBuckets
	count   uint64
	sum     float64
}

// Registry is the service metrics registry. All operations are safe for
// concurrent use on the hot path (atomics + a mutex for the label maps).
type Registry struct {
	latency    atomic.Pointer[histogram]
	mu         sync.Mutex
	referrals  map[string]*uint64
	breaches   uint64
	kernelErrs uint64
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	r := &Registry{referrals: map[string]*uint64{}}
	r.latency.Store(&histogram{buckets: make([]uint64, len(latencyBuckets))})
	return r
}

// ObserveRatingLatency records one rating call duration.
func (r *Registry) ObserveRatingLatency(d time.Duration) {
	secs := d.Seconds()
	for {
		cur := r.latency.Load()
		next := &histogram{
			buckets: make([]uint64, len(cur.buckets)),
			count:   cur.count + 1,
			sum:     cur.sum + secs,
		}
		copy(next.buckets, cur.buckets)
		for i, b := range latencyBuckets {
			if secs <= b {
				next.buckets[i]++
			}
		}
		if r.latency.CompareAndSwap(cur, next) {
			return
		}
	}
}

// IncReferral increments referral_total{reason=...}.
func (r *Registry) IncReferral(reason string) {
	r.mu.Lock()
	c, ok := r.referrals[reason]
	if !ok {
		c = new(uint64)
		r.referrals[reason] = c
	}
	r.mu.Unlock()
	atomic.AddUint64(c, 1)
}

// IncAccumulationBreach increments accumulation_breach_total.
func (r *Registry) IncAccumulationBreach() { atomic.AddUint64(&r.breaches, 1) }

// IncKernelError increments kernel_error_total (kernel non-OK status at
// quote time — a metric on top of the pinned Appendix G surface, used by
// the runbook to catch FFI regressions).
func (r *Registry) IncKernelError() { atomic.AddUint64(&r.kernelErrs, 1) }

// Handler serves GET /metrics in the Prometheus text exposition format.
func (r *Registry) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		var b strings.Builder

		h := r.latency.Load()
		b.WriteString("# HELP rating_latency_seconds Server-side rating latency (Appendix D p99 budget 0.005).\n")
		b.WriteString("# TYPE rating_latency_seconds histogram\n")
		for i, bound := range latencyBuckets {
			fmt.Fprintf(&b, "rating_latency_seconds_bucket{le=\"%g\"} %d\n", bound, h.buckets[i])
		}
		fmt.Fprintf(&b, "rating_latency_seconds_bucket{le=\"+Inf\"} %d\n", h.count)
		fmt.Fprintf(&b, "rating_latency_seconds_sum %g\n", h.sum)
		fmt.Fprintf(&b, "rating_latency_seconds_count %d\n", h.count)

		r.mu.Lock()
		reasons := make([]string, 0, len(r.referrals))
		for reason := range r.referrals {
			reasons = append(reasons, reason)
		}
		r.mu.Unlock()
		sort.Strings(reasons)
		b.WriteString("# HELP referral_total Referral decisions by machine reason code.\n")
		b.WriteString("# TYPE referral_total counter\n")
		for _, reason := range reasons {
			fmt.Fprintf(&b, "referral_total{reason=%q} %d\n", reason, atomic.LoadUint64(r.referrals[reason]))
		}

		b.WriteString("# HELP accumulation_breach_total Accumulation checks that breached a ceiling.\n")
		b.WriteString("# TYPE accumulation_breach_total counter\n")
		fmt.Fprintf(&b, "accumulation_breach_total %d\n", atomic.LoadUint64(&r.breaches))

		b.WriteString("# HELP kernel_error_total Non-OK statuses returned by the actuary compute kernel.\n")
		b.WriteString("# TYPE kernel_error_total counter\n")
		fmt.Fprintf(&b, "kernel_error_total %d\n", atomic.LoadUint64(&r.kernelErrs))

		// nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter
		// Justification (2026-11-28, semgrep finding on PR #357): this is the
		// GET /metrics endpoint serving the Prometheus text exposition format
		// (Content-Type text/plain; version=0.0.4 set above) — not HTML, so
		// the XSS rule does not apply. The written bytes are entirely
		// server-generated metric names/values; no request-controlled or
		// user-controlled input is reflected. Suppression is scoped to this
		// single line; the emitted output is byte-identical to the flagged
		// version (verified by the pinned metric-names handler test).
		_, _ = w.Write([]byte(b.String()))
	})
}
