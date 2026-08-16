module github.com/munisp/NGApp/performance-benchmarks

go 1.22.0

require (
	github.com/google/uuid v1.6.0
	github.com/gorilla/mux v1.8.1
	gorm.io/driver/postgres v1.5.7
	gorm.io/gorm v1.25.10
)

require (
	github.com/munisp/nextgen-insr/bidirectional-integrations v0.0.0
	github.com/tigerbeetle/tigerbeetle-go v0.17.9
)

replace github.com/munisp/nextgen-insr/bidirectional-integrations => ../bidirectional-integrations
