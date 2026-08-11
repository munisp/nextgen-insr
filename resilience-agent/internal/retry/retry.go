// Package retry submits a transaction payload to a backend with bounded
// exponential-backoff retries, for use on unreliable mobile networks.
package retry

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// TxPayload is an arbitrary transaction document forwarded verbatim to the
// POS backend.
type TxPayload map[string]any

// Result reports the outcome of a Submit call.
type Result struct {
	Success    bool   `json:"success"`
	Attempts   int    `json:"attempts"`
	StatusCode int    `json:"status_code,omitempty"`
	Response   string `json:"response,omitempty"`
	Error      string `json:"error,omitempty"`
	DurationMs int64  `json:"duration_ms"`
}

const (
	maxAttempts     = 4
	initialBackoff  = 500 * time.Millisecond
	backoffMultiple = 2
	perTryTimeout   = 10 * time.Second
)

// Submit POSTs payload as JSON to backendURL, retrying with exponential
// backoff on transport errors and 5xx responses until success, the attempt
// budget is exhausted, or ctx is cancelled.
func Submit(ctx context.Context, backendURL string, payload TxPayload) Result {
	start := time.Now()
	res := Result{}

	body, err := json.Marshal(payload)
	if err != nil {
		res.Error = fmt.Sprintf("marshal payload: %v", err)
		res.DurationMs = time.Since(start).Milliseconds()
		return res
	}

	backoff := initialBackoff
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		res.Attempts = attempt

		tryCtx, cancel := context.WithTimeout(ctx, perTryTimeout)
		statusCode, respBody, tryErr := postOnce(tryCtx, backendURL, body)
		cancel()

		res.StatusCode = statusCode
		res.Response = respBody

		switch {
		case tryErr == nil && statusCode >= 200 && statusCode < 300:
			res.Success = true
			res.DurationMs = time.Since(start).Milliseconds()
			return res
		case tryErr != nil:
			res.Error = tryErr.Error()
		default:
			res.Error = fmt.Sprintf("backend returned status %d", statusCode)
			// 4xx means the request itself is rejected; retrying won't help.
			if statusCode >= 400 && statusCode < 500 {
				res.DurationMs = time.Since(start).Milliseconds()
				return res
			}
		}

		if attempt < maxAttempts {
			select {
			case <-ctx.Done():
				res.Error = fmt.Sprintf("%s (aborted: %v)", res.Error, ctx.Err())
				res.DurationMs = time.Since(start).Milliseconds()
				return res
			case <-time.After(backoff):
			}
			backoff *= backoffMultiple
		}
	}

	res.DurationMs = time.Since(start).Milliseconds()
	return res
}

func postOnce(ctx context.Context, url string, body []byte) (int, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return resp.StatusCode, string(data), nil
}
