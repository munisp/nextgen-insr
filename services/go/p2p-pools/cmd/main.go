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

// P2P Pools — peer-to-peer microinsurance pools (digital ajo).
//
// HONEST CONTRACT: this service has NO persistence and NO ledger (the
// module carries no database driver). Pooled contributions are real money,
// so every mutating endpoint fails loudly (501) instead of acknowledging
// funds that would vanish. Read endpoints return honest empty collections
// or explicit 503 unavailable for balance/ledger/statistics figures —
// never fabricated pool balances.

func notImplemented(c *gin.Context, capability string) {
	c.JSON(http.StatusNotImplemented, gin.H{
		"error":  capability + " is not implemented: this service has no persistence or ledger integrated; refusing to acknowledge an operation that would not be recorded",
		"status": "not_implemented",
	})
}

func unavailable(c *gin.Context, capability string) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"error":  capability + " is unavailable: no pool ledger/store is integrated with this service; refusing to fabricate balances or statistics",
		"status": "unavailable",
	})
}

func main() {
	router := gin.New()
	router.Use(gin.Recovery())

	api := router.Group("/api/v1/pools")
	{
		// Pool CRUD — mutations fail loud (no store).
		api.POST("", func(c *gin.Context) { notImplemented(c, "pool creation") })
		api.GET("", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"pools": []interface{}{}, "total": 0, "source": "no pool store integrated"})
		})
		api.GET("/:id", func(c *gin.Context) { unavailable(c, "pool lookup") })
		api.PUT("/:id", func(c *gin.Context) { notImplemented(c, "pool update") })

		// Membership — mutations fail loud.
		api.POST("/:id/join", func(c *gin.Context) { notImplemented(c, "pool membership") })
		api.POST("/:id/leave", func(c *gin.Context) { notImplemented(c, "pool membership") })
		api.GET("/:id/members", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"members": []interface{}{}, "count": 0, "source": "no pool store integrated"})
		})
		api.POST("/:id/invite", func(c *gin.Context) { notImplemented(c, "pool invitations") })

		// Contributions — MONEY: fail closed, never acknowledge funds.
		api.POST("/:id/contribute", func(c *gin.Context) {
			notImplemented(c, "pool contributions (no ledger integrated; funds cannot be accepted)")
		})
		api.GET("/:id/contributions", func(c *gin.Context) { unavailable(c, "contribution history") })
		api.GET("/:id/ledger", func(c *gin.Context) { unavailable(c, "pool ledger") })

		// Claims & Voting — money-adjacent: fail loud.
		api.POST("/:id/claims", func(c *gin.Context) { notImplemented(c, "pool claims") })
		api.GET("/:id/claims", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"claims": []interface{}{}, "total": 0, "source": "no pool store integrated"})
		})
		api.POST("/:id/claims/:claimId/vote", func(c *gin.Context) { notImplemented(c, "claim voting") })
		api.POST("/:id/claims/:claimId/payout", func(c *gin.Context) {
			notImplemented(c, "claim payout (no payment rail or ledger integrated; no payout can be executed)")
		})

		// Analytics — no store: fail loud.
		api.GET("/:id/stats", func(c *gin.Context) { unavailable(c, "pool statistics") })
		api.GET("/discover", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"pools": []interface{}{}, "source": "no pool store integrated"})
		})
	}

	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "p2p-pools", "backing_stores": "unavailable"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8085"
	}

	srv := &http.Server{Addr: ":" + port, Handler: router, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second}
	go func() {
		log.Printf("p2p-pools starting on :%s (no persistence/ledger integrated — mutating endpoints fail loudly)", port)
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
