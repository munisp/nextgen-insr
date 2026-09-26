// util.go — small shared helpers (Q5, 2026-09-25).
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
)

// As re-exports errors.As for call sites that keep a small import list.
func As(err error, target any) bool { return errors.As(err, target) }

// sha256OfReading hashes a manual reading's canonical JSON for the
// payload_hash audit column (same purpose as the TS adapter's payload hash).
func sha256OfReading(r Reading) string {
	b, _ := json.Marshal(r)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
