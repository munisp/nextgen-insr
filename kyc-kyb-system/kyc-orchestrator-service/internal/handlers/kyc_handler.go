package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/models"
	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/services"
)

type KYCHandler struct {
	kycService *services.KYCService
	amlService *services.AMLService
}

func NewKYCHandler(kycService *services.KYCService, amlService *services.AMLService) *KYCHandler {
	return &KYCHandler{kycService: kycService, amlService: amlService}
}

func (h *KYCHandler) StartVerification(c *gin.Context) {
	var req models.StartKYCRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.kycService.StartVerification(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (h *KYCHandler) GetVerification(c *gin.Context) {
	sessionID := c.Param("sessionId")
	v, err := h.kycService.GetVerification(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYCHandler) GetUserVerifications(c *gin.Context) {
	userID := c.Param("userId")
	results, err := h.kycService.GetUserVerifications(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, results)
}

func (h *KYCHandler) SubmitDocument(c *gin.Context) {
	var req models.SubmitDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.kycService.SubmitDocument(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYCHandler) SubmitSelfie(c *gin.Context) {
	var req models.SubmitSelfieRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.kycService.SubmitSelfie(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYCHandler) VerifyNIN(c *gin.Context) {
	var req models.VerifyNINRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.kycService.VerifyNIN(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYCHandler) VerifyBVN(c *gin.Context) {
	var req models.VerifyBVNRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.kycService.VerifyBVN(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYCHandler) VerifyPhone(c *gin.Context) {
	var req models.VerifyPhoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.kycService.VerifyPhone(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYCHandler) ReviewDecision(c *gin.Context) {
	var req models.ReviewDecisionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.kycService.ReviewDecision(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYCHandler) GetEvents(c *gin.Context) {
	sessionID := c.Param("sessionId")
	events, err := h.kycService.GetEvents(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, events)
}

func (h *KYCHandler) AMLScreen(c *gin.Context) {
	var req models.AMLScreenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result, err := h.amlService.Screen(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *KYCHandler) AssessRisk(c *gin.Context) {
	sessionID := c.Param("sessionId")
	v, err := h.kycService.GetVerification(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	assessment, err := h.amlService.AssessRisk(sessionID, v)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, assessment)
}
