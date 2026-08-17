package main

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

// TelematicsEvent represents a single driving data point from mobile sensors
type TelematicsEvent struct {
	UserID       int64   `json:"userId"`
	PolicyID     int64   `json:"policyId"`
	Timestamp    int64   `json:"timestamp"`
	Latitude     float64 `json:"latitude"`
	Longitude    float64 `json:"longitude"`
	Speed        float64 `json:"speed"`        // km/h
	Acceleration float64 `json:"acceleration"` // m/s²
	Braking      float64 `json:"braking"`      // m/s² (negative)
	Cornering    float64 `json:"cornering"`    // lateral g-force
	PhoneUsage   bool    `json:"phoneUsage"`   // screen active while driving
	NightDrive   bool    `json:"nightDrive"`   // between 11pm-5am
	TripID       string  `json:"tripId"`
}

// DrivingScore represents the computed driving behavior score
type DrivingScore struct {
	UserID          int64   `json:"userId"`
	PolicyID        int64   `json:"policyId"`
	OverallScore    float64 `json:"overallScore"`   // 0-100, higher = better driver
	SpeedScore      float64 `json:"speedScore"`     // penalized for speeding
	BrakingScore    float64 `json:"brakingScore"`   // penalized for harsh braking
	CorneringScore  float64 `json:"corneringScore"` // penalized for aggressive cornering
	PhoneScore      float64 `json:"phoneScore"`     // penalized for phone usage
	NightScore      float64 `json:"nightScore"`     // penalized for excessive night driving
	TotalTrips      int     `json:"totalTrips"`
	TotalKm         float64 `json:"totalKm"`
	PremiumDiscount float64 `json:"premiumDiscount"` // percentage discount earned
	Tier            string  `json:"tier"`            // safe, moderate, risky, dangerous
	UpdatedAt       string  `json:"updatedAt"`
}

func main() {
	router := gin.New()
	router.Use(gin.Recovery())

	// Telematics API endpoints
	api := router.Group("/api/v1/telematics")
	{
		api.POST("/events", ingestEvents)
		api.POST("/trip/start", startTrip)
		api.POST("/trip/end", endTrip)
		api.GET("/score/:userId", getUserScore)
		api.GET("/score/:userId/history", getScoreHistory)
		api.GET("/trips/:userId", getUserTrips)
		api.GET("/discount/:userId", getDiscount)
		api.GET("/leaderboard", getLeaderboard)
	}

	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "telematics-engine"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8083"
	}

	srv := &http.Server{Addr: ":" + port, Handler: router, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second}
	go func() {
		log.Printf("telematics-engine starting on :%s", port)
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

func ingestEvents(c *gin.Context) {
	var events []TelematicsEvent
	if err := c.ShouldBindJSON(&events); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid events payload"})
		return
	}

	// Process and score each event batch
	processed := 0
	for range events {
		processed++
	}

	c.JSON(http.StatusOK, gin.H{
		"processed": processed,
		"status":    "ingested",
	})
}

func startTrip(c *gin.Context) {
	var req struct {
		UserID   int64  `json:"userId" binding:"required"`
		PolicyID int64  `json:"policyId" binding:"required"`
		TripID   string `json:"tripId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"tripId":  req.TripID,
		"status":  "started",
		"message": "Trip tracking activated. Drive safely!",
	})
}

func endTrip(c *gin.Context) {
	var req struct {
		UserID   int64   `json:"userId" binding:"required"`
		TripID   string  `json:"tripId" binding:"required"`
		Distance float64 `json:"distance"` // km
		Duration int     `json:"duration"` // seconds
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Compute trip score
	tripScore := computeTripScore(req.Distance, req.Duration)

	c.JSON(http.StatusOK, gin.H{
		"tripId":    req.TripID,
		"status":    "completed",
		"tripScore": tripScore,
		"distance":  req.Distance,
		"duration":  req.Duration,
	})
}

func getUserScore(c *gin.Context) {
	score := DrivingScore{
		UserID:          1,
		PolicyID:        1,
		OverallScore:    78.5,
		SpeedScore:      82.0,
		BrakingScore:    75.0,
		CorneringScore:  80.0,
		PhoneScore:      70.0,
		NightScore:      90.0,
		TotalTrips:      45,
		TotalKm:         1250.5,
		PremiumDiscount: 15.0,
		Tier:            "safe",
		UpdatedAt:       time.Now().Format(time.RFC3339),
	}
	c.JSON(http.StatusOK, score)
}

func getScoreHistory(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"history": []map[string]interface{}{
			{"week": "2026-W20", "score": 75.0},
			{"week": "2026-W21", "score": 78.5},
			{"week": "2026-W22", "score": 80.2},
		},
	})
}

func getUserTrips(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"trips": []interface{}{}, "total": 0})
}

func getDiscount(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"currentDiscount": 15.0,
		"maxDiscount":     40.0,
		"tier":            "safe",
		"nextTier":        "excellent",
		"pointsNeeded":    200,
		"message":         "Drive 200 more km safely to unlock 20% discount!",
	})
}

func getLeaderboard(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"leaderboard": []map[string]interface{}{
			{"rank": 1, "userId": 42, "score": 95.2, "tier": "excellent"},
			{"rank": 2, "userId": 17, "score": 92.8, "tier": "excellent"},
			{"rank": 3, "userId": 1, "score": 78.5, "tier": "safe"},
		},
	})
}

func computeTripScore(distance float64, duration int) float64 {
	if distance <= 0 || duration <= 0 {
		return 50.0
	}
	avgSpeed := distance / (float64(duration) / 3600.0)
	score := 100.0
	if avgSpeed > 120 {
		score -= math.Min((avgSpeed-120)*2, 50)
	}
	return math.Max(score, 0)
}

func toJSON(v interface{}) []byte {
	b, _ := json.Marshal(v)
	return b
}
