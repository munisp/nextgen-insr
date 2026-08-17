package middleware

import (
	"fmt"
	"net/http"
	"time"
)

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	status int
	size   int
}

func (rw *responseWriter) WriteHeader(status int) {
	rw.status = status
	rw.ResponseWriter.WriteHeader(status)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.size += n
	return n, err
}

// LoggingMiddleware logs every HTTP request in structured JSON format.
// Compatible with the shared/logging package.
func LoggingMiddleware(serviceName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rw, r)

			duration := time.Since(start)

			requestID := w.Header().Get("X-Request-ID")
			if requestID == "" {
				requestID = r.Header.Get("X-Request-ID")
			}

			// JSON structured log output
			fmt.Printf(
				`{"timestamp":"%s","level":"INFO","service":"%s","message":"http_request",`+
					`"fields":{"method":"%s","path":"%s","status":%d,"duration_ms":%d,`+
					`"size":%d,"remote_addr":"%s","request_id":"%s","user_agent":"%s"}}`+"\n",
				time.Now().UTC().Format(time.RFC3339),
				serviceName,
				r.Method,
				r.URL.Path,
				rw.status,
				duration.Milliseconds(),
				rw.size,
				r.RemoteAddr,
				requestID,
				r.UserAgent(),
			)
		})
	}
}
