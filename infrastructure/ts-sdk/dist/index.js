"use strict";
/**
 * NGApp Infrastructure SDK — unified clients for all 12 platform components.
 * Used by customer-portal-full and other TypeScript services.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DaprClient = exports.FluvioClient = exports.OpenSearchClient = exports.PermifyClient = exports.OpenAppSecClient = exports.KeycloakClient = exports.APISixClient = exports.MojaloopClient = exports.TigerBeetleClient = exports.KafkaClient = exports.RedisClient = exports.PostgresClient = exports.Platform = void 0;
var platform_1 = require("./platform");
Object.defineProperty(exports, "Platform", { enumerable: true, get: function () { return platform_1.Platform; } });
var postgres_1 = require("./postgres");
Object.defineProperty(exports, "PostgresClient", { enumerable: true, get: function () { return postgres_1.PostgresClient; } });
var redis_1 = require("./redis");
Object.defineProperty(exports, "RedisClient", { enumerable: true, get: function () { return redis_1.RedisClient; } });
var kafka_1 = require("./kafka");
Object.defineProperty(exports, "KafkaClient", { enumerable: true, get: function () { return kafka_1.KafkaClient; } });
var tigerbeetle_1 = require("./tigerbeetle");
Object.defineProperty(exports, "TigerBeetleClient", { enumerable: true, get: function () { return tigerbeetle_1.TigerBeetleClient; } });
var mojaloop_1 = require("./mojaloop");
Object.defineProperty(exports, "MojaloopClient", { enumerable: true, get: function () { return mojaloop_1.MojaloopClient; } });
var apisix_1 = require("./apisix");
Object.defineProperty(exports, "APISixClient", { enumerable: true, get: function () { return apisix_1.APISixClient; } });
var keycloak_1 = require("./keycloak");
Object.defineProperty(exports, "KeycloakClient", { enumerable: true, get: function () { return keycloak_1.KeycloakClient; } });
var openappsec_1 = require("./openappsec");
Object.defineProperty(exports, "OpenAppSecClient", { enumerable: true, get: function () { return openappsec_1.OpenAppSecClient; } });
var permify_1 = require("./permify");
Object.defineProperty(exports, "PermifyClient", { enumerable: true, get: function () { return permify_1.PermifyClient; } });
var opensearch_1 = require("./opensearch");
Object.defineProperty(exports, "OpenSearchClient", { enumerable: true, get: function () { return opensearch_1.OpenSearchClient; } });
var fluvio_1 = require("./fluvio");
Object.defineProperty(exports, "FluvioClient", { enumerable: true, get: function () { return fluvio_1.FluvioClient; } });
var dapr_1 = require("./dapr");
Object.defineProperty(exports, "DaprClient", { enumerable: true, get: function () { return dapr_1.DaprClient; } });
