// mojaloop.go — Q-wave Q5 (2026-09-25)
//
// Mojaloop payout-rail adapter NOTE (per build directive: interface +
// fail-closed unconfigured error, dated disclosure — NO fake Mojaloop
// transfers).
//
// Status 2026-09-25: parametric payouts settle through the EXISTING TS
// engine path (server/lib/parametricEngine.ts → instant-payout-service,
// which already contains a real Mojaloop switch client, mojaloopClient).
// This adapter exists so a future deployment can route parametric payouts
// DIRECTLY over a Mojaloop switch; it is never invoked on a production path
// in this service, and NewMojaloopRail fails closed when the switch
// credentials are not configured.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
)

// ErrMojaloopUnconfigured is returned (fail-closed) whenever the rail is used
// without a configured switch. Dated disclosure 2026-09-25: this repo has NO
// Mojaloop sandbox credentials for parametric payouts; configuring
// MOJALOOP_SWITCH_URL + MOJALOOP_DFSP_ID is a deployment prerequisite.
var ErrMojaloopUnconfigured = errors.New(
	"mojaloop payout rail unconfigured (MOJALOOP_SWITCH_URL/MOJALOOP_DFSP_ID unset) — fail-closed, no transfer attempted (disclosed 2026-09-25)")

// PayoutRail is the minimal payout-rail contract.
type PayoutRail interface {
	// Transfer pays `amountKobo` to `payeeID` (MSISDN/account alias) for the
	// given settlement reference. Implementations MUST fail closed: any
	// transport or switch error ⇒ error, never a fabricated receipt.
	Transfer(ctx context.Context, settlementRef string, amountKobo int64, currency string, payeeID string) (string, error)
}

// MojaloopRail is a Mojaloop switch adapter shell. Construction validates
// configuration; Transfer additionally refuses to run against an
// unconfigured switch (defence in depth).
type MojaloopRail struct {
	switchURL string
	dfspID    string
}

func NewMojaloopRail() (*MojaloopRail, error) {
	url := os.Getenv("MOJALOOP_SWITCH_URL")
	dfsp := os.Getenv("MOJALOOP_DFSP_ID")
	if url == "" || dfsp == "" {
		return nil, ErrMojaloopUnconfigured
	}
	return &MojaloopRail{switchURL: url, dfspID: dfsp}, nil
}

// Transfer fails closed: real Mojaloop transfers for parametric payouts are
// intentionally NOT implemented in this service (2026-09-25) — settlement is
// owned by the TS engine + instant-payout-service's existing Mojaloop
// client. Calling this always returns an explicit error instead of a fake
// receipt.
func (m *MojaloopRail) Transfer(ctx context.Context, settlementRef string, amountKobo int64, currency string, payeeID string) (string, error) {
	if m == nil || m.switchURL == "" || m.dfspID == "" {
		return "", ErrMojaloopUnconfigured
	}
	return "", fmt.Errorf("mojaloop direct parametric payout not enabled in parametric-evaluator (settlement owned by TS engine) — ref %s refused (fail-closed, disclosed 2026-09-25)", settlementRef)
}
