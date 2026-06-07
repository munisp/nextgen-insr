package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"os/signal"
	"syscall"
	"time"
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
	port := os.Getenv("PORT")
	if port == "" {
		port = "8200"
	}

	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"healthy","service":"supply-chain","version":"1.0.0"}`)
	})

	// ─── Warehouse Management ────────────────────────────────────────────
	mux.HandleFunc("GET /api/v1/warehouses", listWarehouses)
	mux.HandleFunc("POST /api/v1/warehouses", createWarehouse)
	mux.HandleFunc("GET /api/v1/warehouses/{id}", getWarehouse)
	mux.HandleFunc("PUT /api/v1/warehouses/{id}", updateWarehouse)
	mux.HandleFunc("GET /api/v1/warehouses/{id}/zones", listZones)
	mux.HandleFunc("POST /api/v1/warehouses/{id}/zones", createZone)
	mux.HandleFunc("GET /api/v1/warehouses/{id}/locations", listLocations)
	mux.HandleFunc("POST /api/v1/warehouses/{id}/locations", createLocation)
	mux.HandleFunc("GET /api/v1/warehouses/{id}/occupancy", getOccupancy)

	// ─── Stock Movements ─────────────────────────────────────────────────
	mux.HandleFunc("POST /api/v1/stock/receive", receiveStock)
	mux.HandleFunc("POST /api/v1/stock/transfer", transferStock)
	mux.HandleFunc("POST /api/v1/stock/adjust", adjustStock)
	mux.HandleFunc("POST /api/v1/stock/reserve", reserveStock)
	mux.HandleFunc("POST /api/v1/stock/pick", pickStock)
	mux.HandleFunc("GET /api/v1/stock/movements", listMovements)
	mux.HandleFunc("GET /api/v1/stock/levels", getStockLevels)
	mux.HandleFunc("GET /api/v1/stock/alerts", getStockAlerts)

	// ─── Inventory Valuation ─────────────────────────────────────────────
	mux.HandleFunc("GET /api/v1/valuation/{sku}", getValuation)
	mux.HandleFunc("POST /api/v1/valuation/calculate", calculateValuation)
	mux.HandleFunc("GET /api/v1/valuation/report", valuationReport)

	// ─── Procurement ─────────────────────────────────────────────────────
	mux.HandleFunc("GET /api/v1/suppliers", listSuppliers)
	mux.HandleFunc("POST /api/v1/suppliers", createSupplier)
	mux.HandleFunc("GET /api/v1/suppliers/{id}", getSupplier)
	mux.HandleFunc("PUT /api/v1/suppliers/{id}", updateSupplier)
	mux.HandleFunc("GET /api/v1/suppliers/{id}/performance", getSupplierPerformance)
	mux.HandleFunc("GET /api/v1/purchase-orders", listPurchaseOrders)
	mux.HandleFunc("POST /api/v1/purchase-orders", createPurchaseOrder)
	mux.HandleFunc("GET /api/v1/purchase-orders/{id}", getPurchaseOrder)
	mux.HandleFunc("PUT /api/v1/purchase-orders/{id}/status", updatePOStatus)
	mux.HandleFunc("POST /api/v1/purchase-orders/{id}/receive", receivePO)

	// ─── Logistics ───────────────────────────────────────────────────────
	mux.HandleFunc("GET /api/v1/carriers", listCarriers)
	mux.HandleFunc("POST /api/v1/shipments", createShipment)
	mux.HandleFunc("GET /api/v1/shipments/{id}", getShipment)
	mux.HandleFunc("PUT /api/v1/shipments/{id}/status", updateShipmentStatus)
	mux.HandleFunc("POST /api/v1/shipments/{id}/label", generateLabel)
	mux.HandleFunc("GET /api/v1/shipments/{id}/tracking", trackShipment)
	mux.HandleFunc("POST /api/v1/shipments/{id}/pod", submitProofOfDelivery)
	mux.HandleFunc("GET /api/v1/shipping/rates", calculateShippingRates)
	mux.HandleFunc("POST /api/v1/shipping/optimize-route", optimizeRoute)

	// ─── Cycle Counting ──────────────────────────────────────────────────
	mux.HandleFunc("POST /api/v1/cycle-count/start", startCycleCount)
	mux.HandleFunc("POST /api/v1/cycle-count/record", recordCycleCount)
	mux.HandleFunc("GET /api/v1/cycle-count/discrepancies", getDiscrepancies)

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("Supply-chain service listening on :%s", port)
		if err := server.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	server.Shutdown(ctx)
	log.Println("Supply-chain service shut down")
}
