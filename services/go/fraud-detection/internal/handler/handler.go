package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/munisp/ngapp/services/fraud-detection/internal/scoring"
	"github.com/munisp/ngapp/services/fraud-detection/internal/store"
)

type Handler struct {
	engine *scoring.Engine
	db     *store.Postgres
}

func New(engine *scoring.Engine, db *store.Postgres) *Handler {
	return &Handler{engine: engine, db: db}
}

func (h *Handler) ScoreClaim(c *gin.Context) {
	var req struct {
		ClaimID int64 `json:"claimId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "claimId is required"})
		return
	}

	score, err := h.engine.ScoreClaim(c.Request.Context(), req.ClaimID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, score)
}

func (h *Handler) GetClaimScore(c *gin.Context) {
	claimID, err := strconv.ParseInt(c.Param("claimId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid claimId"})
		return
	}

	score, err := h.db.GetFraudScore(c.Request.Context(), claimID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "score not found"})
		return
	}

	c.JSON(http.StatusOK, score)
}

func (h *Handler) ListFraudPatterns(c *gin.Context) {
	patterns, err := h.db.ListFraudPatterns(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"patterns": patterns})
}

func (h *Handler) CreateFraudPattern(c *gin.Context) {
	var req struct {
		Name        string  `json:"name" binding:"required"`
		Description string  `json:"description" binding:"required"`
		Weight      float64 `json:"weight" binding:"required"`
		Threshold   float64 `json:"threshold" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id, err := h.db.CreateFraudPattern(c.Request.Context(), req.Name, req.Description, req.Weight, req.Threshold)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": id, "name": req.Name})
}

func (h *Handler) GetFraudNetwork(c *gin.Context) {
	userID, err := strconv.ParseInt(c.Param("userId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid userId"})
		return
	}

	network, err := h.db.GetFraudNetwork(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, network)
}

func (h *Handler) GetFraudStats(c *gin.Context) {
	stats, err := h.db.GetFraudStats(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

func (h *Handler) SubmitFraudReport(c *gin.Context) {
	var req struct {
		ClaimID    int64  `json:"claimId" binding:"required"`
		ReporterID int64  `json:"reporterId" binding:"required"`
		Reason     string `json:"reason" binding:"required"`
		Evidence   string `json:"evidence"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id, err := h.db.CreateFraudReport(c.Request.Context(), req.ClaimID, req.ReporterID, req.Reason, req.Evidence)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": id, "status": "submitted"})
}

func (h *Handler) UpdateThreshold(c *gin.Context) {
	var req struct {
		AutoApproveBelow  float64 `json:"autoApproveBelow" binding:"required"`
		ManualReviewAbove float64 `json:"manualReviewAbove" binding:"required"`
		AutoRejectAbove   float64 `json:"autoRejectAbove" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err := h.db.UpdateFraudThresholds(c.Request.Context(), req.AutoApproveBelow, req.ManualReviewAbove, req.AutoRejectAbove)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "updated", "thresholds": req})
}
