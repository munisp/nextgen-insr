package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/insureportal/gamification_service/config"
	"github.com/insureportal/gamification_service/db"
	"github.com/insureportal/gamification_service/models"
	"go.uber.org/zap"
)

// package-level state
var (
	gcfg    *config.Config
	gpg     *db.Postgres
	gredis  *db.RedisCache
	glog    *zap.Logger
)

// pointAwardRules defines points awarded per action type.
var pointAwardRules = map[string]models.ActionAward{
	"policy_purchase": {Action: "policy_purchase", Points: 100, Limit: 1, Enabled: true},
	"claim_free_year": {Action: "claim_free_year", Points: 500, Limit: 1, Enabled: true},
	"referral":        {Action: "referral", Points: 200, Limit: 10, Enabled: true},
	"doc_upload":      {Action: "doc_upload", Points: 50, Limit: 20, Enabled: true},
	"early_payment":   {Action: "early_payment", Points: 75, Limit: 5, Enabled: true},
}

func main() {
	cfg := config.NewConfig()

	logger, err := zap.NewProduction()
	if err != nil {
		log.Fatalf("Failed to initialize logger: %v", err)
	}
	defer logger.Sync()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pg, err := db.NewPostgres(ctx, &cfg.Postgres)
	if err != nil {
		logger.Fatal("Failed to connect to postgres", zap.Error(err))
	}
	if err := pg.RunMigrations(ctx); err != nil {
		logger.Fatal("Failed to run migrations", zap.Error(err))
	}
	logger.Info("PostgreSQL migrations completed")

	redis, err := db.NewRedisCache(ctx, &cfg.Redis)
	if err != nil {
		logger.Warn("Redis not available (non-fatal)", zap.Error(err))
	}

	gcfg, gpg, gredis, glog = cfg, pg, redis, logger

	seedData(pg, ctx, logger)

	router := buildRouter(cfg, pg, redis, logger)

	srv := &http.Server{
		Addr:         fmt.Sprintf("%s:%s", cfg.Server.Host, cfg.Server.Port),
		Handler:      router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  60 * time.Second,
	}

	shutdownCh := make(chan os.Signal, 1)
	signal.Notify(shutdownCh, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		logger.Info("Gamification Service starting",
			zap.String("addr", srv.Addr),
			zap.String("service", "gamification-service"))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("Server failed", zap.Error(err))
		}
	}()

	<-shutdownCh
	logger.Info("Shutting down server...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownGrace)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("Server forced shutdown", zap.Error(err))
	}

	redis.Close()
	pg.Close()
	logger.Info("Server exited properly")
}

func buildRouter(cfg *config.Config, pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORS.AllowedOrigins,
		AllowedMethods:   cfg.CORS.AllowedMethods,
		AllowedHeaders:   cfg.CORS.AllowedHeaders,
		AllowCredentials: cfg.CORS.AllowCredentials,
		MaxAge:           int(cfg.CORS.MaxAge.Seconds()),
	}))

	r.Get("/health", healthHandler(logger))
	r.Get("/ready", readinessHandler(pg, redis, logger))

	r.Group(func(r chi.Router) {
		// Points
		r.Get("/api/v1/profile/{userId}", getProfileHandler(pg, redis, logger))
		r.Post("/api/v1/points/award", awardPointsHandler(pg, redis, logger))
		r.Get("/api/v1/points/history/{userId}", pointHistoryHandler(pg, redis, logger))
		r.Put("/api/v1/points/{userId}/redeem", redeemPointsHandler(pg, redis, logger))

		// Badges
		r.Get("/api/v1/badges", listBadgesHandler(pg, redis, logger))
		r.Get("/api/v1/badges/{userId}", getUserBadgesHandler(pg, redis, logger))

		// Leaderboards
		r.Get("/api/v1/leaderboard/{period}", leaderboardHandler(pg, redis, logger))

		// Challenges
		r.Get("/api/v1/challenges", listChallengesHandler(pg, redis, logger))
		r.Get("/api/v1/challenges/{userId}", userChallengesHandler(pg, redis, logger))
		r.Post("/api/v1/challenges/{challengeId}/join", joinChallengeHandler(pg, redis, logger))

		// Referrals
		r.Get("/api/v1/referrals/{userId}", referralStatsHandler(pg, redis, logger))
		r.Post("/api/v1/referrals/redeem", redeemReferralHandler(pg, redis, logger))

		// Rewards
		r.Get("/api/v1/rewards", rewardsHandler(pg, redis, logger))
		r.Get("/api/v1/rewards/{userId}/history", redemptionHistoryHandler(pg, redis, logger))

		// Tiers
		r.Get("/api/v1/tiers", tierDefinitionsHandler(pg, redis, logger))

		// Metrics
		r.Get("/api/v1/metrics", metricsHandler(pg, redis, logger))
	})

	return r
}

// ========== Health & Readiness ==========

func healthHandler(logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":    "healthy",
			"service":   "gamification-service",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

func readinessHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := pg.Pool.Ping(r.Context()); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "postgres_unavailable"})
			return
		}
		if redis != nil && redis.Client.Ping(r.Context()).Err() != nil {
			logger.Warn("Redis unavailable at readiness")
		}
		json.NewEncoder(w).Encode(map[string]string{
			"status":    "ready",
			"service":   "gamification-service",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// ========== Points Handlers ==========

func getProfileHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		userID := chi.URLParam(r, "userId")

		if redis != nil {
			if data, err := redis.GetUserPoints(r.Context(), userID); err == nil && len(data) > 0 {
				json.NewEncoder(w).Encode(json.RawMessage(data))
				return
			}
		}

		up, err := pg.GetUserPoints(r.Context(), userID)
		if err != nil {
			// Create user if not exists
			up = &models.UserPoints{
				ID:     generateID(),
				UserID: userID,
				Tier:   models.TierBronze,
				CreatedAt: time.Now().UTC(),
				UpdatedAt: time.Now().UTC(),
			}
			if err := pg.UpsertUserPoints(r.Context(), up); err != nil {
				writeError(w, http.StatusInternalServerError, "failed to initialize user profile", logger)
				return
			}
		}

		// Get badges count
		userBadges, _ := pg.GetUserBadges(r.Context(), userID)

		// Calculate redeemable value (1000 pts = 500 naira)
		redeemableValue := float64(up.TotalPoints) * 0.5

		if redis != nil {
			data, _ := json.Marshal(map[string]any{
				"user_id":              userID,
				"total_points":         up.TotalPoints,
				"redeemable_value_naira": redeemableValue,
				"tier":                 up.Tier,
				"points_to_next":       up.PointsToNext,
				"next_tier":            up.NextTier,
				"badges_earned":        len(userBadges),
				"last_awarded_at":      up.LastAwardedAt,
			})
			redis.CacheUserPoints(r.Context(), userID, data, db.TCacheShort)
		}

		json.NewEncoder(w).Encode(map[string]any{
			"user_id":              userID,
			"total_points":         up.TotalPoints,
			"redeemable_value_naira": redeemableValue,
			"tier":                 up.Tier,
			"points_to_next":       up.PointsToNext,
			"next_tier":            up.NextTier,
			"badges_earned":        len(userBadges),
			"last_awarded_at":      up.LastAwardedAt,
		})
	}
}

func awardPointsHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var req struct {
			UserID string            `json:"user_id"`
			Action string            `json:"action"`
			Amount int               `json:"amount"`
			Metadata map[string]any `json:"metadata,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}
		if req.UserID == "" || req.Action == "" {
			writeError(w, http.StatusBadRequest, "user_id and action are required", logger)
			return
		}

		// Look up award rule
		rule, ok := pointAwardRules[req.Action]
		if !ok || !rule.Enabled {
			writeError(w, http.StatusBadRequest, "unknown or disabled action: "+req.Action, logger)
			return
		}

		// Anti-gaming: daily limit check
		if req.Amount > rule.Limit {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("max %d %s(s) per day allowed", rule.Limit, req.Action), logger)
			return
		}

		// For referral action: check daily referral limit
		if req.Action == "referral" {
			limitExceeded, err := pg.CheckReferralDailyLimit(r.Context(), req.UserID, gcfg.Gamma.DailyReferralLimit)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to check referral limit", logger)
				return
			}
			if limitExceeded {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("daily referral limit of %d reached", gcfg.Gamma.DailyReferralLimit), logger)
				return
			}
		}

		// Self-referral check
		if req.Action == "referral" && req.Metadata != nil {
			referredID, _ := req.Metadata["referred_id"].(string)
			if referredID == req.UserID {
				writeError(w, http.StatusBadRequest, "cannot refer yourself", logger)
				return
			}
		}

		// Award points
		tx, err := pg.AwardPoints(r.Context(), req.UserID, req.Amount, models.PointSource(req.Action), req.Action, generateID(), req.Metadata)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to award points", logger)
			return
		}

		// Check and award badges
		badges, _ := pg.CheckAndAwardBadges(r.Context(), req.UserID, models.UserPoints{TotalPoints: tx.Balance})

		// Update Redis cache
		if redis != nil {
			redis.InvalidateUserPoints(r.Context(), req.UserID)
			for _, b := range badges {
				redis.InvalidateUserBadges(r.Context(), req.UserID)
			}
		}

		result := map[string]any{
			"user_id":      req.UserID,
			"action":       req.Action,
			"points_awarded": req.Amount,
			"new_total":    tx.Balance,
			"redeemable_value_naira": float64(tx.Balance) * 0.5,
		}
		if len(badges) > 0 {
			result["badges_earned"] = badges
		}

		json.NewEncoder(w).Encode(result)
	}
}

func pointHistoryHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		userID := chi.URLParam(r, "userId")
		limit := parseIntQuery(r.URL.Query().Get("limit"), 20)
		offset := parseIntQuery(r.URL.Query().Get("offset"), 0)
		if limit > 100 {
			limit = 100
		}

		history, total, err := pg.GetPointHistory(r.Context(), userID, limit, offset)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get point history", logger)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{
			"user_id": userID,
			"history": history,
			"total":   total,
			"limit":   limit,
			"offset":  offset,
		})
	}
}

func redeemPointsHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		userID := chi.URLParam(r, "userId")

		var req struct {
			PointsUsed int               `json:"points_used"`
			ValueNaira float64           `json:"value_naira"`
			Type       models.RedeemType `json:"type"`
			Metadata   map[string]any    `json:"metadata,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}

		if req.PointsUsed <= 0 && req.ValueNaira <= 0 {
			writeError(w, http.StatusBadRequest, "points_used or value_naira required", logger)
			return
		}

		// Get user's current balance
		up, err := pg.GetUserPoints(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "user not found", logger)
			return
		}

		pointsToRedeem := req.PointsUsed
		if req.ValueNaira > 0 && req.PointsUsed <= 0 {
			pointsToRedeem = int(req.ValueNaira * 2) // 500 naira = 1000 points
		}

		if pointsToRedeem > up.TotalPoints {
			writeError(w, http.StatusBadRequest, "insufficient points", logger)
			return
		}

		if pointsToRedeem < 100 {
			writeError(w, http.StatusBadRequest, "minimum 100 points required for redemption", logger)
			return
		}

		// Check anti-gaming: max 5000 points per redemption
		if pointsToRedeem > 5000 {
			writeError(w, http.StatusBadRequest, "maximum 5000 points per redemption", logger)
			return
		}

		valueNaira := float64(pointsToRedeem) * 0.5
		if req.ValueNaira > 0 {
			valueNaira = req.ValueNaira
		}

		redemption := &models.PointRedemption{
			ID:           generateID(),
			UserID:       userID,
			PointsUsed:   pointsToRedeem,
			ValueNaira:   valueNaira,
			Type:         req.Type,
			Status:       "pending",
			Reference:    fmt.Sprintf("RED-%s", generateID()),
			ExpiresAt:    time.Now().UTC().Add(30 * 24 * time.Hour),
			CreatedAt:    time.Now().UTC(),
		}

		if err := pg.RecordRedemption(r.Context(), redemption); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to record redemption", logger)
			return
		}

		// Update user points balance
		pg.Pool.Exec(r.Context(), `
			UPDATE user_points SET total_points = total_points - $1, updated_at = NOW()
			WHERE user_id = $2
		`, pointsToRedeem, userID)
		// Update redeemable value
		pg.Pool.Exec(r.Context(), `UPDATE user_points SET redeemable_value_naira = redeemable_value_naira - $1 WHERE user_id = $2`, valueNaira, userID)

		if redis != nil {
			redis.InvalidateUserPoints(r.Context(), userID)
		}

		json.NewEncoder(w).Encode(map[string]any{
			"redemption":   redemption,
			"points_used":  pointsToRedeem,
			"value_naira":  valueNaira,
			"status":       "pending",
		})
	}
}

// ========== Badge Handlers ==========

func listBadgesHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		badges, err := pg.GetBadges(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list badges", logger)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{
			"badges":  badges,
			"total":   len(badges),
		})
	}
}

func getUserBadgesHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		userID := chi.URLParam(r, "userId")

		if redis != nil {
			if data, err := redis.GetUserBadges(r.Context(), userID); err == nil && len(data) > 0 {
				json.NewEncoder(w).Encode(json.RawMessage(data))
				return
			}
		}

		badges, err := pg.GetUserBadges(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get user badges", logger)
			return
		}

		if redis != nil {
			data, _ := json.Marshal(badges)
			redis.CacheUserBadges(r.Context(), userID, data, db.TCacheMedium)
		}

		json.NewEncoder(w).Encode(map[string]any{
			"user_id": userID,
			"badges":  badges,
			"total":   len(badges),
		})
	}
}

// ========== Leaderboard Handlers ==========

func leaderboardHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		period := chi.URLParam(r, "period")
		limit := parseIntQuery(r.URL.Query().Get("limit"), 50)

		if limit <= 0 || limit > 100 {
			limit = 50
		}

		// Try cache first
		if redis != nil {
			if data, err := redis.GetLeaderboard(r.Context(), period); err == nil && len(data) > 0 {
				json.NewEncoder(w).Encode(json.RawMessage(data))
				return
			}
		}

		entries, err := pg.GetLeaderboard(r.Context(), period, limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get leaderboard", logger)
			return
		}

		if redis != nil {
			data, _ := json.Marshal(map[string]any{
				"period": period,
				"entries": entries,
			})
			redis.CacheLeaderboard(r.Context(), period, data, db.TCacheShort)
		}

		json.NewEncoder(w).Encode(map[string]any{
			"period":  period,
			"entries": entries,
			"limit":   limit,
		})
	}
}

// ========== Challenge Handlers ==========

func listChallengesHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		challenges, err := pg.GetActiveChallenges(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list challenges", logger)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{
			"challenges": challenges,
			"total":      len(challenges),
		})
	}
}

func userChallengesHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		userID := chi.URLParam(r, "userId")

		if redis != nil {
			if data, err := redis.GetUserChallenge(r.Context(), userID); err == nil && len(data) > 0 {
				json.NewEncoder(w).Encode(json.RawMessage(data))
				return
			}
		}

		progress, err := pg.GetUserChallengeProgress(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get challenge progress", logger)
			return
		}

		if redis != nil {
			data, _ := json.Marshal(progress)
			redis.CacheUserChallenge(r.Context(), userID, data, db.TCacheShort)
		}

		json.NewEncoder(w).Encode(map[string]any{
			"user_id":    userID,
			"challenges": progress,
			"total":      len(progress),
		})
	}
}

func joinChallengeHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		// Determine user ID from context or header
		userID := r.Header.Get("X-User-ID")
		if userID == "" {
			userID = r.URL.Query().Get("user_id")
		}
		if userID == "" {
			writeError(w, http.StatusBadRequest, "user_id required (X-User-ID header or query param)", logger)
			return
		}

		challengeID := chi.URLParam(r, "challengeId")

		// Check if challenge exists
		challenges, _ := pg.GetActiveChallenges(r.Context())
		var challenge *models.Challenge
		for _, c := range challenges {
			if c.ChallengeID == challengeID {
				challenge = c
				break
			}
		}
		if challenge == nil {
			writeError(w, http.StatusNotFound, "challenge not found or not active", logger)
			return
		}

		// Check if already joined
		progress, _ := pg.GetUserChallengeProgress(r.Context(), userID)
		for _, p := range progress {
			if p.ChallengeID == challengeID {
				writeError(w, http.StatusBadRequest, "already joined this challenge", logger)
				return
			}
		}

		if err := pg.JoinChallenge(r.Context(), userID, challengeID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to join challenge", logger)
			return
		}

		if redis != nil {
			redis.InvalidateUserChallenge(r.Context(), userID)
		}

		json.NewEncoder(w).Encode(map[string]any{
			"user_id":       userID,
			"challenge_id":  challengeID,
			"challenge":     challenge.Title,
			"status":        "joined",
			"joined_at":     time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// ========== Referral Handlers ==========

func referralStatsHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		userID := chi.URLParam(r, "userId")

		stats, err := pg.GetReferralStats(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get referral stats", logger)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{
			"referrer_id":  userID,
			"total_referrals": stats["total_referrals"],
			"active_referrals": stats["active_referrals"],
			"failed_referrals": stats["failed_referrals"],
			"awarded_count":  stats["awarded_count"],
		})
	}
}

func redeemReferralHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var req struct {
			ReferrerID string `json:"referrer_id"`
			ReferredID string `json:"referred_id"`
			Code       string `json:"code"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}

		if req.ReferrerID == "" || req.ReferredID == "" {
			writeError(w, http.StatusBadRequest, "referrer_id and referred_id are required", logger)
			return
		}

		// Self-referral check
		if req.ReferrerID == req.ReferredID {
			writeError(w, http.StatusBadRequest, "cannot refer yourself", logger)
			return
		}

		// Check daily limit
		limitExceeded, err := pg.CheckReferralDailyLimit(r.Context(), req.ReferrerID, gcfg.Gamma.DailyReferralLimit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to check referral limit", logger)
			return
		}
		if limitExceeded {
			writeError(w, http.StatusBadRequest, "daily referral limit reached", logger)
			return
		}

		referralCode := req.Code
		if referralCode == "" {
			referralCode = fmt.Sprintf("REF-%s", generateID())
		}

		referral := &models.Referral{
			ID:            generateID(),
			ReferrerID:    req.ReferrerID,
			ReferredID:    req.ReferredID,
			ReferralCode:  referralCode,
			Status:        models.ReferralActive,
			ReferredAt:    time.Now().UTC(),
		}

		if err := pg.CreateReferral(r.Context(), referral); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create referral", logger)
			return
		}

		// Award referral points
		points := gcfg.Gamma.ReferralRewardPts
		if err := pg.RecordReferralReward(r.Context(), req.ReferrerID, points); err != nil {
			glog.Warn("Failed to award referral reward", zap.Error(err))
		}

		if redis != nil {
			redis.InvalidateUserPoints(r.Context(), req.ReferrerID)
			redis.InvalidateUserPoints(r.Context(), req.ReferredID)
		}

		json.NewEncoder(w).Encode(map[string]any{
			"referral":       referral,
			"referrer_id":    req.ReferrerID,
			"referred_id":    req.ReferredID,
			"points_awarded": points,
			"referral_code":  referralCode,
		})
	}
}

// ========== Reward Handlers ==========

func rewardsHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		rewards, err := pg.GetRewards(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get rewards", logger)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{
			"rewards": rewards,
			"total":   len(rewards),
		})
	}
}

func redemptionHistoryHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		userID := chi.URLParam(r, "userId")
		limit := parseIntQuery(r.URL.Query().Get("limit"), 20)
		offset := parseIntQuery(r.URL.Query().Get("offset"), 0)
		if limit > 100 {
			limit = 100
		}

		history, total, err := pg.GetUserRedemptionHistory(r.Context(), userID, limit, offset)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get redemption history", logger)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{
			"user_id":  userID,
			"history":  history,
			"total":    total,
			"limit":    limit,
			"offset":   offset,
		})
	}
}

// ========== Tier Handlers ==========

func tierDefinitionsHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		tiers, err := pg.GetTierDefinitions(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get tier definitions", logger)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{
			"tiers": tiers,
		})
	}
}

// ========== Metrics Handler ==========

func metricsHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		if redis != nil {
			if data, err := redis.GetMetrics(r.Context()); err == nil && len(data) > 0 {
				json.NewEncoder(w).Encode(json.RawMessage(data))
				return
			}
		}

		metrics, err := pg.GetGamificationMetrics(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get gamification metrics", logger)
			return
		}

		if redis != nil {
			data, _ := json.Marshal(metrics)
			redis.CacheMetrics(r.Context(), data, db.TCacheMedium)
		}

		json.NewEncoder(w).Encode(metrics)
	}
}

// ========== Helpers ==========

func writeError(w http.ResponseWriter, code int, message string, logger *zap.Logger) {
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func seedData(pg *db.Postgres, ctx context.Context, logger *zap.Logger) {
	now := time.Now().UTC()

	// Seed tier definitions
	tiers := []*models.TierDefinition{
		{ID: generateID(), Tier: models.TierBronze, MinPoints: 0, MaxPoints: 999, DiscountPct: 0, Icon: "bronze", Description: "Entry level"},
		{ID: generateID(), Tier: models.TierSilver, MinPoints: 1000, MaxPoints: 2999, DiscountPct: 5, Icon: "silver", Description: "Silver tier with 5% discount"},
		{ID: generateID(), Tier: models.TierGold, MinPoints: 3000, MaxPoints: 5999, DiscountPct: 10, Icon: "gold", Description: "Gold tier with 10% discount"},
		{ID: generateID(), Tier: models.TierPlatinum, MinPoints: 6000, MaxPoints: 9999, DiscountPct: 15, Icon: "platinum", Description: "Platinum tier with 15% discount"},
		{ID: generateID(), Tier: models.TierDiamond, MinPoints: 10000, DiscountPct: 20, Icon: "diamond", Description: "Diamond tier with 20% discount"},
	}
	for _, t := range tiers {
		pg.InsertTierDefinition(ctx, t)
	}

	// Seed badges
	badges := []*models.Badge{
		{ID: generateID(), BadgeID: "BADGE-FIRST-POLICY", Name: "First Policy", Description: "Enrolled in your first insurance policy", Icon: "shield", Tier: models.TierBronze, PointsReq: 0, Period: "once"},
		{ID: generateID(), BadgeID: "BADGE-CLAIM-FREE", Name: "Claim-Free Champion", Description: "12 months without claims", Icon: "star", Tier: models.TierSilver, PointsReq: 500, Period: "1y"},
		{ID: generateID(), BadgeID: "BADGE-SUPER-REF", Name: "Super Referrer", Description: "Referred 10+ users", Icon: "users", Tier: models.TierGold, PointsReq: 1000, ActionsReq: 10, Period: "lifetime"},
		{ID: generateID(), BadgeID: "BADGE-EARLY-PAY", Name: "Early Payer", Description: "Paid 6 premiums early", Icon: "clock", Tier: models.TierSilver, PointsReq: 450, ActionsReq: 6, Period: "lifetime"},
	}
	for _, b := range badges {
		pg.InsertBadge(ctx, b)
	}

	// Seed active challenges
	challenges := []*models.Challenge{
		{
			ID: generateID(), ChallengeID: "CH-30-DAY-FREE", Title: "30-Day Claim-Free Streak",
			Description: "Maintain a 30-day period without any claims", Rules: "No claims filed in 30 consecutive days",
			PointsReward: 500, StartDate: now.Add(-7 * 24 * time.Hour), EndDate: now.Add(30 * 24 * time.Hour),
			IsActive: true, Metadata: map[string]any{"target": "claim_free", "duration_days": 30},
		},
		{
			ID: generateID(), ChallengeID: "CH-REFERRAL-SPRINT", Title: "Referral Sprint",
			Description: "Refer 5 friends in one month", Rules: "Each referred friend must complete KYC",
			PointsReward: 1000, StartDate: now.Add(-1 * 24 * time.Hour), EndDate: now.Add(29 * 24 * time.Hour),
			IsActive: true, Metadata: map[string]any{"target": "referrals", "count": 5},
		},
		{
			ID: generateID(), ChallengeID: "CH-LOYALTY-90", Title: "90-Day Loyalty Challenge",
			Description: "Keep active policies for 90 days", Rules: "Minimum 1 active policy at all times",
			PointsReward: 750, StartDate: now.Add(-1 * 24 * time.Hour), EndDate: now.Add(89 * 24 * time.Hour),
			IsActive: true, Metadata: map[string]any{"target": "days_active", "days": 90},
		},
	}
	for _, c := range challenges {
		if err := pg.InsertChallenge(ctx, c); err != nil {
			logger.Warn("Failed to seed challenge", zap.String("id", c.ChallengeID), zap.Error(err))
		}
	}

	// Seed rewards
	rewards := []*models.Reward{
		{ID: generateID(), Name: "N500 Premium Discount", Description: "500 Naira off any premium", PointsCost: 1000, ValueNaira: 500, Type: "discount", IsActive: true, MaxRedemptions: 10000, ExpirationDays: 30},
		{ID: generateID(), Name: "N1000 Premium Discount", Description: "1000 Naira off any premium", PointsCost: 2000, ValueNaira: 1000, Type: "discount", IsActive: true, MaxRedemptions: 5000, ExpirationDays: 30},
		{ID: generateID(), Name: "N2000 Premium Discount", Description: "2000 Naira off any premium", PointsCost: 4000, ValueNaira: 2000, Type: "discount", IsActive: true, MaxRedemptions: 2000, ExpirationDays: 30},
		{ID: generateID(), Name: "Free Policy Month", Description: "One month free of any policy", PointsCost: 1000, ValueNaira: 500, Type: "free_month", IsActive: true, MaxRedemptions: 1000, ExpirationDays: 60},
	}
	for _, r := range rewards {
		pg.InsertReward(ctx, r)
	}
}

func parseIntQuery(val string, fallback int) int {
	if val == "" {
		return fallback
	}
	var n int
	fmt.Sscanf(val, "%d", &n)
	if n < 0 {
		return fallback
	}
	return n
}
