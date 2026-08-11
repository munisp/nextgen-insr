package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/insureportal/enterprise_mdm/internal/service"
	"github.com/insureportal/enterprise_mdm/models"
	"go.uber.org/zap"
)

type Handlers struct {
	mdm *service.MDMService
	log *zap.Logger
}

func NewHandlers(svc *service.MDMService) *Handlers {
	return &Handlers{mdm: svc, log: zap.L()}
}

// Health & Readiness
func (h *Handlers) HealthCheck(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "enterprise-mdm",
		"timestamp": time.Now().Format(time.RFC3339),
		"version":   "1.0.0",
	})
}

func (h *Handlers) ReadinessCheck(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ready",
		"service":   "enterprise-mdm",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// --- Golden Records ---
func (h *Handlers) CreateGoldenRecord(w http.ResponseWriter, r *http.Request) {
	var gr models.GoldenRecord
	if err := json.NewDecoder(r.Body).Decode(&gr); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if gr.EntityID == "" || gr.EntityType == "" {
		http.Error(w, `{"error":"entity_id and entity_type are required"}`, http.StatusBadRequest)
		return
	}
	if err := h.mdm.CreateGoldenRecord(r.Context(), &gr); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"record":  gr,
	})
}

func (h *Handlers) GetGoldenRecord(w http.ResponseWriter, r *http.Request) {
	entityID := r.URL.Query().Get("entity_id")
	entityType := models.EntityType(r.URL.Query().Get("entity_type"))
	if entityID == "" || entityType == "" {
		http.Error(w, `{"error":"entity_id and entity_type are required"}`, http.StatusBadRequest)
		return
	}
	gr, err := h.mdm.GetGoldenRecord(r.Context(), entityID, entityType)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(gr)
}

func (h *Handlers) ListGoldenRecords(w http.ResponseWriter, r *http.Request) {
	entityType := models.EntityType(r.URL.Query().Get("entity_type"))
	status := r.URL.Query().Get("status")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit == 0 || limit > 100 { limit = 20 }

	records, err := h.mdm.ListGoldenRecords(r.Context(), entityType, status, limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"records": records,
		"count":   len(records),
	})
}

// --- Record Sources ---
func (h *Handlers) LinkRecordSource(w http.ResponseWriter, r *http.Request) {
	var rs models.RecordSource
	if err := json.NewDecoder(r.Body).Decode(&rs); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if err := h.mdm.LinkRecordSource(r.Context(), &rs); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"source":  rs,
	})
}

func (h *Handlers) GetRecordSources(w http.ResponseWriter, r *http.Request) {
	goldenID := r.URL.Query().Get("golden_record_id")
	if goldenID == "" {
		http.Error(w, `{"error":"golden_record_id is required"}`, http.StatusBadRequest)
		return
	}
	sources, err := h.mdm.GetRecordSources(r.Context(), goldenID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sources": sources,
		"count":   len(sources),
	})
}

// --- Deduplication ---
func (h *Handlers) FindDuplicates(w http.ResponseWriter, r *http.Request) {
	entityType := models.EntityType(r.URL.Query().Get("entity_type"))
	name := r.URL.Query().Get("name")
	email := r.URL.Query().Get("email")
	phone := r.URL.Query().Get("phone")

	if entityType == "" {
		http.Error(w, `{"error":"entity_type is required"}`, http.StatusBadRequest)
		return
	}

	candidates, err := h.mdm.FindDuplicates(r.Context(), entityType, name, email, phone)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"duplicates_found":    len(candidates),
		"merge_candidates":    len(candidates),
		"review_required":     0,
		"matching_algorithm":  "fuzzy_name_email_phone",
		"threshold":           0.85,
		"candidates":          candidates,
	})
}

func (h *Handlers) ApproveMerge(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CandidateID string `json:"candidate_id"`
		ApprovedBy  string `json:"approved_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.CandidateID == "" {
		http.Error(w, `{"error":"candidate_id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.mdm.ApproveMerge(r.Context(), body.CandidateID, body.ApprovedBy); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"candidate_id":   body.CandidateID,
		"message":        "Merge candidate approved for processing",
	})
}

// --- Data Quality ---
func (h *Handlers) AssessQuality(w http.ResponseWriter, r *http.Request) {
	var body struct {
		EntityType models.EntityType `json:"entity_type"`
		EntityID   string            `json:"entity_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.EntityID == "" || body.EntityType == "" {
		http.Error(w, `{"error":"entity_id and entity_type are required"}`, http.StatusBadRequest)
		return
	}
	qm, err := h.mdm.AssessQuality(r.Context(), body.EntityType, body.EntityID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"quality_metric": qm,
		"overall_score":  qm.OverallScore,
		"status":         qm.Status,
		"threshold":      h.mdm.Config().MinQualityScore,
	})
}

func (h *Handlers) CreateDataIssue(w http.ResponseWriter, r *http.Request) {
	var di models.DataIssue
	if err := json.NewDecoder(r.Body).Decode(&di); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if di.EntityID == "" || di.IssueType == "" {
		http.Error(w, `{"error":"entity_id and issue_type are required"}`, http.StatusBadRequest)
		return
	}
	if err := h.mdm.CreateDataIssue(r.Context(), &di); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"issue":   di,
	})
}

func (h *Handlers) GetOpenIssues(w http.ResponseWriter, r *http.Request) {
	entityType := models.EntityType(r.URL.Query().Get("entity_type"))
	severity := r.URL.Query().Get("severity")
	issues, err := h.mdm.GetOpenIssues(r.Context(), entityType, severity)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"issues":  issues,
		"count":   len(issues),
		"open":    len(issues),
		"resolved": 0,
	})
}

func (h *Handlers) ResolveIssue(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IssueID    string `json:"issue_id"`
		ResolvedBy string `json:"resolved_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.IssueID == "" {
		http.Error(w, `{"error":"issue_id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.mdm.ResolveIssue(r.Context(), body.IssueID, body.ResolvedBy); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"issue_id":  body.IssueID,
		"message":   "Issue resolved",
	})
}

// --- Sync ---
func (h *Handlers) StartSync(w http.ResponseWriter, r *http.Request) {
	var sync models.SyncLog
	if err := json.NewDecoder(r.Body).Decode(&sync); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if sync.SourceSystem == "" {
		http.Error(w, `{"error":"source_system is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.mdm.StartSync(r.Context(), &sync); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"sync_id": sync.SyncID,
		"sync":    sync,
	})
}

func (h *Handlers) GetRecentSyncs(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 { limit = v }
	}
	syncs, err := h.mdm.GetRecentSyncs(r.Context(), limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"syncs":   syncs,
		"count":   len(syncs),
	})
}

// --- Dashboard ---
func (h *Handlers) GetDashboard(w http.ResponseWriter, r *http.Request) {
	dash, err := h.mdm.GetDashboard(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(dash)
}

// --- Agent Records ---
func (h *Handlers) CreateAgentRecord(w http.ResponseWriter, r *http.Request) {
	var ar models.AgentRecord
	if err := json.NewDecoder(r.Body).Decode(&ar); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if ar.AgentCode == "" || ar.AgentName == "" {
		http.Error(w, `{"error":"agent_code and agent_name are required"}`, http.StatusBadRequest)
		return
	}
	if err := h.mdm.CreateAgentRecord(r.Context(), &ar); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"agent":   ar,
	})
}

func (h *Handlers) GetAgentRecord(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("agent_code")
	if code == "" {
		http.Error(w, `{"error":"agent_code is required"}`, http.StatusBadRequest)
		return
	}
	ar, err := h.mdm.GetAgentRecord(r.Context(), code)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(ar)
}

func (h *Handlers) ListAgentRecords(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 || limit > 100 { limit = 20 }
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	agents, err := h.mdm.ListAgentRecords(r.Context(), status, limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"agents":  agents,
		"count":   len(agents),
	})
}

// --- Product Records ---
func (h *Handlers) CreateProductRecord(w http.ResponseWriter, r *http.Request) {
	var pr models.ProductRecord
	if err := json.NewDecoder(r.Body).Decode(&pr); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if pr.ProductCode == "" || pr.ProductName == "" {
		http.Error(w, `{"error":"product_code and product_name are required"}`, http.StatusBadRequest)
		return
	}
	if err := h.mdm.CreateProductRecord(r.Context(), &pr); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"product": pr,
	})
}

func (h *Handlers) GetProductRecord(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("product_code")
	if code == "" {
		http.Error(w, `{"error":"product_code is required"}`, http.StatusBadRequest)
		return
	}
	pr, err := h.mdm.GetProductRecord(r.Context(), code)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(pr)
}

func (h *Handlers) ListProductRecords(w http.ResponseWriter, r *http.Request) {
	isActive := r.URL.Query().Get("active") == "true"
	products, err := h.mdm.ListProductRecords(r.Context(), isActive)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"products": products,
		"count":    len(products),
	})
}

// --- Quality Score ---
func (h *Handlers) GetDataQualityScore(w http.ResponseWriter, r *http.Request) {
	entityType := models.EntityType(r.URL.Query().Get("entity_type"))
	entityID := r.URL.Query().Get("entity_id")
	if entityID == "" || entityType == "" {
		http.Error(w, `{"error":"entity_id and entity_type are required"}`, http.StatusBadRequest)
		return
	}
	qm, err := h.mdm.AssessQuality(r.Context(), entityType, entityID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"overall_score": qm.OverallScore,
		"completeness":  qm.Completeness,
		"accuracy":      qm.Accuracy,
		"consistency":   qm.Consistency,
		"timeliness":    qm.Timeliness,
		"uniqueness":    qm.Uniqueness,
		"validity":      qm.Validity,
		"status":        qm.Status,
		"last_assessed": qm.LastAssessedAt.Format(time.RFC3339),
	})
}
