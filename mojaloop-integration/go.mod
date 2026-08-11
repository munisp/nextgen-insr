module github.com/munisp/NGApp/mojaloop-integration

go 1.25.0

require (
	github.com/google/uuid v1.6.0
	github.com/lib/pq v1.10.9
	github.com/segmentio/kafka-go v0.4.51
	github.com/tigerbeetle/tigerbeetle-go v0.15.3
	gorm.io/gorm v1.25.10
)

require (
	github.com/jinzhu/inflection v1.0.0 // indirect
	github.com/jinzhu/now v1.1.5 // indirect
	github.com/klauspost/compress v1.17.4 // indirect
	github.com/pierrec/lz4/v4 v4.1.19 // indirect
)

require nextgen-insr/tigerbeetle-implementation v0.0.0-00010101000000-000000000000

replace nextgen-insr/tigerbeetle-implementation => ../tigerbeetle-implementation
