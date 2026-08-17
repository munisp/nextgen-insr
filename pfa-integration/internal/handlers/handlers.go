package handlers

import (
	"encoding/json"
	"github.com/unified-insurance/pfa-integration/internal/service"
	"net/http"

	"github.com/google/uuid"
)

type PFAHandler struct {
	svc *service.PFAService
}

func NewPFAHandler(svc *service.PFAService) *PFAHandler {
	return &PFAHandler{svc: svc}
}

func (h *PFAHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/pfa/partners", h.RegisterPartner)
	mux.HandleFunc("GET /api/v1/pfa/partners", h.ListPartners)
	mux.HandleFunc("POST /api/v1/pfa/rsa-holders", h.RegisterRSAHolder)
	mux.HandleFunc("GET /api/v1/pfa/rsa-holders/{rsaPIN}/validate", h.ValidateRSAPIN)
	mux.HandleFunc("POST /api/v1/pfa/annuity/quotes", h.CalculateAnnuityQuote)
	mux.HandleFunc("POST /api/v1/pfa/annuity/quotes/{id}/accept", h.AcceptQuote)
	mux.HandleFunc("GET /api/v1/pfa/annuity/products", h.ListProducts)
	mux.HandleFunc("GET /api/v1/pfa/annuity/policies/{holderId}", h.GetPoliciesByHolder)
	mux.HandleFunc("POST /api/v1/pfa/payments/{policyId}", h.ProcessPayment)
	mux.HandleFunc("GET /api/v1/pfa/payments/{policyId}", h.GetPayments)
	mux.HandleFunc("POST /api/v1/pfa/group-life", h.CalculateGroupLife)
	mux.HandleFunc("POST /api/v1/pfa/fund-transfers", h.InitiateFundTransfer)
	mux.HandleFunc("POST /api/v1/pfa/fund-transfers/{id}/approve", h.ApproveFundTransfer)
	mux.HandleFunc("POST /api/v1/pfa/reports", h.GenerateReport)
	mux.HandleFunc("GET /health", h.HealthCheck)
	mux.HandleFunc("GET /ready", h.ReadinessCheck)
}

func (h *PFAHandler) RegisterPartner(w http.ResponseWriter, r *http.Request) {
	var req service.RegisterPFARequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.RegisterPFAPartner(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *PFAHandler) ListPartners(w http.ResponseWriter, r *http.Request) {
	results, err := h.svc.GetPFAPartners(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *PFAHandler) RegisterRSAHolder(w http.ResponseWriter, r *http.Request) {
	var req service.RegisterRSAHolderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.RegisterRSAHolder(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *PFAHandler) ValidateRSAPIN(w http.ResponseWriter, r *http.Request) {
	rsaPIN := r.PathValue("rsaPIN")
	result, err := h.svc.ValidateRSAPIN(r.Context(), rsaPIN)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *PFAHandler) CalculateAnnuityQuote(w http.ResponseWriter, r *http.Request) {
	var req service.AnnuityQuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.CalculateAnnuityQuote(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *PFAHandler) AcceptQuote(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid quote ID")
		return
	}
	result, err := h.svc.AcceptAnnuityQuote(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *PFAHandler) ListProducts(w http.ResponseWriter, r *http.Request) {
	results, err := h.svc.GetAnnuityProducts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *PFAHandler) GetPoliciesByHolder(w http.ResponseWriter, r *http.Request) {
	holderID, err := uuid.Parse(r.PathValue("holderId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid holder ID")
		return
	}
	results, err := h.svc.GetPoliciesByHolder(r.Context(), holderID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *PFAHandler) ProcessPayment(w http.ResponseWriter, r *http.Request) {
	policyID, err := uuid.Parse(r.PathValue("policyId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid policy ID")
		return
	}
	result, err := h.svc.ProcessPensionPayment(r.Context(), policyID)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *PFAHandler) GetPayments(w http.ResponseWriter, r *http.Request) {
	policyID, err := uuid.Parse(r.PathValue("policyId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid policy ID")
		return
	}
	results, err := h.svc.GetPaymentsByPolicy(r.Context(), policyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *PFAHandler) CalculateGroupLife(w http.ResponseWriter, r *http.Request) {
	var req service.GroupLifeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.CalculateGroupLifePremium(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *PFAHandler) InitiateFundTransfer(w http.ResponseWriter, r *http.Request) {
	var req service.FundTransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.InitiateFundTransfer(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *PFAHandler) ApproveFundTransfer(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid transfer ID")
		return
	}
	if err := h.svc.ApproveFundTransfer(r.Context(), id); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "approved"})
}

func (h *PFAHandler) GenerateReport(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ReportType string `json:"report_type"`
		Period     string `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.GeneratePenComReport(r.Context(), req.ReportType, req.Period)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *PFAHandler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "healthy", "service": "pfa-integration"})
}

func (h *PFAHandler) ReadinessCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "service": "pfa-integration"})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
