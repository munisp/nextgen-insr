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

// ParametricPolicy represents a parametric insurance policy with trigger conditions
type ParametricPolicy struct {
	ID              int64             `json:"id"`
	UserID          int64             `json:"userId"`
	PolicyNumber    string            `json:"policyNumber"`
	Type            string            `json:"type"` // rainfall, drought, flood, temperature, wind
	Region          string            `json:"region"`
	Coordinates     [2]float64        `json:"coordinates"` // [lat, lng]
	TriggerParams   TriggerParameters `json:"triggerParams"`
	CoverageAmount  float64           `json:"coverageAmount"`
	Premium         float64           `json:"premium"`
	Status          string            `json:"status"` // active, triggered, expired, paid_out
	StartDate       string            `json:"startDate"`
	EndDate         string            `json:"endDate"`
	CreatedAt       string            `json:"createdAt"`
}

// TriggerParameters defines the conditions that trigger an automatic payout
type TriggerParameters struct {
	MetricType      string  `json:"metricType"`      // rainfall_mm, temperature_c, wind_speed_kmh
	ThresholdValue  float64 `json:"thresholdValue"`  // trigger when metric exceeds this
	ThresholdType   string  `json:"thresholdType"`   // above, below
	MeasurementDays int     `json:"measurementDays"` // over how many consecutive days
	DataSource      string  `json:"dataSource"`      // openweathermap, nimet, satellite
}

// WeatherDataPoint represents a single weather measurement
type WeatherDataPoint struct {
	Timestamp   time.Time `json:"timestamp"`
	Latitude    float64   `json:"latitude"`
	Longitude   float64   `json:"longitude"`
	Rainfall    float64   `json:"rainfall"`    // mm
	Temperature float64   `json:"temperature"` // celsius
	WindSpeed   float64   `json:"windSpeed"`   // km/h
	Humidity    float64   `json:"humidity"`    // percentage
	Source      string    `json:"source"`
}

// PayoutEvent represents an auto-triggered payout
type PayoutEvent struct {
	ID             int64   `json:"id"`
	PolicyID       int64   `json:"policyId"`
	TriggerValue   float64 `json:"triggerValue"`
	ThresholdValue float64 `json:"thresholdValue"`
	PayoutAmount   float64 `json:"payoutAmount"`
	Status         string  `json:"status"` // pending, processing, completed, failed
	TriggeredAt    string  `json:"triggeredAt"`
	PaidAt         string  `json:"paidAt,omitempty"`
}

func main() {
	router := gin.New()
	router.Use(gin.Recovery())

	api := router.Group("/api/v1/parametric")
	{
		// Policy management
		api.POST("/policies", createPolicy)
		api.GET("/policies", listPolicies)
		api.GET("/policies/:id", getPolicy)

		// Weather data ingestion
		api.POST("/weather/ingest", ingestWeatherData)
		api.GET("/weather/current/:region", getCurrentWeather)
		api.GET("/weather/history/:region", getWeatherHistory)

		// Trigger evaluation
		api.POST("/evaluate", evaluateTriggers)
		api.GET("/triggers/active", getActiveTriggers)

		// Payouts
		api.GET("/payouts", listPayouts)
		api.GET("/payouts/:id", getPayoutDetails)
		api.POST("/payouts/:id/process", processPayout)

		// Quotes
		api.POST("/quote", getParametricQuote)

		// Analytics
		api.GET("/analytics/risk-map", getRiskMap)
		api.GET("/analytics/seasonal", getSeasonalAnalysis)
	}

	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "parametric-insurance"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8084"
	}

	srv := &http.Server{Addr: ":" + port, Handler: router, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second}
	go func() {
		log.Printf("parametric-insurance starting on :%s", port)
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

func createPolicy(c *gin.Context) {
	var req struct {
		UserID         int64             `json:"userId" binding:"required"`
		Type           string            `json:"type" binding:"required"`
		Region         string            `json:"region" binding:"required"`
		Coordinates    [2]float64        `json:"coordinates" binding:"required"`
		TriggerParams  TriggerParameters `json:"triggerParams" binding:"required"`
		CoverageAmount float64           `json:"coverageAmount" binding:"required"`
		Duration       int               `json:"durationMonths" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	premium := calculateParametricPremium(req.CoverageAmount, req.Type, req.Region, req.Duration)

	c.JSON(http.StatusCreated, gin.H{
		"policyNumber":   "PAR-2026-" + req.Region[:3] + "-001",
		"type":           req.Type,
		"region":         req.Region,
		"coverageAmount": req.CoverageAmount,
		"premium":        premium,
		"status":         "active",
		"triggerParams":  req.TriggerParams,
	})
}

func listPolicies(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"policies": []interface{}{}, "total": 0})
}

func getPolicy(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "status": "active"})
}

func ingestWeatherData(c *gin.Context) {
	var data []WeatherDataPoint
	if err := c.ShouldBindJSON(&data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ingested": len(data), "status": "processed"})
}

func getCurrentWeather(c *gin.Context) {
	region := c.Param("region")
	c.JSON(http.StatusOK, gin.H{
		"region":      region,
		"temperature": 32.5,
		"rainfall":    5.2,
		"windSpeed":   12.0,
		"humidity":    78.0,
		"source":      "nimet",
		"timestamp":   time.Now().Format(time.RFC3339),
	})
}

func getWeatherHistory(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"region": c.Param("region"), "history": []interface{}{}, "period": "30d"})
}

func evaluateTriggers(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"evaluated":    0,
		"triggered":    0,
		"payoutsQueue": 0,
	})
}

func getActiveTriggers(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"triggers": []interface{}{}, "count": 0})
}

func listPayouts(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"payouts": []interface{}{}, "total": 0})
}

func getPayoutDetails(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "status": "pending"})
}

func processPayout(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "status": "processing"})
}

func getParametricQuote(c *gin.Context) {
	var req struct {
		Type           string     `json:"type" binding:"required"`
		Region         string     `json:"region" binding:"required"`
		CoverageAmount float64    `json:"coverageAmount" binding:"required"`
		Duration       int        `json:"durationMonths" binding:"required"`
		Coordinates    [2]float64 `json:"coordinates"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	premium := calculateParametricPremium(req.CoverageAmount, req.Type, req.Region, req.Duration)

	c.JSON(http.StatusOK, gin.H{
		"type":           req.Type,
		"region":         req.Region,
		"coverageAmount": req.CoverageAmount,
		"premium":        premium,
		"premiumMonthly": premium / float64(req.Duration),
		"riskLevel":      classifyRegionRisk(req.Region, req.Type),
		"historicalTriggers": 2,
	})
}

func getRiskMap(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"regions": []map[string]interface{}{
			{"name": "Lagos", "riskLevel": "medium", "avgRainfall": 180.0},
			{"name": "Kano", "riskLevel": "high", "avgRainfall": 60.0},
			{"name": "Benue", "riskLevel": "high", "avgRainfall": 220.0},
			{"name": "Niger", "riskLevel": "medium", "avgRainfall": 150.0},
		},
	})
}

func getSeasonalAnalysis(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"seasons": []map[string]interface{}{
			{"name": "Dry Season", "months": "Nov-Mar", "riskLevel": "low"},
			{"name": "Early Rain", "months": "Apr-Jun", "riskLevel": "medium"},
			{"name": "Peak Rain", "months": "Jul-Sep", "riskLevel": "high"},
			{"name": "Late Rain", "months": "Oct-Nov", "riskLevel": "medium"},
		},
	})
}

func calculateParametricPremium(coverage float64, policyType, region string, months int) float64 {
	baseRate := 0.03 // 3% of coverage per year
	switch policyType {
	case "rainfall":
		baseRate = 0.035
	case "drought":
		baseRate = 0.04
	case "flood":
		baseRate = 0.05
	case "temperature":
		baseRate = 0.025
	case "wind":
		baseRate = 0.03
	}

	regionMultiplier := 1.0
	switch region {
	case "Lagos", "Rivers", "Bayelsa":
		regionMultiplier = 1.3 // Coastal flood risk
	case "Benue", "Kogi", "Niger":
		regionMultiplier = 1.2 // River basin risk
	case "Kano", "Sokoto", "Zamfara":
		regionMultiplier = 1.1 // Drought risk
	}

	annual := coverage * baseRate * regionMultiplier
	return math.Round(annual/12*float64(months)*100) / 100
}

func classifyRegionRisk(region, policyType string) string {
	switch {
	case policyType == "flood" && (region == "Lagos" || region == "Rivers"):
		return "high"
	case policyType == "drought" && (region == "Kano" || region == "Sokoto"):
		return "high"
	default:
		return "medium"
	}
}
