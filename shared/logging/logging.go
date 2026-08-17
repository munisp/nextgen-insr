package logging

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"runtime"
	"sync"
	"time"
)

// Level represents the log level
type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
	LevelFatal
)

func (l Level) String() string {
	switch l {
	case LevelDebug:
		return "DEBUG"
	case LevelInfo:
		return "INFO"
	case LevelWarn:
		return "WARN"
	case LevelError:
		return "ERROR"
	case LevelFatal:
		return "FATAL"
	default:
		return "UNKNOWN"
	}
}

// ParseLevel parses a log level string
func ParseLevel(s string) Level {
	switch s {
	case "debug", "DEBUG":
		return LevelDebug
	case "info", "INFO":
		return LevelInfo
	case "warn", "WARN", "warning", "WARNING":
		return LevelWarn
	case "error", "ERROR":
		return LevelError
	case "fatal", "FATAL":
		return LevelFatal
	default:
		return LevelInfo
	}
}

// Fields represents log fields
type Fields map[string]interface{}

// LogEntry represents a single log entry
type LogEntry struct {
	Timestamp time.Time              `json:"timestamp"`
	Level     string                 `json:"level"`
	Message   string                 `json:"message"`
	Service   string                 `json:"service,omitempty"`
	TraceID   string                 `json:"trace_id,omitempty"`
	SpanID    string                 `json:"span_id,omitempty"`
	Caller    string                 `json:"caller,omitempty"`
	Fields    map[string]interface{} `json:"fields,omitempty"`
}

// Logger is the main logger interface
type Logger interface {
	Debug(msg string, fields ...Fields)
	Info(msg string, fields ...Fields)
	Warn(msg string, fields ...Fields)
	Error(msg string, fields ...Fields)
	Fatal(msg string, fields ...Fields)
	WithFields(fields Fields) Logger
	WithContext(ctx context.Context) Logger
}

// JSONLogger implements Logger with JSON output
type JSONLogger struct {
	output      io.Writer
	level       Level
	serviceName string
	fields      Fields
	traceID     string
	spanID      string
	mu          sync.Mutex
}

// NewLogger creates a new JSON logger
func NewLogger(serviceName string, level Level) *JSONLogger {
	return &JSONLogger{
		output:      os.Stdout,
		level:       level,
		serviceName: serviceName,
		fields:      make(Fields),
	}
}

// NewLoggerFromEnv creates a logger from environment variables
func NewLoggerFromEnv(serviceName string) *JSONLogger {
	level := ParseLevel(os.Getenv("LOG_LEVEL"))
	return NewLogger(serviceName, level)
}

// SetOutput sets the output writer
func (l *JSONLogger) SetOutput(w io.Writer) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.output = w
}

// SetLevel sets the log level
func (l *JSONLogger) SetLevel(level Level) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.level = level
}

func (l *JSONLogger) log(level Level, msg string, fields ...Fields) {
	if level < l.level {
		return
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	entry := LogEntry{
		Timestamp: time.Now().UTC(),
		Level:     level.String(),
		Message:   msg,
		Service:   l.serviceName,
		TraceID:   l.traceID,
		SpanID:    l.spanID,
		Caller:    getCaller(3),
		Fields:    make(map[string]interface{}),
	}

	// Merge base fields
	for k, v := range l.fields {
		entry.Fields[k] = v
	}

	// Merge additional fields
	for _, f := range fields {
		for k, v := range f {
			entry.Fields[k] = v
		}
	}

	if len(entry.Fields) == 0 {
		entry.Fields = nil
	}

	data, err := json.Marshal(entry)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to marshal log entry: %v\n", err)
		return
	}

	_, _ = l.output.Write(append(data, '\n'))

	if level == LevelFatal {
		os.Exit(1)
	}
}

func (l *JSONLogger) Debug(msg string, fields ...Fields) {
	l.log(LevelDebug, msg, fields...)
}

func (l *JSONLogger) Info(msg string, fields ...Fields) {
	l.log(LevelInfo, msg, fields...)
}

func (l *JSONLogger) Warn(msg string, fields ...Fields) {
	l.log(LevelWarn, msg, fields...)
}

func (l *JSONLogger) Error(msg string, fields ...Fields) {
	l.log(LevelError, msg, fields...)
}

func (l *JSONLogger) Fatal(msg string, fields ...Fields) {
	l.log(LevelFatal, msg, fields...)
}

func (l *JSONLogger) WithFields(fields Fields) Logger {
	newLogger := &JSONLogger{
		output:      l.output,
		level:       l.level,
		serviceName: l.serviceName,
		fields:      make(Fields),
		traceID:     l.traceID,
		spanID:      l.spanID,
	}

	for k, v := range l.fields {
		newLogger.fields[k] = v
	}
	for k, v := range fields {
		newLogger.fields[k] = v
	}

	return newLogger
}

func (l *JSONLogger) WithContext(ctx context.Context) Logger {
	newLogger := &JSONLogger{
		output:      l.output,
		level:       l.level,
		serviceName: l.serviceName,
		fields:      make(Fields),
	}

	for k, v := range l.fields {
		newLogger.fields[k] = v
	}

	// Extract trace context if available
	if traceID, ok := ctx.Value("trace_id").(string); ok {
		newLogger.traceID = traceID
	}
	if spanID, ok := ctx.Value("span_id").(string); ok {
		newLogger.spanID = spanID
	}

	return newLogger
}

func getCaller(skip int) string {
	_, file, line, ok := runtime.Caller(skip)
	if !ok {
		return "unknown"
	}
	// Get just the filename, not the full path
	short := file
	for i := len(file) - 1; i > 0; i-- {
		if file[i] == '/' {
			short = file[i+1:]
			break
		}
	}
	return fmt.Sprintf("%s:%d", short, line)
}

// Global logger instance
var defaultLogger Logger = NewLogger("app", LevelInfo)

// SetDefaultLogger sets the default logger
func SetDefaultLogger(logger Logger) {
	defaultLogger = logger
}

// GetDefaultLogger returns the default logger
func GetDefaultLogger() Logger {
	return defaultLogger
}

// Package-level logging functions
func Debug(msg string, fields ...Fields) {
	defaultLogger.Debug(msg, fields...)
}

func Info(msg string, fields ...Fields) {
	defaultLogger.Info(msg, fields...)
}

func Warn(msg string, fields ...Fields) {
	defaultLogger.Warn(msg, fields...)
}

func Error(msg string, fields ...Fields) {
	defaultLogger.Error(msg, fields...)
}

func Fatal(msg string, fields ...Fields) {
	defaultLogger.Fatal(msg, fields...)
}

// RequestLogger creates a logger for HTTP requests
func RequestLogger(logger Logger, method, path, requestID string) Logger {
	return logger.WithFields(Fields{
		"method":     method,
		"path":       path,
		"request_id": requestID,
	})
}

// ErrorWithStack logs an error with stack trace
func ErrorWithStack(logger Logger, msg string, err error) {
	buf := make([]byte, 4096)
	n := runtime.Stack(buf, false)
	logger.Error(msg, Fields{
		"error": err.Error(),
		"stack": string(buf[:n]),
	})
}

// AuditLog creates an audit log entry
func AuditLog(logger Logger, action, userID, resourceType, resourceID string, details Fields) {
	fields := Fields{
		"audit":         true,
		"action":        action,
		"user_id":       userID,
		"resource_type": resourceType,
		"resource_id":   resourceID,
	}
	for k, v := range details {
		fields[k] = v
	}
	logger.Info("audit_event", fields)
}

// MetricLog creates a metric log entry
func MetricLog(logger Logger, metric string, value float64, tags Fields) {
	fields := Fields{
		"metric": true,
		"name":   metric,
		"value":  value,
	}
	for k, v := range tags {
		fields[k] = v
	}
	logger.Info("metric", fields)
}
