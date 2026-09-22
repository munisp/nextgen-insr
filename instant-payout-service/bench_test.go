package main

// bench_test.go — 2026-09-19 perf (P-wave): benchmarks for the cache path.
// Uses an in-process mini RESP server (no external Redis needed) so the
// benchmark exercises the real go-redis client: connection pooling, RESP
// encode/decode and network syscalls over loopback TCP.

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// miniRedis is a tiny RESP2 server supporting GET/SET/DEL/INCR/PING — just
// enough for go-redis cache-path benchmarks.
type miniRedis struct {
	ln net.Listener
	mu sync.Mutex
	kv map[string]string
	n  map[string]int64
}

func newMiniRedis(t testing.TB) *miniRedis {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("mini redis listen: %v", err)
	}
	m := &miniRedis{ln: ln, kv: map[string]string{}, n: map[string]int64{}}
	go m.serve()
	t.Cleanup(func() { _ = ln.Close() })
	return m
}

func (m *miniRedis) addr() string { return m.ln.Addr().String() }

func (m *miniRedis) serve() {
	for {
		conn, err := m.ln.Accept()
		if err != nil {
			return
		}
		go m.handle(conn)
	}
}

func readRESPArgs(r *bufio.Reader) ([]string, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return nil, err
	}
	line = strings.TrimRight(line, "\r\n")
	if !strings.HasPrefix(line, "*") {
		return nil, fmt.Errorf("expected array, got %q", line)
	}
	n, _ := strconv.Atoi(line[1:])
	args := make([]string, 0, n)
	for i := 0; i < n; i++ {
		hdr, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		hdr = strings.TrimRight(hdr, "\r\n")
		if !strings.HasPrefix(hdr, "$") {
			return nil, fmt.Errorf("expected bulk, got %q", hdr)
		}
		l, _ := strconv.Atoi(hdr[1:])
		buf := make([]byte, l+2)
		if _, err := io.ReadFull(r, buf); err != nil {
			return nil, err
		}
		args = append(args, string(buf[:l]))
	}
	return args, nil
}

func (m *miniRedis) handle(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	r := bufio.NewReader(conn)
	for {
		args, err := readRESPArgs(r)
		if err != nil {
			return
		}
		if len(args) == 0 {
			continue
		}
		cmd := strings.ToUpper(args[0])
		m.mu.Lock()
		switch cmd {
		case "PING":
			_, _ = conn.Write([]byte("+PONG\r\n"))
		case "SET", "SETEX":
			m.kv[args[1]] = args[len(args)-1]
			_, _ = conn.Write([]byte("+OK\r\n"))
		case "GET":
			if v, ok := m.kv[args[1]]; ok {
				_, _ = fmt.Fprintf(conn, "$%d\r\n%s\r\n", len(v), v)
			} else {
				_, _ = conn.Write([]byte("$-1\r\n"))
			}
		case "DEL":
			var d int64
			for _, k := range args[1:] {
				if _, ok := m.kv[k]; ok {
					delete(m.kv, k)
					d++
				}
			}
			_, _ = fmt.Fprintf(conn, ":%d\r\n", d)
		case "INCR":
			m.n[args[1]]++
			_, _ = fmt.Fprintf(conn, ":%d\r\n", m.n[args[1]])
		default:
			_, _ = conn.Write([]byte("-ERR unknown command\r\n"))
		}
		m.mu.Unlock()
	}
}

// BenchmarkCacheGetHit measures the pooled go-redis cache-read path.
func BenchmarkCacheGetHit(b *testing.B) {
	mr := newMiniRedis(b)
	rc := newRedisCache(mr.addr(), "")
	rc.CacheSet("bench:key", strings.Repeat("x", 2048), 0)
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			if _, ok := rc.CacheGet("bench:key"); !ok {
				b.Fatal("expected cache hit")
			}
		}
	})
}

// BenchmarkCacheSet measures the pooled cache-write path.
func BenchmarkCacheSet(b *testing.B) {
	mr := newMiniRedis(b)
	rc := newRedisCache(mr.addr(), "")
	val := strings.Repeat("y", 512)
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			rc.CacheSet(fmt.Sprintf("bench:k%d", i%1024), val, 0)
			i++
		}
	})
}
