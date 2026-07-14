package tls

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"os"
)

// NewTLSServer creates an HTTP server with TLS and optional mTLS.
// If TLS_CERT and TLS_KEY env vars are set, serves over HTTPS.
// If TLS_CA is also set, enables mutual TLS (client cert verification).
// Falls back to plain HTTP if no TLS env vars are configured.
func NewTLSServer(addr string, handler http.Handler) *http.Server {
	certFile := os.Getenv("TLS_CERT")
	keyFile := os.Getenv("TLS_KEY")
	caFile := os.Getenv("TLS_CA")

	srv := &http.Server{
		Addr:    addr,
		Handler: handler,
	}

	if certFile == "" || keyFile == "" {
		return srv
	}

	tlsConfig := &tls.Config{
		MinVersion: tls.VersionTLS12,
		CipherSuites: []uint16{
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
		},
	}

	if caFile != "" {
		caCert, err := os.ReadFile(caFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "tls: read CA file: %v\n", err)
		} else {
			pool := x509.NewCertPool()
			pool.AppendCertsFromPEM(caCert)
			tlsConfig.ClientCAs = pool
			tlsConfig.ClientAuth = tls.RequireAndVerifyClientCert
		}
	}

	srv.TLSConfig = tlsConfig
	return srv
}

// ListenAndServe starts the server with TLS if configured, plain HTTP otherwise.
func ListenAndServe(srv *http.Server) error {
	certFile := os.Getenv("TLS_CERT")
	keyFile := os.Getenv("TLS_KEY")

	if certFile != "" && keyFile != "" {
		return srv.ListenAndServeTLS(certFile, keyFile)
	}
	return srv.ListenAndServe()
}
