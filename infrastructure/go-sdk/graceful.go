package infra

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.uber.org/zap"
)

// GracefulServer wraps http.Server with signal handling and graceful shutdown.
type GracefulServer struct {
	server   *http.Server
	logger   *zap.Logger
	platform *Platform
}

// NewGracefulServer creates a server with graceful shutdown support.
func NewGracefulServer(addr string, handler http.Handler, logger *zap.Logger, platform *Platform) *GracefulServer {
	return &GracefulServer{
		server: &http.Server{
			Addr:              addr,
			Handler:           handler,
			ReadTimeout:       15 * time.Second,
			ReadHeaderTimeout: 5 * time.Second,
			WriteTimeout:      30 * time.Second,
			IdleTimeout:       60 * time.Second,
			MaxHeaderBytes:    1 << 20,
		},
		logger:   logger,
		platform: platform,
	}
}

// ListenAndServe starts the server and blocks until shutdown signal is received.
func (gs *GracefulServer) ListenAndServe() error {
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT)

	errCh := make(chan error, 1)
	go func() {
		gs.logger.Info("server_starting", zap.String("addr", gs.server.Addr))
		if err := gs.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case sig := <-quit:
		gs.logger.Info("shutdown_signal_received", zap.String("signal", sig.String()))
	}

	return gs.Shutdown()
}

// Shutdown gracefully shuts down the server and all infrastructure connections.
func (gs *GracefulServer) Shutdown() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	gs.logger.Info("graceful_shutdown_starting")

	if err := gs.server.Shutdown(ctx); err != nil {
		gs.logger.Error("server_shutdown_error", zap.Error(err))
		return err
	}

	if gs.platform != nil {
		gs.platform.Close()
	}

	gs.logger.Info("graceful_shutdown_complete")
	return nil
}

// ProbeHandler provides Kubernetes-compatible health probes.
type ProbeHandler struct {
	platform *Platform
	started  time.Time
	ready    bool
}

// NewProbeHandler creates health/ready/live probe handlers.
func NewProbeHandler(platform *Platform) *ProbeHandler {
	return &ProbeHandler{
		platform: platform,
		started:  time.Now(),
		ready:    true,
	}
}

// SetReady sets the readiness state.
func (ph *ProbeHandler) SetReady(ready bool) {
	ph.ready = ready
}

// HealthHandler returns overall service health with component statuses.
func (ph *ProbeHandler) HealthHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	status := ph.platform.HealthCheck(ctx)
	allHealthy := true
	for _, s := range status {
		if !s.Connected {
			allHealthy = false
			break
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if allHealthy {
		w.WriteHeader(http.StatusOK)
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
	}

	writeJSON(w, map[string]interface{}{
		"status":         boolToStatus(allHealthy),
		"uptime_seconds": time.Since(ph.started).Seconds(),
		"components":     status,
	})
}

// ReadyHandler returns whether the service is ready to accept traffic.
func (ph *ProbeHandler) ReadyHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if ph.ready {
		w.WriteHeader(http.StatusOK)
		writeJSON(w, map[string]interface{}{"ready": true})
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]interface{}{"ready": false})
	}
}

// LiveHandler returns whether the service process is alive.
func (ph *ProbeHandler) LiveHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	writeJSON(w, map[string]interface{}{"alive": true})
}

func boolToStatus(b bool) string {
	if b {
		return "healthy"
	}
	return "degraded"
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Write(data)
}
