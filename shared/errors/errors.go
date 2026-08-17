package errors

import (
	"encoding/json"
	"net/http"
)

type ErrorCode string

const (
	ErrInvalidInput   ErrorCode = "INVALID_INPUT"
	ErrUnauthorized   ErrorCode = "UNAUTHORIZED"
	ErrForbidden      ErrorCode = "FORBIDDEN"
	ErrNotFound       ErrorCode = "NOT_FOUND"
	ErrConflict       ErrorCode = "CONFLICT"
	ErrInternal       ErrorCode = "INTERNAL_ERROR"
	ErrServiceUnavail ErrorCode = "SERVICE_UNAVAILABLE"
	ErrRateLimited    ErrorCode = "RATE_LIMITED"
)

type APIError struct {
	Code    ErrorCode   `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details,omitempty"`
}

type ErrorResponse struct {
	Error APIError `json:"error"`
}

func Respond(w http.ResponseWriter, status int, code ErrorCode, message string, details ...interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	resp := ErrorResponse{
		Error: APIError{
			Code:    code,
			Message: message,
		},
	}
	if len(details) > 0 {
		resp.Error.Details = details[0]
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func BadRequest(w http.ResponseWriter, msg string) {
	Respond(w, http.StatusBadRequest, ErrInvalidInput, msg)
}

func Unauthorized(w http.ResponseWriter, msg string) {
	Respond(w, http.StatusUnauthorized, ErrUnauthorized, msg)
}

func Forbidden(w http.ResponseWriter, msg string) {
	Respond(w, http.StatusForbidden, ErrForbidden, msg)
}

func NotFound(w http.ResponseWriter, msg string) {
	Respond(w, http.StatusNotFound, ErrNotFound, msg)
}

func Conflict(w http.ResponseWriter, msg string) {
	Respond(w, http.StatusConflict, ErrConflict, msg)
}

func Internal(w http.ResponseWriter, msg string) {
	Respond(w, http.StatusInternalServerError, ErrInternal, msg)
}

func RespondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
