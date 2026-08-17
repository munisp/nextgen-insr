package testing

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestSuite provides common testing utilities
type TestSuite struct {
	T       *testing.T
	Context context.Context
	Cancel  context.CancelFunc
}

// NewTestSuite creates a new test suite
func NewTestSuite(t *testing.T) *TestSuite {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	return &TestSuite{
		T:       t,
		Context: ctx,
		Cancel:  cancel,
	}
}

// Cleanup cleans up test resources
func (s *TestSuite) Cleanup() {
	s.Cancel()
}

// AssertEqual asserts that two values are equal
func (s *TestSuite) AssertEqual(expected, actual interface{}, msg string) {
	s.T.Helper()
	if expected != actual {
		s.T.Errorf("%s: expected %v, got %v", msg, expected, actual)
	}
}

// AssertNotNil asserts that a value is not nil
func (s *TestSuite) AssertNotNil(value interface{}, msg string) {
	s.T.Helper()
	if value == nil {
		s.T.Errorf("%s: expected non-nil value", msg)
	}
}

// AssertNil asserts that a value is nil
func (s *TestSuite) AssertNil(value interface{}, msg string) {
	s.T.Helper()
	if value != nil {
		s.T.Errorf("%s: expected nil, got %v", msg, value)
	}
}

// AssertNoError asserts that an error is nil
func (s *TestSuite) AssertNoError(err error, msg string) {
	s.T.Helper()
	if err != nil {
		s.T.Errorf("%s: unexpected error: %v", msg, err)
	}
}

// AssertError asserts that an error is not nil
func (s *TestSuite) AssertError(err error, msg string) {
	s.T.Helper()
	if err == nil {
		s.T.Errorf("%s: expected error, got nil", msg)
	}
}

// AssertTrue asserts that a condition is true
func (s *TestSuite) AssertTrue(condition bool, msg string) {
	s.T.Helper()
	if !condition {
		s.T.Errorf("%s: expected true", msg)
	}
}

// AssertFalse asserts that a condition is false
func (s *TestSuite) AssertFalse(condition bool, msg string) {
	s.T.Helper()
	if condition {
		s.T.Errorf("%s: expected false", msg)
	}
}

// HTTPTestClient provides HTTP testing utilities
type HTTPTestClient struct {
	Handler http.Handler
	BaseURL string
}

// NewHTTPTestClient creates a new HTTP test client
func NewHTTPTestClient(handler http.Handler) *HTTPTestClient {
	return &HTTPTestClient{
		Handler: handler,
	}
}

// Request represents an HTTP test request
type Request struct {
	Method  string
	Path    string
	Body    interface{}
	Headers map[string]string
}

// Response represents an HTTP test response
type Response struct {
	StatusCode int
	Body       []byte
	Headers    http.Header
}

// Do performs an HTTP request
func (c *HTTPTestClient) Do(req Request) (*Response, error) {
	var body io.Reader
	if req.Body != nil {
		data, err := json.Marshal(req.Body)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(data)
	}

	httpReq := httptest.NewRequest(req.Method, req.Path, body)
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}
	if req.Body != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}

	rec := httptest.NewRecorder()
	c.Handler.ServeHTTP(rec, httpReq)

	return &Response{
		StatusCode: rec.Code,
		Body:       rec.Body.Bytes(),
		Headers:    rec.Header(),
	}, nil
}

// Get performs a GET request
func (c *HTTPTestClient) Get(path string, headers map[string]string) (*Response, error) {
	return c.Do(Request{
		Method:  "GET",
		Path:    path,
		Headers: headers,
	})
}

// Post performs a POST request
func (c *HTTPTestClient) Post(path string, body interface{}, headers map[string]string) (*Response, error) {
	return c.Do(Request{
		Method:  "POST",
		Path:    path,
		Body:    body,
		Headers: headers,
	})
}

// Put performs a PUT request
func (c *HTTPTestClient) Put(path string, body interface{}, headers map[string]string) (*Response, error) {
	return c.Do(Request{
		Method:  "PUT",
		Path:    path,
		Body:    body,
		Headers: headers,
	})
}

// Delete performs a DELETE request
func (c *HTTPTestClient) Delete(path string, headers map[string]string) (*Response, error) {
	return c.Do(Request{
		Method:  "DELETE",
		Path:    path,
		Headers: headers,
	})
}

// DecodeJSON decodes the response body as JSON
func (r *Response) DecodeJSON(v interface{}) error {
	return json.Unmarshal(r.Body, v)
}

// MockService provides a mock HTTP service
type MockService struct {
	Server   *httptest.Server
	Requests []Request
	Response *Response
}

// NewMockService creates a new mock service
func NewMockService(statusCode int, body interface{}) *MockService {
	mock := &MockService{
		Requests: make([]Request, 0),
	}

	responseBody, _ := json.Marshal(body)
	mock.Response = &Response{
		StatusCode: statusCode,
		Body:       responseBody,
	}

	mock.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mock.Requests = append(mock.Requests, Request{
			Method: r.Method,
			Path:   r.URL.Path,
			Body:   string(body),
		})

		w.WriteHeader(mock.Response.StatusCode)
		_, _ = w.Write(mock.Response.Body)
	}))

	return mock
}

// Close closes the mock server
func (m *MockService) Close() {
	m.Server.Close()
}

// URL returns the mock server URL
func (m *MockService) URL() string {
	return m.Server.URL
}

// AssertRequestCount asserts the number of requests received
func (m *MockService) AssertRequestCount(t *testing.T, expected int) {
	t.Helper()
	if len(m.Requests) != expected {
		t.Errorf("expected %d requests, got %d", expected, len(m.Requests))
	}
}

// TestDatabase provides database testing utilities
type TestDatabase struct {
	ConnectionString string
	CleanupFuncs     []func()
}

// NewTestDatabase creates a new test database connection
func NewTestDatabase(connectionString string) *TestDatabase {
	return &TestDatabase{
		ConnectionString: connectionString,
		CleanupFuncs:     make([]func(), 0),
	}
}

// AddCleanup adds a cleanup function
func (d *TestDatabase) AddCleanup(fn func()) {
	d.CleanupFuncs = append(d.CleanupFuncs, fn)
}

// Cleanup runs all cleanup functions
func (d *TestDatabase) Cleanup() {
	for i := len(d.CleanupFuncs) - 1; i >= 0; i-- {
		d.CleanupFuncs[i]()
	}
}

// TableTest represents a table-driven test case
type TableTest[T any, R any] struct {
	Name     string
	Input    T
	Expected R
	WantErr  bool
}

// RunTableTests runs table-driven tests
func RunTableTests[T any, R any](t *testing.T, tests []TableTest[T, R], fn func(T) (R, error)) {
	for _, tt := range tests {
		t.Run(tt.Name, func(t *testing.T) {
			result, err := fn(tt.Input)
			if (err != nil) != tt.WantErr {
				t.Errorf("error = %v, wantErr %v", err, tt.WantErr)
				return
			}
			if !tt.WantErr {
				// Compare results - this is a simplified comparison
				expectedJSON, _ := json.Marshal(tt.Expected)
				resultJSON, _ := json.Marshal(result)
				if string(expectedJSON) != string(resultJSON) {
					t.Errorf("got %v, want %v", result, tt.Expected)
				}
			}
		})
	}
}

// Benchmark provides benchmarking utilities
type Benchmark struct {
	B *testing.B
}

// NewBenchmark creates a new benchmark
func NewBenchmark(b *testing.B) *Benchmark {
	return &Benchmark{B: b}
}

// Run runs a benchmark
func (b *Benchmark) Run(name string, fn func()) {
	b.B.Run(name, func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			fn()
		}
	})
}

// RunParallel runs a parallel benchmark
func (b *Benchmark) RunParallel(name string, fn func()) {
	b.B.Run(name, func(b *testing.B) {
		b.RunParallel(func(pb *testing.PB) {
			for pb.Next() {
				fn()
			}
		})
	})
}
