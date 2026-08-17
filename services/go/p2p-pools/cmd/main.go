package main

import (
	"context"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

// Pool represents a peer-to-peer microinsurance pool (digital ajo)
type Pool struct {
	ID             int64    `json:"id"`
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	InsuranceType  string   `json:"insuranceType"` // health, motor, life, property
	MaxMembers     int      `json:"maxMembers"`
	CurrentMembers int      `json:"currentMembers"`
	MonthlyContrib float64  `json:"monthlyContribution"` // per member in NGN
	TotalPooled    float64  `json:"totalPooled"`
	MaxCoverage    float64  `json:"maxCoverage"` // per claim
	Status         string   `json:"status"`      // forming, active, suspended, dissolved
	Region         string   `json:"region"`
	AdminUserID    int64    `json:"adminUserId"`
	Members        []Member `json:"members,omitempty"`
	CreatedAt      string   `json:"createdAt"`
}

// Member represents a pool member
type Member struct {
	UserID     int64   `json:"userId"`
	Name       string  `json:"name"`
	JoinedAt   string  `json:"joinedAt"`
	TotalPaid  float64 `json:"totalPaid"`
	ClaimsMade int     `json:"claimsMade"`
	Status     string  `json:"status"`     // active, suspended, left
	TrustScore float64 `json:"trustScore"` // 0-100 peer rating
}

// PoolClaim represents a claim against the pool
type PoolClaim struct {
	ID           int64   `json:"id"`
	PoolID       int64   `json:"poolId"`
	ClaimantID   int64   `json:"claimantId"`
	Amount       float64 `json:"amount"`
	Reason       string  `json:"reason"`
	Evidence     string  `json:"evidence"`
	Status       string  `json:"status"` // pending_vote, approved, rejected, paid
	VotesFor     int     `json:"votesFor"`
	VotesAgainst int     `json:"votesAgainst"`
	VotesNeeded  int     `json:"votesNeeded"` // 67% majority
	CreatedAt    string  `json:"createdAt"`
}

func main() {
	router := gin.New()
	router.Use(gin.Recovery())

	api := router.Group("/api/v1/pools")
	{
		// Pool CRUD
		api.POST("", createPool)
		api.GET("", listPools)
		api.GET("/:id", getPool)
		api.PUT("/:id", updatePool)

		// Membership
		api.POST("/:id/join", joinPool)
		api.POST("/:id/leave", leavePool)
		api.GET("/:id/members", getMembers)
		api.POST("/:id/invite", inviteToPool)

		// Contributions
		api.POST("/:id/contribute", makeContribution)
		api.GET("/:id/contributions", listContributions)
		api.GET("/:id/ledger", getPoolLedger)

		// Claims & Voting
		api.POST("/:id/claims", submitPoolClaim)
		api.GET("/:id/claims", listPoolClaims)
		api.POST("/:id/claims/:claimId/vote", voteOnClaim)
		api.POST("/:id/claims/:claimId/payout", processClaimPayout)

		// Analytics
		api.GET("/:id/stats", getPoolStats)
		api.GET("/discover", discoverPools)
	}

	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "p2p-pools"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8085"
	}

	srv := &http.Server{Addr: ":" + port, Handler: router, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second}
	go func() {
		log.Printf("p2p-pools starting on :%s", port)
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

func createPool(c *gin.Context) {
	var req struct {
		Name           string  `json:"name" binding:"required"`
		Description    string  `json:"description"`
		InsuranceType  string  `json:"insuranceType" binding:"required"`
		MaxMembers     int     `json:"maxMembers" binding:"required"`
		MonthlyContrib float64 `json:"monthlyContribution" binding:"required"`
		MaxCoverage    float64 `json:"maxCoverage" binding:"required"`
		Region         string  `json:"region" binding:"required"`
		AdminUserID    int64   `json:"adminUserId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":                  1,
		"name":                req.Name,
		"insuranceType":       req.InsuranceType,
		"maxMembers":          req.MaxMembers,
		"monthlyContribution": req.MonthlyContrib,
		"maxCoverage":         req.MaxCoverage,
		"status":              "forming",
		"inviteCode":          generateInviteCode(),
	})
}

func listPools(c *gin.Context) {
	pools := []Pool{
		{ID: 1, Name: "Lagos Motor Circle", InsuranceType: "motor", MaxMembers: 20, CurrentMembers: 15, MonthlyContrib: 5000, TotalPooled: 450000, Status: "active", Region: "Lagos"},
		{ID: 2, Name: "Kano Health Ajo", InsuranceType: "health", MaxMembers: 30, CurrentMembers: 28, MonthlyContrib: 3000, TotalPooled: 756000, Status: "active", Region: "Kano"},
		{ID: 3, Name: "Abuja Property Shield", InsuranceType: "property", MaxMembers: 15, CurrentMembers: 8, MonthlyContrib: 10000, TotalPooled: 240000, Status: "forming", Region: "Abuja"},
	}
	c.JSON(http.StatusOK, gin.H{"pools": pools, "total": len(pools)})
}

func getPool(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"id":             c.Param("id"),
		"name":           "Lagos Motor Circle",
		"status":         "active",
		"currentMembers": 15,
		"totalPooled":    450000,
	})
}

func updatePool(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "updated"})
}

func joinPool(c *gin.Context) {
	var req struct {
		UserID     int64  `json:"userId" binding:"required"`
		InviteCode string `json:"inviteCode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "joined", "message": "Welcome to the pool! First contribution due in 30 days."})
}

func leavePool(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "left", "refund": 0})
}

func getMembers(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"members": []interface{}{}, "count": 0})
}

func inviteToPool(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"inviteCode": generateInviteCode(), "expiresIn": "7 days"})
}

func makeContribution(c *gin.Context) {
	var req struct {
		UserID int64   `json:"userId" binding:"required"`
		Amount float64 `json:"amount" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "received", "amount": req.Amount, "newBalance": 450000 + req.Amount})
}

func listContributions(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"contributions": []interface{}{}, "total": 0})
}

func getPoolLedger(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"ledger":        []interface{}{},
		"totalInflows":  450000,
		"totalOutflows": 150000,
		"balance":       300000,
	})
}

func submitPoolClaim(c *gin.Context) {
	var req struct {
		ClaimantID int64   `json:"claimantId" binding:"required"`
		Amount     float64 `json:"amount" binding:"required"`
		Reason     string  `json:"reason" binding:"required"`
		Evidence   string  `json:"evidence"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	votesNeeded := int(math.Ceil(15 * 0.67)) // 67% of current members

	c.JSON(http.StatusCreated, gin.H{
		"claimId":     1,
		"status":      "pending_vote",
		"votesNeeded": votesNeeded,
		"votingEnds":  time.Now().Add(72 * time.Hour).Format(time.RFC3339),
		"message":     "Claim submitted. Members have 72 hours to vote.",
	})
}

func listPoolClaims(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"claims": []interface{}{}, "total": 0})
}

func voteOnClaim(c *gin.Context) {
	var req struct {
		VoterID int64  `json:"voterId" binding:"required"`
		Vote    string `json:"vote" binding:"required"` // approve, reject
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "voted", "vote": req.Vote})
}

func processClaimPayout(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "processing", "estimatedTime": "24 hours"})
}

func getPoolStats(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"members":        15,
		"totalPooled":    450000,
		"totalClaims":    5,
		"claimsPaid":     4,
		"claimsRejected": 1,
		"avgVoteTime":    "18 hours",
		"lossRatio":      0.33,
	})
}

func discoverPools(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"pools": []map[string]interface{}{
			{"id": 1, "name": "Lagos Motor Circle", "openSlots": 5, "monthlyContrib": 5000},
			{"id": 2, "name": "Kano Health Ajo", "openSlots": 2, "monthlyContrib": 3000},
		},
	})
}

func generateInviteCode() string {
	return "INV-" + time.Now().Format("20060102") + "-ABCD"
}
