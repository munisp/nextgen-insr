package handlers

import (
	"encoding/json"
	"github.com/munisp/NGApp/gdpr-compliance/internal/service"
	"net/http"
)

type GDPRHandler struct{ svc *service.GDPRService }

func NewGDPRHandler(svc *service.GDPRService) *GDPRHandler { return &GDPRHandler{svc: svc} }

func (h *GDPRHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/gdpr/subjects", h.RegisterSubject)
	mux.HandleFunc("POST /api/v1/gdpr/consent", h.RecordConsent)
	mux.HandleFunc("GET /api/v1/gdpr/consent/{ref}", h.GetConsents)
	mux.HandleFunc("POST /api/v1/gdpr/requests", h.SubmitRequest)
	mux.HandleFunc("GET /api/v1/gdpr/requests", h.ListRequests)
	mux.HandleFunc("POST /api/v1/gdpr/requests/{ref}/process", h.ProcessRequest)
	mux.HandleFunc("POST /api/v1/gdpr/requests/{ref}/reject", h.RejectRequest)
	mux.HandleFunc("GET /api/v1/gdpr/requests/overdue", h.GetOverdue)
	mux.HandleFunc("POST /api/v1/gdpr/processing", h.RegisterProcessing)
	mux.HandleFunc("GET /api/v1/gdpr/processing", h.ListProcessing)
	mux.HandleFunc("POST /api/v1/gdpr/breaches", h.ReportBreach)
	mux.HandleFunc("GET /api/v1/gdpr/breaches", h.ListBreaches)
	mux.HandleFunc("GET /health", h.HealthCheck)
	mux.HandleFunc("GET /ready", h.ReadinessCheck)
}

func (h *GDPRHandler) RegisterSubject(w http.ResponseWriter, r *http.Request) {
	var req service.RegisterSubjectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.RegisterSubject(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *GDPRHandler) RecordConsent(w http.ResponseWriter, r *http.Request) {
	var req service.ConsentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.RecordConsent(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *GDPRHandler) GetConsents(w http.ResponseWriter, r *http.Request) {
	ref := r.PathValue("ref")
	results, err := h.svc.GetConsents(r.Context(), ref)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *GDPRHandler) SubmitRequest(w http.ResponseWriter, r *http.Request) {
	var req service.AccessRequestInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.SubmitAccessRequest(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *GDPRHandler) ListRequests(w http.ResponseWriter, r *http.Request) {
	results, err := h.svc.GetAccessRequests(r.Context(), r.URL.Query().Get("status"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *GDPRHandler) ProcessRequest(w http.ResponseWriter, r *http.Request) {
	ref := r.PathValue("ref")
	var response map[string]interface{}
	_ = json.NewDecoder(r.Body).Decode(&response)
	if err := h.svc.ProcessAccessRequest(r.Context(), ref, response); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "completed"})
}

func (h *GDPRHandler) RejectRequest(w http.ResponseWriter, r *http.Request) {
	ref := r.PathValue("ref")
	var req struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if err := h.svc.RejectAccessRequest(r.Context(), ref, req.Reason); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "rejected"})
}

func (h *GDPRHandler) GetOverdue(w http.ResponseWriter, r *http.Request) {
	results, err := h.svc.GetOverdueRequests(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *GDPRHandler) RegisterProcessing(w http.ResponseWriter, r *http.Request) {
	var req service.ProcessingActivityRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.RegisterProcessingActivity(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *GDPRHandler) ListProcessing(w http.ResponseWriter, r *http.Request) {
	results, err := h.svc.GetProcessingRecords(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *GDPRHandler) ReportBreach(w http.ResponseWriter, r *http.Request) {
	var req service.BreachReportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.ReportBreach(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *GDPRHandler) ListBreaches(w http.ResponseWriter, r *http.Request) {
	results, err := h.svc.GetBreaches(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *GDPRHandler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "healthy", "service": "gdpr-compliance"})
}

func (h *GDPRHandler) ReadinessCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "service": "gdpr-compliance"})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
