package handlers

import (
	"encoding/json"
	"github.com/unified-insurance/reinsurance-management/internal/service"
	"net/http"

	"github.com/google/uuid"
)

type ReinsuranceHandler struct {
	svc *service.ReinsuranceService
}

func NewReinsuranceHandler(svc *service.ReinsuranceService) *ReinsuranceHandler {
	return &ReinsuranceHandler{svc: svc}
}

func (h *ReinsuranceHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/reinsurance/treaties", h.CreateTreaty)
	mux.HandleFunc("GET /api/v1/reinsurance/treaties", h.ListTreaties)
	mux.HandleFunc("GET /api/v1/reinsurance/treaties/{id}", h.GetTreaty)
	mux.HandleFunc("POST /api/v1/reinsurance/treaties/{id}/participations", h.AddParticipation)
	mux.HandleFunc("GET /api/v1/reinsurance/treaties/{id}/participations", h.GetParticipations)
	mux.HandleFunc("POST /api/v1/reinsurance/cessions", h.CalculateCession)
	mux.HandleFunc("POST /api/v1/reinsurance/facultative", h.CreateFacPlacement)
	mux.HandleFunc("GET /api/v1/reinsurance/facultative", h.ListFacPlacements)
	mux.HandleFunc("POST /api/v1/reinsurance/facultative/{id}/place", h.PlaceFacultative)
	mux.HandleFunc("POST /api/v1/reinsurance/recoveries", h.CalculateRecovery)
	mux.HandleFunc("GET /api/v1/reinsurance/recoveries/{treatyId}", h.GetRecoveries)
	mux.HandleFunc("POST /api/v1/reinsurance/recoveries/{id}/submit", h.SubmitRecovery)
	mux.HandleFunc("POST /api/v1/reinsurance/bordereau/{treatyId}", h.GenerateBordereau)
	mux.HandleFunc("GET /api/v1/reinsurance/bordereau/{treatyId}", h.GetBordereau)
	mux.HandleFunc("POST /api/v1/reinsurance/accounts/{treatyId}", h.GenerateAccount)
	mux.HandleFunc("GET /api/v1/reinsurance/accounts/{treatyId}", h.GetAccounts)
	mux.HandleFunc("POST /api/v1/reinsurance/analytics", h.CalculateAnalytics)
	mux.HandleFunc("GET /health", h.HealthCheck)
	mux.HandleFunc("GET /ready", h.ReadinessCheck)
}

func (h *ReinsuranceHandler) CreateTreaty(w http.ResponseWriter, r *http.Request) {
	var req service.CreateTreatyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.CreateTreaty(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *ReinsuranceHandler) ListTreaties(w http.ResponseWriter, r *http.Request) {
	lob := r.URL.Query().Get("line_of_business")
	results, err := h.svc.GetTreaties(r.Context(), lob)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *ReinsuranceHandler) GetTreaty(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid treaty ID")
		return
	}
	result, err := h.svc.GetTreaty(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *ReinsuranceHandler) AddParticipation(w http.ResponseWriter, r *http.Request) {
	treatyID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid treaty ID")
		return
	}
	var req service.AddParticipationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	req.TreatyID = treatyID
	result, err := h.svc.AddReinsurerParticipation(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *ReinsuranceHandler) GetParticipations(w http.ResponseWriter, r *http.Request) {
	treatyID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid treaty ID")
		return
	}
	results, err := h.svc.GetParticipations(r.Context(), treatyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *ReinsuranceHandler) CalculateCession(w http.ResponseWriter, r *http.Request) {
	var req service.CessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.CalculateCession(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *ReinsuranceHandler) CreateFacPlacement(w http.ResponseWriter, r *http.Request) {
	var req service.FacultativeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.CreateFacultativePlacement(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *ReinsuranceHandler) ListFacPlacements(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	results, err := h.svc.GetFacPlacements(r.Context(), status)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *ReinsuranceHandler) PlaceFacultative(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid placement ID")
		return
	}
	var req struct {
		ReinsurerName string `json:"reinsurer_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.PlaceFacultative(r.Context(), id, req.ReinsurerName); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "placed"})
}

func (h *ReinsuranceHandler) CalculateRecovery(w http.ResponseWriter, r *http.Request) {
	var req service.ClaimRecoveryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.CalculateClaimRecovery(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *ReinsuranceHandler) GetRecoveries(w http.ResponseWriter, r *http.Request) {
	treatyID, err := uuid.Parse(r.PathValue("treatyId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid treaty ID")
		return
	}
	results, err := h.svc.GetRecoveries(r.Context(), treatyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *ReinsuranceHandler) SubmitRecovery(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid recovery ID")
		return
	}
	if err := h.svc.SubmitClaimRecovery(r.Context(), id); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "submitted"})
}

func (h *ReinsuranceHandler) GenerateBordereau(w http.ResponseWriter, r *http.Request) {
	treatyID, err := uuid.Parse(r.PathValue("treatyId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid treaty ID")
		return
	}
	var req struct {
		Period string `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	results, err := h.svc.GenerateBordereau(r.Context(), treatyID, req.Period)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, results)
}

func (h *ReinsuranceHandler) GetBordereau(w http.ResponseWriter, r *http.Request) {
	treatyID, err := uuid.Parse(r.PathValue("treatyId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid treaty ID")
		return
	}
	period := r.URL.Query().Get("period")
	results, err := h.svc.GetBordereau(r.Context(), treatyID, period)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *ReinsuranceHandler) GenerateAccount(w http.ResponseWriter, r *http.Request) {
	treatyID, err := uuid.Parse(r.PathValue("treatyId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid treaty ID")
		return
	}
	var req struct {
		Period string `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.GenerateAccountStatement(r.Context(), treatyID, req.Period)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *ReinsuranceHandler) GetAccounts(w http.ResponseWriter, r *http.Request) {
	treatyID, err := uuid.Parse(r.PathValue("treatyId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid treaty ID")
		return
	}
	results, err := h.svc.GetAccounts(r.Context(), treatyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *ReinsuranceHandler) CalculateAnalytics(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Period string `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.CalculateAnalytics(r.Context(), req.Period)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *ReinsuranceHandler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "healthy", "service": "reinsurance-management"})
}

func (h *ReinsuranceHandler) ReadinessCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "service": "reinsurance-management"})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
