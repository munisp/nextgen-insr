package handlers

import (
	"customer-360-service/internal/models"
	"customer-360-service/internal/service"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
)

type Customer360Handler struct {
	svc *service.Customer360Service
}

func NewCustomer360Handler(svc *service.Customer360Service) *Customer360Handler {
	return &Customer360Handler{svc: svc}
}

func (h *Customer360Handler) RegisterRoutes(r *mux.Router) {
	api := r.PathPrefix("/api/v1/customer-360").Subrouter()
	api.HandleFunc("/customers/{id}/view", h.GetCustomer360View).Methods("GET")
	api.HandleFunc("/customers/{id}/analytics", h.GetCustomerAnalytics).Methods("GET")
	api.HandleFunc("/customers/{id}/interactions", h.CreateInteraction).Methods("POST")
	api.HandleFunc("/customers/{id}/journey-events", h.TrackJourneyEvent).Methods("POST")
	api.HandleFunc("/customers/{id}/segment", h.UpdateCustomerSegment).Methods("PUT")
	api.HandleFunc("/customers/search", h.SearchCustomers).Methods("GET")
}

func (h *Customer360Handler) GetCustomer360View(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	customerID := vars["id"]
	token := r.Header.Get("Authorization")
	if len(token) > 7 && token[:7] == "Bearer " {
		token = token[7:]
	}

	view, err := h.svc.GetCustomer360View(r.Context(), customerID, token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (h *Customer360Handler) GetCustomerAnalytics(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	customerID := vars["id"]

	analytics, err := h.svc.GetCustomerAnalytics(r.Context(), customerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, analytics)
}

func (h *Customer360Handler) CreateInteraction(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	customerID := vars["id"]

	var interaction models.CustomerInteraction
	if err := json.NewDecoder(r.Body).Decode(&interaction); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := h.svc.CreateInteraction(r.Context(), customerID, &interaction); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, interaction)
}

func (h *Customer360Handler) TrackJourneyEvent(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	customerID := vars["id"]

	var event models.JourneyEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := h.svc.TrackJourneyEvent(r.Context(), customerID, &event); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "tracked", "event_id": event.ID})
}

func (h *Customer360Handler) UpdateCustomerSegment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	customerID := vars["id"]

	if err := h.svc.UpdateCustomerSegment(r.Context(), customerID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *Customer360Handler) SearchCustomers(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	customers, total, err := h.svc.SearchCustomers(r.Context(), query, nil, page, pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"customers": customers,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]interface{}{
		"error": map[string]interface{}{
			"code":    status,
			"message": message,
		},
	})
}
