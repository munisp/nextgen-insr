package handlers

import (
	"encoding/json"
	"github.com/munisp/NGApp/feedback-management/internal/service"
	"net/http"

	"github.com/google/uuid"
)

type FeedbackHandler struct{ svc *service.FeedbackService }

func NewFeedbackHandler(svc *service.FeedbackService) *FeedbackHandler {
	return &FeedbackHandler{svc: svc}
}

func (h *FeedbackHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/feedback", h.SubmitFeedback)
	mux.HandleFunc("GET /api/v1/feedback", h.ListFeedback)
	mux.HandleFunc("GET /api/v1/feedback/{id}", h.GetFeedback)
	mux.HandleFunc("POST /api/v1/feedback/{id}/respond", h.Respond)
	mux.HandleFunc("GET /api/v1/feedback/{id}/responses", h.GetResponses)
	mux.HandleFunc("POST /api/v1/feedback/{id}/resolve", h.Resolve)
	mux.HandleFunc("POST /api/v1/feedback/{id}/escalate", h.Escalate)
	mux.HandleFunc("POST /api/v1/surveys", h.CreateSurvey)
	mux.HandleFunc("GET /api/v1/surveys", h.ListSurveys)
	mux.HandleFunc("POST /api/v1/surveys/responses", h.SubmitSurveyResponse)
	mux.HandleFunc("POST /api/v1/feedback/analytics", h.GenerateAnalytics)
	mux.HandleFunc("GET /health", h.HealthCheck)
	mux.HandleFunc("GET /ready", h.ReadinessCheck)
}

func (h *FeedbackHandler) SubmitFeedback(w http.ResponseWriter, r *http.Request) {
	var req service.SubmitFeedbackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.SubmitFeedback(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *FeedbackHandler) ListFeedback(w http.ResponseWriter, r *http.Request) {
	results, err := h.svc.ListFeedback(r.Context(), r.URL.Query().Get("category"), r.URL.Query().Get("status"), r.URL.Query().Get("priority"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *FeedbackHandler) GetFeedback(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid ID")
		return
	}
	result, err := h.svc.GetFeedback(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *FeedbackHandler) Respond(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid ID")
		return
	}
	var req service.RespondRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.RespondToFeedback(r.Context(), id, req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *FeedbackHandler) GetResponses(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid ID")
		return
	}
	results, err := h.svc.GetResponses(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *FeedbackHandler) Resolve(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid ID")
		return
	}
	var req struct {
		Resolution string `json:"resolution"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if err := h.svc.ResolveFeedback(r.Context(), id, req.Resolution); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "resolved"})
}

func (h *FeedbackHandler) Escalate(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid ID")
		return
	}
	var req struct {
		AssignTo string `json:"assign_to"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if err := h.svc.EscalateFeedback(r.Context(), id, req.AssignTo); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "escalated"})
}

func (h *FeedbackHandler) CreateSurvey(w http.ResponseWriter, r *http.Request) {
	var req service.CreateSurveyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.CreateSurvey(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *FeedbackHandler) ListSurveys(w http.ResponseWriter, r *http.Request) {
	results, err := h.svc.GetSurveys(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *FeedbackHandler) SubmitSurveyResponse(w http.ResponseWriter, r *http.Request) {
	var req service.SurveyResponseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.SubmitSurveyResponse(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *FeedbackHandler) GenerateAnalytics(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Period string `json:"period"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	result, err := h.svc.GenerateAnalytics(r.Context(), req.Period)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *FeedbackHandler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "healthy", "service": "feedback-management"})
}

func (h *FeedbackHandler) ReadinessCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "service": "feedback-management"})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
