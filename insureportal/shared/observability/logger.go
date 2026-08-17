package observability

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

type Logger struct {
	service  string
	osClient *OpenSearchClient
	index    string
}

func NewLogger(service string) *Logger {
	return &Logger{
		service:  service,
		osClient: NewOpenSearchClient(),
		index:    fmt.Sprintf("logs-%s", service),
	}
}

func (l *Logger) log(level, msg string, fields map[string]interface{}) {
	entry := map[string]interface{}{
		"@timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"level":      level,
		"service":    l.service,
		"message":    msg,
	}
	for k, v := range fields {
		entry[k] = v
	}
	data, _ := json.Marshal(entry)
	_, _ = fmt.Fprintln(os.Stdout, string(data))

	// async send to opensearch (best-effort)
	go func() {
		logEntry := LogEntry{
			Timestamp: time.Now(),
			Level:     level,
			Service:   l.service,
			Message:   msg,
			Fields:    fields,
		}
		_ = l.osClient.IndexLog(context.Background(), l.index, logEntry)
	}()
}

func (l *Logger) Info(msg string, fields ...map[string]interface{}) {
	f := mergeFields(fields)
	l.log("info", msg, f)
}

func (l *Logger) Warn(msg string, fields ...map[string]interface{}) {
	f := mergeFields(fields)
	l.log("warn", msg, f)
}

func (l *Logger) Error(msg string, fields ...map[string]interface{}) {
	f := mergeFields(fields)
	l.log("error", msg, f)
}

func mergeFields(fields []map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{})
	for _, f := range fields {
		for k, v := range f {
			result[k] = v
		}
	}
	return result
}
