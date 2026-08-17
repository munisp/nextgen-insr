package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/insureportal/enhanced_kyc_kyb/config"
	"github.com/insureportal/enhanced_kyc_kyb/db"
	"github.com/insureportal/enhanced_kyc_kyb/models"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

// context keys (SA1029: typed keys to avoid collisions)
type ctxKey string

const (
	ctxKeyRequestid ctxKey = "requestID"
)


// --- Response Helpers ---

func jsonResponse(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func errorResponse(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}

func generateID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// --- HTTP Handlers ---

type Handler struct {
	store  *db.PostgresStore
	cache  *db.RedisCache
	cfg    *config.Config
	log    *zap.Logger
	httpCl *http.Client
}

func NewHandler(store *db.PostgresStore, cache *db.RedisCache, cfg *config.Config, log *zap.Logger) *Handler {
	return &Handler{
		store:  store,
		cache:  cache,
		cfg:    cfg,
		log:    log,
		httpCl: &http.Client{Timeout: 10 * time.Second},
	}
}

// =====================================================================
// POST /api/v1/kyc/individual — Submit individual KYC
// =====================================================================

func (h *Handler) submitIndividualKYC(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	defer func() { _ = r.Body.Close() }()

	var req models.VerificationRequest
	if err := json.Unmarshal(body, &req); err != nil {
		errorResponse(w, http.StatusBadRequest, "invalid JSON payload")
		return
	}

	if err := validateIndividualRequest(&req); err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	customerID := req.CustomerID
	if customerID == "" {
		customerID = "IND-" + generateID()[:8]
	}

	// Determine tier and daily limits
	tier, dailyLimit := determineTier(req.NIN != "", req.FullName != "", req.Phone != "")

	verificationDate := time.Now().UTC()
	expiresAt := verificationDate.Add(h.cfg.KYCTTL)

	kyc := &models.IndividualKYC{
		ID:               generateID(),
		CustomerID:       customerID,
		NIN:              req.NIN,
		BVN:              req.BVN,
		FullName:         req.FullName,
		Tier:             tier,
		DailyLimit:       dailyLimit,
		Status:           models.Submitted,
		RiskLevel:        models.RiskLow,
		VerificationDate: verificationDate,
		ExpiresAt:        expiresAt,
	}

	// Parse DOB
	if req.DOB != "" {
		if dob, err := time.Parse("2006-01-02", req.DOB); err == nil {
			kyc.DOB = dob
		}
	}
	kyc.Gender = req.Gender
	kyc.Address = req.Address
	kyc.Phone = req.Phone
	kyc.Email = req.Email

	if err := h.store.CreateIndividualKYC(kyc); err != nil {
		h.log.Error("failed to create individual KYC", zap.String("customerID", customerID), zap.Error(err))
		errorResponse(w, http.StatusInternalServerError, "failed to create KYC record")
		return
	}

	// Process submitted documents
	for _, doc := range req.Documents {
		kycDoc := models.KYCDocument{
			ID:                 generateID(),
			IndividualKYCID:    &kyc.ID,
			DocType:            models.DocumentType(doc.DocType),
			Number:             doc.Number,
			Issuer:             doc.Issuer,
			Verified:           false,
			VerificationMethod: models.VerifyManual,
			CreatedAt:          time.Now().UTC(),
		}
		if doc.Expiry != "" {
			if exp, err := time.Parse("2006-01-02", doc.Expiry); err == nil {
				kycDoc.ExpiryDate = &exp
			}
		}
		_ = h.store.StoreDocument(&kycDoc)
	}

	// Check cache first
	if h.cache != nil {
		if cached, err := h.cache.GetCachedKYCResult(customerID); err == nil && cached != nil {
			kyc.RiskLevel = cached.RiskLevel
			kyc.Status = cached.Status
		}
	}

	// Calculate risk score and determine status
	riskScore, flags := h.calculateIndividualRiskScore(kyc)
	kyc.RiskLevel = scoreToRiskLevel(riskScore)
	kyc.Status = determineStatus(riskScore)

	if err := h.store.UpdateKYCStatus(customerID, kyc.Status, string(kyc.RiskLevel)); err != nil {
		h.log.Error("failed to update KYC status", zap.Error(err))
	}

	// Record audit trail
	h.store.WriteAudit("kyc_submitted", "individual", customerID, "", r.RemoteAddr,
		fmt.Sprintf("NIN=%s BVN=%s tier=%d risk=%s", req.NIN, req.BVN, tier, string(kyc.RiskLevel)))

	result := models.VerificationResult{
		Success:   true,
		Status:    kyc.Status,
		Score:     riskScore,
		RiskLevel: kyc.RiskLevel,
		Details:   []string{"KYC record created, pending verification"},
		Flags:     flags,
	}

	if len(flags) > 0 {
		result.Details = append(result.Details, "requires manual review")
		kyc.Status = models.UnderReview
		_ = h.store.UpdateKYCStatus(customerID, kyc.Status)
	}

	if h.cache != nil {
		_ = h.cache.CacheKYCResult(customerID, &result)
	}

	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"customer_id":     customerID,
		"status":          kyc.Status,
		"risk_level":      kyc.RiskLevel,
		"risk_score":      riskScore,
		"tier":            tier,
		"daily_limit":     dailyLimit,
		"expires_at":      kyc.ExpiresAt.Format(time.RFC3339),
		"flags":           flags,
		"requires_review": len(flags) > 0,
	})
}

// =====================================================================
// POST /api/v1/kyc/business — Submit business KYC
// =====================================================================

func (h *Handler) submitBusinessKYC(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	defer func() { _ = r.Body.Close() }()

	var req models.VerificationRequest
	if err := json.Unmarshal(body, &req); err != nil {
		errorResponse(w, http.StatusBadRequest, "invalid JSON payload")
		return
	}

	if err := validateBusinessRequest(&req); err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	customerID := req.CustomerID
	if customerID == "" {
		customerID = "BIZ-" + generateID()[:8]
	}

	verificationDate := time.Now().UTC()
	expiresAt := verificationDate.Add(h.cfg.KYBTTT)

	kyc := &models.BusinessKYC{
		ID:               generateID(),
		CustomerID:       customerID,
		RCNumber:         req.RCNumber,
		CompanyName:      req.CompanyName,
		Industry:         req.Industry,
		Address:          req.Address,
		TIN:              req.TIN,
		Status:           models.Submitted,
		VerificationDate: verificationDate,
		ExpiresAt:        expiresAt,
		RiskLevel:        models.RiskLow,
	}

	// Parse directors and screen for PEP
	if len(req.Directors) > 0 {
		directors := make([]models.DirectorInfo, 0, len(req.Directors))
		for _, d := range req.Directors {
			doj := time.Time{}
			if d.DateOfBirth != "" {
				if dob, err := time.Parse("2006-01-02", d.DateOfBirth); err == nil {
					doj = dob
				}
			}
			directors = append(directors, models.DirectorInfo{
				Name:        d.Name,
				IDNumber:    d.IDNumber,
				DateOfBirth: doj,
				Nationality: d.Nationality,
				PEPScreened: true,
				PEPMatch:    false, // mock screening; in production call PEP list API
			})
		}
		kyc.Directors = directors
		kyc.DirectorsScreened = len(directors)
		kyc.PEPScreened = true
	}

	if err := h.store.CreateBusinessKYC(kyc); err != nil {
		h.log.Error("failed to create business KYC", zap.String("customerID", customerID), zap.Error(err))
		errorResponse(w, http.StatusInternalServerError, "failed to create KYB record")
		return
	}

	// Process submitted documents
	for _, doc := range req.Documents {
		kycDoc := models.KYCDocument{
			ID:                 generateID(),
			BusinessKYCID:      &kyc.ID,
			DocType:            models.DocumentType(doc.DocType),
			Number:             doc.Number,
			Issuer:             doc.Issuer,
			Verified:           false,
			VerificationMethod: models.VerifyManual,
			CreatedAt:          time.Now().UTC(),
		}
		if doc.Expiry != "" {
			if exp, err := time.Parse("2006-01-02", doc.Expiry); err == nil {
				kycDoc.ExpiryDate = &exp
			}
		}
		_ = h.store.StoreDocument(&kycDoc)
	}

	// Auto-mark CAC/TIN as verified if numbers provided
	kyc.CACVerified = req.RCNumber != ""
	kyc.TINVerified = req.TIN != ""

	kyc.Status = models.UnderReview
	h.store.DB().Model(&models.BusinessKYC{}).Where("customer_id = ?", customerID).Updates(map[string]interface{}{
		"status":             kyc.Status,
		"cac_verified":       kyc.CACVerified,
		"tin_verified":       kyc.TINVerified,
		"directors_screened": kyc.DirectorsScreened,
		"pep_screened":       kyc.PEPScreened,
	})

	// Audit
	h.store.WriteAudit("kyb_submitted", "business", customerID, "", r.RemoteAddr,
		fmt.Sprintf("RC=%s TIN=%s directors=%d", req.RCNumber, req.TIN, len(req.Directors)))

	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"customer_id":        customerID,
		"status":             kyc.Status,
		"cac_verified":       kyc.CACVerified,
		"tin_verified":       kyc.TINVerified,
		"directors_screened": kyc.DirectorsScreened,
		"pep_screened":       kyc.PEPScreened,
		"risk_level":         kyc.RiskLevel,
		"expires_at":         kyc.ExpiresAt.Format(time.RFC3339),
	})
}

// =====================================================================
// GET /api/v1/kyc/{customerId} — Get KYC/KYB status
// =====================================================================

func (h *Handler) getKYCStatus(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "customerId")
	if customerID == "" {
		errorResponse(w, http.StatusBadRequest, "missing customer_id")
		return
	}

	// Try individual KYC
	ind, indErr := h.store.GetIndividualKYC(customerID)
	if indErr == nil {
		tier := ind.Tier
		if tier == 0 {
			tier = 1
		}
		jsonResponse(w, http.StatusOK, map[string]interface{}{
			"entity_type":       "individual",
			"customer_id":       ind.CustomerID,
			"full_name":         ind.FullName,
			"tier":              tier,
			"status":            ind.Status,
			"risk_level":        ind.RiskLevel,
			"verification_date": ind.VerificationDate.Format(time.RFC3339),
			"expires_at":        ind.ExpiresAt.Format(time.RFC3339),
			"nin_verified":      ind.NINRecord != nil && ind.NINRecord.Status == "verified",
			"bvn_verified":      ind.BVNRecord != nil && ind.BVNRecord.Status == "verified",
			"document_count":    len(ind.Documents),
			"daily_limit":       ind.DailyLimit,
		})
		return
	}

	// Try business KYC
	biz, bizErr := h.store.GetBusinessKYC(customerID)
	if bizErr == nil {
		jsonResponse(w, http.StatusOK, map[string]interface{}{
			"entity_type":        "business",
			"customer_id":        biz.CustomerID,
			"company_name":       biz.CompanyName,
			"status":             biz.Status,
			"risk_level":         biz.RiskLevel,
			"verification_date":  biz.VerificationDate.Format(time.RFC3339),
			"expires_at":         biz.ExpiresAt.Format(time.RFC3339),
			"cac_verified":       biz.CACVerified,
			"tin_verified":       biz.TINVerified,
			"directors_screened": biz.DirectorsScreened,
			"pep_screened":       biz.PEPScreened,
			"document_count":     len(biz.Documents),
		})
		return
	}

	// Check cache as final fallback
	if h.cache != nil {
		if cached, err := h.cache.GetCachedKYCResult(customerID); err == nil && cached != nil {
			jsonResponse(w, http.StatusOK, map[string]interface{}{
				"entity_type": "cached",
				"customer_id": customerID,
				"status":      cached.Status,
				"risk_level":  cached.RiskLevel,
				"score":       cached.Score,
			})
			return
		}
	}

	errorResponse(w, http.StatusNotFound, fmt.Sprintf("no KYC record found for customer: %s", customerID))
}

// =====================================================================
// POST /api/v1/kyc/verify-nin — NIN verification endpoint
// =====================================================================

func (h *Handler) verifyNIN(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	defer func() { _ = r.Body.Close() }()

	var req struct {
		NIN       string `json:"nin"`
		FullNamel string `json:"full_name"`
		DOB       string `json:"dob"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		errorResponse(w, http.StatusBadRequest, "invalid JSON payload")
		return
	}

	if err := validateNIN(req.NIN, req.FullNamel, req.DOB); err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	// Rate limiting
	if h.cache != nil && !h.cache.AllowNIN(req.NIN) {
		h.store.WriteAudit("rate_limited", "nin", req.NIN, "", r.RemoteAddr, "NIN verification rate limit exceeded")
		errorResponse(w, http.StatusTooManyRequests, "NIN verification rate limit exceeded")
		return
	}

	// Track attempts
	if h.cache != nil {
		attempts := h.cache.RecordAttempt(req.NIN)
		if attempts > 20 {
			h.store.WriteAudit("max_attempts", "nin", req.NIN, "", r.RemoteAddr, "exceeded 20 verification attempts")
			errorResponse(w, http.StatusTooManyRequests, "maximum verification attempts exceeded")
			return
		}
	}

	// Check cache
	if h.cache != nil {
		if cached, err := h.cache.GetCachedNINLookup(req.NIN); err == nil && cached != nil {
			jsonResponse(w, http.StatusOK, map[string]interface{}{
				"nin":         req.NIN,
				"verified":    true,
				"status":      "verified",
				"cached":      true,
				"verified_at": time.Now().UTC().Format(time.RFC3339),
			})
			return
		}
	}

	// Call mock NIN API with retry
	ninResult, err := h.verifyNINWithRetry(req.NIN, req.FullNamel, req.DOB)
	if err != nil {
		h.store.WriteAudit("nin_verification_failed", "nin", req.NIN, "", r.RemoteAddr, fmt.Sprintf("error: %v", err))
		errorResponse(w, http.StatusBadGateway, fmt.Sprintf("NIN verification failed: %s", err.Error()))
		return
	}

	// Store verification record in DB
	ninRec := &models.NINVerification{
		ID:          generateID(),
		NIN:         req.NIN,
		Status:      ninResult.Status,
		Name:        req.FullNamel,
		NameMatch:   ninResult.NameMatch,
		DOB:         nil,
		DOBMatch:    ninResult.DOBMatch,
		PhotoMatch:  ninResult.PhotoMatch,
		Source:      "nibss_api",
		RequestedAt: time.Now().UTC(),
	}

	if err := h.store.StoreNINVerification(ninRec); err != nil {
		h.log.Error("failed to store NIN verification", zap.Error(err))
	}

	// Cache result
	if h.cache != nil {
		_ = h.cache.CacheNINLookup(req.NIN, ninResult)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"nin":         req.NIN,
		"verified":    ninRec.Status == "verified",
		"status":      ninRec.Status,
		"name_match":  ninRec.NameMatch,
		"dob_match":   ninRec.DOBMatch,
		"photo_match": ninRec.PhotoMatch,
		"cached":      false,
		"verified_at": time.Now().UTC().Format(time.RFC3339),
	})
}

// =====================================================================
// POST /api/v1/kyc/verify-bvn — BVN verification endpoint
// =====================================================================

func (h *Handler) verifyBVN(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	defer func() { _ = r.Body.Close() }()

	var req struct {
		BVN         string `json:"bvn"`
		FullNamel   string `json:"full_name"`
		AccountType string `json:"account_type"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		errorResponse(w, http.StatusBadRequest, "invalid JSON payload")
		return
	}

	if err := validateBVN(req.BVN, req.FullNamel); err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	// Rate limiting
	if h.cache != nil && !h.cache.AllowBVN(req.BVN) {
		h.store.WriteAudit("rate_limited", "bvn", req.BVN, "", r.RemoteAddr, "BVN verification rate limit exceeded")
		errorResponse(w, http.StatusTooManyRequests, "BVN verification rate limit exceeded")
		return
	}

	// Track attempts
	if h.cache != nil {
		attempts := h.cache.RecordAttempt(req.BVN)
		if attempts > 20 {
			h.store.WriteAudit("max_attempts", "bvn", req.BVN, "", r.RemoteAddr, "exceeded 20 verification attempts")
			errorResponse(w, http.StatusTooManyRequests, "maximum verification attempts exceeded")
			return
		}
	}

	// Check cache
	if h.cache != nil {
		if cached, err := h.cache.GetCachedBVNLookup(req.BVN); err == nil && cached != nil {
			jsonResponse(w, http.StatusOK, map[string]interface{}{
				"bvn":         req.BVN,
				"verified":    true,
				"status":      "verified",
				"cached":      true,
				"verified_at": time.Now().UTC().Format(time.RFC3339),
			})
			return
		}
	}

	// Call mock BVN API with retry
	bvnResult, err := h.verifyBVNWithRetry(req.BVN, req.FullNamel)
	if err != nil {
		h.store.WriteAudit("bvn_verification_failed", "bvn", req.BVN, "", r.RemoteAddr, fmt.Sprintf("error: %v", err))
		errorResponse(w, http.StatusBadGateway, fmt.Sprintf("BVN verification failed: %s", err.Error()))
		return
	}

	// Store verification record in DB
	bvnRec := &models.BVNVerification{
		ID:             generateID(),
		BVN:            req.BVN,
		Status:         bvnResult.Status,
		Name:           req.FullNamel,
		NameMatch:      bvnResult.NameMatch,
		BiometricMatch: bvnResult.BiometricMatch,
		AccountCount:   bvnResult.AccountCount,
		Source:         "nibss_api",
		RequestedAt:    time.Now().UTC(),
	}

	if err := h.store.StoreBVNVerification(bvnRec); err != nil {
		h.log.Error("failed to store BVN verification", zap.Error(err))
	}

	// Cache result
	if h.cache != nil {
		_ = h.cache.CacheBVNLookup(req.BVN, bvnResult)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"bvn":             req.BVN,
		"verified":        bvnRec.Status == "verified",
		"status":          bvnRec.Status,
		"name_match":      bvnRec.NameMatch,
		"biometric_match": bvnRec.BiometricMatch,
		"account_count":   bvnRec.AccountCount,
		"cached":          false,
		"verified_at":     time.Now().UTC().Format(time.RFC3339),
	})
}

// =====================================================================
// POST /api/v1/kyc/refresh — Refresh expired KYC record
// =====================================================================

func (h *Handler) refreshKYC(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	defer func() { _ = r.Body.Close() }()

	var req struct {
		CustomerID string `json:"customer_id"`
		EntityType string `json:"entity_type"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		errorResponse(w, http.StatusBadRequest, "invalid JSON payload")
		return
	}

	if req.CustomerID == "" {
		errorResponse(w, http.StatusBadRequest, "customer_id is required")
		return
	}

	refreshed := false

	// Refresh individual
	if req.EntityType == "" || req.EntityType == "individual" {
		ind, err := h.store.GetIndividualKYC(req.CustomerID)
		if err == nil {
			now := time.Now().UTC()
			ind.VerificationDate = now
			ind.ExpiresAt = now.Add(h.cfg.KYCTTL)
			ind.Status = models.Verified
			ind.RiskLevel = models.RiskLow

			h.store.DB().Model(&models.IndividualKYC{}).Where("customer_id = ?", req.CustomerID).Updates(map[string]interface{}{
				"status":            models.Verified,
				"verification_date": now,
				"expires_at":        now.Add(h.cfg.KYCTTL),
				"risk_level":        models.RiskLow,
				"updated_at":        now,
			})

			if h.cache != nil {
				h.cache.InvalidateKYCCache(req.CustomerID)
			}

			h.store.WriteAudit("kyc_refreshed", "individual", req.CustomerID, "", r.RemoteAddr, "KYC refreshed successfully")
			refreshed = true
		}
	}

	// Refresh business
	if req.EntityType == "" || req.EntityType == "business" {
		biz, err := h.store.GetBusinessKYC(req.CustomerID)
		if err == nil {
			now := time.Now().UTC()
			biz.VerificationDate = now
			biz.ExpiresAt = now.Add(h.cfg.KYBTTT)
			biz.Status = models.Verified

			h.store.DB().Model(&models.BusinessKYC{}).Where("customer_id = ?", req.CustomerID).Updates(map[string]interface{}{
				"status":            models.Verified,
				"verification_date": now,
				"expires_at":        now.Add(h.cfg.KYBTTT),
				"updated_at":        now,
			})

			if h.cache != nil {
				h.cache.InvalidateKYCCache(req.CustomerID)
			}

			h.store.WriteAudit("kyb_refreshed", "business", req.CustomerID, "", r.RemoteAddr, "KYB refreshed successfully")
			refreshed = true
		}
	}

	if !refreshed {
		errorResponse(w, http.StatusNotFound, fmt.Sprintf("no KYC record found for customer: %s", req.CustomerID))
		return
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"customer_id": req.CustomerID,
		"status":      "refreshed",
		"expires_at":  time.Now().UTC().Add(h.cfg.KYCTTL).Format(time.RFC3339),
	})
}

// =====================================================================
// GET /api/v1/kyc/stats — Dashboard metrics
// =====================================================================

func (h *Handler) getKYCStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.store.GetKYCStats()
	if err != nil {
		h.log.Error("failed to get KYC stats", zap.Error(err))
		errorResponse(w, http.StatusInternalServerError, "failed to retrieve dashboard metrics")
		return
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"individual_kyc": map[string]interface{}{
			"total":           stats.TotalKYC,
			"verified":        stats.VerifiedKYC,
			"under_review":    stats.UnderReviewKYC,
			"rejected":        stats.RejectedKYC,
			"expired":         stats.ExpiredKYC,
			"pending_refresh": stats.PendingRefresh,
			"avg_risk_score":  stats.AvgRiskScore,
		},
		"business_kyc": map[string]interface{}{
			"total":    stats.TotalBusiness,
			"verified": stats.VerifiedBusiness,
		},
	})
}

// =====================================================================
// GET /health — Health check with NIN/BVN API status
// =====================================================================

func (h *Handler) healthCheck(w http.ResponseWriter, r *http.Request) {
	status := map[string]interface{}{
		"status":    "degraded",
		"service":   "enhanced-kyc-kyb",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"version":   "1.0.0",
	}

	// Database check
	dbStatus := map[string]interface{}{"status": "disconnected"}
	if sqlDB, err := h.store.DB().DB(); err == nil {
		if sqlDB.Ping() == nil {
			dbStatus = map[string]interface{}{"status": "connected", "service": "postgres"}
		}
	}
	status["database"] = dbStatus

	// Redis check
	redisStatus := map[string]interface{}{"status": "disconnected"}
	if h.cache != nil {
		if err := h.cache.Ping(); err == nil {
			redisStatus = map[string]interface{}{"status": "connected", "service": "redis"}
		}
	}
	status["cache"] = redisStatus

	// NIN API check
	ninStatus := h.checkAPIServerStatus(h.cfg.NINAPIURL)
	status["nibss_nin"] = ninStatus

	// BVN API check
	bvnStatus := h.checkAPIServerStatus(h.cfg.BVNAPIURL)
	status["nibss_bvn"] = bvnStatus

	// Overall: healthy only if both DB and Redis are up
	if dbStatus["status"] == "connected" && redisStatus["status"] == "connected" {
		status["status"] = "healthy"
	}

	jsonResponse(w, http.StatusOK, status)
}

// =====================================================================
// NIN Verification with Retry
// =====================================================================

func (h *Handler) verifyNINWithRetry(nin, fullName, dob string) (*models.NINResult, error) {
	var lastErr error
	for attempt := 1; attempt <= h.cfg.NINRetryAttempts; attempt++ {
		result, err := h.callNINAPI(nin, fullName, dob)
		if err != nil {
			lastErr = err
			h.log.Warn("NIN API call failed, retrying",
				zap.Int("attempt", attempt),
				zap.Int("max_attempts", h.cfg.NINRetryAttempts),
				zap.Error(err))
			if attempt < h.cfg.NINRetryAttempts {
				time.Sleep(h.cfg.NINRetryDelay)
			}
			continue
		}
		return result, nil
	}
	return nil, fmt.Errorf("NIN verification failed after %d attempts: %w", h.cfg.NINRetryAttempts, lastErr)
}

func (h *Handler) callNINAPI(nin, fullName, dob string) (*models.NINResult, error) {
	payload := fmt.Sprintf(`{"nin":"%s","full_name":"%s","dob":"%s"}`, nin, fullName, dob)
	resp, err := h.httpCl.Post(h.cfg.NINAPIURL, "application/json", strings.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	var apiResp struct {
		Status     string `json:"status"`
		NameMatch  *bool  `json:"name_match"`
		DOBMatch   *bool  `json:"dob_match"`
		PhotoMatch *bool  `json:"photo_match"`
		NIN        string `json:"nin"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	nameMatch := apiResp.NameMatch
	dobMatch := apiResp.DOBMatch
	photoMatch := apiResp.PhotoMatch

	result := &models.NINResult{
		NIN:        apiResp.NIN,
		Status:     apiResp.Status,
		NameMatch:  nameMatch,
		DOBMatch:   dobMatch,
		PhotoMatch: photoMatch,
	}

	return result, nil
}

// =====================================================================
// BVN Verification with Retry
// =====================================================================

func (h *Handler) verifyBVNWithRetry(bvn, fullName string) (*models.BVNResult, error) {
	var lastErr error
	for attempt := 1; attempt <= h.cfg.BVNRetryAttempts; attempt++ {
		result, err := h.callBVNAPI(bvn, fullName)
		if err != nil {
			lastErr = err
			h.log.Warn("BVN API call failed, retrying",
				zap.Int("attempt", attempt),
				zap.Int("max_attempts", h.cfg.BVNRetryAttempts),
				zap.Error(err))
			if attempt < h.cfg.BVNRetryAttempts {
				time.Sleep(h.cfg.BVNRetryDelay)
			}
			continue
		}
		return result, nil
	}
	return nil, fmt.Errorf("BVN verification failed after %d attempts: %w", h.cfg.BVNRetryAttempts, lastErr)
}

func (h *Handler) callBVNAPI(bvn, fullName string) (*models.BVNResult, error) {
	payload := fmt.Sprintf(`{"bvn":"%s","full_name":"%s"}`, bvn, fullName)
	resp, err := h.httpCl.Post(h.cfg.BVNAPIURL, "application/json", strings.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	var apiResp struct {
		Status         string `json:"status"`
		NameMatch      *bool  `json:"name_match"`
		BiometricMatch *bool  `json:"biometric_match"`
		AccountCount   int    `json:"account_count"`
		BVN            string `json:"bvn"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	result := &models.BVNResult{
		BVN:            apiResp.BVN,
		Status:         apiResp.Status,
		NameMatch:      apiResp.NameMatch,
		BiometricMatch: apiResp.BiometricMatch,
		AccountCount:   apiResp.AccountCount,
	}

	return result, nil
}

// =====================================================================
// API Health Check Helper
// =====================================================================

func (h *Handler) checkAPIServerStatus(url string) map[string]interface{} {
	resp, err := h.httpCl.Get(url)
	if err != nil {
		return map[string]interface{}{"status": "unavailable", "url": url, "error": err.Error()}
	}
	defer func() { _ = resp.Body.Close() }()

	status := "unavailable"
	if resp.StatusCode == http.StatusOK {
		status = "available"
	}
	return map[string]interface{}{"status": status, "url": url}
}

// =====================================================================
// Risk Scoring
// =====================================================================

// calculateIndividualRiskScore computes a 0-100 risk score and returns flags.
// Lower scores = higher risk (inverse scoring: more verified data = lower risk).
func (h *Handler) calculateIndividualRiskScore(kyc *models.IndividualKYC) (int, []string) {
	score := 0
	flags := []string{}

	// NIN verification: up to +50 points
	if kyc.NIN != "" && len(kyc.NIN) == 11 {
		score += 25
		if kyc.NINRecord != nil && kyc.NINRecord.Status == "verified" {
			score += 25
		} else {
			flags = append(flags, "nin_not_verified")
		}
	}

	// BVN verification: up to +50 points
	if kyc.BVN != "" && len(kyc.BVN) == 11 {
		score += 25
		if kyc.BVNRecord != nil && kyc.BVNRecord.Status == "verified" {
			score += 25
		} else {
			flags = append(flags, "bvn_not_verified")
		}
	}

	// Personal details completeness
	if kyc.FullName != "" {
		score += 5
	}
	if kyc.DOB.Year() > 1950 && kyc.DOB.Year() < time.Now().Year()-10 {
		score += 5
	}
	if kyc.Phone != "" {
		score += 3
	}
	if kyc.Email != "" && strings.Contains(kyc.Email, "@") {
		score += 3
	}
	if kyc.Address != "" {
		score += 3
	}

	// Bonus: both NIN and BVN present
	if kyc.NIN != "" && kyc.BVN != "" {
		score += 4
	}

	// Cap at 100
	if score > 100 {
		score = 100
	}

	// Generate flags for missing critical data
	if kyc.NIN == "" {
		flags = append(flags, "no_nin_provided")
	}
	if kyc.BVN == "" {
		flags = append(flags, "no_bvn_provided")
	}
	if kyc.FullName == "" {
		flags = append(flags, "missing_full_name")
	}
	if kyc.DOB.IsZero() || kyc.DOB.Year() <= 1950 {
		flags = append(flags, "missing_or_invalid_dob")
	}

	return score, flags
}

func scoreToRiskLevel(score int) models.RiskLevel {
	if score >= 80 {
		return models.RiskLow
	}
	if score >= 50 {
		return models.RiskMedium
	}
	if score >= 25 {
		return models.RiskHigh
	}
	return models.RiskCritical
}

func determineStatus(score int) models.KYCStatus {
	if score >= 80 {
		return models.Verified
	}
	if score >= 40 {
		return models.UnderReview
	}
	return models.Rejected
}

func determineTier(hasNIN, hasFullNamel, hasPhone bool) (int, int64) {
	switch {
	case hasNIN && hasFullNamel && hasPhone:
		return 3, 999999999
	case hasNIN && hasFullNamel:
		return 2, 5000000
	default:
		return 1, 300000
	}
}

// =====================================================================
// Input Validation
// =====================================================================

func validateIndividualRequest(req *models.VerificationRequest) error {
	if req.NIN == "" && req.BVN == "" {
		return fmt.Errorf("either NIN or BVN is required")
	}
	if req.NIN != "" && !isValidID(req.NIN) {
		return fmt.Errorf("invalid NIN format: must be 11 digits")
	}
	if req.BVN != "" && !isValidID(req.BVN) {
		return fmt.Errorf("invalid BVN format: must be 11 digits")
	}
	if req.FullName == "" {
		return fmt.Errorf("full_name is required")
	}
	if len(req.FullName) < 2 || len(req.FullName) > 150 {
		return fmt.Errorf("full_name must be between 2 and 150 characters")
	}
	if req.DOB != "" {
		if _, err := time.Parse("2006-01-02", req.DOB); err != nil {
			return fmt.Errorf("invalid DOB format: use YYYY-MM-DD")
		}
	}
	if req.Gender != "" && req.Gender != "male" && req.Gender != "female" && req.Gender != "other" {
		return fmt.Errorf("invalid gender: must be male, female, or other")
	}
	if req.Phone != "" && !isValidPhone(req.Phone) {
		return fmt.Errorf("invalid phone number format")
	}
	if req.Email != "" && !isValidEmail(req.Email) {
		return fmt.Errorf("invalid email format")
	}
	return nil
}

func validateBusinessRequest(req *models.VerificationRequest) error {
	if req.RCNumber == "" && req.TIN == "" {
		return fmt.Errorf("either RCNumber or TIN is required")
	}
	if req.CompanyName == "" {
		return fmt.Errorf("company_name is required")
	}
	if len(req.CompanyName) < 2 || len(req.CompanyName) > 200 {
		return fmt.Errorf("company_name must be between 2 and 200 characters")
	}
	if req.TIN != "" && !isValidID(req.TIN) {
		return fmt.Errorf("invalid TIN format: must be 10-15 digits")
	}
	if req.RCNumber != "" && len(req.RCNumber) > 50 {
		return fmt.Errorf("RC number too long (max 50 characters)")
	}
	if len(req.Directors) > 0 {
		for i, d := range req.Directors {
			if d.Name == "" {
				return fmt.Errorf("director[%d].name is required", i)
			}
			if d.IDNumber == "" {
				return fmt.Errorf("director[%d].id_number is required", i)
			}
		}
	}
	return nil
}

func validateNIN(nin, fullName, dob string) error {
	if nin == "" {
		return fmt.Errorf("NIN is required")
	}
	if !isValidID(nin) {
		return fmt.Errorf("invalid NIN format: must be 11 digits")
	}
	if fullName == "" {
		return fmt.Errorf("full_name is required")
	}
	if dob != "" {
		if _, err := time.Parse("2006-01-02", dob); err != nil {
			return fmt.Errorf("invalid DOB format: use YYYY-MM-DD")
		}
	}
	return nil
}

func validateBVN(bvn, fullName string) error {
	if bvn == "" {
		return fmt.Errorf("BVN is required")
	}
	if !isValidID(bvn) {
		return fmt.Errorf("invalid BVN format: must be 11 digits")
	}
	if fullName == "" {
		return fmt.Errorf("full_name is required")
	}
	return nil
}

// Validation helpers
func isValidID(s string) bool {
	if len(s) < 11 || len(s) > 15 {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func isValidPhone(s string) bool {
	return len(s) >= 7 && len(s) <= 20
}

func isValidEmail(s string) bool {
	return strings.Contains(s, "@") && strings.Contains(s, ".")
}

// =====================================================================
// Middleware
// =====================================================================

// corsMiddleware adds CORS headers.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// authMiddleware validates API key for protected endpoints.
func authMiddleware(secret string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		// Public endpoints
		if path == "/health" || path == "/api/v1/kyc/stats" {
			next.ServeHTTP(w, r)
			return
		}

		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			errorResponse(w, http.StatusUnauthorized, "missing authorization header")
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == "" {
			token = strings.TrimPrefix(authHeader, "ApiKey ")
		}

		// Simple token length check; in production use JWT or HMAC validation
		if len(token) < 16 {
			errorResponse(w, http.StatusUnauthorized, "invalid API key")
			return
		}

		// Verify the token against the configured secret hash
		hashedSecret, err := bcrypt.GenerateFromPassword([]byte(secret), bcrypt.DefaultCost)
		if err != nil {
			errorResponse(w, http.StatusInternalServerError, "internal error")
			return
		}
		if err := bcrypt.CompareHashAndPassword(hashedSecret, []byte(token)); err != nil {
			errorResponse(w, http.StatusUnauthorized, "invalid API key")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// requestIDMiddleware generates or propagates a request ID.
func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqID := r.Header.Get("X-Request-ID")
		if reqID == "" {
			b := make([]byte, 8)
			_, _ = rand.Read(b)
			reqID = hex.EncodeToString(b)
		}
		w.Header().Set("X-Request-ID", reqID)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKeyRequestid, reqID)))
	})
}

// =====================================================================
// Main
// =====================================================================

func main() {
	log, err := zap.NewProduction()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create logger: %v\n", err)
		os.Exit(1)
	}
	defer func() { _ = log.Sync() }()

	cfg := config.Load()
	log.Info("configuration loaded",
		zap.String("port", cfg.Port),
		zap.String("db_host", cfg.DBHost),
		zap.String("redis_addr", cfg.RedisAddr),
	)

	// Initialize database
	store, err := db.NewPostgresStore(cfg, log)
	if err != nil {
		log.Fatal("failed to initialize database", zap.Error(err))
	}

	// Initialize Redis cache (non-fatal if unavailable)
	var cache *db.RedisCache
	cache, err = db.NewRedisCache(cfg, log)
	if err != nil {
		log.Warn("redis unavailable, continuing without cache", zap.Error(err))
	}

	// Initialize handler
	handler := NewHandler(store, cache, cfg, log)

	// Setup router
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(corsMiddleware)
	r.Use(func(next http.Handler) http.Handler { return authMiddleware(cfg.JWTSecret, next) })
	r.Use(requestIDMiddleware)

	// Register routes
	r.Get("/health", handler.healthCheck)
	r.Get("/api/v1/kyc/stats", handler.getKYCStats)
	r.Post("/api/v1/kyc/individual", handler.submitIndividualKYC)
	r.Post("/api/v1/kyc/business", handler.submitBusinessKYC)
	r.Get("/api/v1/kyc/{customerId}", handler.getKYCStatus)
	r.Post("/api/v1/kyc/verify-nin", handler.verifyNIN)
	r.Post("/api/v1/kyc/verify-bvn", handler.verifyBVN)
	r.Post("/api/v1/kyc/refresh", handler.refreshKYC)

	// Background maintenance tasks
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		backgroundTasks(log, store, cache, cfg)
	}()

	// HTTP server
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in goroutine
	go func() {
		log.Info("starting KYC/KYB server", zap.String("address", ":"+cfg.Port))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal("server failed to start", zap.Error(err))
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("shutting down server...")

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Error("server forced shutdown", zap.Error(err))
	}

	log.Info("server exited properly")
	wg.Wait()
}

// =====================================================================
// Background Maintenance Tasks (runs every 5 minutes)
// =====================================================================

func backgroundTasks(log *zap.Logger, store *db.PostgresStore, cache *db.RedisCache, cfg *config.Config) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	log.Info("background task worker started")

	for range ticker.C {
		log.Debug("running background maintenance tasks")

		// Expire overdue KYC/KYB records
		rows, err := store.ExpireOverdueKYCs()
		if err != nil {
			log.Error("failed to expire overdue KYCs", zap.Error(err))
		} else if rows > 0 {
			log.Info("expired overdue KYC/KYB records", zap.Int64("count", rows))
		}

		// Process refresh reminders
		reminders, err := store.GetRemindersDue()
		if err != nil {
			log.Error("failed to get refresh reminders", zap.Error(err))
		} else {
			for _, reminder := range reminders {
				if err := store.MarkReminderSent(reminder.ID); err != nil {
					log.Error("failed to mark reminder sent",
						zap.String("reminder_id", reminder.ID), zap.Error(err))
					continue
				}
				log.Info("refresh reminder sent",
					zap.String("customer_id", reminder.CustomerID),
					zap.Time("expires_at", reminder.ExpiresAt),
					zap.String("reminder_type", reminder.ReminderType))
			}
		}

		// Clean stale audit trails beyond retention period
		cutoff := time.Now().Add(-cfg.AuditRetention)
		res := store.DB().Exec("DELETE FROM audit_trails WHERE timestamp < ?", cutoff)
		if res.Error != nil {
			log.Error("failed to clean audit trails", zap.Error(res.Error))
		} else {
			rowsAffected := res.RowsAffected
			if rowsAffected > 0 {
				log.Info("cleaned stale audit trails", zap.Int64("removed", rowsAffected))
			}
		}
	}
}

// validateQueryParam returns the query parameter value for key, enforcing a
// maximum length. An absent parameter yields an empty string and no error.
func validateQueryParam(r *http.Request, key string, maxLen int) (string, error) {
	val := r.URL.Query().Get(key)
	if len(val) > maxLen {
		return "", fmt.Errorf("parameter %s exceeds max length %d", key, maxLen)
	}
	return val, nil
}

// validateIntParam parses the query parameter for key as an integer. An absent
// parameter yields 0 and no error; a non-integer value yields an error.
func validateIntParam(r *http.Request, key string) (int, error) {
	val := r.URL.Query().Get(key)
	if val == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 0, fmt.Errorf("parameter %s must be an integer", key)
	}
	return n, nil
}
