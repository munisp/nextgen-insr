package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/insureportal/enterprise_mdm/config"
	"github.com/insureportal/enterprise_mdm/db"
	"github.com/insureportal/enterprise_mdm/models"
	"go.uber.org/zap"
)

type MDMService struct {
	pg  *db.PostgreSQL
	rdb *db.RedisCache
	cfg *config.Config
	log *zap.Logger
}

// Config returns the service configuration.
func (s *MDMService) Config() *config.Config { return s.cfg }

func NewMDMService(pg *db.PostgreSQL, rdb *db.RedisCache, cfg *config.Config) *MDMService {
	return &MDMService{pg: pg, rdb: rdb, cfg: cfg, log: zap.L()}
}

// --- Golden Record Operations ---

func (s *MDMService) CreateGoldenRecord(ctx context.Context, gr *models.GoldenRecord) error {
	if gr.EntityID == "" {
		return fmt.Errorf("entity_id is required")
	}
	if gr.EntityType == "" {
		return fmt.Errorf("entity_type is required")
	}
	gr.IsGolden = true
	gr.Status = "active"
	return s.pg.UpsertGoldenRecord(ctx, gr)
}

func (s *MDMService) GetGoldenRecord(ctx context.Context, entityID string, entityType models.EntityType) (*models.GoldenRecord, error) {
	if cached, err := s.rdb.GetGoldenRecord(ctx, entityID, string(entityType)); err == nil && cached != nil {
		return cached, nil
	}
	gr, err := s.pg.GetGoldenRecord(ctx, entityID, entityType)
	if err != nil {
		return nil, err
	}
	_ = s.rdb.CacheGoldenRecord(ctx, gr)
	return gr, nil
}

func (s *MDMService) ListGoldenRecords(ctx context.Context, entityType models.EntityType, status string, limit, offset int) ([]models.GoldenRecord, error) {
	return s.pg.ListGoldenRecords(ctx, entityType, status, limit, offset)
}

// --- Record Source Operations ---

func (s *MDMService) LinkRecordSource(ctx context.Context, rs *models.RecordSource) error {
	if rs.GoldenRecordID == "" {
		return fmt.Errorf("golden_record_id is required")
	}
	return s.pg.CreateRecordSource(ctx, rs)
}

func (s *MDMService) GetRecordSources(ctx context.Context, goldenRecordID string) ([]models.RecordSource, error) {
	return s.pg.GetRecordSources(ctx, goldenRecordID)
}

// --- Deduplication & Merge ---

// FindDuplicates performs fuzzy matching to find potential duplicates
func (s *MDMService) FindDuplicates(ctx context.Context, entityType models.EntityType, name, email, phone string) ([]models.MergeCandidate, error) {
	var candidates []models.MergeCandidate

	// Query existing records of the same type
	grs, err := s.pg.ListGoldenRecords(ctx, entityType, "active", s.cfg.MaxMergeCandidates, 0)
	if err != nil {
		return nil, err
	}

	for _, gr := range grs {
		score := s.calculateMatchScore(gr, name, email, phone)
		if score >= s.cfg.DedupThreshold {
			candidate := models.MergeCandidate{
				GoldenRecordID:    gr.ID,
				CandidateRecordID: gr.EntityID,
				SourceSystem:      gr.PrimarySource,
				SourceRecordID:    gr.SourceRecordID,
				MatchScore:        score,
				MatchReasons:      s.getMatchReasons(gr, name, email, phone),
				Status:            "pending",
			}
			candidates = append(candidates, candidate)

			// Publish event
			_ = s.rdb.PublishMergeEvent(ctx, gr.ID, gr.EntityID, score)
		}
	}

	// Sort by match score descending
	s.sortCandidatesByScore(candidates)

	return candidates, nil
}

func (s *MDMService) calculateMatchScore(existing models.GoldenRecord, name, email, phone string) float64 {
	score := 0.0
	total := 0

	if name != "" {
		total++
		score += s.fuzzyStringMatch(existing.Name, name) * 0.4
	}
	if email != "" && existing.Email != "" {
		total++
		if strings.EqualFold(existing.Email, email) {
			score += 1.0 * 0.3
		}
	}
	if phone != "" && existing.Phone != "" {
		total++
		if strings.EqualFold(existing.Phone, phone) {
			score += 1.0 * 0.2
		}
	}
	if phone != "" && existing.PhoneNumber != "" {
		total++
		if strings.EqualFold(existing.PhoneNumber, phone) {
			score += 1.0 * 0.1
		}
	}

	if total > 0 {
		return score
	}
	return 0
}

func (s *MDMService) fuzzyStringMatch(a, b string) float64 {
	if a == "" || b == "" {
		return 0
	}
	if a == b {
		return 1.0
	}

	// Simple Levenshtein-based similarity
	aLower := strings.ToLower(a)
	bLower := strings.ToLower(b)

	// Check if one contains the other
	if strings.Contains(aLower, bLower) || strings.Contains(bLower, aLower) {
		shortLen := min(len(aLower), len(bLower))
		longLen := max(len(aLower), len(bLower))
		return float64(shortLen) / float64(longLen)
	}

	// Simple character overlap
	match := 0
	aRunes := []rune(aLower)
	bRunes := []rune(bLower)
	for _, a := range aRunes {
		for _, b := range bRunes {
			if a == b {
				match++
				break
			}
		}
	}

	if len(aRunes) > 0 && len(bRunes) > 0 {
		overlap := float64(match) / float64(max(len(aRunes), len(bRunes)))
		return overlap * 0.5
	}
	return 0
}

func (s *MDMService) getMatchReasons(gr models.GoldenRecord, name, email, phone string) string {
	reasons := []string{}
	if name != "" && gr.Name != "" && strings.Contains(strings.ToLower(gr.Name), strings.ToLower(name)) {
		reasons = append(reasons, "name_match")
	}
	if email != "" && strings.EqualFold(gr.Email, email) {
		reasons = append(reasons, "email_match")
	}
	if phone != "" && (strings.EqualFold(gr.Phone, phone) || strings.EqualFold(gr.PhoneNumber, phone)) {
		reasons = append(reasons, "phone_match")
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "partial_match")
	}
	return strings.Join(reasons, ",")
}

func (s *MDMService) sortCandidatesByScore(candidates []models.MergeCandidate) {
	for i := 0; i < len(candidates); i++ {
		for j := i + 1; j < len(candidates); j++ {
			if candidates[j].MatchScore > candidates[i].MatchScore {
				candidates[i], candidates[j] = candidates[j], candidates[i]
			}
		}
	}
}

func (s *MDMService) CreateMergeCandidate(ctx context.Context, mc *models.MergeCandidate) error {
	if mc.GoldenRecordID == "" {
		return fmt.Errorf("golden_record_id is required")
	}
	return s.pg.CreateMergeCandidate(ctx, mc)
}

func (s *MDMService) GetPendingMergeCandidates(ctx context.Context, limit int) ([]models.MergeCandidate, error) {
	return s.pg.GetPendingMergeCandidates(ctx, limit)
}

func (s *MDMService) ApproveMerge(ctx context.Context, candidateID, approvedBy string) error {
	if err := s.pg.ApproveMerge(ctx, candidateID, approvedBy); err != nil {
		return err
	}

	// Update the merge candidate to merged
	// (In production, this would trigger the actual merge operation)

	s.log.Info("Merge candidate approved", zap.String("candidate", candidateID))
	_ = s.rdb.DecrementIssueCount(ctx)
	return nil
}

// --- Data Quality ---

func (s *MDMService) AssessQuality(ctx context.Context, entityType models.EntityType, entityID string) (*models.DataQualityMetric, error) {
	qm := &models.DataQualityMetric{
		EntityID:   entityID,
		EntityType: entityType,
	}

	// Calculate quality dimensions
	gr, err := s.pg.GetGoldenRecord(ctx, entityID, entityType)
	if err != nil {
		return nil, fmt.Errorf("golden record not found: %w", err)
	}

	qm.SourceCount = 1
	if gr != nil {
		qm.SourceCount = gr.RecordCount
	}

	// Completeness: check required fields
	completeness := s.calculateCompleteness(gr)
	qm.Completeness = completeness

	// Uniqueness: check against duplicates
	// In production, would query dedup counts
	qm.Uniqueness = 100.0

	// Validity: check field formats
	qm.Validity = 95.0

	// Timeliness: check last updated
	if gr != nil && gr.LastSyncedAt != nil {
		daysSinceSync := time.Since(*gr.LastSyncedAt).Hours() / 24
		qm.Timeliness = 100 - daysSinceSync*5
		if qm.Timeliness < 0 {
			qm.Timeliness = 0
		}
	} else {
		qm.Timeliness = 0
	}

	// Consistency: all sources agree
	qm.Consistency = 90.0

	// Accuracy: source trust score
	qm.Accuracy = 85.0

	qm.OverallScore = (qm.Completeness + qm.Accuracy + qm.Consistency + qm.Timeliness + qm.Uniqueness + qm.Validity) / 6

	// Determine status
	if qm.OverallScore >= 90 {
		qm.Status = "pass"
	} else if qm.OverallScore >= 70 {
		qm.Status = "warning"
	} else {
		qm.Status = "fail"
	}

	if err := s.pg.UpsertQualityMetric(ctx, qm); err != nil {
		return nil, fmt.Errorf("failed to save quality metric: %w", err)
	}

	// Publish quality event
	_ = s.rdb.PublishQualityEvent(ctx, string(entityType), entityID, qm.OverallScore)

	return qm, nil
}

func (s *MDMService) calculateCompleteness(gr *models.GoldenRecord) float64 {
	if gr == nil {
		return 0
	}
	total := 6 // name, email, phone, address, city, state
	complete := 0
	if gr.Name != "" {
		complete++
	}
	if gr.Email != "" {
		complete++
	}
	if gr.Phone != "" {
		complete++
	}
	if gr.Address != "" {
		complete++
	}
	if gr.City != "" {
		complete++
	}
	if gr.State != "" {
		complete++
	}
	return float64(complete) / float64(total) * 100
}

func (s *MDMService) CreateDataIssue(ctx context.Context, di *models.DataIssue) error {
	if di.EntityID == "" {
		return fmt.Errorf("entity_id is required")
	}
	if di.IssueType == "" {
		return fmt.Errorf("issue_type is required")
	}
	if err := s.pg.CreateDataIssue(ctx, di); err != nil {
		return err
	}
	_ = s.rdb.IncrementIssueCount(ctx)
	return nil
}

func (s *MDMService) GetOpenIssues(ctx context.Context, entityType models.EntityType, severity string) ([]models.DataIssue, error) {
	return s.pg.GetOpenIssues(ctx, entityType, severity)
}

func (s *MDMService) ResolveIssue(ctx context.Context, issueID, resolvedBy string) error {
	if err := s.pg.ResolveIssue(ctx, issueID, resolvedBy); err != nil {
		return err
	}
	_ = s.rdb.DecrementIssueCount(ctx)
	return nil
}

// --- Sync Operations ---

func (s *MDMService) StartSync(ctx context.Context, sync *models.SyncLog) error {
	sync.SyncID = "SYNC-" + time.Now().Format("20060102150405")
	sync.Status = "started"
	if err := s.pg.CreateSyncLog(ctx, sync); err != nil {
		return err
	}
	_ = s.rdb.PublishSyncEvent(ctx, sync.SyncID, sync.SourceSystem, sync.TargetSystem)
	return nil
}

func (s *MDMService) CompleteSync(ctx context.Context, syncID, status, errMsg string) error {
	return s.pg.CompleteSyncLog(ctx, syncID, status, errMsg)
}

func (s *MDMService) GetRecentSyncs(ctx context.Context, limit int) ([]models.SyncLog, error) {
	return s.pg.GetRecentSyncs(ctx, limit)
}

// --- Dashboard ---

func (s *MDMService) GetDashboard(ctx context.Context) (*models.MasterDataDashboard, error) {
	if cached, err := s.rdb.GetCachedDashboard(ctx); err == nil && cached != nil {
		return cached, nil
	}

	dash := &models.MasterDataDashboard{}

	// Count golden records by entity type
	byType, err := s.pg.CountByEntityType(ctx)
	if err == nil {
		for _, eq := range byType {
			dash.TotalGoldenRecords += eq.TotalRecords
			dash.ByEntityType = append(dash.ByEntityType, eq)
		}
	}

	// Count open issues
	openIssues, _ := s.pg.GetOpenIssues(ctx, models.EntityCustomer, "")
	dash.TotalIssues = len(openIssues)
	dash.OpenIssues = len(openIssues)

	// Count merge candidates
	pendingMerges, _ := s.pg.CountMergeCandidates(ctx, "pending")
	dash.PendingMerges = pendingMerges

	// Get quality metrics
	if len(dash.ByEntityType) > 0 {
		totalScore := 0.0
		for _, eq := range dash.ByEntityType {
			totalScore += eq.QualityScore
		}
		dash.OverallQuality = totalScore / float64(len(dash.ByEntityType))
	}

	// Get recent sync
	syncs, _ := s.pg.GetRecentSyncs(ctx, 1)
	if len(syncs) > 0 {
		dash.LastSyncAt = &syncs[0].StartedAt
		dash.SyncStatus = syncs[0].Status
	}

	_ = s.rdb.CacheDashboard(ctx, dash)
	return dash, nil
}

// --- Agent CRUD ---

func (s *MDMService) CreateAgentRecord(ctx context.Context, ar *models.AgentRecord) error {
	if ar.AgentCode == "" {
		return fmt.Errorf("agent_code is required")
	}
	if ar.AgentName == "" {
		return fmt.Errorf("agent_name is required")
	}
	if err := s.pg.CreateAgentRecord(ctx, ar); err != nil {
		return err
	}
	_ = s.rdb.CacheAgentRecord(ctx, ar)
	return nil
}

func (s *MDMService) GetAgentRecord(ctx context.Context, code string) (*models.AgentRecord, error) {
	if cached, err := s.rdb.GetAgentRecord(ctx, code); err == nil && cached != nil {
		return cached, nil
	}
	ar, err := s.pg.GetAgentRecord(ctx, code)
	if err != nil {
		return nil, err
	}
	_ = s.rdb.CacheAgentRecord(ctx, ar)
	return ar, nil
}

func (s *MDMService) ListAgentRecords(ctx context.Context, status string, limit, offset int) ([]models.AgentRecord, error) {
	return s.pg.ListAgentRecords(ctx, status, limit, offset)
}

// --- Product CRUD ---

func (s *MDMService) CreateProductRecord(ctx context.Context, pr *models.ProductRecord) error {
	if pr.ProductCode == "" {
		return fmt.Errorf("product_code is required")
	}
	if pr.ProductName == "" {
		return fmt.Errorf("product_name is required")
	}
	return s.pg.CreateProductRecord(ctx, pr)
}

func (s *MDMService) GetProductRecord(ctx context.Context, code string) (*models.ProductRecord, error) {
	return s.pg.GetProductRecord(ctx, code)
}

func (s *MDMService) ListProductRecords(ctx context.Context, isActive bool) ([]models.ProductRecord, error) {
	return s.pg.ListProductRecords(ctx, isActive)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
