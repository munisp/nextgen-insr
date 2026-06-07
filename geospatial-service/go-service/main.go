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
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Configuration
type Config struct {
	Port        string
	DatabaseURL string
}

// Server holds the application dependencies
type Server struct {
	db     *pgxpool.Pool
	router *gin.Engine
}

// Location represents a geographic point
type Location struct {
	Longitude float64 `json:"longitude"`
	Latitude  float64 `json:"latitude"`
}

// Agent represents an insurance agent with location
type Agent struct {
	AgentID              string  `json:"agent_id"`
	AgentName            string  `json:"agent_name"`
	OfficeAddress        string  `json:"office_address"`
	DistanceKm           float64 `json:"distance_km"`
	AssignedPoliciesCount int    `json:"assigned_policies_count"`
}

// HealthcareProvider represents a healthcare facility
type HealthcareProvider struct {
	ProviderID       string  `json:"provider_id"`
	Name             string  `json:"name"`
	ProviderType     string  `json:"provider_type"`
	Address          string  `json:"address"`
	DistanceKm       float64 `json:"distance_km"`
	Is24Hours        bool    `json:"is_24_hours"`
	AcceptsEmergency bool    `json:"accepts_emergency"`
	Phone            string  `json:"phone"`
}

// RepairShop represents an auto repair facility
type RepairShop struct {
	ShopID            string   `json:"shop_id"`
	Name              string   `json:"name"`
	ShopType          string   `json:"shop_type"`
	Address           string   `json:"address"`
	DistanceKm        float64  `json:"distance_km"`
	IsNetworkProvider bool     `json:"is_network_provider"`
	BrandsServiced    []string `json:"brands_serviced"`
	AvgRating         float64  `json:"avg_rating"`
	Phone             string   `json:"phone"`
}

// RiskAssessment represents location-based risk factors
type RiskAssessment struct {
	FloodRisk          string        `json:"flood_risk"`
	FloodMultiplier    float64       `json:"flood_multiplier"`
	CrimeRisk          string        `json:"crime_risk"`
	CrimeMultiplier    float64       `json:"crime_multiplier"`
	FireRisk           string        `json:"fire_risk"`
	FireMultiplier     float64       `json:"fire_multiplier"`
	CombinedRiskScore  int           `json:"combined_risk_score"`
	CombinedMultiplier float64       `json:"combined_multiplier"`
	RiskFactors        []RiskFactor  `json:"risk_factors"`
}

// RiskFactor represents a single risk factor
type RiskFactor struct {
	Type       string  `json:"type"`
	Level      string  `json:"level"`
	Multiplier float64 `json:"multiplier"`
}

// ClaimCluster represents a potential fraud cluster
type ClaimCluster struct {
	ClusterID         string    `json:"cluster_id"`
	ClaimIDs          []string  `json:"claim_ids"`
	ClaimCount        int       `json:"claim_count"`
	TotalAmount       float64   `json:"total_amount"`
	CentroidLongitude float64   `json:"centroid_longitude"`
	CentroidLatitude  float64   `json:"centroid_latitude"`
	RadiusKm          float64   `json:"radius_km"`
	EarliestDate      time.Time `json:"earliest_date"`
	LatestDate        time.Time `json:"latest_date"`
}

// PolicyLocation represents a policy with geospatial data
type PolicyLocation struct {
	ID                string   `json:"id"`
	PolicyID          string   `json:"policy_id"`
	CustomerID        string   `json:"customer_id"`
	PolicyType        string   `json:"policy_type"`
	AddressLine1      string   `json:"address_line1"`
	City              string   `json:"city"`
	StateCode         string   `json:"state_code"`
	Longitude         float64  `json:"longitude"`
	Latitude          float64  `json:"latitude"`
	FloodRiskZoneID   *string  `json:"flood_risk_zone_id,omitempty"`
	CrimeRiskZoneID   *string  `json:"crime_risk_zone_id,omitempty"`
	FireRiskZoneID    *string  `json:"fire_risk_zone_id,omitempty"`
	SumAssured        float64  `json:"sum_assured"`
	PremiumAmount     float64  `json:"premium_amount"`
	Status            string   `json:"status"`
}

// ClaimLocation represents a claim with geospatial data
type ClaimLocation struct {
	ID                   string    `json:"id"`
	ClaimID              string    `json:"claim_id"`
	PolicyID             string    `json:"policy_id"`
	CustomerID           string    `json:"customer_id"`
	ClaimType            string    `json:"claim_type"`
	IncidentAddress      string    `json:"incident_address"`
	IncidentCity         string    `json:"incident_city"`
	IncidentStateCode    string    `json:"incident_state_code"`
	Longitude            float64   `json:"longitude"`
	Latitude             float64   `json:"latitude"`
	ClaimAmount          float64   `json:"claim_amount"`
	IncidentDate         time.Time `json:"incident_date"`
	Status               string    `json:"status"`
	IsClustered          bool      `json:"is_clustered"`
	ClusterID            *string   `json:"cluster_id,omitempty"`
	DistanceFromPolicyKm float64   `json:"distance_from_policy_km"`
}

// HeatmapPoint represents a point for heatmap visualization
type HeatmapPoint struct {
	Longitude   float64 `json:"longitude"`
	Latitude    float64 `json:"latitude"`
	Weight      float64 `json:"weight"`
	ClaimType   string  `json:"claim_type,omitempty"`
	ClaimAmount float64 `json:"claim_amount,omitempty"`
}

// State represents a Nigerian state
type State struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Code    string `json:"code"`
	Capital string `json:"capital"`
	Region  string `json:"region"`
}

// LGA represents a Local Government Area
type LGA struct {
	ID        string `json:"id"`
	StateID   string `json:"state_id"`
	StateName string `json:"state_name"`
	Name      string `json:"name"`
	Code      string `json:"code"`
}

// PolicyDensity represents policy density by LGA
type PolicyDensity struct {
	LGAID           string  `json:"lga_id"`
	LGAName         string  `json:"lga_name"`
	StateName       string  `json:"state_name"`
	PolicyCount     int     `json:"policy_count"`
	TotalSumAssured float64 `json:"total_sum_assured"`
	TotalPremium    float64 `json:"total_premium"`
	CentroidLon     float64 `json:"centroid_longitude"`
	CentroidLat     float64 `json:"centroid_latitude"`
}

func loadConfig() Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/geospatial?sslmode=disable"
	}

	return Config{
		Port:        port,
		DatabaseURL: dbURL,
	}
}

func NewServer(db *pgxpool.Pool) *Server {
	router := gin.Default()
	
	server := &Server{
		db:     db,
		router: router,
	}
	
	server.setupRoutes()
	return server
}

func (s *Server) setupRoutes() {
	// Health check
	s.router.GET("/health", s.healthCheck)
	s.router.GET("/ready", s.readinessCheck)
	
	// Metrics
	s.router.GET("/metrics", gin.WrapH(promhttp.Handler()))
	
	// API v1
	v1 := s.router.Group("/api/v1")
	{
		// Location services
		v1.POST("/nearest-agents", s.findNearestAgents)
		v1.POST("/nearest-healthcare", s.findNearestHealthcare)
		v1.POST("/nearest-repair-shops", s.findNearestRepairShops)
		
		// Risk assessment
		v1.POST("/risk-assessment", s.calculateRiskAssessment)
		v1.GET("/risk-zones/flood", s.getFloodRiskZones)
		v1.GET("/risk-zones/crime", s.getCrimeRiskZones)
		v1.GET("/risk-zones/fire", s.getFireRiskZones)
		
		// Fraud detection
		v1.GET("/claim-clusters", s.detectClaimClusters)
		
		// Policy locations
		v1.POST("/policies/location", s.createPolicyLocation)
		v1.GET("/policies/location/:policy_id", s.getPolicyLocation)
		v1.PUT("/policies/location/:policy_id", s.updatePolicyLocation)
		v1.GET("/policies/by-area", s.getPoliciesByArea)
		
		// Claim locations
		v1.POST("/claims/location", s.createClaimLocation)
		v1.GET("/claims/location/:claim_id", s.getClaimLocation)
		v1.GET("/claims/heatmap", s.getClaimsHeatmap)
		
		// Administrative boundaries
		v1.GET("/states", s.getStates)
		v1.GET("/states/:code/lgas", s.getLGAsByState)
		v1.GET("/lgas/:id", s.getLGA)
		
		// Analytics
		v1.GET("/analytics/policy-density", s.getPolicyDensity)
		v1.GET("/analytics/claims-by-region", s.getClaimsByRegion)
		v1.GET("/analytics/agent-territories", s.getAgentTerritories)
	}
}

func (s *Server) healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "healthy"})
}

func (s *Server) readinessCheck(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	
	if err := s.db.Ping(ctx); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not ready", "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ready"})
}

// FindNearestAgentsRequest represents the request body
type FindNearestAgentsRequest struct {
	Longitude     float64 `json:"longitude" binding:"required"`
	Latitude      float64 `json:"latitude" binding:"required"`
	Limit         int     `json:"limit"`
	MaxDistanceKm float64 `json:"max_distance_km"`
}

func (s *Server) findNearestAgents(c *gin.Context) {
	var req FindNearestAgentsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	if req.Limit == 0 {
		req.Limit = 5
	}
	if req.MaxDistanceKm == 0 {
		req.MaxDistanceKm = 100
	}
	
	query := `SELECT * FROM geospatial.find_nearest_agents($1, $2, $3, $4)`
	
	rows, err := s.db.Query(c.Request.Context(), query, req.Longitude, req.Latitude, req.Limit, req.MaxDistanceKm)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var agents []Agent
	for rows.Next() {
		var agent Agent
		if err := rows.Scan(&agent.AgentID, &agent.AgentName, &agent.OfficeAddress, &agent.DistanceKm, &agent.AssignedPoliciesCount); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		agents = append(agents, agent)
	}
	
	c.JSON(http.StatusOK, gin.H{"agents": agents, "count": len(agents)})
}

// FindNearestHealthcareRequest represents the request body
type FindNearestHealthcareRequest struct {
	Longitude    float64 `json:"longitude" binding:"required"`
	Latitude     float64 `json:"latitude" binding:"required"`
	ProviderType string  `json:"provider_type"`
	NetworkOnly  bool    `json:"network_only"`
	Limit        int     `json:"limit"`
	MaxDistanceKm float64 `json:"max_distance_km"`
}

func (s *Server) findNearestHealthcare(c *gin.Context) {
	var req FindNearestHealthcareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	if req.Limit == 0 {
		req.Limit = 10
	}
	if req.MaxDistanceKm == 0 {
		req.MaxDistanceKm = 50
	}
	
	var providerType *string
	if req.ProviderType != "" {
		providerType = &req.ProviderType
	}
	
	query := `SELECT * FROM geospatial.find_nearest_healthcare($1, $2, $3, $4, $5, $6)`
	
	rows, err := s.db.Query(c.Request.Context(), query, req.Longitude, req.Latitude, providerType, req.NetworkOnly, req.Limit, req.MaxDistanceKm)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var providers []HealthcareProvider
	for rows.Next() {
		var p HealthcareProvider
		if err := rows.Scan(&p.ProviderID, &p.Name, &p.ProviderType, &p.Address, &p.DistanceKm, &p.Is24Hours, &p.AcceptsEmergency, &p.Phone); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		providers = append(providers, p)
	}
	
	c.JSON(http.StatusOK, gin.H{"providers": providers, "count": len(providers)})
}

// FindNearestRepairShopsRequest represents the request body
type FindNearestRepairShopsRequest struct {
	Longitude     float64 `json:"longitude" binding:"required"`
	Latitude      float64 `json:"latitude" binding:"required"`
	NetworkOnly   bool    `json:"network_only"`
	Limit         int     `json:"limit"`
	MaxDistanceKm float64 `json:"max_distance_km"`
}

func (s *Server) findNearestRepairShops(c *gin.Context) {
	var req FindNearestRepairShopsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	if req.Limit == 0 {
		req.Limit = 10
	}
	if req.MaxDistanceKm == 0 {
		req.MaxDistanceKm = 50
	}
	
	query := `
		SELECT 
			r.shop_id,
			r.name,
			r.shop_type,
			r.address,
			ROUND((ST_Distance(
				r.location::geography,
				ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
			) / 1000)::DECIMAL, 2) as distance_km,
			r.is_network_provider,
			r.brands_serviced,
			COALESCE(r.avg_rating, 0) as avg_rating,
			COALESCE(r.phone, '') as phone
		FROM geospatial.repair_shops r
		WHERE r.status = 'ACTIVE'
		AND ($3 = FALSE OR r.is_network_provider = TRUE)
		AND ST_DWithin(
			r.location::geography,
			ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
			$4 * 1000
		)
		ORDER BY r.location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
		LIMIT $5
	`
	
	rows, err := s.db.Query(c.Request.Context(), query, req.Longitude, req.Latitude, req.NetworkOnly, req.MaxDistanceKm, req.Limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var shops []RepairShop
	for rows.Next() {
		var shop RepairShop
		if err := rows.Scan(&shop.ShopID, &shop.Name, &shop.ShopType, &shop.Address, &shop.DistanceKm, &shop.IsNetworkProvider, &shop.BrandsServiced, &shop.AvgRating, &shop.Phone); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		shops = append(shops, shop)
	}
	
	c.JSON(http.StatusOK, gin.H{"repair_shops": shops, "count": len(shops)})
}

// RiskAssessmentRequest represents the request body
type RiskAssessmentRequest struct {
	Longitude  float64 `json:"longitude" binding:"required"`
	Latitude   float64 `json:"latitude" binding:"required"`
	PolicyType string  `json:"policy_type" binding:"required"`
}

func (s *Server) calculateRiskAssessment(c *gin.Context) {
	var req RiskAssessmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	query := `SELECT * FROM geospatial.calculate_location_risk($1, $2, $3)`
	
	var assessment RiskAssessment
	var riskFactorsJSON []byte
	
	err := s.db.QueryRow(c.Request.Context(), query, req.Longitude, req.Latitude, req.PolicyType).Scan(
		&assessment.FloodRisk,
		&assessment.FloodMultiplier,
		&assessment.CrimeRisk,
		&assessment.CrimeMultiplier,
		&assessment.FireRisk,
		&assessment.FireMultiplier,
		&assessment.CombinedRiskScore,
		&assessment.CombinedMultiplier,
		&riskFactorsJSON,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	if err := json.Unmarshal(riskFactorsJSON, &assessment.RiskFactors); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse risk factors"})
		return
	}
	
	c.JSON(http.StatusOK, assessment)
}

func (s *Server) getFloodRiskZones(c *gin.Context) {
	query := `
		SELECT 
			id,
			name,
			risk_level,
			ST_AsGeoJSON(boundary) as boundary_geojson,
			historical_claim_count,
			historical_loss_amount,
			premium_multiplier
		FROM geospatial.flood_risk_zones
		ORDER BY risk_level DESC
	`
	
	rows, err := s.db.Query(c.Request.Context(), query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var zones []map[string]interface{}
	for rows.Next() {
		var id, name, riskLevel, boundaryGeoJSON string
		var claimCount int
		var lossAmount, multiplier float64
		
		if err := rows.Scan(&id, &name, &riskLevel, &boundaryGeoJSON, &claimCount, &lossAmount, &multiplier); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		
		var boundary interface{}
		json.Unmarshal([]byte(boundaryGeoJSON), &boundary)
		
		zones = append(zones, map[string]interface{}{
			"id":                     id,
			"name":                   name,
			"risk_level":             riskLevel,
			"boundary":               boundary,
			"historical_claim_count": claimCount,
			"historical_loss_amount": lossAmount,
			"premium_multiplier":     multiplier,
		})
	}
	
	c.JSON(http.StatusOK, gin.H{"flood_risk_zones": zones, "count": len(zones)})
}

func (s *Server) getCrimeRiskZones(c *gin.Context) {
	query := `
		SELECT 
			id,
			name,
			risk_level,
			ST_AsGeoJSON(boundary) as boundary_geojson,
			theft_rate,
			robbery_rate,
			vehicle_theft_rate,
			premium_multiplier
		FROM geospatial.crime_risk_zones
		ORDER BY risk_level DESC
	`
	
	rows, err := s.db.Query(c.Request.Context(), query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var zones []map[string]interface{}
	for rows.Next() {
		var id, name, riskLevel, boundaryGeoJSON string
		var theftRate, robberyRate, vehicleTheftRate, multiplier float64
		
		if err := rows.Scan(&id, &name, &riskLevel, &boundaryGeoJSON, &theftRate, &robberyRate, &vehicleTheftRate, &multiplier); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		
		var boundary interface{}
		json.Unmarshal([]byte(boundaryGeoJSON), &boundary)
		
		zones = append(zones, map[string]interface{}{
			"id":                 id,
			"name":               name,
			"risk_level":         riskLevel,
			"boundary":           boundary,
			"theft_rate":         theftRate,
			"robbery_rate":       robberyRate,
			"vehicle_theft_rate": vehicleTheftRate,
			"premium_multiplier": multiplier,
		})
	}
	
	c.JSON(http.StatusOK, gin.H{"crime_risk_zones": zones, "count": len(zones)})
}

func (s *Server) getFireRiskZones(c *gin.Context) {
	query := `
		SELECT 
			id,
			name,
			risk_level,
			ST_AsGeoJSON(boundary) as boundary_geojson,
			building_density,
			fire_station_distance_km,
			historical_fire_count,
			premium_multiplier
		FROM geospatial.fire_risk_zones
		ORDER BY risk_level DESC
	`
	
	rows, err := s.db.Query(c.Request.Context(), query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var zones []map[string]interface{}
	for rows.Next() {
		var id, name, riskLevel, boundaryGeoJSON, buildingDensity string
		var fireStationDistance float64
		var fireCount int
		var multiplier float64
		
		if err := rows.Scan(&id, &name, &riskLevel, &boundaryGeoJSON, &buildingDensity, &fireStationDistance, &fireCount, &multiplier); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		
		var boundary interface{}
		json.Unmarshal([]byte(boundaryGeoJSON), &boundary)
		
		zones = append(zones, map[string]interface{}{
			"id":                       id,
			"name":                     name,
			"risk_level":               riskLevel,
			"boundary":                 boundary,
			"building_density":         buildingDensity,
			"fire_station_distance_km": fireStationDistance,
			"historical_fire_count":    fireCount,
			"premium_multiplier":       multiplier,
		})
	}
	
	c.JSON(http.StatusOK, gin.H{"fire_risk_zones": zones, "count": len(zones)})
}

func (s *Server) detectClaimClusters(c *gin.Context) {
	distanceKm, _ := strconv.ParseFloat(c.DefaultQuery("distance_km", "1.0"), 64)
	timeWindowDays, _ := strconv.Atoi(c.DefaultQuery("time_window_days", "30"))
	minClaims, _ := strconv.Atoi(c.DefaultQuery("min_claims", "3"))
	
	query := `SELECT * FROM geospatial.detect_claim_clusters($1, $2, $3)`
	
	rows, err := s.db.Query(c.Request.Context(), query, distanceKm, timeWindowDays, minClaims)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var clusters []ClaimCluster
	for rows.Next() {
		var cluster ClaimCluster
		if err := rows.Scan(
			&cluster.ClusterID,
			&cluster.ClaimIDs,
			&cluster.ClaimCount,
			&cluster.TotalAmount,
			&cluster.CentroidLongitude,
			&cluster.CentroidLatitude,
			&cluster.RadiusKm,
			&cluster.EarliestDate,
			&cluster.LatestDate,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		clusters = append(clusters, cluster)
	}
	
	c.JSON(http.StatusOK, gin.H{"clusters": clusters, "count": len(clusters)})
}

// CreatePolicyLocationRequest represents the request body
type CreatePolicyLocationRequest struct {
	PolicyID     string  `json:"policy_id" binding:"required"`
	CustomerID   string  `json:"customer_id" binding:"required"`
	PolicyType   string  `json:"policy_type" binding:"required"`
	AddressLine1 string  `json:"address_line1"`
	AddressLine2 string  `json:"address_line2"`
	City         string  `json:"city"`
	StateCode    string  `json:"state_code"`
	PostalCode   string  `json:"postal_code"`
	Longitude    float64 `json:"longitude" binding:"required"`
	Latitude     float64 `json:"latitude" binding:"required"`
	SumAssured   float64 `json:"sum_assured"`
	PremiumAmount float64 `json:"premium_amount"`
}

func (s *Server) createPolicyLocation(c *gin.Context) {
	var req CreatePolicyLocationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	query := `
		INSERT INTO geospatial.policy_locations (
			policy_id, customer_id, policy_type,
			address_line1, address_line2, city, state_code, postal_code,
			location, sum_assured, premium_amount
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8,
			ST_SetSRID(ST_MakePoint($9, $10), 4326),
			$11, $12
		)
		RETURNING id
	`
	
	var id string
	err := s.db.QueryRow(c.Request.Context(), query,
		req.PolicyID, req.CustomerID, req.PolicyType,
		req.AddressLine1, req.AddressLine2, req.City, req.StateCode, req.PostalCode,
		req.Longitude, req.Latitude,
		req.SumAssured, req.PremiumAmount,
	).Scan(&id)
	
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusCreated, gin.H{"id": id, "policy_id": req.PolicyID})
}

func (s *Server) getPolicyLocation(c *gin.Context) {
	policyID := c.Param("policy_id")
	
	query := `
		SELECT 
			id, policy_id, customer_id, policy_type,
			address_line1, city, state_code,
			ST_X(location) as longitude, ST_Y(location) as latitude,
			flood_risk_zone_id, crime_risk_zone_id, fire_risk_zone_id,
			sum_assured, premium_amount, status
		FROM geospatial.policy_locations
		WHERE policy_id = $1
	`
	
	var p PolicyLocation
	err := s.db.QueryRow(c.Request.Context(), query, policyID).Scan(
		&p.ID, &p.PolicyID, &p.CustomerID, &p.PolicyType,
		&p.AddressLine1, &p.City, &p.StateCode,
		&p.Longitude, &p.Latitude,
		&p.FloodRiskZoneID, &p.CrimeRiskZoneID, &p.FireRiskZoneID,
		&p.SumAssured, &p.PremiumAmount, &p.Status,
	)
	
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "policy location not found"})
		return
	}
	
	c.JSON(http.StatusOK, p)
}

func (s *Server) updatePolicyLocation(c *gin.Context) {
	policyID := c.Param("policy_id")
	
	var req CreatePolicyLocationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	query := `
		UPDATE geospatial.policy_locations
		SET 
			address_line1 = $2,
			address_line2 = $3,
			city = $4,
			state_code = $5,
			postal_code = $6,
			location = ST_SetSRID(ST_MakePoint($7, $8), 4326),
			sum_assured = $9,
			premium_amount = $10,
			updated_at = CURRENT_TIMESTAMP
		WHERE policy_id = $1
	`
	
	_, err := s.db.Exec(c.Request.Context(), query,
		policyID,
		req.AddressLine1, req.AddressLine2, req.City, req.StateCode, req.PostalCode,
		req.Longitude, req.Latitude,
		req.SumAssured, req.PremiumAmount,
	)
	
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{"message": "policy location updated"})
}

func (s *Server) getPoliciesByArea(c *gin.Context) {
	minLon, _ := strconv.ParseFloat(c.Query("min_lon"), 64)
	minLat, _ := strconv.ParseFloat(c.Query("min_lat"), 64)
	maxLon, _ := strconv.ParseFloat(c.Query("max_lon"), 64)
	maxLat, _ := strconv.ParseFloat(c.Query("max_lat"), 64)
	policyType := c.Query("policy_type")
	
	query := `
		SELECT 
			id, policy_id, customer_id, policy_type,
			address_line1, city, state_code,
			ST_X(location) as longitude, ST_Y(location) as latitude,
			sum_assured, premium_amount, status
		FROM geospatial.policy_locations
		WHERE ST_Within(
			location,
			ST_MakeEnvelope($1, $2, $3, $4, 4326)
		)
		AND ($5 = '' OR policy_type = $5)
		LIMIT 1000
	`
	
	rows, err := s.db.Query(c.Request.Context(), query, minLon, minLat, maxLon, maxLat, policyType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var policies []PolicyLocation
	for rows.Next() {
		var p PolicyLocation
		if err := rows.Scan(
			&p.ID, &p.PolicyID, &p.CustomerID, &p.PolicyType,
			&p.AddressLine1, &p.City, &p.StateCode,
			&p.Longitude, &p.Latitude,
			&p.SumAssured, &p.PremiumAmount, &p.Status,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		policies = append(policies, p)
	}
	
	c.JSON(http.StatusOK, gin.H{"policies": policies, "count": len(policies)})
}

// CreateClaimLocationRequest represents the request body
type CreateClaimLocationRequest struct {
	ClaimID           string    `json:"claim_id" binding:"required"`
	PolicyID          string    `json:"policy_id" binding:"required"`
	CustomerID        string    `json:"customer_id" binding:"required"`
	ClaimType         string    `json:"claim_type" binding:"required"`
	IncidentAddress   string    `json:"incident_address"`
	IncidentCity      string    `json:"incident_city"`
	IncidentStateCode string    `json:"incident_state_code"`
	Longitude         float64   `json:"longitude" binding:"required"`
	Latitude          float64   `json:"latitude" binding:"required"`
	ClaimAmount       float64   `json:"claim_amount"`
	IncidentDate      time.Time `json:"incident_date"`
}

func (s *Server) createClaimLocation(c *gin.Context) {
	var req CreateClaimLocationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	// Calculate distance from policy location
	distanceQuery := `
		SELECT ROUND((ST_Distance(
			p.location::geography,
			ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
		) / 1000)::DECIMAL, 2)
		FROM geospatial.policy_locations p
		WHERE p.policy_id = $1
	`
	
	var distanceFromPolicy float64
	s.db.QueryRow(c.Request.Context(), distanceQuery, req.PolicyID, req.Longitude, req.Latitude).Scan(&distanceFromPolicy)
	
	query := `
		INSERT INTO geospatial.claim_locations (
			claim_id, policy_id, customer_id, claim_type,
			incident_address, incident_city, incident_state_code,
			incident_location, claim_amount, incident_date,
			distance_from_policy_km
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7,
			ST_SetSRID(ST_MakePoint($8, $9), 4326),
			$10, $11, $12
		)
		RETURNING id
	`
	
	var id string
	err := s.db.QueryRow(c.Request.Context(), query,
		req.ClaimID, req.PolicyID, req.CustomerID, req.ClaimType,
		req.IncidentAddress, req.IncidentCity, req.IncidentStateCode,
		req.Longitude, req.Latitude,
		req.ClaimAmount, req.IncidentDate, distanceFromPolicy,
	).Scan(&id)
	
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusCreated, gin.H{"id": id, "claim_id": req.ClaimID, "distance_from_policy_km": distanceFromPolicy})
}

func (s *Server) getClaimLocation(c *gin.Context) {
	claimID := c.Param("claim_id")
	
	query := `
		SELECT 
			id, claim_id, policy_id, customer_id, claim_type,
			incident_address, incident_city, incident_state_code,
			ST_X(incident_location) as longitude, ST_Y(incident_location) as latitude,
			claim_amount, incident_date, status,
			is_clustered, cluster_id, distance_from_policy_km
		FROM geospatial.claim_locations
		WHERE claim_id = $1
	`
	
	var cl ClaimLocation
	err := s.db.QueryRow(c.Request.Context(), query, claimID).Scan(
		&cl.ID, &cl.ClaimID, &cl.PolicyID, &cl.CustomerID, &cl.ClaimType,
		&cl.IncidentAddress, &cl.IncidentCity, &cl.IncidentStateCode,
		&cl.Longitude, &cl.Latitude,
		&cl.ClaimAmount, &cl.IncidentDate, &cl.Status,
		&cl.IsClustered, &cl.ClusterID, &cl.DistanceFromPolicyKm,
	)
	
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "claim location not found"})
		return
	}
	
	c.JSON(http.StatusOK, cl)
}

func (s *Server) getClaimsHeatmap(c *gin.Context) {
	claimType := c.Query("claim_type")
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")
	
	query := `
		SELECT 
			ST_X(incident_location) as longitude,
			ST_Y(incident_location) as latitude,
			claim_amount,
			claim_type
		FROM geospatial.claim_locations
		WHERE incident_location IS NOT NULL
		AND ($1 = '' OR claim_type = $1)
		AND ($2 = '' OR incident_date >= $2::timestamp)
		AND ($3 = '' OR incident_date <= $3::timestamp)
	`
	
	rows, err := s.db.Query(c.Request.Context(), query, claimType, startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var points []HeatmapPoint
	for rows.Next() {
		var p HeatmapPoint
		if err := rows.Scan(&p.Longitude, &p.Latitude, &p.ClaimAmount, &p.ClaimType); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		p.Weight = p.ClaimAmount / 1000000 // Normalize weight
		points = append(points, p)
	}
	
	c.JSON(http.StatusOK, gin.H{"points": points, "count": len(points)})
}

func (s *Server) getStates(c *gin.Context) {
	query := `SELECT id, name, code, capital, region FROM geospatial.states ORDER BY name`
	
	rows, err := s.db.Query(c.Request.Context(), query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var states []State
	for rows.Next() {
		var s State
		if err := rows.Scan(&s.ID, &s.Name, &s.Code, &s.Capital, &s.Region); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		states = append(states, s)
	}
	
	c.JSON(http.StatusOK, gin.H{"states": states, "count": len(states)})
}

func (s *Server) getLGAsByState(c *gin.Context) {
	stateCode := c.Param("code")
	
	query := `
		SELECT l.id, l.state_id, s.name as state_name, l.name, COALESCE(l.code, '') as code
		FROM geospatial.lgas l
		JOIN geospatial.states s ON l.state_id = s.id
		WHERE s.code = $1
		ORDER BY l.name
	`
	
	rows, err := s.db.Query(c.Request.Context(), query, stateCode)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var lgas []LGA
	for rows.Next() {
		var l LGA
		if err := rows.Scan(&l.ID, &l.StateID, &l.StateName, &l.Name, &l.Code); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		lgas = append(lgas, l)
	}
	
	c.JSON(http.StatusOK, gin.H{"lgas": lgas, "count": len(lgas)})
}

func (s *Server) getLGA(c *gin.Context) {
	lgaID := c.Param("id")
	
	query := `
		SELECT l.id, l.state_id, s.name as state_name, l.name, COALESCE(l.code, '') as code
		FROM geospatial.lgas l
		JOIN geospatial.states s ON l.state_id = s.id
		WHERE l.id = $1
	`
	
	var l LGA
	err := s.db.QueryRow(c.Request.Context(), query, lgaID).Scan(&l.ID, &l.StateID, &l.StateName, &l.Name, &l.Code)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "LGA not found"})
		return
	}
	
	c.JSON(http.StatusOK, l)
}

func (s *Server) getPolicyDensity(c *gin.Context) {
	query := `
		SELECT 
			lga_id, lga_name, state_name,
			policy_count, total_sum_assured, total_premium,
			ST_X(centroid) as centroid_longitude,
			ST_Y(centroid) as centroid_latitude
		FROM geospatial.v_policy_density_by_lga
		WHERE policy_count > 0
		ORDER BY policy_count DESC
	`
	
	rows, err := s.db.Query(c.Request.Context(), query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var densities []PolicyDensity
	for rows.Next() {
		var d PolicyDensity
		if err := rows.Scan(
			&d.LGAID, &d.LGAName, &d.StateName,
			&d.PolicyCount, &d.TotalSumAssured, &d.TotalPremium,
			&d.CentroidLon, &d.CentroidLat,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		densities = append(densities, d)
	}
	
	c.JSON(http.StatusOK, gin.H{"policy_density": densities, "count": len(densities)})
}

func (s *Server) getClaimsByRegion(c *gin.Context) {
	query := `
		SELECT 
			s.region,
			COUNT(c.id) as claim_count,
			SUM(c.claim_amount) as total_amount,
			AVG(c.claim_amount) as avg_amount
		FROM geospatial.claim_locations c
		JOIN geospatial.states s ON c.incident_state_code = s.code
		GROUP BY s.region
		ORDER BY claim_count DESC
	`
	
	rows, err := s.db.Query(c.Request.Context(), query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var results []map[string]interface{}
	for rows.Next() {
		var region string
		var claimCount int
		var totalAmount, avgAmount float64
		
		if err := rows.Scan(&region, &claimCount, &totalAmount, &avgAmount); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		
		results = append(results, map[string]interface{}{
			"region":       region,
			"claim_count":  claimCount,
			"total_amount": totalAmount,
			"avg_amount":   avgAmount,
		})
	}
	
	c.JSON(http.StatusOK, gin.H{"claims_by_region": results})
}

func (s *Server) getAgentTerritories(c *gin.Context) {
	query := `
		SELECT 
			a.agent_id,
			a.agent_name,
			a.office_address,
			ST_X(a.office_location) as longitude,
			ST_Y(a.office_location) as latitude,
			a.service_radius_km,
			ST_AsGeoJSON(a.territory) as territory_geojson,
			a.assigned_policies_count,
			a.total_premium_managed
		FROM geospatial.agent_locations a
		WHERE a.status = 'ACTIVE'
		ORDER BY a.assigned_policies_count DESC
	`
	
	rows, err := s.db.Query(c.Request.Context(), query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	
	var territories []map[string]interface{}
	for rows.Next() {
		var agentID, agentName, officeAddress string
		var longitude, latitude, serviceRadius float64
		var territoryGeoJSON *string
		var assignedPolicies int
		var totalPremium float64
		
		if err := rows.Scan(
			&agentID, &agentName, &officeAddress,
			&longitude, &latitude, &serviceRadius,
			&territoryGeoJSON, &assignedPolicies, &totalPremium,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		
		var territory interface{}
		if territoryGeoJSON != nil {
			json.Unmarshal([]byte(*territoryGeoJSON), &territory)
		}
		
		territories = append(territories, map[string]interface{}{
			"agent_id":                agentID,
			"agent_name":              agentName,
			"office_address":          officeAddress,
			"longitude":               longitude,
			"latitude":                latitude,
			"service_radius_km":       serviceRadius,
			"territory":               territory,
			"assigned_policies_count": assignedPolicies,
			"total_premium_managed":   totalPremium,
		})
	}
	
	c.JSON(http.StatusOK, gin.H{"agent_territories": territories, "count": len(territories)})
}


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
	config := loadConfig()
	
	// Connect to database
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	
	pool, err := pgxpool.New(ctx, config.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer pool.Close()
	
	// Test connection
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}
	log.Println("Connected to PostGIS database")
	
	// Create server
	server := NewServer(pool)
	
	// Start HTTP server
	srv := &http.Server{
		Addr:    ":" + config.Port,
		Handler: server.router,
	}
	
	// Graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan
		
		log.Println("Shutting down server...")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("Server shutdown error: %v", err)
		}
	}()
	
	log.Printf("Geospatial service starting on port %s", config.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}
