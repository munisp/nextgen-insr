package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

// Multi-Channel Notification Orchestration Service
// Port: 8105
// Channels: push, whatsapp, sms, email (priority-based routing)
//
// HONEST DELIVERY CONTRACT: no notification provider is integrated in-tree.
// A channel is reported "sent" ONLY after a configured provider HTTP leg
// (PUSH_PROVIDER_URL / WHATSAPP_PROVIDER_URL / SMS_PROVIDER_URL /
// EMAIL_PROVIDER_URL) completes with a 2xx response carrying a provider
// message id. Unconfigured channels report "unavailable", failed provider
// calls report "failed", and if no channel can deliver, the send endpoint
// fails loudly (503) instead of claiming delivery.

type Config struct {
	Port                string
	PushProviderURL     string
	WhatsAppProviderURL string
	SMSProviderURL      string
	EmailProviderURL    string
}

type NotificationRequest struct {
	UserID      string                 `json:"user_id"`
	Type        string                 `json:"type"`     // claim_update, payment_confirm, policy_renewal, kyc_status
	Priority    string                 `json:"priority"` // critical, high, medium, low
	Title       string                 `json:"title"`
	Body        string                 `json:"body"`
	Data        map[string]interface{} `json:"data"`
	Channels    []string               `json:"channels,omitempty"` // Override default routing
	Language    string                 `json:"language"`           // en, ha, yo, ig
	ScheduledAt string                 `json:"scheduled_at,omitempty"`
}

type DeliveryStatus struct {
	NotificationID    string `json:"notification_id"`
	Channel           string `json:"channel"`
	Status            string `json:"status"` // sent, accepted, failed, unavailable — never "sent" without a completed provider leg
	ProviderMessageID string `json:"provider_message_id,omitempty"`
	Error             string `json:"error,omitempty"`
	SentAt            string `json:"sent_at,omitempty"`
}

type ChannelRouter struct {
	priorities map[string][]string
}

func NewChannelRouter() *ChannelRouter {
	return &ChannelRouter{
		priorities: map[string][]string{
			"critical": {"push", "whatsapp", "sms", "email"},
			"high":     {"push", "whatsapp", "email"},
			"medium":   {"push", "email"},
			"low":      {"email"},
		},
	}
}

func (r *ChannelRouter) Route(priority string, userPrefs []string) []string {
	if len(userPrefs) > 0 {
		return userPrefs
	}
	channels, ok := r.priorities[priority]
	if !ok {
		return []string{"email"}
	}
	return channels
}

func (c *Config) providerURL(channel string) string {
	switch channel {
	case "push":
		return c.PushProviderURL
	case "whatsapp":
		return c.WhatsAppProviderURL
	case "sms":
		return c.SMSProviderURL
	case "email":
		return c.EmailProviderURL
	default:
		return ""
	}
}

// deliver performs the real provider leg. It returns the provider-issued
// message id on success, or an honest error. It never fabricates a result.
func deliver(providerURL, channel string, req NotificationRequest) (messageID string, accepted bool, err error) {
	if providerURL == "" {
		return "", false, fmt.Errorf("no provider configured for channel %q", channel)
	}
	payload, err := json.Marshal(map[string]interface{}{
		"channel":  channel,
		"user_id":  req.UserID,
		"type":     req.Type,
		"priority": req.Priority,
		"title":    req.Title,
		"body":     req.Body,
		"data":     req.Data,
		"language": req.Language,
	})
	if err != nil {
		return "", false, fmt.Errorf("encode notification: %w", err)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(providerURL, "application/json", bytes.NewReader(payload))
	if err != nil {
		return "", false, fmt.Errorf("provider call failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", false, fmt.Errorf("provider returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	// Extract the provider-issued message id; without one we cannot honestly
	// claim "sent", so we report the leg as "accepted" instead.
	var parsed map[string]interface{}
	if err := json.Unmarshal(respBody, &parsed); err == nil {
		for _, key := range []string{"message_id", "messageId", "id", "reference"} {
			if v, ok := parsed[key].(string); ok && v != "" {
				return v, true, nil
			}
		}
	}
	return "", true, nil
}

func main() {
	cfg := Config{
		Port:                envOr("PORT", "8105"),
		PushProviderURL:     envOr("PUSH_PROVIDER_URL", ""),
		WhatsAppProviderURL: envOr("WHATSAPP_PROVIDER_URL", ""),
		SMSProviderURL:      envOr("SMS_PROVIDER_URL", ""),
		EmailProviderURL:    envOr("EMAIL_PROVIDER_URL", ""),
	}
	router := NewChannelRouter()

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":    "healthy",
			"service":   "notification-orchestrator",
			"channels":  []string{"push", "whatsapp", "sms", "email"},
			"languages": []string{"en", "ha", "yo", "ig"},
			"providers_configured": map[string]bool{
				"push":     cfg.PushProviderURL != "",
				"whatsapp": cfg.WhatsAppProviderURL != "",
				"sms":      cfg.SMSProviderURL != "",
				"email":    cfg.EmailProviderURL != "",
			},
		})
	})

	mux.HandleFunc("/api/v1/notifications/send", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		var req NotificationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
			return
		}
		channels := router.Route(req.Priority, req.Channels)
		statuses := make([]DeliveryStatus, 0, len(channels))
		delivered := 0
		attempted := 0
		for _, ch := range channels {
			st := DeliveryStatus{
				NotificationID: req.UserID + "-" + req.Type,
				Channel:        ch,
			}
			messageID, accepted, err := deliver(cfg.providerURL(ch), ch, req)
			switch {
			case err != nil && cfg.providerURL(ch) == "":
				st.Status = "unavailable"
				st.Error = err.Error()
			case err != nil:
				attempted++
				st.Status = "failed"
				st.Error = err.Error()
			case messageID != "":
				attempted++
				delivered++
				st.Status = "sent"
				st.ProviderMessageID = messageID
				st.SentAt = time.Now().UTC().Format(time.RFC3339)
			case accepted:
				attempted++
				delivered++
				st.Status = "accepted" // provider acknowledged but returned no message id — not claimed as "sent"
				st.SentAt = time.Now().UTC().Format(time.RFC3339)
			}
			statuses = append(statuses, st)
		}

		w.Header().Set("Content-Type", "application/json")
		switch {
		case attempted == 0:
			// Fail-loud: no provider is configured for any routed channel.
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success":  false,
				"error":    "notification delivery unavailable: no provider configured for any routed channel (set PUSH_PROVIDER_URL / WHATSAPP_PROVIDER_URL / SMS_PROVIDER_URL / EMAIL_PROVIDER_URL)",
				"channels": channels,
				"statuses": statuses,
			})
		case delivered == 0:
			// Fail-loud: every configured provider leg failed.
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success":  false,
				"error":    "notification delivery failed on all configured providers",
				"channels": channels,
				"statuses": statuses,
			})
		default:
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success":  true,
				"channels": channels,
				"statuses": statuses,
			})
		}
	})

	mux.HandleFunc("/api/v1/notifications/preferences", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusNotImplemented)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": "preference mutation is not implemented: this service has no preference store",
			})
			return
		}
		// Honest read: these are non-persisted service defaults, not user data.
		json.NewEncoder(w).Encode(map[string]interface{}{
			"source":      "service_defaults",
			"persisted":   false,
			"quiet_hours": map[string]string{"start": "22:00", "end": "07:00"},
			"channels":    []string{"push", "whatsapp", "email"},
			"digest_mode": "daily",
			"language":    "en",
		})
	})

	log.Printf("Notification Orchestrator starting on port %s (providers configured: push=%t whatsapp=%t sms=%t email=%t)",
		cfg.Port, cfg.PushProviderURL != "", cfg.WhatsAppProviderURL != "", cfg.SMSProviderURL != "", cfg.EmailProviderURL != "")
	log.Fatal(http.ListenAndServe(":"+cfg.Port, mux))
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
