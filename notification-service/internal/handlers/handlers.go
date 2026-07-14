package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/insureportal/notification_service/internal/service"
	"github.com/insureportal/notification_service/models"
	"go.uber.org/zap"
)

type Handlers struct {
	notif *service.NotificationService
	log   *zap.Logger
}

func NewHandlers(svc *service.NotificationService) *Handlers {
	return &Handlers{notif: svc, log: zap.L()}
}

// Health
func (h *Handlers) HealthCheck(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "notification-service",
		"timestamp": time.Now().Format(time.RFC3339),
		"channels":  map[string]bool{"sms": true, "email": true, "push": true, "whatsapp": true, "ussd": true},
	})
}

func (h *Handlers) ReadinessCheck(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ready",
		"service":   "notification-service",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// --- Send Notification ---
func (h *Handlers) SendNotification(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Channel      string                 `json:"channel"`
		To           string                 `json:"to"`
		From         string                 `json:"from"`
		TemplateName string                 `json:"template_name"`
		TemplateData map[string]interface{} `json:"template_data"`
		Message      string                 `json:"message"`
		Subject      string                 `json:"subject"`
		Priority     int                    `json:"priority"`
		CustomerID   string                 `json:"customer_id"`
		CallbackURL  string                 `json:"callback_url"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}

	if body.To == "" {
		http.Error(w, `{"error":"to (recipient) is required"}`, http.StatusBadRequest)
		return
	}

	n := &models.Notification{
		Channel:      models.NotificationChannel(body.Channel),
		To:           body.To,
		From:         body.From,
		TemplateName: body.TemplateName,
		Message:      body.Message,
		Subject:      body.Subject,
		Priority:     models.NotificationPriority(body.Priority),
		CustomerID:   body.CustomerID,
		CallbackURL:  body.CallbackURL,
	}

	if n.Priority == 0 {
		n.Priority = models.Prio3Normal
	}

	if body.TemplateData != nil {
		dataJSON, _ := json.Marshal(body.TemplateData)
		n.TemplateData = string(dataJSON)
	}

	if err := h.notif.SendNotification(r.Context(), n); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"notification_id": n.NotificationID,
		"channel":         string(n.Channel),
		"to":              n.To,
		"status":          "queued",
		"priority":        int(n.Priority),
		"message":         "Notification queued for delivery",
		"retry_policy":    map[string]interface{}{
			"max_attempts": 3,
			"backoff":      "exponential",
		},
		"estimated_delivery": "< 30 seconds",
		"naicom_approved":   n.TemplateName != "",
	})
}

// --- Templates ---
func (h *Handlers) ListTemplates(w http.ResponseWriter, r *http.Request) {
	isActive := r.URL.Query().Get("active") == "true"
	templates, err := h.notif.ListTemplates(r.Context(), isActive)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"templates": templates,
		"count":     len(templates),
	})
}

func (h *Handlers) GetTemplate(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, `{"error":"template code is required"}`, http.StatusBadRequest)
		return
	}
	t, err := h.notif.GetTemplate(r.Context(), code)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(t)
}

func (h *Handlers) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	var t models.NotificationTemplate
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if err := h.notif.CreateTemplate(r.Context(), &t); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"template": t,
	})
}

// --- Delivery Stats ---
func (h *Handlers) GetDeliveryStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.notif.GetDeliveryStats(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"stats":      stats,
		"channels":   []string{"sms", "email", "push", "whatsapp", "ussd"},
		"period":     "last_24_hours",
		"summary": map[string]interface{}{
			"total_sent":    len(stats),
			"channels_active": 4,
		},
	})
}

func (h *Handlers) GetDeliveryStatsDaily(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("date")
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	stats, err := h.notif.GetDeliveryStatsDaily(r.Context(), date)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"date":  date,
		"stats": stats,
	})
}

func (h *Handlers) GetDashboard(w http.ResponseWriter, r *http.Request) {
	dash, err := h.notif.GetDashboard(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(dash)
}

// --- Delivery Attempts ---
func (h *Handlers) GetDeliveryAttempts(w http.ResponseWriter, r *http.Request) {
	notifID := r.URL.Query().Get("notification_id")
	if notifID == "" {
		http.Error(w, `{"error":"notification_id is required"}`, http.StatusBadRequest)
		return
	}
	attempts, err := h.notif.GetDeliveryAttempts(r.Context(), notifID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"notification_id": notifID,
		"attempts":        attempts,
		"count":           len(attempts),
	})
}

func (h *Handlers) RetryNotification(w http.ResponseWriter, r *http.Request) {
	var body struct {
		NotificationID string `json:"notification_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.NotificationID == "" {
		http.Error(w, `{"error":"notification_id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.notif.RetryNotification(r.Context(), body.NotificationID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"notification_id": body.NotificationID,
		"message":         "Notification queued for retry with exponential backoff",
		"retry_policy":    map[string]interface{}{"max_attempts": 3, "backoff": "1min, 5min, 30min"},
	})
}

// --- Customer Preferences ---
func (h *Handlers) GetCustomerPreference(w http.ResponseWriter, r *http.Request) {
	customerID := r.URL.Query().Get("customer_id")
	if customerID == "" {
		http.Error(w, `{"error":"customer_id is required"}`, http.StatusBadRequest)
		return
	}
	pref, err := h.notif.GetCustomerPreference(r.Context(), customerID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(pref)
}

func (h *Handlers) UpdateCustomerPreference(w http.ResponseWriter, r *http.Request) {
	var pref models.CustomerPreference
	if err := json.NewDecoder(r.Body).Decode(&pref); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if pref.CustomerID == "" {
		http.Error(w, `{"error":"customer_id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.notif.UpdateCustomerPreference(r.Context(), &pref); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"customer_id": pref.CustomerID,
		"preference":  pref,
	})
}

// --- Notification History ---
func (h *Handlers) GetNotificationsByCustomer(w http.ResponseWriter, r *http.Request) {
	customerID := r.URL.Query().Get("customer_id")
	if customerID == "" {
		http.Error(w, `{"error":"customer_id is required"}`, http.StatusBadRequest)
		return
	}
	status := r.URL.Query().Get("status")
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 100 {
			limit = v
		}
	}
	notifs, err := h.notif.GetNotificationsByCustomer(r.Context(), customerID, status, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"customer_id": customerID,
		"notifications": notifs,
		"count":       len(notifs),
		"limit":       limit,
	})
}

// --- Channel Status ---
func (h *Handlers) GetChannelStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sms":       map[string]interface{}{"enabled": true, "provider": "Termii", "rate_limit": 5, "unit": "per_day"},
		"email":     map[string]interface{}{"enabled": true, "provider": "SendGrid", "rate_limit": 1000, "unit": "per_hour"},
		"push":      map[string]interface{}{"enabled": true, "provider": "FCM", "rate_limit": 3, "unit": "per_hour"},
		"whatsapp":  map[string]interface{}{"enabled": true, "provider": "WhatsApp Business API", "rate_limit": 0, "unit": "unlimited"},
		"ussd":      map[string]interface{}{"enabled": true, "provider": "USSD Gateway", "rate_limit": 0, "unit": "unlimited"},
		"quiet_hours": map[string]string{
			"start": "22:00", "end": "07:00",
			"note": "Non-critical notifications suppressed during quiet hours",
		},
	})
}
