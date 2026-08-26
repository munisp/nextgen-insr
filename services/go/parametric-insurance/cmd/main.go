package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

// Parametric Insurance — policies with weather-triggered automatic payouts.
//
// HONEST CONTRACT: this service has no policy store, no weather-history
// store, and no payment rail integrated (the module carries no database
// driver). Mutating endpoints (policy creation, weather ingestion, payout
// processing, trigger evaluation) FAIL LOUD (501) rather than acknowledge
// work that would vanish. Current weather is served ONLY from a real
// OpenWeatherMap call when WEATHER_API_KEY is configured (same provider as
// the in-tree smart-contract-oracle); otherwise the endpoint returns 503.
// Weather data is NEVER fabricated and NEVER attributed to NiMet without a
// real NiMet feed.

func notImplemented(c *gin.Context, capability string) {
	c.JSON(http.StatusNotImplemented, gin.H{
		"error":  capability + " is not implemented: this service has no persistence, weather-history store, or payment rail integrated; refusing to acknowledge an operation that would not be recorded",
		"status": "not_implemented",
	})
}

func unavailable(c *gin.Context, capability string) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"error":  capability + " is unavailable: no backing data source is integrated with this service; refusing to fabricate data",
		"status": "unavailable",
	})
}

// fetchCurrentWeather performs a REAL OpenWeatherMap call. It returns an
// honest error when unconfigured or when the provider call fails.
func fetchCurrentWeather(region string) (map[string]interface{}, error) {
	apiKey := os.Getenv("WEATHER_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("no weather provider configured (set WEATHER_API_KEY for OpenWeatherMap)")
	}
	q := url.Values{}
	q.Set("q", region+",NG")
	q.Set("appid", apiKey)
	q.Set("units", "metric")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get("https://api.openweathermap.org/data/2.5/weather?" + q.Encode())
	if err != nil {
		return nil, fmt.Errorf("weather provider call failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("weather provider returned HTTP %d", resp.StatusCode)
	}
	var ow struct {
		Main struct {
			Temp     float64 `json:"temp"`
			Humidity float64 `json:"humidity"`
		} `json:"main"`
		Wind struct {
			Speed float64 `json:"speed"` // m/s
		} `json:"wind"`
		Rain struct {
			OneH float64 `json:"1h"` // mm last hour
		} `json:"rain"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&ow); err != nil {
		return nil, fmt.Errorf("weather provider response undecodable: %w", err)
	}
	return map[string]interface{}{
		"region":      region,
		"temperature": ow.Main.Temp,
		"rainfall":    ow.Rain.OneH,
		"windSpeed":   ow.Wind.Speed * 3.6, // m/s → km/h
		"humidity":    ow.Main.Humidity,
		"source":      "openweathermap",
		"timestamp":   time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func main() {
	router := gin.New()
	router.Use(gin.Recovery())

	api := router.Group("/api/v1/parametric")
	{
		// Policy management — mutations fail loud (no store).
		api.POST("/policies", func(c *gin.Context) { notImplemented(c, "policy creation") })
		api.GET("/policies", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"policies": []interface{}{}, "total": 0, "source": "no policy store integrated"})
		})
		api.GET("/policies/:id", func(c *gin.Context) { unavailable(c, "policy lookup") })

		// Weather data — ingestion fails loud (no store); current weather is
		// real via OpenWeatherMap when configured, else 503.
		api.POST("/weather/ingest", func(c *gin.Context) { notImplemented(c, "weather data ingestion") })
		api.GET("/weather/current/:region", getCurrentWeather)
		api.GET("/weather/history/:region", func(c *gin.Context) { unavailable(c, "weather history") })

		// Trigger evaluation — impossible without policy + weather stores.
		api.POST("/evaluate", func(c *gin.Context) { notImplemented(c, "trigger evaluation (no policy or weather store integrated)") })
		api.GET("/triggers/active", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"triggers": []interface{}{}, "count": 0, "source": "no policy store integrated"})
		})

		// Payouts — MONEY: fail closed, never claim processing.
		api.GET("/payouts", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"payouts": []interface{}{}, "total": 0, "source": "no payout store integrated"})
		})
		api.GET("/payouts/:id", func(c *gin.Context) { unavailable(c, "payout lookup") })
		api.POST("/payouts/:id/process", func(c *gin.Context) {
			notImplemented(c, "payout processing (no payment rail integrated; no payout can be executed)")
		})

		// Quotes — static, disclosed rate table (labeled honestly).
		api.POST("/quote", getParametricQuote)

		// Analytics — regional rainfall figures require a real climate data
		// source; seasonal labels are qualitative climatology, labeled as such.
		api.GET("/analytics/risk-map", func(c *gin.Context) { unavailable(c, "risk map (no climate data source integrated)") })
		api.GET("/analytics/seasonal", getSeasonalAnalysis)
	}

	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":           "healthy",
			"service":          "parametric-insurance",
			"weather_provider": os.Getenv("WEATHER_API_KEY") != "",
			"backing_stores":   "unavailable",
		})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8084"
	}

	srv := &http.Server{Addr: ":" + port, Handler: router, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second}
	go func() {
		log.Printf("parametric-insurance starting on :%s (weather provider configured: %t)", port, os.Getenv("WEATHER_API_KEY") != "")
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

func getCurrentWeather(c *gin.Context) {
	data, err := fetchCurrentWeather(c.Param("region"))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":  "current weather unavailable: " + err.Error(),
			"status": "unavailable",
		})
		return
	}
	c.JSON(http.StatusOK, data)
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
	if req.Duration <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "durationMonths must be positive"})
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
		"basis":          "static_rate_table", // disclosed heuristic rates — not derived from historical claims data
	})
}

func getSeasonalAnalysis(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"basis": "general_climatology", // qualitative seasonal labels, not measured data
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
