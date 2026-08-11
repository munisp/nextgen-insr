package observability

import (
	"net/http"
	"time"

	"crypto/rand"
	"encoding/hex"
)

type obsResponseWriter struct {
	http.ResponseWriter
	status int
	size   int
}

func (rw *obsResponseWriter) WriteHeader(status int) {
	rw.status = status
	rw.ResponseWriter.WriteHeader(status)
}

func (rw *obsResponseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.size += n
	return n, err
}

func RequestLogging(logger *Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			requestID := r.Header.Get("X-Request-ID")
			if requestID == "" {
				b := make([]byte, 8)
				rand.Read(b)
				requestID = hex.EncodeToString(b)
			}
			w.Header().Set("X-Request-ID", requestID)

			wrapped := &obsResponseWriter{ResponseWriter: w, status: 200}
			next.ServeHTTP(wrapped, r)

			duration := time.Since(start)
			logger.Info("request", map[string]interface{}{
				"method":      r.Method,
				"path":        r.URL.Path,
				"status":      wrapped.status,
				"duration_ms": duration.Milliseconds(),
				"size":        wrapped.size,
				"request_id":  requestID,
				"remote_addr": r.RemoteAddr,
			})
		})
	}
}
