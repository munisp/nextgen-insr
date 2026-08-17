package errors

import (
	"encoding/json"
	"net/http"
)

// StandardErrorResponse is the platform-wide error response format.
// All services MUST return errors in this shape.
//
//	{
//	  "error": {
//	    "code": "VALIDATION_ERROR",
//	    "message": "customer_id is required",
//	    "details": [{"field": "customer_id", "reason": "required"}]
//	  }
//	}
type StandardErrorResponse struct {
	Error ErrorBody `json:"error"`
}

// ErrorBody holds the error details
type ErrorBody struct {
	Code    string        `json:"code"`
	Message string        `json:"message"`
	Details []ErrorDetail `json:"details,omitempty"`
}

// ErrorDetail holds field-level error detail
type ErrorDetail struct {
	Field  string `json:"field,omitempty"`
	Reason string `json:"reason"`
}

// WriteError writes a standardized error response
func WriteError(w http.ResponseWriter, status int, code, message string, details ...ErrorDetail) {
	resp := StandardErrorResponse{
		Error: ErrorBody{
			Code:    code,
			Message: message,
			Details: details,
		},
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(resp)
}

// WriteBadRequest writes a 400 error
func WriteBadRequest(w http.ResponseWriter, message string, details ...ErrorDetail) {
	WriteError(w, http.StatusBadRequest, "BAD_REQUEST", message, details...)
}

// WriteNotFound writes a 404 error
func WriteNotFound(w http.ResponseWriter, resource string) {
	WriteError(w, http.StatusNotFound, "NOT_FOUND", resource+" not found")
}

// WriteValidationError writes a 422 validation error
func WriteValidationError(w http.ResponseWriter, details ...ErrorDetail) {
	WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Validation failed", details...)
}

// WriteInternalError writes a 500 error
func WriteInternalError(w http.ResponseWriter) {
	WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred")
}

// WriteUnauthorized writes a 401 error
func WriteUnauthorized(w http.ResponseWriter, message string) {
	WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", message)
}

// WriteForbidden writes a 403 error
func WriteForbidden(w http.ResponseWriter, message string) {
	WriteError(w, http.StatusForbidden, "FORBIDDEN", message)
}

// WriteConflict writes a 409 error
func WriteConflict(w http.ResponseWriter, message string) {
	WriteError(w, http.StatusConflict, "CONFLICT", message)
}

// WriteTooManyRequests writes a 429 error
func WriteTooManyRequests(w http.ResponseWriter) {
	WriteError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests, please try again later")
}

func formatDetail(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	case error:
		return val.Error()
	default:
		data, _ := json.Marshal(v)
		return string(data)
	}
}
