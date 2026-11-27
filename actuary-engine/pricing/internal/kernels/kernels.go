// Package kernels is the single cgo boundary to the actuary_kernels Rust
// cdylib (design doc §3.2: "Go also owns the cgo boundary to the Rust
// kernels, keeping FFI in exactly one place").
//
// The wrapper enforces the frozen Appendix C contract:
//   - truthful (ptr, len) pairs (the header documents that non-null bogus
//     pointers are undetectable from the callee side);
//   - status codes mapped onto typed Go errors — the kernels never guess,
//     and neither do we: any AK_ERR_* propagates as an error, never a
//     fabricated value;
//   - money crosses the boundary as integer kobo out-params; Go never
//     re-rounds kernel outputs (design §9.1 float discipline).
//
// Linking: the kernels crate builds as cdylib (libactuary_kernels.so). At
// build time LDFLAGS points at ../kernels/target/release (dev) or the staged
// library dir (Docker). At runtime the loader needs the .so on
// LD_LIBRARY_PATH (dev) or /usr/lib (image), exactly like any cgo consumer.
package kernels

/*
#cgo CFLAGS: -I../../../kernels/include
#cgo LDFLAGS: -L../../../kernels/target/release -lactuary_kernels -lm
#include <stdlib.h>
#include "actuary_kernels.h"
*/
import "C"

import (
	"errors"
	"fmt"
	"math"
	"unsafe"
)

// Status codes mirrored from actuary_kernels.h (frozen contract).
const (
	OK         = 0
	ErrInput   = -1
	ErrDomain  = -2
	ErrNumeric = -3
	ErrPanic   = -99
)

// KernelError is a non-OK status returned by the cdylib. Code carries the
// raw AK_ERR_* value so callers can branch on domain-vs-input-vs-numeric
// (Appendix I step 7: any kernel failure at quote time → refer, never
// accept).
type KernelError struct {
	Code int32
	Op   string
}

func (e *KernelError) Error() string {
	return fmt.Sprintf("actuary kernel %s failed: status %d (%s)", e.Op, e.Code, codeName(e.Code))
}

func codeName(code int32) string {
	switch code {
	case ErrInput:
		return "AK_ERR_INPUT"
	case ErrDomain:
		return "AK_ERR_DOMAIN"
	case ErrNumeric:
		return "AK_ERR_NUMERIC"
	case ErrPanic:
		return "AK_ERR_PANIC"
	default:
		return "AK_UNKNOWN"
	}
}

// IsDomain reports whether err is an out-of-model-domain failure (e.g. the
// quote carries a variable level the rating model has no relativity for).
// Callers map domain failures to referral reason codes.
func IsDomain(err error) bool {
	var ke *KernelError
	return errors.As(err, &ke) && ke.Code == ErrDomain
}

// Version returns the packed semver of the linked cdylib
// (major<<16 | minor<<8 | patch). Used by the boot smoke test and readyz
// (Appendix D boot sequence: "smoke-test cgo (ak_version, one golden
// premium)").
func Version() uint32 {
	return uint32(C.ak_version())
}

// PremiumQuote is the decomposed quote returned by ak_premium_compose. All
// monetary fields are integer kobo; the kernel owns the single rounding
// policy (half-away-from-zero), so these values are final.
type PremiumQuote struct {
	TotalKobo    int64
	PureKobo     int64
	LoadingsKobo int64
	// TaxKobo is derived on the Go side as total - pure - loadings, the same
	// identity the Rust kernel documents for its own tax_kobo field. Zero
	// when no tax rates are supplied.
	TaxKobo int64
}

// ComposePremium wraps ak_premium_compose. rels are the flattened,
// already-resolved multiplicative relativities (the kernel never does table
// lookup — Appendix C). taxRates are additive statutory rates on gross.
// minKobo/maxKobo clamp the total; pass (0, math.MaxInt64) for no clamp.
//
// The function never mutates inputs and never returns partial outputs: on a
// non-OK status it returns a *KernelError and a zero quote.
func ComposePremium(
	basePurePremium float64,
	rels []float64,
	expenseRatio, commissionRate, profitMargin float64,
	taxRates []float64,
	minKobo, maxKobo int64,
) (PremiumQuote, error) {
	var relsPtr *C.double
	if len(rels) > 0 {
		relsPtr = (*C.double)(unsafe.Pointer(&rels[0]))
	}
	var taxPtr *C.double
	if len(taxRates) > 0 {
		taxPtr = (*C.double)(unsafe.Pointer(&taxRates[0]))
	}
	var outTotal, outPure, outLoadings C.int64_t
	status := C.ak_premium_compose(
		C.double(basePurePremium),
		relsPtr, C.size_t(len(rels)),
		C.double(expenseRatio), C.double(commissionRate), C.double(profitMargin),
		taxPtr, C.size_t(len(taxRates)),
		C.int64_t(minKobo), C.int64_t(maxKobo),
		&outTotal, &outPure, &outLoadings,
	)
	if status != OK {
		return PremiumQuote{}, &KernelError{Code: int32(status), Op: "ak_premium_compose"}
	}
	total := int64(outTotal)
	pure := int64(outPure)
	loadings := int64(outLoadings)
	return PremiumQuote{
		TotalKobo:    total,
		PureKobo:     pure,
		LoadingsKobo: loadings,
		TaxKobo:      total - pure - loadings,
	}, nil
}

// LineSimSpec mirrors AkLineSimSpec (repr(C)) for the Monte Carlo kernel.
// Distribution codes are the frozen header values: frequency 0=Poisson
// (P1=lambda), 1=NegBin (P1=mean, P2=size r); severity 2=Gamma (P1=mean,
// P2=cv), 3=Lognormal (P1=mu, P2=sigma), 4=Tweedie (P1=mean, P2=phi,
// P3=power).
type LineSimSpec struct {
	FreqDist int32
	FreqP1   float64
	FreqP2   float64
	SevDist  int32
	SevP1    float64
	SevP2    float64
	SevP3    float64
}

// MonteCarloResult carries the aggregate-loss simulation outputs.
type MonteCarloResult struct {
	Var995      float64
	Tvar99      float64
	Mean        float64
	PerLineTvar []float64 // mean line loss over worst-1% aggregate paths
}

// MonteCarloAggregate wraps ak_montecarlo_aggregate. corr may be nil for
// independence; otherwise it must hold n×n row-major entries with n ==
// len(lines). The kernel is deterministic under seed.
func MonteCarloAggregate(lines []LineSimSpec, corr []float64, nPaths, seed uint64) (MonteCarloResult, error) {
	if len(lines) == 0 {
		return MonteCarloResult{}, &KernelError{Code: ErrInput, Op: "ak_montecarlo_aggregate"}
	}
	specs := make([]C.AkLineSimSpec, len(lines))
	for i, l := range lines {
		specs[i] = C.AkLineSimSpec{
			freq_dist: C.int32_t(l.FreqDist),
			freq_p1:   C.double(l.FreqP1),
			freq_p2:   C.double(l.FreqP2),
			sev_dist:  C.int32_t(l.SevDist),
			sev_p1:    C.double(l.SevP1),
			sev_p2:    C.double(l.SevP2),
			sev_p3:    C.double(l.SevP3),
		}
	}
	var corrPtr *C.double
	var corrDim C.size_t
	if len(corr) > 0 {
		if len(corr) != len(lines)*len(lines) {
			return MonteCarloResult{}, fmt.Errorf("correlation matrix has %d entries, want %d", len(corr), len(lines)*len(lines))
		}
		corrPtr = (*C.double)(unsafe.Pointer(&corr[0]))
		corrDim = C.size_t(len(lines))
	}
	perLine := make([]C.double, len(lines))
	var outVar, outTvar, outMean C.double
	status := C.ak_montecarlo_aggregate(
		(*C.AkLineSimSpec)(unsafe.Pointer(&specs[0])), C.size_t(len(specs)),
		corrPtr, corrDim,
		C.uint64_t(nPaths), C.uint64_t(seed),
		&outVar, &outTvar, &outMean,
		(*C.double)(unsafe.Pointer(&perLine[0])),
	)
	if status != OK {
		return MonteCarloResult{}, &KernelError{Code: int32(status), Op: "ak_montecarlo_aggregate"}
	}
	res := MonteCarloResult{
		Var995:      float64(outVar),
		Tvar99:      float64(outTvar),
		Mean:        float64(outMean),
		PerLineTvar: make([]float64, len(lines)),
	}
	for i := range perLine {
		res.PerLineTvar[i] = float64(perLine[i])
	}
	if math.IsNaN(res.Var995) || math.IsNaN(res.Tvar99) {
		return MonteCarloResult{}, &KernelError{Code: ErrNumeric, Op: "ak_montecarlo_aggregate"}
	}
	return res, nil
}
