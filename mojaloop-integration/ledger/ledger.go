// Package ledger provides a thin, real wrapper around the TigerBeetle
// double-entry accounting client plus the identifier/amount helpers used by
// the Mojaloop integration service.
package ledger

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math"
	"math/big"

	tigerbeetle_go "github.com/tigerbeetle/tigerbeetle-go"
)

// Transfer and Uint128 are aliased to the upstream TigerBeetle bindings so
// callers can construct ledger entries without importing the bindings
// directly.
type Transfer = tigerbeetle_go.Transfer
type Uint128 = tigerbeetle_go.Uint128

// TigerBeetleClient wraps the upstream TigerBeetle client with the
// context-aware, single-transfer API used by this service.
type TigerBeetleClient struct {
	client tigerbeetle_go.Client
}

// NewTigerBeetleClient connects to a TigerBeetle cluster.
func NewTigerBeetleClient(clusterID Uint128, addresses []string) (*TigerBeetleClient, error) {
	c, err := tigerbeetle_go.NewClient(clusterID, addresses)
	if err != nil {
		return nil, fmt.Errorf("connect tigerbeetle: %w", err)
	}
	return &TigerBeetleClient{client: c}, nil
}

// Close releases the underlying client resources.
func (c *TigerBeetleClient) Close() {
	if c != nil && c.client != nil {
		c.client.Close()
	}
}

// CreateTransfer submits a single transfer to the ledger. It returns the
// number of transfers accepted (1 on success) or an error describing the
// rejection.
func (c *TigerBeetleClient) CreateTransfer(ctx context.Context, t Transfer) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	results, err := c.client.CreateTransfers([]Transfer{t})
	if err != nil {
		return 0, fmt.Errorf("create transfer: %w", err)
	}
	if len(results) > 0 {
		return 0, fmt.Errorf("transfer rejected: status code %d", results[0].Status)
	}
	return 1, nil
}

// Uint128FromUint64 converts a uint64 into a TigerBeetle Uint128.
func Uint128FromUint64(v uint64) Uint128 {
	return tigerbeetle_go.BigIntToUint128(new(big.Int).SetUint64(v))
}

// AmountToSmallestUnit converts a decimal currency amount into its smallest
// unit (e.g. kobo/cents) using the given number of decimal places.
func AmountToSmallestUnit(amount float64, decimals int) uint64 {
	return uint64(math.Round(amount * math.Pow10(decimals)))
}

// GenerateTransferID derives a deterministic 128-bit transfer ID from a
// human-readable reference and a sequence number.
func GenerateTransferID(reference string, seq int) Uint128 {
	sum := sha256.Sum256([]byte(fmt.Sprintf("transfer:%s:%d", reference, seq)))
	var b [16]byte
	copy(b[:], sum[:16])
	return tigerbeetle_go.BytesToUint128(b)
}

// GenerateAccountID derives a deterministic 128-bit account ID from an
// account namespace and a numeric owner identifier.
func GenerateAccountID(namespace string, id uint32) Uint128 {
	h := sha256.New()
	h.Write([]byte("account:" + namespace + ":"))
	var raw [4]byte
	binary.BigEndian.PutUint32(raw[:], id)
	h.Write(raw[:])
	sum := h.Sum(nil)
	var b [16]byte
	copy(b[:], sum[:16])
	return tigerbeetle_go.BytesToUint128(b)
}
