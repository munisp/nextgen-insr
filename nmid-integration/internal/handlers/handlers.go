package handlers

import (
	"encoding/json"
	"github.com/unified-insurance/nmid-integration/internal/service"
	"net/http"

	"github.com/google/uuid"
)

type NMIDHandler struct {
	svc *service.NMIDService
}

func NewNMIDHandler(svc *service.NMIDService) *NMIDHandler {
	return &NMIDHandler{svc: svc}
}

func (h *NMIDHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/nmid/vehicles", h.RegisterVehicle)
	mux.HandleFunc("GET /api/v1/nmid/vehicles/{regNo}", h.GetVehicle)
	mux.HandleFunc("POST /api/v1/nmid/vehicles/{regNo}/verify", h.VerifyVehicle)
	mux.HandleFunc("POST /api/v1/nmid/policies", h.RegisterPolicy)
	mux.HandleFunc("GET /api/v1/nmid/policies/vehicle/{regNo}", h.GetVehiclePolicies)
	mux.HandleFunc("POST /api/v1/nmid/policies/{id}/cancel", h.CancelPolicy)
	mux.HandleFunc("POST /api/v1/nmid/certificates/{certNo}/verify", h.VerifyCertificate)
	mux.HandleFunc("POST /api/v1/nmid/claims", h.RecordClaim)
	mux.HandleFunc("GET /api/v1/nmid/claims/{regNo}", h.GetClaimHistory)
	mux.HandleFunc("POST /api/v1/nmid/batch", h.InitiateBatch)
	mux.HandleFunc("GET /api/v1/nmid/batch/{batchRef}", h.GetBatchStatus)
	mux.HandleFunc("POST /api/v1/nmid/renewals/process", h.ProcessExpiringPolicies)
	mux.HandleFunc("GET /api/v1/nmid/renewals/pending", h.GetPendingRenewals)
	mux.HandleFunc("GET /health", h.HealthCheck)
	mux.HandleFunc("GET /ready", h.ReadinessCheck)
}

func (h *NMIDHandler) RegisterVehicle(w http.ResponseWriter, r *http.Request) {
	var req service.RegisterVehicleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.RegisterVehicle(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *NMIDHandler) GetVehicle(w http.ResponseWriter, r *http.Request) {
	regNo := r.PathValue("regNo")
	result, err := h.svc.GetVehicle(r.Context(), regNo)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *NMIDHandler) VerifyVehicle(w http.ResponseWriter, r *http.Request) {
	regNo := r.PathValue("regNo")
	result, err := h.svc.VerifyVehicle(r.Context(), regNo)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *NMIDHandler) RegisterPolicy(w http.ResponseWriter, r *http.Request) {
	var req service.RegisterPolicyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.RegisterPolicy(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *NMIDHandler) GetVehiclePolicies(w http.ResponseWriter, r *http.Request) {
	regNo := r.PathValue("regNo")
	results, err := h.svc.GetVehiclePolicies(r.Context(), regNo)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *NMIDHandler) CancelPolicy(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid policy ID")
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.CancelPolicy(r.Context(), id, req.Reason); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

func (h *NMIDHandler) VerifyCertificate(w http.ResponseWriter, r *http.Request) {
	certNo := r.PathValue("certNo")
	verifiedBy := r.URL.Query().Get("verified_by")
	if verifiedBy == "" {
		verifiedBy = "public"
	}
	result, err := h.svc.VerifyCertificate(r.Context(), certNo, verifiedBy)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *NMIDHandler) RecordClaim(w http.ResponseWriter, r *http.Request) {
	var req service.RecordClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.RecordClaim(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *NMIDHandler) GetClaimHistory(w http.ResponseWriter, r *http.Request) {
	regNo := r.PathValue("regNo")
	results, err := h.svc.GetClaimHistory(r.Context(), regNo)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *NMIDHandler) InitiateBatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		InsurerCode  string `json:"insurer_code"`
		TotalRecords int    `json:"total_records"`
		FileURL      string `json:"file_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.InitiateBatchRegistration(r.Context(), req.InsurerCode, req.TotalRecords, req.FileURL)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *NMIDHandler) GetBatchStatus(w http.ResponseWriter, r *http.Request) {
	batchRef := r.PathValue("batchRef")
	result, err := h.svc.GetBatchStatus(r.Context(), batchRef)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *NMIDHandler) ProcessExpiringPolicies(w http.ResponseWriter, r *http.Request) {
	results, err := h.svc.ProcessExpiringPolicies(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *NMIDHandler) GetPendingRenewals(w http.ResponseWriter, r *http.Request) {
	results, err := h.svc.GetPendingRenewals(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *NMIDHandler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "healthy", "service": "nmid-integration"})
}

func (h *NMIDHandler) ReadinessCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "service": "nmid-integration"})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
