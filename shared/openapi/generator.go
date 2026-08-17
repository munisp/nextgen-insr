package openapi

import (
	"encoding/json"
	"net/http"
)

// Spec represents a minimal OpenAPI 3.0 specification
type Spec struct {
	OpenAPI    string              `json:"openapi"`
	Info       Info                `json:"info"`
	Servers    []Server            `json:"servers,omitempty"`
	Paths      map[string]PathItem `json:"paths"`
	Components *Components         `json:"components,omitempty"`
}

// Info holds API metadata
type Info struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Version     string `json:"version"`
}

// Server describes an API server
type Server struct {
	URL         string `json:"url"`
	Description string `json:"description,omitempty"`
}

// PathItem describes operations on a single path
type PathItem struct {
	Get    *Operation `json:"get,omitempty"`
	Post   *Operation `json:"post,omitempty"`
	Put    *Operation `json:"put,omitempty"`
	Delete *Operation `json:"delete,omitempty"`
	Patch  *Operation `json:"patch,omitempty"`
}

// Operation describes a single API operation
type Operation struct {
	Summary     string              `json:"summary"`
	Description string              `json:"description,omitempty"`
	OperationID string              `json:"operationId"`
	Tags        []string            `json:"tags,omitempty"`
	Parameters  []Parameter         `json:"parameters,omitempty"`
	RequestBody *RequestBody        `json:"requestBody,omitempty"`
	Responses   map[string]Response `json:"responses"`
}

// Parameter describes an operation parameter
type Parameter struct {
	Name        string `json:"name"`
	In          string `json:"in"`
	Description string `json:"description,omitempty"`
	Required    bool   `json:"required"`
	Schema      Schema `json:"schema"`
}

// RequestBody describes a request body
type RequestBody struct {
	Description string             `json:"description,omitempty"`
	Required    bool               `json:"required"`
	Content     map[string]Content `json:"content"`
}

// Content describes media type content
type Content struct {
	Schema Schema `json:"schema"`
}

// Response describes an operation response
type Response struct {
	Description string             `json:"description"`
	Content     map[string]Content `json:"content,omitempty"`
}

// Schema describes a data type
type Schema struct {
	Type       string            `json:"type,omitempty"`
	Format     string            `json:"format,omitempty"`
	Ref        string            `json:"$ref,omitempty"`
	Properties map[string]Schema `json:"properties,omitempty"`
	Items      *Schema           `json:"items,omitempty"`
	Required   []string          `json:"required,omitempty"`
	Enum       []string          `json:"enum,omitempty"`
}

// Components holds reusable schema definitions
type Components struct {
	Schemas         map[string]Schema         `json:"schemas,omitempty"`
	SecuritySchemes map[string]SecurityScheme `json:"securitySchemes,omitempty"`
}

// SecurityScheme describes an auth mechanism
type SecurityScheme struct {
	Type         string `json:"type"`
	Scheme       string `json:"scheme,omitempty"`
	BearerFormat string `json:"bearerFormat,omitempty"`
	Name         string `json:"name,omitempty"`
	In           string `json:"in,omitempty"`
}

// NewSpec creates a new OpenAPI spec
func NewSpec(title, description, version string) *Spec {
	return &Spec{
		OpenAPI: "3.0.3",
		Info: Info{
			Title:       title,
			Description: description,
			Version:     version,
		},
		Paths: make(map[string]PathItem),
		Components: &Components{
			Schemas: map[string]Schema{
				"Error": {
					Type: "object",
					Properties: map[string]Schema{
						"error": {
							Type: "object",
							Properties: map[string]Schema{
								"code":    {Type: "string"},
								"message": {Type: "string"},
							},
						},
					},
				},
			},
			SecuritySchemes: map[string]SecurityScheme{
				"bearerAuth": {
					Type:         "http",
					Scheme:       "bearer",
					BearerFormat: "JWT",
				},
				"apiKey": {
					Type: "apiKey",
					Name: "X-API-Key",
					In:   "header",
				},
			},
		},
	}
}

// ServeSpec returns an HTTP handler that serves the spec as JSON
func ServeSpec(spec *Spec) http.HandlerFunc {
	data, _ := json.MarshalIndent(spec, "", "  ")
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(data)
	}
}
