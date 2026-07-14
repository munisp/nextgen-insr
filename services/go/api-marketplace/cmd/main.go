package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

// Partner represents a B2B API consumer (bank, fintech, e-commerce platform)
type Partner struct {
	ID           int64    `json:"id"`
	Name         string   `json:"name"`
	CompanyType  string   `json:"companyType"` // bank, fintech, ecommerce, telco
	APIKey       string   `json:"apiKey"`
	Tier         string   `json:"tier"` // sandbox, basic, premium, enterprise
	RateLimit    int      `json:"rateLimit"` // requests/minute
	Endpoints    []string `json:"endpoints"` // which APIs they have access to
	WebhookURL   string   `json:"webhookUrl"`
	Status       string   `json:"status"` // active, suspended, pending_review
	MonthlyFee   float64  `json:"monthlyFee"`
	PerPolicyFee float64  `json:"perPolicyFee"`
	CreatedAt    string   `json:"createdAt"`
}

// APIProduct represents a white-label API product offering
type APIProduct struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Slug        string  `json:"slug"`
	Description string  `json:"description"`
	Category    string  `json:"category"` // embed, quote, issue, claim, verify
	Version     string  `json:"version"`
	Pricing     Pricing `json:"pricing"`
	Endpoints   []Endpoint `json:"endpoints"`
}

type Pricing struct {
	Model       string  `json:"model"` // per_call, per_policy, flat_monthly
	BasePrice   float64 `json:"basePrice"`
	VolumeDiscount float64 `json:"volumeDiscount"` // percentage off at 1000+ calls
}

type Endpoint struct {
	Method      string `json:"method"`
	Path        string `json:"path"`
	Description string `json:"description"`
	RateLimit   int    `json:"rateLimit"`
}

func main() {
	router := gin.New()
	router.Use(gin.Recovery())

	api := router.Group("/api/v1/marketplace")
	{
		// Partner management
		api.POST("/partners", registerPartner)
		api.GET("/partners", listPartners)
		api.GET("/partners/:id", getPartner)
		api.PUT("/partners/:id", updatePartner)
		api.POST("/partners/:id/keys/rotate", rotateAPIKey)

		// API Products catalog
		api.GET("/products", listProducts)
		api.GET("/products/:slug", getProduct)
		api.POST("/products/:slug/subscribe", subscribeToProduct)

		// Usage & Billing
		api.GET("/usage/:partnerId", getUsageStats)
		api.GET("/billing/:partnerId", getBillingHistory)
		api.GET("/billing/:partnerId/invoice/:month", getInvoice)

		// White-label insurance APIs (what partners consume)
		api.POST("/insurance/quote", getInsuranceQuote)
		api.POST("/insurance/issue", issuePolicy)
		api.POST("/insurance/claim", submitClaim)
		api.GET("/insurance/verify/:policyNumber", verifyPolicy)
		api.POST("/insurance/premium/calculate", calculatePremium)

		// Webhooks
		api.POST("/webhooks/configure", configureWebhook)
		api.GET("/webhooks/logs/:partnerId", getWebhookLogs)

		// Analytics
		api.GET("/analytics/overview", getMarketplaceOverview)
	}

	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "api-marketplace"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8086"
	}

	srv := &http.Server{Addr: ":" + port, Handler: router, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second}
	go func() {
		log.Printf("api-marketplace starting on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}

func registerPartner(c *gin.Context) {
	var req struct {
		Name        string `json:"name" binding:"required"`
		CompanyType string `json:"companyType" binding:"required"`
		Email       string `json:"email" binding:"required"`
		WebhookURL  string `json:"webhookUrl"`
		Tier        string `json:"tier"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	apiKey := generateAPIKey()

	c.JSON(http.StatusCreated, gin.H{
		"id":      1,
		"name":    req.Name,
		"apiKey":  apiKey,
		"tier":    "sandbox",
		"status":  "active",
		"message": "API key generated. Start with sandbox tier — upgrade after review.",
	})
}

func listPartners(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"partners": []map[string]interface{}{
			{"id": 1, "name": "Paystack", "type": "fintech", "tier": "enterprise", "status": "active"},
			{"id": 2, "name": "Kuda Bank", "type": "bank", "tier": "premium", "status": "active"},
			{"id": 3, "name": "Jumia", "type": "ecommerce", "tier": "basic", "status": "active"},
		},
		"total": 3,
	})
}

func getPartner(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "status": "active"})
}

func updatePartner(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "updated"})
}

func rotateAPIKey(c *gin.Context) {
	newKey := generateAPIKey()
	c.JSON(http.StatusOK, gin.H{
		"newApiKey":       newKey,
		"oldKeyExpiresIn": "24 hours",
		"message":         "Update your integration with the new key within 24 hours.",
	})
}

func listProducts(c *gin.Context) {
	products := []APIProduct{
		{ID: 1, Name: "Embedded Insurance", Slug: "embedded-insurance", Category: "embed", Version: "v2", Description: "Add insurance at checkout with 3 lines of code"},
		{ID: 2, Name: "Quote Engine", Slug: "quote-engine", Category: "quote", Version: "v2", Description: "Real-time insurance quotes for any product type"},
		{ID: 3, Name: "Policy Issuance", Slug: "policy-issuance", Category: "issue", Version: "v1", Description: "Issue policies programmatically with KYC verification"},
		{ID: 4, Name: "Claims API", Slug: "claims-api", Category: "claim", Version: "v1", Description: "Submit and track claims via API"},
		{ID: 5, Name: "Verification API", Slug: "verification-api", Category: "verify", Version: "v1", Description: "Verify policy status and coverage details"},
	}
	c.JSON(http.StatusOK, gin.H{"products": products})
}

func getProduct(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"slug": c.Param("slug"), "status": "available"})
}

func subscribeToProduct(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "subscribed", "product": c.Param("slug")})
}

func getUsageStats(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"partnerId":    c.Param("partnerId"),
		"period":       "2026-05",
		"totalCalls":   15420,
		"quoteCalls":   8200,
		"issueCalls":   4100,
		"claimCalls":   2100,
		"verifyCalls":  1020,
		"errorRate":    0.02,
		"avgLatencyMs": 145,
	})
}

func getBillingHistory(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"billing": []interface{}{}, "total": 0})
}

func getInvoice(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"partnerId": c.Param("partnerId"),
		"month":     c.Param("month"),
		"amount":    250000,
		"currency":  "NGN",
		"status":    "paid",
	})
}

func getInsuranceQuote(c *gin.Context) {
	var req struct {
		ProductType string  `json:"productType" binding:"required"`
		SumInsured  float64 `json:"sumInsured" binding:"required"`
		Duration    int     `json:"durationMonths"`
		CustomerAge int     `json:"customerAge"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	premium := req.SumInsured * 0.035
	c.JSON(http.StatusOK, gin.H{
		"quoteId":     "QT-" + time.Now().Format("20060102150405"),
		"productType": req.ProductType,
		"sumInsured":  req.SumInsured,
		"premium":     premium,
		"currency":    "NGN",
		"validUntil":  time.Now().Add(24 * time.Hour).Format(time.RFC3339),
	})
}

func issuePolicy(c *gin.Context) {
	c.JSON(http.StatusCreated, gin.H{
		"policyNumber": "POL-API-" + time.Now().Format("20060102") + "-001",
		"status":       "active",
		"issuedAt":     time.Now().Format(time.RFC3339),
	})
}

func submitClaim(c *gin.Context) {
	c.JSON(http.StatusCreated, gin.H{
		"claimNumber": "CLM-API-" + time.Now().Format("20060102") + "-001",
		"status":      "submitted",
	})
}

func verifyPolicy(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"policyNumber": c.Param("policyNumber"),
		"valid":        true,
		"status":       "active",
		"holder":       "John Doe",
		"expiry":       "2026-12-31",
	})
}

func calculatePremium(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"premium": 45000, "currency": "NGN"})
}

func configureWebhook(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "configured"})
}

func getWebhookLogs(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"logs": []interface{}{}, "total": 0})
}

func getMarketplaceOverview(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"activePartners":  12,
		"totalAPICalls":   1250000,
		"policiesIssued":  8500,
		"monthlyRevenue":  3500000,
		"topPartner":      "Paystack",
		"topProduct":      "Embedded Insurance",
	})
}

func generateAPIKey() string {
	bytes := make([]byte, 32)
	rand.Read(bytes)
	return "ipk_" + hex.EncodeToString(bytes)
}
