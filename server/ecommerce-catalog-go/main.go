package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/munisp/NGApp/ecommerce-catalog/handlers"
	"github.com/munisp/NGApp/ecommerce-catalog/middleware"
	"github.com/munisp/NGApp/ecommerce-catalog/store"
)


// validateQueryParam validates and sanitizes a query parameter.
func validateQueryParam(r *http.Request, key string, maxLen int) (string, error) {
	val := r.URL.Query().Get(key)
	if len(val) > maxLen {
		return "", fmt.Errorf("parameter %q exceeds max length %d", key, maxLen)
	}
	return val, nil
}

// validateRequiredParam validates a required query parameter.
func validateRequiredParam(r *http.Request, key string, maxLen int) (string, error) {
	val, err := validateQueryParam(r, key, maxLen)
	if err != nil {
		return "", err
	}
	if val == "" {
		return "", fmt.Errorf("parameter %q is required", key)
	}
	return val, nil
}

// validateIntParam validates and converts an integer query parameter.
func validateIntParam(r *http.Request, key string) (int, error) {
	val := r.URL.Query().Get(key)
	if val == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 0, fmt.Errorf("parameter %q must be a valid integer", key)
	}
	return n, nil
}

func main() {
	port := os.Getenv("CATALOG_PORT")
	if port == "" {
		port = "8100"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = os.Getenv("POSTGRES_URL")
	}

	// Initialize store
	productStore := store.NewProductStore(dbURL)
	orderStore := store.NewOrderStore(dbURL)
	inventoryStore := store.NewInventoryStore(dbURL)

	// Create handler
	h := handlers.NewHandler(productStore, orderStore, inventoryStore)

	// Setup routes
	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "healthy",
			"service": "ecommerce-catalog-go",
			"version": "1.0.0",
		})
	})

	// Products
	mux.HandleFunc("GET /api/v1/products", h.ListProducts)
	mux.HandleFunc("GET /api/v1/products/{id}", h.GetProduct)
	mux.HandleFunc("POST /api/v1/products", h.CreateProduct)
	mux.HandleFunc("PUT /api/v1/products/{id}", h.UpdateProduct)
	mux.HandleFunc("DELETE /api/v1/products/{id}", h.DeleteProduct)
	mux.HandleFunc("GET /api/v1/products/search", h.SearchProducts)
	mux.HandleFunc("GET /api/v1/products/category/{category}", h.ListByCategory)

	// Categories
	mux.HandleFunc("GET /api/v1/categories", h.ListCategories)
	mux.HandleFunc("POST /api/v1/categories", h.CreateCategory)
	mux.HandleFunc("PUT /api/v1/categories/{id}", h.UpdateCategory)
	mux.HandleFunc("DELETE /api/v1/categories/{id}", h.DeleteCategory)

	// Orders
	mux.HandleFunc("POST /api/v1/orders", h.CreateOrder)
	mux.HandleFunc("GET /api/v1/orders/{id}", h.GetOrder)
	mux.HandleFunc("GET /api/v1/orders", h.ListOrders)
	mux.HandleFunc("PUT /api/v1/orders/{id}/status", h.UpdateOrderStatus)
	mux.HandleFunc("POST /api/v1/orders/{id}/cancel", h.CancelOrder)
	mux.HandleFunc("POST /api/v1/orders/{id}/fulfill", h.FulfillOrder)

	// Inventory
	mux.HandleFunc("GET /api/v1/inventory/{sku}", h.GetInventory)
	mux.HandleFunc("POST /api/v1/inventory/reserve", h.ReserveInventory)
	mux.HandleFunc("POST /api/v1/inventory/release", h.ReleaseInventory)
	mux.HandleFunc("POST /api/v1/inventory/deduct", h.DeductInventory)
	mux.HandleFunc("GET /api/v1/inventory/low-stock", h.LowStockAlerts)

	// Offline sync
	mux.HandleFunc("POST /api/v1/sync/orders", h.SyncOfflineOrders)
	mux.HandleFunc("POST /api/v1/sync/inventory", h.SyncInventoryUpdates)

	// Apply middleware
	handler := middleware.Chain(mux,
		middleware.CORS,
		middleware.RequestID,
		middleware.Logger,
		middleware.Recovery,
		middleware.RateLimit,
		middleware.Auth,
	)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		log.Printf("[ecommerce-catalog-go] Starting on port %s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[ecommerce-catalog-go] Shutting down gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced shutdown: %v", err)
	}
	log.Println("[ecommerce-catalog-go] Server stopped")
}

// Suppress unused import warnings
var (
	_ = fmt.Sprintf
	_ = strconv.Itoa
	_ = strings.Contains
	_ sync.Mutex
)
