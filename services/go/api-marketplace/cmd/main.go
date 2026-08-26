package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

// API Marketplace — partner API catalog.
//
// HONEST CONTRACT: this service has no partner store, no usage/metering
// tables, no billing system, no policy store, and no rating engine
// integrated (the module carries no database driver). Endpoints that would
// require such backing fail loudly (501/503) instead of returning
// fabricated partners, usage counters, invoices, policies, or premiums.
// Only the static product catalog is served, and it is labeled as static.

// APIProduct represents a white-label API product offering
type APIProduct struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Description string `json:"description"`
	Category    string `json:"category"` // embed, quote, issue, claim, verify
	Version     string `json:"version"`
}

var productCatalog = []APIProduct{
	{ID: 1, Name: "Embedded Insurance", Slug: "embedded-insurance", Category: "embed", Version: "v2", Description: "Add insurance at checkout with 3 lines of code"},
	{ID: 2, Name: "Quote Engine", Slug: "quote-engine", Category: "quote", Version: "v2", Description: "Real-time insurance quotes for any product type"},
	{ID: 3, Name: "Policy Issuance", Slug: "policy-issuance", Category: "issue", Version: "v1", Description: "Issue policies programmatically with KYC verification"},
	{ID: 4, Name: "Claims API", Slug: "claims-api", Category: "claim", Version: "v1", Description: "Submit and track claims via API"},
	{ID: 5, Name: "Verification API", Slug: "verification-api", Category: "verify", Version: "v1", Description: "Verify policy status and coverage details"},
}

func notImplemented(c *gin.Context, capability string) {
	c.JSON(http.StatusNotImplemented, gin.H{
		"error":  capability + " is not implemented: this service has no backing store integrated; refusing to fabricate a response",
		"status": "not_implemented",
	})
}

func unavailable(c *gin.Context, capability string) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"error":  capability + " is unavailable: no usage/billing data source is integrated with this service; refusing to fabricate figures",
		"status": "unavailable",
	})
}

func main() {
	router := gin.New()
	router.Use(gin.Recovery())

	api := router.Group("/api/v1/marketplace")
	{
		// Partner management — no partner store integrated: fail loud.
		api.POST("/partners", func(c *gin.Context) { notImplemented(c, "partner registration") })
		api.GET("/partners", listPartners)
		api.GET("/partners/:id", func(c *gin.Context) { notImplemented(c, "partner lookup") })
		api.PUT("/partners/:id", func(c *gin.Context) { notImplemented(c, "partner update") })
		api.POST("/partners/:id/keys/rotate", func(c *gin.Context) { notImplemented(c, "API key rotation") })

		// API Products catalog (static, honestly labeled)
		api.GET("/products", listProducts)
		api.GET("/products/:slug", getProduct)
		api.POST("/products/:slug/subscribe", func(c *gin.Context) { notImplemented(c, "product subscription") })

		// Usage & Billing — no usage/metering/billing data source: fail loud.
		api.GET("/usage/:partnerId", func(c *gin.Context) { unavailable(c, "usage statistics") })
		api.GET("/billing/:partnerId", func(c *gin.Context) { unavailable(c, "billing history") })
		api.GET("/billing/:partnerId/invoice/:month", func(c *gin.Context) { unavailable(c, "invoice retrieval") })

		// White-label insurance APIs — no policy store / rating engine /
		// claims pipeline integrated: fail closed, never fabricate policies,
		// premiums, claim numbers, or validity verdicts.
		api.POST("/insurance/quote", func(c *gin.Context) { notImplemented(c, "insurance quoting (no rating engine integrated)") })
		api.POST("/insurance/issue", func(c *gin.Context) {
			notImplemented(c, "policy issuance (no policy store or premium collection integrated)")
		})
		api.POST("/insurance/claim", func(c *gin.Context) { notImplemented(c, "claim submission (no claims pipeline integrated)") })
		api.GET("/insurance/verify/:policyNumber", func(c *gin.Context) { unavailable(c, "policy verification (no policy store integrated)") })
		api.POST("/insurance/premium/calculate", func(c *gin.Context) { notImplemented(c, "premium calculation (no rating engine integrated)") })

		// Webhooks — no webhook store/dispatcher integrated: fail loud.
		api.POST("/webhooks/configure", func(c *gin.Context) { notImplemented(c, "webhook configuration") })
		api.GET("/webhooks/logs/:partnerId", func(c *gin.Context) { unavailable(c, "webhook logs") })

		// Analytics — no metrics store: fail loud.
		api.GET("/analytics/overview", func(c *gin.Context) { unavailable(c, "marketplace analytics") })
	}

	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "api-marketplace", "backing_stores": "unavailable"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8086"
	}

	srv := &http.Server{Addr: ":" + port, Handler: router, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second}
	go func() {
		log.Printf("api-marketplace starting on :%s (backing stores unavailable — transactional endpoints fail loudly)", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

// listPartners is an honest read: with no partner store integrated, this
// service has zero registered partners.
func listPartners(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"partners": []interface{}{},
		"total":    0,
		"source":   "no partner store integrated",
	})
}

func listProducts(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"products": productCatalog, "source": "static_catalog"})
}

func getProduct(c *gin.Context) {
	slug := c.Param("slug")
	for _, p := range productCatalog {
		if p.Slug == slug {
			c.JSON(http.StatusOK, gin.H{"product": p, "source": "static_catalog"})
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "product not found", "slug": slug})
}
