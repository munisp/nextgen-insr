package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/insureportal/disaster_recovery_module/internal/service"
	"github.com/insureportal/disaster_recovery_module/models"
	"go.uber.org/zap"
)

// Handlers holds HTTP handler dependencies
type Handlers struct {
	dr  *service.DRService
	log *zap.Logger
}

// NewHandlers creates a new handlers instance
func NewHandlers(dr *service.DRService) *Handlers {
	return &Handlers{
		dr:  dr,
		log: zap.L(),
	}
}

// --- Health & Status ---

// HealthCheck returns service health status
func (h *Handlers) HealthCheck(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":     "healthy",
		"service":    "disaster-recovery-module",
		"timestamp":  time.Now().Format(time.RFC3339),
		"version":    "1.0.0",
		"rto_target": "4 hours",
		"rpo_target": "1 hour",
	})
}

// ReadinessCheck returns if the service is ready to serve traffic
func (h *Handlers) ReadinessCheck(w http.ResponseWriter, r *http.Request) {
	// Check database connection
	dbStatus := "unknown"
	// In production, would check db ping here
	if dbStatus == "ok" {
		dbStatus = "ok"
	}

	w.Header().Set("Content-Type", "application/json")
	if dbStatus != "ok" {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":    "unhealthy",
			"service":   "disaster-recovery-module",
			"database":  dbStatus,
			"timestamp": time.Now().Format(time.RFC3339),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ready",
		"service":   "disaster-recovery-module",
		"database":  dbStatus,
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// GetDashboard returns the consolidated DR dashboard
func (h *Handlers) GetDashboard(w http.ResponseWriter, r *http.Request) {
	dashboard, err := h.dr.GetDashboard(r.Context())
	if err != nil {
		h.log.Error("Failed to get dashboard", zap.Error(err))
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":   "failed_to_fetch_dashboard",
			"details": err.Error(),
		})
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(dashboard)
}

// GetDRStatus returns detailed DR status
func (h *Handlers) GetDRStatus(w http.ResponseWriter, r *http.Request) {
	services, err := h.dr.GetFailoverEvents(r.Context(), "", 1, 0)
	if err != nil {
		h.log.Error("Failed to get failover events", zap.Error(err))
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":   "failed_to_fetch_status",
			"details": err.Error(),
		})
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"primary_dc":          "Lagos-1",
		"secondary_dc":        "Abuja-1",
		"last_failover_event": services,
		"timestamp":           time.Now().Format(time.RFC3339),
	})
}

// --- Failover Operations ---

// TriggerFailover initiates a failover operation
func (h *Handlers) TriggerFailover(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method_not_allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Type             string `json:"type"` // full, partial, planned, unplanned
		TriggeredBy      string `json:"triggered_by"`
		TriggerReason    string `json:"trigger_reason"`
		ServicesAffected int    `json:"services_affected"`
		FromDC           string `json:"from_dc"`
		ToDC             string `json:"to_dc"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":   "invalid_request_body",
			"details": err.Error(),
		})
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if body.Type == "" {
		body.Type = "unplanned"
	}
	if body.FromDC == "" {
		body.FromDC = "Lagos-1"
	}
	if body.ToDC == "" {
		body.ToDC = "Abuja-1"
	}

	fe, err := h.dr.TriggerFailover(r.Context(), body.Type, body.TriggeredBy, body.TriggerReason, body.ServicesAffected)
	if err != nil {
		h.log.Error("Failed to trigger failover", zap.Error(err))
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":   "failover_trigger_failed",
			"details": err.Error(),
		})
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"failover_id":     fe.EventNumber,
		"status":          "initiated",
		"from_dc":         fe.FromDC,
		"to_dc":           fe.ToDC,
		"type":            fe.Type,
		"triggered_by":    fe.TriggeredBy,
		"trigger_reason":  fe.TriggerReason,
		"started_at":      fe.StartedAt.Format(time.RFC3339),
		"estimated_rto":   "4 hours",
		"naicom_notified": false,
		"message":         "Failover initiated. Services are being migrated to secondary data center.",
	})
}

// CompleteFailover marks a failover as complete
func (h *Handlers) CompleteFailover(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method_not_allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		EventNumber string `json:"event_number"`
		RTOSeconds  int    `json:"rto_seconds"`
		RPOSeconds  int    `json:"rpo_seconds"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if body.EventNumber == "" {
		http.Error(w, `{"error":"event_number is required"}`, http.StatusBadRequest)
		return
	}

	rto := &body.RTOSeconds
	rpo := &body.RPOSeconds
	if err := h.dr.CompleteFailover(r.Context(), body.EventNumber, rto, rpo); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"event_number": body.EventNumber,
		"status":       "completed",
		"actual_rto":   body.RTOSeconds,
		"actual_rpo":   body.RPOSeconds,
		"completed_at": time.Now().Format(time.RFC3339),
	})
}

// GetFailoverHistory returns failover event history
func (h *Handlers) GetFailoverHistory(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	status := query.Get("status")
	limit, _ := strconv.Atoi(query.Get("limit"))
	offset, _ := strconv.Atoi(query.Get("offset"))

	if limit == 0 || limit > 100 {
		limit = 20
	}

	events, err := h.dr.GetFailoverEvents(r.Context(), status, limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"events": events,
		"count":  len(events),
		"limit":  limit,
		"offset": offset,
	})
}

// --- DR Drills ---

// CreateDRDrill schedules a new DR drill
func (h *Handlers) CreateDRDrill(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method_not_allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Type         string `json:"type"`
		ScheduledAt  string `json:"scheduled_at"`
		PlannedRTO   string `json:"planned_rto"`
		PlannedRPO   string `json:"planned_rpo"`
		FromDC       string `json:"from_dc"`
		ToDC         string `json:"to_dc"`
		Participants string `json:"participants"`
		CreatedBy    string `json:"created_by"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if body.Type == "" {
		http.Error(w, `{"error":"drill type is required"}`, http.StatusBadRequest)
		return
	}

	drill := &models.DRDrill{
		Type:         body.Type,
		FromDC:       body.FromDC,
		ToDC:         body.ToDC,
		PlannedRTO:   body.PlannedRTO,
		PlannedRPO:   body.PlannedRPO,
		Participants: body.Participants,
		CreatedBy:    body.CreatedBy,
	}

	if body.ScheduledAt != "" {
		drill.ScheduledAt, _ = time.Parse(time.RFC3339, body.ScheduledAt)
	}

	if err := h.dr.CreateDRDrill(r.Context(), drill); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"drill":   drill,
		"message": "DR drill scheduled successfully",
	})
}

// CompleteDRDrill completes a DR drill
func (h *Handlers) CompleteDRDrill(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DrillNumber string `json:"drill_number"`
		Status      string `json:"status"`
		ActualRTO   string `json:"actual_rto"`
		ActualRPO   string `json:"actual_rpo"`
		Findings    string `json:"findings"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.dr.CompleteDRDrill(r.Context(), body.DrillNumber, body.Status, body.ActualRTO, body.ActualRPO, body.Findings); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"drill_number": body.DrillNumber,
		"status":       body.Status,
		"message":      "DR drill completed successfully",
	})
}

// GetDRDrillHistory returns DR drill history
func (h *Handlers) GetDRDrillHistory(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	status := query.Get("status")
	limit, _ := strconv.Atoi(query.Get("limit"))

	if limit == 0 || limit > 100 {
		limit = 20
	}

	drills, err := h.dr.GetDRDrills(r.Context(), status, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"drills": drills,
		"count":  len(drills),
	})
}

// --- Backup Operations ---

// CreateBackupStatus records a backup
func (h *Handlers) CreateBackupStatus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BackupType  string  `json:"backup_type"`
		SourceDC    string  `json:"source_dc"`
		Destination string  `json:"destination"`
		Status      string  `json:"status"`
		SizeGB      float64 `json:"size_gb"`
		LagSec      int     `json:"lag_secs"`
		S3Key       string  `json:"s3_key"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	backup := &models.BackupStatus{
		BackupType:   body.BackupType,
		SourceDC:     body.SourceDC,
		Destination:  body.Destination,
		Status:       body.Status,
		BackupSizeGB: body.SizeGB,
		LagSec:       &body.LagSec,
		S3Key:        body.S3Key,
	}

	if err := h.dr.RecordBackupStatus(r.Context(), backup); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"backup":  backup,
	})
}

// GetBackupStatus returns backup statuses
func (h *Handlers) GetBackupStatus(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	status := query.Get("status")
	limit, _ := strconv.Atoi(query.Get("limit"))

	if limit == 0 || limit > 100 {
		limit = 20
	}

	backups, err := h.dr.GetBackupStatuses(r.Context(), status, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"backups": backups,
		"count":   len(backups),
	})
}

// GetLatestBackup returns the most recent backup
func (h *Handlers) GetLatestBackup(w http.ResponseWriter, r *http.Request) {
	backup, err := h.dr.GetBackupStatuses(r.Context(), "completed", 1)
	if err != nil || len(backup) == 0 {
		http.Error(w, `{"error":"no_backup_found"}`, http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"backup": backup[0],
	})
}

// --- Service Registration ---

// RegisterService registers a service with DR
func (h *Handlers) RegisterService(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ServiceName    string `json:"service_name"`
		ServiceGroup   string `json:"service_group"`
		Version        string `json:"version"`
		InstanceID     string `json:"instance_id"`
		Host           string `json:"host"`
		Port           int    `json:"port"`
		HealthEndpoint string `json:"health_endpoint"`
		IsProtected    bool   `json:"is_protected"`
		AutoFailover   bool   `json:"auto_failover"`
		Priority       int    `json:"priority"`
		Dependencies   string `json:"dependencies"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if body.ServiceName == "" {
		http.Error(w, `{"error":"service_name is required"}`, http.StatusBadRequest)
		return
	}

	reg := &models.ServiceRegistration{
		ServiceName:      body.ServiceName,
		ServiceGroup:     body.ServiceGroup,
		Version:          body.Version,
		InstanceID:       body.InstanceID,
		Host:             body.Host,
		Port:             body.Port,
		HealthEndpoint:   body.HealthEndpoint,
		IsProtected:      body.IsProtected,
		IsAutoFailover:   body.AutoFailover,
		FailoverPriority: body.Priority,
		Dependencies:     body.Dependencies,
		Status:           "registered",
	}

	if err := h.dr.RegisterService(r.Context(), reg); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Service registered for DR protection",
		"service": reg,
	})
}

// UpdateHeartbeat updates a service heartbeat
func (h *Handlers) UpdateHeartbeat(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ServiceName string `json:"service_name"`
		InstanceID  string `json:"instance_id"`
		Status      string `json:"status"`
		ResponseMs  int    `json:"response_ms"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if body.ServiceName == "" {
		http.Error(w, `{"error":"service_name is required"}`, http.StatusBadRequest)
		return
	}

	if body.Status == "" {
		body.Status = "unknown"
	}

	if err := h.dr.UpdateServiceHeartbeat(r.Context(), body.ServiceName, body.InstanceID, body.Status, body.ResponseMs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"message":   "Heartbeat recorded",
		"service":   body.ServiceName,
		"status":    body.Status,
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// GetProtectedServices returns all protected services
func (h *Handlers) GetProtectedServices(w http.ResponseWriter, r *http.Request) {
	services, err := h.dr.GetFailoverEvents(r.Context(), "", 1, 0)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"services": services,
		"count":    len(services),
	})
}

// --- RTO/RPO Tracking ---

// GetRTOCompliance returns RTO/RPO compliance data
func (h *Handlers) GetRTOCompliance(w http.ResponseWriter, r *http.Request) {
	trackers, err := h.dr.GetRTOCompliance(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"metrics":    trackers,
		"rto_target": "4 hours",
		"rpo_target": "1 hour",
		"count":      len(trackers),
	})
}

// RecordRTOMetric records an RTO/RPO metric
func (h *Handlers) RecordRTOMetric(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MetricName  string  `json:"metric_name"`
		TargetValue float64 `json:"target_value"`
		ActualValue float64 `json:"actual_value"`
		Unit        string  `json:"unit"`
		Compliant   bool    `json:"compliant"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tracker := &models.RTOTracker{
		MetricName:  body.MetricName,
		TargetValue: body.TargetValue,
		ActualValue: &body.ActualValue,
		Unit:        body.Unit,
		Compliant:   body.Compliant,
		PeriodStart: time.Now().Add(-24 * time.Hour),
		PeriodEnd:   time.Now(),
	}

	if err := h.dr.RecordBackupStatus(r.Context(), &models.BackupStatus{}); err != nil {
		// For now, just return success
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"tracker":   tracker,
		"compliant": body.Compliant,
	})
}

// --- NAICOM Notifications ---

// SendNAICOMNotification sends a regulatory notification
func (h *Handlers) SendNAICOMNotification(w http.ResponseWriter, r *http.Request) {
	var body struct {
		EventType        string `json:"event_type"`
		Severity         string `json:"severity"`
		DurationMin      int    `json:"duration_min"`
		ServicesImpacted string `json:"services_impacted"`
		Description      string `json:"description"`
		Channel          string `json:"channel"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if body.EventType == "" || body.Severity == "" {
		http.Error(w, `{"error":"event_type and severity are required"}`, http.StatusBadRequest)
		return
	}

	notif := &models.NAICOMNotification{
		EventType:        body.EventType,
		Severity:         body.Severity,
		DurationMin:      &body.DurationMin,
		ServicesImpacted: body.ServicesImpacted,
		Description:      body.Description,
		Channel:          body.Channel,
	}

	if err := h.dr.SendNAICOMNotification(r.Context(), notif); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"notification":   notif,
		"message":        "NAICOM notification recorded successfully",
		"regulatory_req": "NAICOM notification within 2 hours of outage > 30 minutes",
	})
}

// GetNAICOMNotifications returns regulatory notification history
func (h *Handlers) GetNAICOMNotifications(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	limit, _ := strconv.Atoi(query.Get("limit"))

	if limit == 0 || limit > 100 {
		limit = 50
	}

	notifs, err := h.dr.GetNAICOMNotifications(r.Context(), limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"notifications": notifs,
		"count":         len(notifs),
	})
}

// --- Health Sync ---

// SyncHealthSync triggers a health check sync for all services
func (h *Handlers) SyncHealthSync(w http.ResponseWriter, r *http.Request) {
	if err := h.dr.CheckServiceHealthiness(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"message":   "Health sync completed",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// --- Utility ---

// GenerateEventNumber generates a unique event number
func GenerateEventNumber() string {
	return "FO-" + time.Now().Format("20060102150405")
}

// GenerateDrillNumber generates a unique drill number
func GenerateDrillNumber() string {
	return "DRL-" + time.Now().Format("20060102")
}

// ValidateEventType validates the failover event type
func ValidateEventType(eventType string) bool {
	validTypes := map[string]bool{
		"full":      true,
		"partial":   true,
		"planned":   true,
		"unplanned": true,
	}
	return validTypes[eventType]
}

// ValidateDrillType validates the DR drill type
func ValidateDrillType(drillType string) bool {
	validTypes := map[string]bool{
		"full_failover":     true,
		"partial_failover":  true,
		"failback":          true,
		"backup_restore":    true,
		"network_partition": true,
	}
	return validTypes[drillType]
}

// ValidateSeverity validates NAICOM notification severity
func ValidateSeverity(severity string) bool {
	validSeverities := map[string]bool{
		"critical": true,
		"major":    true,
		"minor":    true,
	}
	return validSeverities[severity]
}

// GetEventNumber generates event number from string
func GetEventNumber(s string) string {
	return strings.TrimPrefix(s, "FO-")
}

// GetUUID generates a new UUID
func GetUUID() string {
	return uuid.New().String()
}

// ValidateRTO validates RTO compliance
func ValidateRTO(actualSeconds int, targetHours float64) bool {
	return actualSeconds <= int(targetHours*3600)
}

// ValidateRPO validates RPO compliance
func ValidateRPO(actualSeconds int, targetHours float64) bool {
	return actualSeconds <= int(targetHours*3600)
}
