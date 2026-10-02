// PostgreSQL persistence layer for the FIDO2 service.
//
// 2026-10-01 (C2-fido2, persistence audit item A8): passkey credentials,
// users, and in-flight ceremony sessions were previously held in process
// memory (main.go comment: "replace with PostgreSQL in production"), so a
// restart permanently destroyed registered credentials and locked users out.
// Postgres is now the AUTHORITATIVE store; there is no in-memory fallback.
// Fail-closed policy: if PG is unavailable at boot the process exits
// (log.Fatal in initDB); if a store operation fails during a ceremony the
// handler returns an explicit 5xx error and never reports success.
//
// The service has no Redis client (grep: no redis import in this module), so
// short-lived ceremony session data (WebAuthn challenges) is persisted to the
// fido2_sessions table with expires_at + a background cleanup sweep.

package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/lib/pq"
)

// sessionTTL is the fallback lifetime for ceremony sessions when the
// SessionData does not carry an Expires timestamp.
const sessionTTL = 5 * time.Minute

// fido2Store is the Postgres-backed store for users, credentials and
// ceremony sessions. All methods fail closed: errors are returned to the
// caller and never swallowed.
type fido2Store struct {
	db *sql.DB
}

var store *fido2Store

// storeDDL creates the authoritative tables. Idempotent; run at boot.
//
// The legacy generic-CRUD handlers (handleListEntities/handleCreateEntity/
// ...) query fido2_credentials columns id, name, status, data, created_at,
// so those columns are retained: `id` is a surrogate identity column and
// name/status/data remain for backward compatibility with that debug API.
const storeDDL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- provides gen_random_bytes for the credential_id default

CREATE TABLE IF NOT EXISTS fido2_users (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fido2_credentials (
    credential_id    BYTEA PRIMARY KEY DEFAULT gen_random_bytes(32),
    id               BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    user_id          TEXT NOT NULL REFERENCES fido2_users(id) ON DELETE CASCADE,
    public_key       BYTEA,
    attestation_type TEXT NOT NULL DEFAULT '',
    transports       TEXT[] NOT NULL DEFAULT '{}',
    flags            SMALLINT NOT NULL DEFAULT 0,
    aaguid           BYTEA,
    sign_count       BIGINT NOT NULL DEFAULT 0,
    clone_warning    BOOLEAN NOT NULL DEFAULT FALSE,
    name             TEXT,
    status           TEXT NOT NULL DEFAULT 'active',
    data             JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS fido2_credentials_user_id_idx ON fido2_credentials(user_id);

CREATE TABLE IF NOT EXISTS fido2_sessions (
    id         TEXT PRIMARY KEY,
    data       JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fido2_sessions_expires_at_idx ON fido2_sessions(expires_at);
`

// initStore runs the DDL and installs the global store. Any failure is fatal
// (fail-closed): the service must not start without a writable PG.
func initStore(ctx context.Context) error {
	if _, err := db.ExecContext(ctx, storeDDL); err != nil {
		return fmt.Errorf("fido2 store DDL: %w", err)
	}
	store = &fido2Store{db: db}
	return nil
}

// ─── Users ──────────────────────────────────────────────────────────────────

// ensureUser inserts the user if absent (idempotent upsert) and returns the
// user with its credentials loaded from PG.
func (s *fido2Store) ensureUser(ctx context.Context, userID, userName, displayName string) (*User, error) {
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO fido2_users (id, name, display_name) VALUES ($1, $2, $3)
		 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, display_name = EXCLUDED.display_name`,
		userID, userName, displayName); err != nil {
		return nil, fmt.Errorf("ensure user %q: %w", userID, err)
	}
	return s.getUser(ctx, userID)
}

// getUser loads a user and its credentials from PG. Returns (nil, nil) when
// the user does not exist.
func (s *fido2Store) getUser(ctx context.Context, userID string) (*User, error) {
	var name, displayName string
	err := s.db.QueryRowContext(ctx,
		`SELECT name, display_name FROM fido2_users WHERE id = $1`, userID).Scan(&name, &displayName)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user %q: %w", userID, err)
	}
	u := &User{ID: []byte(userID), Name: name, DisplayName: displayName, Credentials: []webauthn.Credential{}}
	creds, err := s.loadCredentials(ctx, `WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	u.Credentials = creds
	return u, nil
}

// getUserByCredentialID resolves a raw credential ID to its owning user (with
// credentials loaded). Used by the discoverable-login flow.
func (s *fido2Store) getUserByCredentialID(ctx context.Context, rawID []byte) (*User, error) {
	var userID string
	err := s.db.QueryRowContext(ctx,
		`SELECT user_id FROM fido2_credentials WHERE credential_id = $1`, rawID).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lookup credential owner: %w", err)
	}
	return s.getUser(ctx, userID)
}

// ─── Credentials ────────────────────────────────────────────────────────────

// saveCredential persists a newly registered credential (write-through; PG is
// authoritative). The user row must already exist (created at register/begin).
func (s *fido2Store) saveCredential(ctx context.Context, userID string, cred *webauthn.Credential, deviceType string, createdAt time.Time) error {
	transports := make([]string, len(cred.Transport))
	for i, t := range cred.Transport {
		transports[i] = string(t)
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO fido2_credentials
			(credential_id, user_id, public_key, attestation_type, transports, flags, aaguid,
			 sign_count, clone_warning, name, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 ON CONFLICT (credential_id) DO UPDATE SET
			public_key = EXCLUDED.public_key, attestation_type = EXCLUDED.attestation_type,
			transports = EXCLUDED.transports, flags = EXCLUDED.flags, aaguid = EXCLUDED.aaguid,
			sign_count = EXCLUDED.sign_count, clone_warning = EXCLUDED.clone_warning`,
		cred.ID, userID, cred.PublicKey, cred.AttestationType, pq.Array(transports), packCredentialFlags(cred.Flags), nullBytes(cred.Authenticator.AAGUID),
		int64(cred.Authenticator.SignCount), cred.Authenticator.CloneWarning, deviceType, createdAt)
	if err != nil {
		return fmt.Errorf("save credential for user %q: %w", userID, err)
	}
	return nil
}

// touchCredential updates sign_count and last_used_at after a successful
// assertion. Fail-closed (2026-10-02, C2-fido2-fix): if the credential row
// has vanished (e.g. revoked mid-ceremony) this returns an error so the
// handler fails the ceremony with 500 instead of reporting a success whose
// durable counter was never updated.
func (s *fido2Store) touchCredential(ctx context.Context, credID []byte, signCount uint32, cloneWarning bool, at time.Time) (string, error) {
	var userID string
	err := s.db.QueryRowContext(ctx,
		`UPDATE fido2_credentials SET sign_count = $2, clone_warning = $3, last_used_at = $4
		 WHERE credential_id = $1 RETURNING user_id`,
		credID, int64(signCount), cloneWarning, at).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("credential row missing for counter update (revoked mid-ceremony?)")
	}
	if err != nil {
		return "", fmt.Errorf("update credential counter: %w", err)
	}
	return userID, nil
}

// listCredentials returns the serialisable credentials for a user.
func (s *fido2Store) listCredentials(ctx context.Context, userID string) ([]*StoredCredential, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT credential_id, user_id, public_key, attestation_type, transports, sign_count,
		        COALESCE(name, ''), created_at, last_used_at
		 FROM fido2_credentials WHERE user_id = $1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("list credentials for %q: %w", userID, err)
	}
	defer func() { _ = rows.Close() }()

	creds := []*StoredCredential{}
	for rows.Next() {
		var rawID, pubKey []byte
		var uid, attType, deviceType string
		var transports []string
		var signCount int64
		var createdAt time.Time
		var lastUsed sql.NullTime
		if err := rows.Scan(&rawID, &uid, &pubKey, &attType, pq.Array(&transports), &signCount, &deviceType, &createdAt, &lastUsed); err != nil {
			return nil, fmt.Errorf("scan credential row: %w", err)
		}
		c := &StoredCredential{
			ID:           base64.URLEncoding.EncodeToString(rawID),
			UserID:       uid,
			CredentialID: base64.URLEncoding.EncodeToString(rawID),
			PublicKey:    base64.URLEncoding.EncodeToString(pubKey),
			Counter:      uint32(signCount),
			DeviceType:   deviceType,
			Transports:   transports,
			CreatedAt:    createdAt,
		}
		if lastUsed.Valid {
			t := lastUsed.Time
			c.LastUsedAt = &t
		}
		creds = append(creds, c)
	}
	return creds, rows.Err()
}

// deleteCredential removes a credential by base64url credential ID.
// Returns the owning user ID and whether a row was deleted.
func (s *fido2Store) deleteCredential(ctx context.Context, credIDB64 string) (string, bool, error) {
	rawID, err := base64.URLEncoding.DecodeString(credIDB64)
	if err != nil {
		return "", false, fmt.Errorf("invalid credential id encoding: %w", err)
	}
	var userID string
	err = s.db.QueryRowContext(ctx,
		`DELETE FROM fido2_credentials WHERE credential_id = $1 RETURNING user_id`, rawID).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("delete credential: %w", err)
	}
	return userID, true, nil
}

// loadCredentials reconstructs webauthn.Credential values from PG rows.
func (s *fido2Store) loadCredentials(ctx context.Context, where string, args ...any) ([]webauthn.Credential, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT credential_id, public_key, attestation_type, transports, flags, aaguid, sign_count, clone_warning
		 FROM fido2_credentials `+where, args...)
	if err != nil {
		return nil, fmt.Errorf("load credentials: %w", err)
	}
	defer func() { _ = rows.Close() }()

	creds := []webauthn.Credential{}
	for rows.Next() {
		var c webauthn.Credential
		var transports []string
		var flags byte
		var aaguid []byte
		var signCount int64
		if err := rows.Scan(&c.ID, &c.PublicKey, &c.AttestationType, pq.Array(&transports), &flags, &aaguid, &signCount, &c.Authenticator.CloneWarning); err != nil {
			return nil, fmt.Errorf("scan credential: %w", err)
		}
		c.Transport = make([]protocol.AuthenticatorTransport, len(transports))
		for i, t := range transports {
			c.Transport[i] = protocol.AuthenticatorTransport(t)
		}
		c.Flags = unpackCredentialFlags(flags)
		c.Authenticator.AAGUID = aaguid
		c.Authenticator.SignCount = uint32(signCount)
		creds = append(creds, c)
	}
	return creds, rows.Err()
}

// ─── Ceremony sessions (challenge data; short-lived, PG-backed) ─────────────

// saveSession persists in-flight ceremony data with an expiry. PG is
// authoritative: a restart mid-ceremony no longer strands the flow.
func (s *fido2Store) saveSession(ctx context.Context, sessionID string, sd *webauthn.SessionData) error {
	data, err := json.Marshal(sd)
	if err != nil {
		return fmt.Errorf("marshal session data: %w", err)
	}
	expires := sd.Expires
	if expires.IsZero() {
		expires = time.Now().Add(sessionTTL)
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO fido2_sessions (id, data, expires_at) VALUES ($1, $2, $3)
		 ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
		sessionID, data, expires); err != nil {
		return fmt.Errorf("save ceremony session: %w", err)
	}
	return nil
}

// getSession loads ceremony session data, enforcing expiry. Returns
// (nil, nil) when absent or expired.
func (s *fido2Store) getSession(ctx context.Context, sessionID string) (*webauthn.SessionData, error) {
	var data []byte
	err := s.db.QueryRowContext(ctx,
		`DELETE FROM fido2_sessions WHERE id = $1 AND expires_at > now() RETURNING data`,
		sessionID).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load ceremony session: %w", err)
	}
	var sd webauthn.SessionData
	if err := json.Unmarshal(data, &sd); err != nil {
		return nil, fmt.Errorf("unmarshal session data: %w", err)
	}
	return &sd, nil
}

// cleanupExpiredSessions removes expired ceremony rows. Errors are logged by
// the caller; expired rows are also rejected at read time, so a missed sweep
// is never a correctness issue.
func (s *fido2Store) cleanupExpiredSessions(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM fido2_sessions WHERE expires_at <= now()`)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// packCredentialFlags encodes the webauthn CredentialFlags booleans into one
// byte for the flags SMALLINT column (bit0 UP, bit1 UV, bit2 BE, bit3 BS).
func packCredentialFlags(f webauthn.CredentialFlags) byte {
	var b byte
	if f.UserPresent {
		b |= 1
	}
	if f.UserVerified {
		b |= 2
	}
	if f.BackupEligible {
		b |= 4
	}
	if f.BackupState {
		b |= 8
	}
	return b
}

func unpackCredentialFlags(b byte) webauthn.CredentialFlags {
	return webauthn.CredentialFlags{
		UserPresent:    b&1 != 0,
		UserVerified:   b&2 != 0,
		BackupEligible: b&4 != 0,
		BackupState:    b&8 != 0,
	}
}

// nullBytes maps an empty slice to NULL for the aaguid column.
func nullBytes(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}

