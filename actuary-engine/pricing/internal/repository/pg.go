package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/lib/pq"

	"github.com/unified-insurance/actuary-engine/pricing/internal/accumulation"
	"github.com/unified-insurance/actuary-engine/pricing/internal/exposure"
	"github.com/unified-insurance/actuary-engine/pricing/internal/models"
	"github.com/unified-insurance/actuary-engine/pricing/internal/referral"
)

// PG is the production Store backed by PostgreSQL (lib/pq, matching
// reinsurance-management). Column names follow the Leg D Drizzle schema —
// camelCase identifiers are quoted.
type PG struct {
	db *sql.DB
}

// NewPG wraps an open *sql.DB.
func NewPG(db *sql.DB) *PG { return &PG{db: db} }

// Ping implements Store.
func (p *PG) Ping(ctx context.Context) error { return p.db.PingContext(ctx) }

// LoadBoot implements Store.
func (p *PG) LoadBoot(ctx context.Context) (*Boot, error) {
	boot := &Boot{AccumSeeds: map[string]int64{}}

	// Product lines (the managed-line registry).
	lineIDs := map[int64]string{}
	rows, err := p.db.QueryContext(ctx,
		`SELECT id, code FROM act_product_lines WHERE "isActive" = TRUE ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("load product lines: %w", err)
	}
	for rows.Next() {
		var id int64
		var code string
		if err := rows.Scan(&id, &code); err != nil {
			rows.Close()
			return nil, err
		}
		lineIDs[id] = code
		boot.Lines = append(boot.Lines, code)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	// Rate versions + rating tables.
	vrows, err := p.db.QueryContext(ctx,
		`SELECT id, "productLineId", version, "effectiveFrom", "effectiveTo", status
		 FROM act_rate_versions ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("load rate versions: %w", err)
	}
	var versionRows []VersionRow
	byID := map[int64]*VersionRow{}
	for vrows.Next() {
		var id, lineID int64
		var version, status string
		var from, to sql.NullTime
		if err := vrows.Scan(&id, &lineID, &version, &from, &to, &status); err != nil {
			vrows.Close()
			return nil, err
		}
		line, ok := lineIDs[lineID]
		if !ok {
			vrows.Close()
			return nil, fmt.Errorf("rate version %d references unknown line id %d", id, lineID)
		}
		vr := VersionRow{ID: id, Line: line, Version: version, Status: status, Tables: map[string]json.RawMessage{}}
		if from.Valid {
			t := from.Time
			vr.EffectiveFrom = &t
		}
		if to.Valid {
			t := to.Time
			vr.EffectiveTo = &t
		}
		versionRows = append(versionRows, vr)
		byID[id] = &versionRows[len(versionRows)-1]
	}
	if err := vrows.Err(); err != nil {
		vrows.Close()
		return nil, err
	}
	vrows.Close()

	trows, err := p.db.QueryContext(ctx,
		`SELECT "rateVersionId", "tableType", payload::text FROM act_rating_tables ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("load rating tables: %w", err)
	}
	for trows.Next() {
		var versionID int64
		var tableType, payload string
		if err := trows.Scan(&versionID, &tableType, &payload); err != nil {
			trows.Close()
			return nil, err
		}
		vr, ok := byID[versionID]
		if !ok {
			trows.Close()
			return nil, fmt.Errorf("rating table references unknown version %d", versionID)
		}
		vr.Tables[tableType] = json.RawMessage(payload)
	}
	if err := trows.Err(); err != nil {
		trows.Close()
		return nil, err
	}
	trows.Close()

	snap, err := BuildSnapshot(boot.Lines, versionRows)
	if err != nil {
		return nil, err
	}
	boot.Versions = snap.All

	// Exposure limits.
	boot.Limits, err = p.loadLimits(ctx, lineIDs)
	if err != nil {
		return nil, err
	}

	// Referral rules.
	boot.Rules, err = p.loadRules(ctx, lineIDs)
	if err != nil {
		return nil, err
	}

	// Accumulation warm seeds (persisted PG snapshot of Redis aggregates).
	arows, err := p.db.QueryContext(ctx,
		`SELECT "productLineId", "geoCell", "aggregateExposure"::text FROM act_accumulation_cells`)
	if err != nil {
		return nil, fmt.Errorf("load accumulation cells: %w", err)
	}
	for arows.Next() {
		var lineID int64
		var cell, amount string
		if err := arows.Scan(&lineID, &cell, &amount); err != nil {
			arows.Close()
			return nil, err
		}
		kobo, err := ParseKobo(amount)
		if err != nil {
			arows.Close()
			return nil, fmt.Errorf("accumulation cell %d/%s: %w", lineID, cell, err)
		}
		boot.AccumSeeds[accumulation.Key(lineIDs[lineID], cell)] = kobo
	}
	if err := arows.Err(); err != nil {
		arows.Close()
		return nil, err
	}
	arows.Close()

	return boot, nil
}

func (p *PG) loadLimits(ctx context.Context, lineIDs map[int64]string) (map[string]*exposure.Limits, error) {
	rows, err := p.db.QueryContext(ctx,
		`SELECT "productLineId", "maxSumInsured"::text, "maxPremium"::text,
		        "maxAggregateExposure"::text, "geoAccumulationLimit"::text
		 FROM act_exposure_limits`)
	if err != nil {
		return nil, fmt.Errorf("load exposure limits: %w", err)
	}
	defer rows.Close()
	out := map[string]*exposure.Limits{}
	for rows.Next() {
		var lineID int64
		var maxSI, maxPrem, maxAgg sql.NullString
		var geoRaw sql.NullString
		if err := rows.Scan(&lineID, &maxSI, &maxPrem, &maxAgg, &geoRaw); err != nil {
			return nil, err
		}
		lim := &exposure.Limits{}
		if maxSI.Valid {
			v, err := ParseKobo(maxSI.String)
			if err != nil {
				return nil, fmt.Errorf("exposure limits line %d maxSumInsured: %w", lineID, err)
			}
			lim.MaxSumInsuredKobo = v
		}
		if maxPrem.Valid {
			v, err := ParseKobo(maxPrem.String)
			if err != nil {
				return nil, fmt.Errorf("exposure limits line %d maxPremium: %w", lineID, err)
			}
			lim.MaxPremiumKobo = v
		}
		if maxAgg.Valid {
			v, err := ParseKobo(maxAgg.String)
			if err != nil {
				return nil, fmt.Errorf("exposure limits line %d maxAggregateExposure: %w", lineID, err)
			}
			lim.MaxAggregateKobo = v
		}
		if geoRaw.Valid && geoRaw.String != "" && geoRaw.String != "null" {
			var geo map[string]float64
			if err := json.Unmarshal([]byte(geoRaw.String), &geo); err != nil {
				return nil, fmt.Errorf("exposure limits line %d geoAccumulationLimit: %w", lineID, err)
			}
			lim.GeoAccumulationKobo = map[string]int64{}
			for cell, naira := range geo {
				k, err := NairaToKobo(naira)
				if err != nil {
					return nil, fmt.Errorf("exposure limits line %d geo cell %s: %w", lineID, cell, err)
				}
				lim.GeoAccumulationKobo[cell] = k
			}
		}
		line, ok := lineIDs[lineID]
		if !ok {
			return nil, fmt.Errorf("exposure limits reference unknown line id %d", lineID)
		}
		out[line] = lim
	}
	return out, rows.Err()
}

func (p *PG) loadRules(ctx context.Context, lineIDs map[int64]string) ([]referral.Rule, error) {
	rows, err := p.db.QueryContext(ctx,
		`SELECT id, "productLineId", predicate::text, action, "reasonCode", priority, "isActive"
		 FROM act_referral_rules ORDER BY priority, id`)
	if err != nil {
		return nil, fmt.Errorf("load referral rules: %w", err)
	}
	defer rows.Close()
	var out []referral.Rule
	for rows.Next() {
		var id, lineID int64
		var predicate, action, reasonCode string
		var priority int
		var active bool
		if err := rows.Scan(&id, &lineID, &predicate, &action, &reasonCode, &priority, &active); err != nil {
			return nil, err
		}
		line, ok := lineIDs[lineID]
		if !ok {
			return nil, fmt.Errorf("referral rule %d references unknown line id %d", id, lineID)
		}
		out = append(out, referral.Rule{
			ID:         id,
			Line:       line,
			Predicate:  json.RawMessage(predicate),
			Action:     action,
			ReasonCode: reasonCode,
			Priority:   priority,
			IsActive:   active,
		})
	}
	return out, rows.Err()
}

// ListReferrals implements Store.
func (p *PG) ListReferrals(ctx context.Context, status string) ([]models.ReferralCase, error) {
	query := `SELECT r.id, r."quoteRef", pl.code, r."reasonCodes", r.status, r."createdAt"
	          FROM act_referrals r JOIN act_product_lines pl ON pl.id = r."productLineId"`
	args := []any{}
	if status != "" {
		query += ` WHERE r.status = $1`
		args = append(args, status)
	}
	query += ` ORDER BY r.id DESC LIMIT 500`
	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list referrals: %w", err)
	}
	defer rows.Close()
	var out []models.ReferralCase
	for rows.Next() {
		var c models.ReferralCase
		var created time.Time
		if err := rows.Scan(&c.ID, &c.QuoteRef, &c.ProductLine, pq.Array(&c.ReasonCodes), &c.Status, &created); err != nil {
			return nil, err
		}
		c.CreatedAt = created.UTC().Format(time.RFC3339)
		out = append(out, c)
	}
	return out, rows.Err()
}

// InsertReferral implements Store (idempotent on quoteRef).
func (p *PG) InsertReferral(ctx context.Context, quoteRef, line string, reasonCodes []string) (int64, error) {
	var id int64
	err := p.db.QueryRowContext(ctx,
		`INSERT INTO act_referrals ("quoteRef", "productLineId", "reasonCodes", status)
		 SELECT $1, pl.id, $2, 'open' FROM act_product_lines pl WHERE pl.code = $3
		 ON CONFLICT ("quoteRef") DO NOTHING
		 RETURNING id`,
		quoteRef, pq.Array(reasonCodes), line).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		// Conflict path (or unknown line): fetch the existing id.
		if lookupErr := p.db.QueryRowContext(ctx,
			`SELECT id FROM act_referrals WHERE "quoteRef" = $1`, quoteRef).Scan(&id); lookupErr == nil {
			return id, nil
		}
		return 0, fmt.Errorf("insert referral: line %q unknown or conflict fetch failed", line)
	}
	if err != nil {
		return 0, fmt.Errorf("insert referral: %w", err)
	}
	return id, nil
}

// DecideReferral implements Store.
func (p *PG) DecideReferral(ctx context.Context, id int64, decision string, underwriterID *int64) error {
	res, err := p.db.ExecContext(ctx,
		`UPDATE act_referrals
		 SET status = $2, "underwriterId" = $3, "decidedAt" = now(), "updatedAt" = now()
		 WHERE id = $1 AND status = 'open'`, id, decision, underwriterID)
	if err != nil {
		return fmt.Errorf("decide referral: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		var status string
		err := p.db.QueryRowContext(ctx, `SELECT status FROM act_referrals WHERE id = $1`, id).Scan(&status)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		return ErrConflict
	}
	return nil
}

// LatestCapitalSummary implements Store.
func (p *PG) LatestCapitalSummary(ctx context.Context) (*models.CapitalSummary, bool, error) {
	summary := &models.CapitalSummary{}
	found := false

	// Latest approved NAICOM RBC approximation row.
	var reqStr, availStr sql.NullString
	var rbcAsOf time.Time
	err := p.db.QueryRowContext(ctx,
		`SELECT "rbcRequired"::text, "rbcAvailable"::text, "asOf"
		 FROM act_capital_runs WHERE status = 'approved' AND model = 'naicom_rbc'
		 ORDER BY "asOf" DESC LIMIT 1`).Scan(&reqStr, &availStr, &rbcAsOf)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, false, fmt.Errorf("capital summary rbc: %w", err)
	}
	rbcFound := err == nil && reqStr.Valid && availStr.Valid
	if rbcFound {
		found = true
		req, err1 := ParseKobo(reqStr.String)
		avail, err2 := ParseKobo(availStr.String)
		if err1 != nil || err2 != nil {
			return nil, false, fmt.Errorf("capital summary rbc amounts malformed")
		}
		summary.NaicomRBC.Required = KoboToNaira(req)
		summary.NaicomRBC.Available = KoboToNaira(avail)
		summary.NaicomRBC.Ratio = KoboToNaira(avail) / summary.NaicomRBC.Required
		summary.AsOf = rbcAsOf.UTC().Format(time.RFC3339)
		summary.Status = "approved"
	}

	// Latest approved internal EC row.
	var varStr, tvarStr sql.NullString
	var perLine sql.NullString
	var ecAsOf time.Time
	err = p.db.QueryRowContext(ctx,
		`SELECT "var995"::text, "tvar99"::text, "perLine"::text, "asOf"
		 FROM act_capital_runs WHERE status = 'approved' AND model = 'internal_ec'
		 ORDER BY "asOf" DESC LIMIT 1`).Scan(&varStr, &tvarStr, &perLine, &ecAsOf)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, false, fmt.Errorf("capital summary ec: %w", err)
	}
	if err == nil && varStr.Valid && tvarStr.Valid {
		found = true
		v995, err1 := ParseKobo(varStr.String)
		t99, err2 := ParseKobo(tvarStr.String)
		if err1 != nil || err2 != nil {
			return nil, false, fmt.Errorf("capital summary ec amounts malformed")
		}
		summary.EC.Var995 = KoboToNaira(v995)
		summary.EC.Tvar99 = KoboToNaira(t99)
		if perLine.Valid && perLine.String != "" && perLine.String != "null" {
			if err := json.Unmarshal([]byte(perLine.String), &summary.EC.PerLine); err != nil {
				return nil, false, fmt.Errorf("capital summary perLine malformed: %w", err)
			}
		}
		if !rbcFound || ecAsOf.After(rbcAsOf) {
			summary.AsOf = ecAsOf.UTC().Format(time.RFC3339)
			summary.Status = "approved"
		}
	}
	return summary, found, nil
}

// InsertAdequacyAlert implements Store.
func (p *PG) InsertAdequacyAlert(ctx context.Context, line, period string, pricedLR, actualLR float64, severity string) error {
	res, err := p.db.ExecContext(ctx,
		`INSERT INTO act_adequacy_alerts ("productLineId", period, "pricedLossRatio", "actualLossRatio", severity)
		 SELECT pl.id, $2, $3, $4, $5 FROM act_product_lines pl WHERE pl.code = $1`,
		line, period, pricedLR, actualLR, severity)
	if err != nil {
		return fmt.Errorf("insert adequacy alert: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("adequacy alert: unknown line %q", line)
	}
	return nil
}

// ActivateRateVersion implements Store (transactional single-active).
func (p *PG) ActivateRateVersion(ctx context.Context, id int64) error {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var lineID int64
	var status string
	err = tx.QueryRowContext(ctx,
		`SELECT "productLineId", status FROM act_rate_versions WHERE id = $1 FOR UPDATE`, id,
	).Scan(&lineID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if status != "filing" {
		return fmt.Errorf("%w: version %d is %q, only filing → approved activation is allowed", ErrConflict, id, status)
	}

	// Retire the line's currently approved versions (single-active).
	if _, err := tx.ExecContext(ctx,
		`UPDATE act_rate_versions SET status = 'retired', "updatedAt" = now()
		 WHERE "productLineId" = $1 AND status = 'approved'`, lineID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE act_rate_versions SET status = 'approved', "approvedAt" = now(), "updatedAt" = now()
		 WHERE id = $1`, id); err != nil {
		return err
	}
	return tx.Commit()
}
