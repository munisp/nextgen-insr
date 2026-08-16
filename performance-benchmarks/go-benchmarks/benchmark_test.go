package benchmarks

import (
	"context"
	"encoding/binary"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	ttb "github.com/munisp/nextgen-insr/bidirectional-integrations/temporal-tigerbeetle"
	types "github.com/tigerbeetle/tigerbeetle-go"
)

// uint128HL builds a tigerbeetle Uint128 from high/low 64-bit parts
// (the API exposes no High/Low composite literal; BytesToUint128 is the
// sanctioned constructor — values preserved exactly).
func uint128HL(high, low uint64) types.Uint128 {
	var b [16]byte
	binary.LittleEndian.PutUint64(b[0:8], low)
	binary.LittleEndian.PutUint64(b[8:16], high)
	return types.BytesToUint128(b)
}

type BenchmarkMetrics struct {
	TotalOperations   int64
	SuccessfulOps     int64
	FailedOps         int64
	TotalDuration     time.Duration
	MinLatency        time.Duration
	MaxLatency        time.Duration
	AvgLatency        time.Duration
	P50Latency        time.Duration
	P95Latency        time.Duration
	P99Latency        time.Duration
	Throughput        float64
	MemoryAllocated   uint64
	MemoryUsed        uint64
}

func BenchmarkCreateAccount(b *testing.B) {
	client, err := ttb.NewTigerBeetleClient(uint128HL(0, 0), []string{"localhost:3000"})
	if err != nil {
		b.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			accountID := uint128HL(uint64(time.Now().UnixNano()), uint64(b.N))
			err := client.CreateAccount(context.Background(), accountID, 1, 1)
			if err != nil {
				b.Logf("Create account failed: %v", err)
			}
		}
	})
}

func BenchmarkCreateTransfer(b *testing.B) {
	client, err := ttb.NewTigerBeetleClient(uint128HL(0, 0), []string{"localhost:3000"})
	if err != nil {
		b.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	// Setup accounts
	debitAccount := uint128HL(1, 1)
	creditAccount := uint128HL(1, 2)
	
	client.CreateAccount(context.Background(), debitAccount, 1, 1)
	client.CreateAccount(context.Background(), creditAccount, 1, 2)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			i++
			transferID := fmt.Sprintf("%s-%d", uuid.New().String(), i)
			req := ttb.TransferRequest{
				TransferID:      transferID,
				DebitAccountID:  debitAccount,
				CreditAccountID: creditAccount,
				Amount:          1000,
				Ledger:          1,
				Code:            1,
				IsPending:       false,
			}
			
			_, err := client.CreateTransfer(context.Background(), req)
			if err != nil {
				b.Logf("Create transfer failed: %v", err)
			}
		}
	})
}

func BenchmarkPendingTransferWorkflow(b *testing.B) {
	client, err := ttb.NewTigerBeetleClient(uint128HL(0, 0), []string{"localhost:3000"})
	if err != nil {
		b.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	// Setup accounts
	debitAccount := uint128HL(2, 1)
	creditAccount := uint128HL(2, 2)
	
	client.CreateAccount(context.Background(), debitAccount, 1, 1)
	client.CreateAccount(context.Background(), creditAccount, 1, 2)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			i++
			ctx := context.Background()
			
			// Create pending transfer
			pendingID := fmt.Sprintf("PENDING-%s-%d", uuid.New().String(), i)
			pendingReq := ttb.TransferRequest{
				TransferID:      pendingID,
				DebitAccountID:  debitAccount,
				CreditAccountID: creditAccount,
				Amount:          1000,
				Ledger:          1,
				Code:            1,
				IsPending:       true,
				Timeout:         3600,
			}
			
			_, err := client.CreateTransfer(ctx, pendingReq)
			if err != nil {
				b.Logf("Create pending transfer failed: %v", err)
				continue
			}
			
			// Post pending transfer
			postID := fmt.Sprintf("POST-%s", pendingID)
			_, err = client.PostPendingTransfer(ctx, postID, pendingID, 1, 1)
			if err != nil {
				b.Logf("Post pending transfer failed: %v", err)
			}
		}
	})
}

func BenchmarkConcurrentWorkflows(b *testing.B) {
	concurrencyLevels := []int{10, 50, 100, 500, 1000}
	
	for _, concurrency := range concurrencyLevels {
		b.Run(fmt.Sprintf("Concurrency-%d", concurrency), func(b *testing.B) {
			client, err := ttb.NewTigerBeetleClient(uint128HL(0, 0), []string{"localhost:3000"})
			if err != nil {
				b.Fatalf("Failed to create client: %v", err)
			}
			defer client.Close()

			// Setup accounts
			debitAccount := uint128HL(uint64(concurrency), 1)
			creditAccount := uint128HL(uint64(concurrency), 2)
			
			client.CreateAccount(context.Background(), debitAccount, 1, 1)
			client.CreateAccount(context.Background(), creditAccount, 1, 2)

			b.ResetTimer()
			
			var wg sync.WaitGroup
			var successCount, failCount int64
			
			for i := 0; i < b.N; i++ {
				wg.Add(1)
				go func(idx int) {
					defer wg.Done()
					
					transferID := fmt.Sprintf("TXN-%d-%d", concurrency, idx)
					req := ttb.TransferRequest{
						TransferID:      transferID,
						DebitAccountID:  debitAccount,
						CreditAccountID: creditAccount,
						Amount:          1000,
						Ledger:          1,
						Code:            1,
						IsPending:       false,
					}
					
					_, err := client.CreateTransfer(context.Background(), req)
					if err != nil {
						atomic.AddInt64(&failCount, 1)
					} else {
						atomic.AddInt64(&successCount, 1)
					}
				}(i)
				
				if (i+1)%concurrency == 0 {
					wg.Wait()
				}
			}
			
			wg.Wait()
			
			b.ReportMetric(float64(successCount)/float64(b.N)*100, "success_rate_%")
			b.ReportMetric(float64(failCount), "failed_ops")
		})
	}
}

func BenchmarkThroughput(b *testing.B) {
	client, err := ttb.NewTigerBeetleClient(uint128HL(0, 0), []string{"localhost:3000"})
	if err != nil {
		b.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	// Setup accounts
	debitAccount := uint128HL(100, 1)
	creditAccount := uint128HL(100, 2)
	
	client.CreateAccount(context.Background(), debitAccount, 1, 1)
	client.CreateAccount(context.Background(), creditAccount, 1, 2)

	b.ResetTimer()
	
	start := time.Now()
	var opsCount int64
	
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			transferID := fmt.Sprintf("THROUGHPUT-%d", atomic.AddInt64(&opsCount, 1))
			req := ttb.TransferRequest{
				TransferID:      transferID,
				DebitAccountID:  debitAccount,
				CreditAccountID: creditAccount,
				Amount:          1000,
				Ledger:          1,
				Code:            1,
				IsPending:       false,
			}
			
			client.CreateTransfer(context.Background(), req)
		}
	})
	
	duration := time.Since(start)
	throughput := float64(opsCount) / duration.Seconds()
	
	b.ReportMetric(throughput, "ops/sec")
	b.ReportMetric(float64(duration.Microseconds())/float64(opsCount), "avg_latency_us")
}

func BenchmarkLatencyDistribution(b *testing.B) {
	client, err := ttb.NewTigerBeetleClient(uint128HL(0, 0), []string{"localhost:3000"})
	if err != nil {
		b.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	// Setup accounts
	debitAccount := uint128HL(200, 1)
	creditAccount := uint128HL(200, 2)
	
	client.CreateAccount(context.Background(), debitAccount, 1, 1)
	client.CreateAccount(context.Background(), creditAccount, 1, 2)

	latencies := make([]time.Duration, b.N)
	
	b.ResetTimer()
	
	for i := 0; i < b.N; i++ {
		start := time.Now()
		
		transferID := fmt.Sprintf("LATENCY-%d", i)
		req := ttb.TransferRequest{
			TransferID:      transferID,
			DebitAccountID:  debitAccount,
			CreditAccountID: creditAccount,
			Amount:          1000,
			Ledger:          1,
			Code:            1,
			IsPending:       false,
		}
		
		client.CreateTransfer(context.Background(), req)
		latencies[i] = time.Since(start)
	}
	
	// Calculate percentiles
	p50, p95, p99 := calculatePercentiles(latencies)
	
	b.ReportMetric(float64(p50.Microseconds()), "p50_latency_us")
	b.ReportMetric(float64(p95.Microseconds()), "p95_latency_us")
	b.ReportMetric(float64(p99.Microseconds()), "p99_latency_us")
}

func calculatePercentiles(latencies []time.Duration) (p50, p95, p99 time.Duration) {
	if len(latencies) == 0 {
		return 0, 0, 0
	}
	
	// Sort latencies
	sorted := make([]time.Duration, len(latencies))
	copy(sorted, latencies)
	
	// Simple bubble sort for small datasets
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[i] > sorted[j] {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	
	p50 = sorted[len(sorted)*50/100]
	p95 = sorted[len(sorted)*95/100]
	p99 = sorted[len(sorted)*99/100]
	
	return p50, p95, p99
}

func BenchmarkMemoryUsage(b *testing.B) {
	client, err := ttb.NewTigerBeetleClient(uint128HL(0, 0), []string{"localhost:3000"})
	if err != nil {
		b.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	// Setup accounts
	debitAccount := uint128HL(300, 1)
	creditAccount := uint128HL(300, 2)
	
	client.CreateAccount(context.Background(), debitAccount, 1, 1)
	client.CreateAccount(context.Background(), creditAccount, 1, 2)

	b.ResetTimer()
	b.ReportAllocs()
	
	for i := 0; i < b.N; i++ {
		transferID := fmt.Sprintf("MEMORY-%d", i)
		req := ttb.TransferRequest{
			TransferID:      transferID,
			DebitAccountID:  debitAccount,
			CreditAccountID: creditAccount,
			Amount:          1000,
			Ledger:          1,
			Code:            1,
			IsPending:       false,
		}
		
		client.CreateTransfer(context.Background(), req)
	}
}
