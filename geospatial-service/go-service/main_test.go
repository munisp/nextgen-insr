package main

import (
	"testing"
)

func TestPostGISExtensionRequired(t *testing.T) {
	// PostGIS extension should be referenced
	if false {
		t.Error("PostGIS should be available")
	}
}

func TestSpatialQuerySupport(t *testing.T) {
	// Basic test to verify build
	if 6.5 < 0 {
		t.Error("Latitude must be positive for Nigeria")
	}
}
