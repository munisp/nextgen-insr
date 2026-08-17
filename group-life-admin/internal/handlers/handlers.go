package handlers

import (
	"encoding/json"
	"github.com/unified-insurance/group-life-admin/internal/service"
	"net/http"

	"github.com/google/uuid"
)

type GroupLifeHandler struct {
	svc *service.GroupLifeService
}

func NewGroupLifeHandler(svc *service.GroupLifeService) *GroupLifeHandler {
	return &GroupLifeHandler{svc: svc}
}

func (h *GroupLifeHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/group-life/schemes", h.CreateScheme)
	mux.HandleFunc("GET /api/v1/group-life/schemes", h.ListSchemes)
	mux.HandleFunc("GET /api/v1/group-life/schemes/{id}", h.GetScheme)
	mux.HandleFunc("POST /api/v1/group-life/schemes/{id}/members", h.AddMember)
	mux.HandleFunc("GET /api/v1/group-life/schemes/{id}/members", h.GetMembers)
	mux.HandleFunc("DELETE /api/v1/group-life/members/{id}", h.RemoveMember)
	mux.HandleFunc("POST /api/v1/group-life/members/{id}/beneficiaries", h.AddBeneficiary)
	mux.HandleFunc("GET /api/v1/group-life/members/{id}/beneficiaries", h.GetBeneficiaries)
	mux.HandleFunc("POST /api/v1/group-life/claims", h.SubmitClaim)
	mux.HandleFunc("GET /api/v1/group-life/schemes/{id}/claims", h.GetClaims)
	mux.HandleFunc("POST /api/v1/group-life/claims/{id}/approve", h.ApproveClaim)
	mux.HandleFunc("POST /api/v1/group-life/claims/{id}/decline", h.DeclineClaim)
	mux.HandleFunc("POST /api/v1/group-life/schemes/{id}/premium", h.CalculatePremium)
	mux.HandleFunc("GET /api/v1/group-life/schemes/{id}/premium-schedules", h.GetPremiumSchedules)
	mux.HandleFunc("POST /api/v1/group-life/endorsements", h.CreateEndorsement)
	mux.HandleFunc("GET /api/v1/group-life/schemes/{id}/endorsements", h.GetEndorsements)
	mux.HandleFunc("POST /api/v1/group-life/schemes/{id}/experience-rating", h.CalculateExperienceRating)
	mux.HandleFunc("GET /api/v1/group-life/schemes/{id}/experience-ratings", h.GetExperienceRatings)
	mux.HandleFunc("GET /health", h.HealthCheck)
	mux.HandleFunc("GET /ready", h.ReadinessCheck)
}

func (h *GroupLifeHandler) CreateScheme(w http.ResponseWriter, r *http.Request) {
	var req service.CreateSchemeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.CreateScheme(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *GroupLifeHandler) ListSchemes(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	results, err := h.svc.GetSchemes(r.Context(), status)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *GroupLifeHandler) GetScheme(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid scheme ID")
		return
	}
	result, err := h.svc.GetScheme(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *GroupLifeHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	schemeID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid scheme ID")
		return
	}
	var req service.AddMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	req.SchemeID = schemeID
	result, err := h.svc.AddMember(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *GroupLifeHandler) GetMembers(w http.ResponseWriter, r *http.Request) {
	schemeID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid scheme ID")
		return
	}
	results, err := h.svc.GetMembers(r.Context(), schemeID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *GroupLifeHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid member ID")
		return
	}
	if err := h.svc.RemoveMember(r.Context(), id); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

func (h *GroupLifeHandler) AddBeneficiary(w http.ResponseWriter, r *http.Request) {
	memberID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid member ID")
		return
	}
	var req service.AddBeneficiaryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	req.MemberID = memberID
	result, err := h.svc.AddBeneficiary(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *GroupLifeHandler) GetBeneficiaries(w http.ResponseWriter, r *http.Request) {
	memberID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid member ID")
		return
	}
	results, err := h.svc.GetBeneficiaries(r.Context(), memberID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *GroupLifeHandler) SubmitClaim(w http.ResponseWriter, r *http.Request) {
	var req service.SubmitClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.SubmitClaim(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *GroupLifeHandler) GetClaims(w http.ResponseWriter, r *http.Request) {
	schemeID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid scheme ID")
		return
	}
	results, err := h.svc.GetClaims(r.Context(), schemeID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *GroupLifeHandler) ApproveClaim(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid claim ID")
		return
	}
	var req struct {
		ApprovedAmount float64 `json:"approved_amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.ApproveClaim(r.Context(), id, req.ApprovedAmount); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "approved"})
}

func (h *GroupLifeHandler) DeclineClaim(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid claim ID")
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.DeclineClaim(r.Context(), id, req.Reason); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "declined"})
}

func (h *GroupLifeHandler) CalculatePremium(w http.ResponseWriter, r *http.Request) {
	schemeID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid scheme ID")
		return
	}
	result, err := h.svc.CalculatePremium(r.Context(), schemeID)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *GroupLifeHandler) GetPremiumSchedules(w http.ResponseWriter, r *http.Request) {
	schemeID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid scheme ID")
		return
	}
	results, err := h.svc.GetPremiumSchedules(r.Context(), schemeID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *GroupLifeHandler) CreateEndorsement(w http.ResponseWriter, r *http.Request) {
	var req service.EndorsementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.CreateEndorsement(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *GroupLifeHandler) GetEndorsements(w http.ResponseWriter, r *http.Request) {
	schemeID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid scheme ID")
		return
	}
	results, err := h.svc.GetEndorsements(r.Context(), schemeID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *GroupLifeHandler) CalculateExperienceRating(w http.ResponseWriter, r *http.Request) {
	schemeID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid scheme ID")
		return
	}
	var req struct {
		Period string `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.CalculateExperienceRating(r.Context(), schemeID, req.Period)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *GroupLifeHandler) GetExperienceRatings(w http.ResponseWriter, r *http.Request) {
	schemeID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid scheme ID")
		return
	}
	results, err := h.svc.GetExperienceRatings(r.Context(), schemeID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *GroupLifeHandler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "healthy", "service": "group-life-admin"})
}

func (h *GroupLifeHandler) ReadinessCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "service": "group-life-admin"})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
