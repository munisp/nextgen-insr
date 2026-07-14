package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/models"
	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/services"
)

type KYBHandler struct {
	kybService *services.KYBService
}

func NewKYBHandler(kybService *services.KYBService) *KYBHandler {
	return &KYBHandler{kybService: kybService}
}

func (h *KYBHandler) StartVerification(c *gin.Context) {
	var req models.StartKYBRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.kybService.StartVerification(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (h *KYBHandler) GetVerification(c *gin.Context) {
	sessionID := c.Param("sessionId")
	v, err := h.kybService.GetVerification(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYBHandler) VerifyCAC(c *gin.Context) {
	sessionID := c.Param("sessionId")
	v, err := h.kybService.VerifyCAC(sessionID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYBHandler) VerifyTIN(c *gin.Context) {
	sessionID := c.Param("sessionId")
	v, err := h.kybService.VerifyTIN(sessionID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYBHandler) AddDirector(c *gin.Context) {
	var req models.AddDirectorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.kybService.AddDirector(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYBHandler) AddUBO(c *gin.Context) {
	var req models.AddUBORequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.kybService.AddUBO(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYBHandler) SubmitDocument(c *gin.Context) {
	var req models.SubmitKYBDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.kybService.SubmitDocument(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYBHandler) ReviewDecision(c *gin.Context) {
	var req models.ReviewDecisionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.kybService.ReviewDecision(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *KYBHandler) GetEvents(c *gin.Context) {
	sessionID := c.Param("sessionId")
	events, err := h.kybService.GetEvents(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, events)
}
