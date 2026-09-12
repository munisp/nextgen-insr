// opensearch-analytics — typed Go facade over a REAL OpenSearch cluster for
// platform search/analytics, plus anomaly detection over indexed metrics.
//
// Matches the Node adapter contract (server/adapters/opensearchAdapter.ts):
//
//	POST /api/v1/search     {index, query, filters?, from?, size?, sort?}
//	    -> {total, hits:[{id, score, source}], took, aggregations?}
//	POST /api/v1/aggregate  {index, aggregations, filters?} -> raw aggs
//	POST /api/v1/index      {index, id, document} -> {indexed: bool}
//	POST /api/v1/bulk-index {index, documents:[{id, body}]} -> {indexed, errors}
//	POST /api/v1/anomalies  {index, field, window?} -> z-score anomalies over
//	    real indexed documents
//
// OPENSEARCH_URL is REQUIRED. Without it (or when the cluster is
// unreachable) every data endpoint fails loud (503/502) and /health is
// degraded — no response is ever fabricated.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"strings"
	"time"
)

// AnalyticsEngine wraps a real OpenSearch HTTP endpoint.
type AnalyticsEngine struct {
	baseURL string
	client  *http.Client
}

func NewAnalyticsEngine(baseURL string) *AnalyticsEngine {
	return &AnalyticsEngine{
		baseURL: strings.TrimRight(baseURL, "/"),
		client:  &http.Client{Timeout: 15 * time.Second},
	}
}

// osRequest performs a raw OpenSearch call and surfaces transport/status
// errors verbatim.
func (e *AnalyticsEngine) osRequest(method, path string, body any) (json.RawMessage, int, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, e.baseURL+path, rdr)
	if err != nil {
		return nil, 0, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if user := os.Getenv("OPENSEARCH_USER"); user != "" {
		req.SetBasicAuth(user, os.Getenv("OPENSEARCH_PASSWORD"))
	}
	resp, err := e.client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("opensearch unreachable at %s: %w", e.baseURL, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if resp.StatusCode/100 != 2 {
		return nil, resp.StatusCode, fmt.Errorf("opensearch %s %s -> %d: %s", method, path, resp.StatusCode, truncate(string(b), 512))
	}
	return json.RawMessage(b), resp.StatusCode, nil
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// ── adapter contract types ──────────────────────────────────────────────────

type searchHit struct {
	ID     string         `json:"id"`
	Score  float64        `json:"score"`
	Source map[string]any `json:"source"`
}

type searchResult struct {
	Total        int            `json:"total"`
	Hits         []searchHit    `json:"hits"`
	Took         int            `json:"took"`
	Aggregations map[string]any `json:"aggregations,omitempty"`
}

type searchQuery struct {
	Index   string           `json:"index"`
	Query   string           `json:"query"`
	Filters map[string]any   `json:"filters,omitempty"`
	From    *int             `json:"from,omitempty"`
	Size    *int             `json:"size,omitempty"`
	Sort    []map[string]any `json:"sort,omitempty"`
}

// buildOSQuery translates the adapter's SearchQuery into a real OpenSearch
// bool query (multi_match on query text + term filters).
func buildOSQuery(q searchQuery) map[string]any {
	must := []any{}
	if q.Query != "" {
		must = append(must, map[string]any{
			"multi_match": map[string]any{"query": q.Query},
		})
	}
	for field, value := range q.Filters {
		must = append(must, map[string]any{"term": map[string]any{field: value}})
	}
	var query map[string]any
	if len(must) == 0 {
		query = map[string]any{"match_all": map[string]any{}}
	} else {
		query = map[string]any{"bool": map[string]any{"must": must}}
	}
	body := map[string]any{"query": query}
	if q.From != nil {
		body["from"] = *q.From
	}
	if q.Size != nil {
		body["size"] = *q.Size
	}
	if len(q.Sort) > 0 {
		sort := make([]any, 0, len(q.Sort))
		for _, s := range q.Sort {
			if f, ok := s["field"].(string); ok {
				order, _ := s["order"].(string)
				if order != "asc" && order != "desc" {
					order = "desc"
				}
				sort = append(sort, map[string]any{f: map[string]any{"order": order}})
			}
		}
		body["sort"] = sort
	}
	return body
}

// Search executes a real OpenSearch _search and maps it to the adapter's
// SearchResult shape.
func (e *AnalyticsEngine) Search(q searchQuery) (*searchResult, error) {
	raw, _, err := e.osRequest(http.MethodPost, "/"+q.Index+"/_search", buildOSQuery(q))
	if err != nil {
		return nil, err
	}
	var osResp struct {
		Took int `json:"took"`
		Hits struct {
			Total struct {
				Value int `json:"value"`
			} `json:"total"`
			Hits []struct {
				ID     string         `json:"_id"`
				Score  float64        `json:"_score"`
				Source map[string]any `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
		Aggregations map[string]any `json:"aggregations"`
	}
	if err := json.Unmarshal(raw, &osResp); err != nil {
		return nil, fmt.Errorf("cannot parse opensearch response: %w", err)
	}
	res := &searchResult{
		Total:        osResp.Hits.Total.Value,
		Took:         osResp.Took,
		Hits:         make([]searchHit, 0, len(osResp.Hits.Hits)),
		Aggregations: osResp.Aggregations,
	}
	for _, h := range osResp.Hits.Hits {
		res.Hits = append(res.Hits, searchHit{ID: h.ID, Score: h.Score, Source: h.Source})
	}
	return res, nil
}

// IndexDocument indexes one real document.
func (e *AnalyticsEngine) IndexDocument(index, id string, document map[string]any) (bool, error) {
	_, _, err := e.osRequest(http.MethodPut, "/"+index+"/_doc/"+id, document)
	if err != nil {
		return false, err
	}
	return true, nil
}

// BulkIndex performs a real _bulk request and reports per-item errors.
func (e *AnalyticsEngine) BulkIndex(index string, docs []struct {
	ID   string         `json:"id"`
	Body map[string]any `json:"body"`
}) (indexed int, errors int, err error) {
	var buf bytes.Buffer
	for _, d := range docs {
		meta, _ := json.Marshal(map[string]any{"index": map[string]any{"_index": index, "_id": d.ID}})
		body, _ := json.Marshal(d.Body)
		buf.Write(meta)
		buf.WriteByte('\n')
		buf.Write(body)
		buf.WriteByte('\n')
	}
	req, rerr := http.NewRequest(http.MethodPost, e.baseURL+"/_bulk", &buf)
	if rerr != nil {
		return 0, 0, rerr
	}
	req.Header.Set("Content-Type", "application/x-ndjson")
	if user := os.Getenv("OPENSEARCH_USER"); user != "" {
		req.SetBasicAuth(user, os.Getenv("OPENSEARCH_PASSWORD"))
	}
	resp, rerr := e.client.Do(req)
	if rerr != nil {
		return 0, 0, fmt.Errorf("opensearch unreachable: %w", rerr)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if resp.StatusCode/100 != 2 {
		return 0, 0, fmt.Errorf("opensearch _bulk -> %d: %s", resp.StatusCode, truncate(string(b), 512))
	}
	var bulkResp struct {
		Errors bool `json:"errors"`
		Items  []map[string]struct {
			Status int `json:"status"`
		} `json:"items"`
	}
	if uerr := json.Unmarshal(b, &bulkResp); uerr != nil {
		return 0, 0, fmt.Errorf("cannot parse bulk response: %w", uerr)
	}
	for _, item := range bulkResp.Items {
		for _, op := range item {
			if op.Status >= 200 && op.Status < 300 {
				indexed++
			} else {
				errors++
			}
		}
	}
	return indexed, errors, nil
}

// anomalyPoint is one measured document field value.
type anomalyPoint struct {
	ID    string  `json:"id"`
	Value float64 `json:"value"`
	Z     float64 `json:"z_score"`
}

// detectAnomalies pulls the real recent documents for an index and flags
// values of `field` with |z-score| >= threshold. It never invents data —
// with no documents it returns an empty anomaly list.
func (e *AnalyticsEngine) detectAnomalies(index, field string, size int, threshold float64) ([]anomalyPoint, int, error) {
	q := map[string]any{
		"size":    size,
		"query":   map[string]any{"exists": map[string]any{"field": field}},
		"_source": []string{field},
	}
	raw, _, err := e.osRequest(http.MethodPost, "/"+index+"/_search", q)
	if err != nil {
		return nil, 0, err
	}
	var resp struct {
		Hits struct {
			Total struct {
				Value int `json:"value"`
			} `json:"total"`
			Hits []struct {
				ID     string         `json:"_id"`
				Source map[string]any `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, 0, err
	}
	type pv struct {
		id string
		v  float64
	}
	var vals []pv
	for _, h := range resp.Hits.Hits {
		if f, ok := h.Source[field].(float64); ok {
			vals = append(vals, pv{h.ID, f})
		}
	}
	if len(vals) < 3 {
		return []anomalyPoint{}, resp.Hits.Total.Value, nil
	}
	var sum float64
	for _, p := range vals {
		sum += p.v
	}
	mean := sum / float64(len(vals))
	var sq float64
	for _, p := range vals {
		d := p.v - mean
		sq += d * d
	}
	std := math.Sqrt(sq / float64(len(vals)))
	out := []anomalyPoint{}
	if std == 0 {
		return out, resp.Hits.Total.Value, nil
	}
	for _, p := range vals {
		z := (p.v - mean) / std
		if math.Abs(z) >= threshold {
			out = append(out, anomalyPoint{ID: p.id, Value: p.v, Z: z})
		}
	}
	return out, resp.Hits.Total.Value, nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func failLoud(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8093"
	}
	osURL := os.Getenv("OPENSEARCH_URL")
	engine := NewAnalyticsEngine(osURL)

	requireEngine := func(w http.ResponseWriter) bool {
		if osURL == "" {
			failLoud(w, http.StatusServiceUnavailable, fmt.Errorf("OPENSEARCH_URL not configured — analytics backend unavailable"))
			return false
		}
		return true
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if osURL == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "reason": "OPENSEARCH_URL not configured"})
			return
		}
		if _, _, err := engine.osRequest(http.MethodGet, "/_cluster/health", nil); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "reason": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "opensearch-analytics"})
	})

	mux.HandleFunc("/api/v1/search", func(w http.ResponseWriter, r *http.Request) {
		if !requireEngine(w) {
			return
		}
		var q searchQuery
		if err := json.NewDecoder(r.Body).Decode(&q); err != nil || q.Index == "" {
			failLoud(w, http.StatusBadRequest, fmt.Errorf("index is required"))
			return
		}
		res, err := engine.Search(q)
		if err != nil {
			failLoud(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, res)
	})

	mux.HandleFunc("/api/v1/aggregate", func(w http.ResponseWriter, r *http.Request) {
		if !requireEngine(w) {
			return
		}
		var q struct {
			Index        string         `json:"index"`
			Aggregations map[string]any `json:"aggregations"`
			Filters      map[string]any `json:"filters,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&q); err != nil || q.Index == "" || len(q.Aggregations) == 0 {
			failLoud(w, http.StatusBadRequest, fmt.Errorf("index and aggregations are required"))
			return
		}
		must := []any{}
		for field, value := range q.Filters {
			must = append(must, map[string]any{"term": map[string]any{field: value}})
		}
		query := map[string]any{"match_all": map[string]any{}}
		if len(must) > 0 {
			query = map[string]any{"bool": map[string]any{"must": must}}
		}
		raw, _, err := engine.osRequest(http.MethodPost, "/"+q.Index+"/_search", map[string]any{
			"size": 0, "query": query, "aggs": q.Aggregations,
		})
		if err != nil {
			failLoud(w, http.StatusBadGateway, err)
			return
		}
		var resp struct {
			Aggregations map[string]any `json:"aggregations"`
		}
		if err := json.Unmarshal(raw, &resp); err != nil {
			failLoud(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, resp.Aggregations)
	})

	mux.HandleFunc("/api/v1/index", func(w http.ResponseWriter, r *http.Request) {
		if !requireEngine(w) {
			return
		}
		var q struct {
			Index    string         `json:"index"`
			ID       string         `json:"id"`
			Document map[string]any `json:"document"`
		}
		if err := json.NewDecoder(r.Body).Decode(&q); err != nil || q.Index == "" || q.ID == "" || q.Document == nil {
			failLoud(w, http.StatusBadRequest, fmt.Errorf("index, id and document are required"))
			return
		}
		ok, err := engine.IndexDocument(q.Index, q.ID, q.Document)
		if err != nil {
			failLoud(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"indexed": ok})
	})

	mux.HandleFunc("/api/v1/bulk-index", func(w http.ResponseWriter, r *http.Request) {
		if !requireEngine(w) {
			return
		}
		var q struct {
			Index     string `json:"index"`
			Documents []struct {
				ID   string         `json:"id"`
				Body map[string]any `json:"body"`
			} `json:"documents"`
		}
		if err := json.NewDecoder(r.Body).Decode(&q); err != nil || q.Index == "" || len(q.Documents) == 0 {
			failLoud(w, http.StatusBadRequest, fmt.Errorf("index and documents[] are required"))
			return
		}
		indexed, errs, err := engine.BulkIndex(q.Index, q.Documents)
		if err != nil {
			failLoud(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"indexed": indexed, "errors": errs})
	})

	mux.HandleFunc("/api/v1/anomalies", func(w http.ResponseWriter, r *http.Request) {
		if !requireEngine(w) {
			return
		}
		var q struct {
			Index     string  `json:"index"`
			Field     string  `json:"field"`
			Size      int     `json:"size,omitempty"`
			Threshold float64 `json:"threshold,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&q); err != nil || q.Index == "" || q.Field == "" {
			failLoud(w, http.StatusBadRequest, fmt.Errorf("index and field are required"))
			return
		}
		if q.Size <= 0 {
			q.Size = 200
		}
		if q.Threshold <= 0 {
			q.Threshold = 2.5
		}
		anomalies, scanned, err := engine.detectAnomalies(q.Index, q.Field, q.Size, q.Threshold)
		if err != nil {
			failLoud(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"anomalies": anomalies, "scanned": scanned, "field": q.Field, "threshold": q.Threshold})
	})

	log.Printf("opensearch-analytics listening on :%s (opensearch=%q)", port, osURL)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
