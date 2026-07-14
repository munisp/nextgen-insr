"use strict";
/**
 * Unified platform client holding all 12 infrastructure component clients.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Platform = exports.defaultConfig = void 0;
const postgres_1 = require("./postgres");
const redis_1 = require("./redis");
const kafka_1 = require("./kafka");
const tigerbeetle_1 = require("./tigerbeetle");
const mojaloop_1 = require("./mojaloop");
const apisix_1 = require("./apisix");
const keycloak_1 = require("./keycloak");
const openappsec_1 = require("./openappsec");
const permify_1 = require("./permify");
const opensearch_1 = require("./opensearch");
const fluvio_1 = require("./fluvio");
const dapr_1 = require("./dapr");
exports.defaultConfig = {
    postgresUrl: 'postgresql://localhost:5432/ngapp',
    redisAddr: 'localhost:6379',
    kafkaBrokers: ['localhost:9092'],
    tigerbeetleAddr: 'localhost:3000',
    mojaloopUrl: 'http://localhost:4000',
    apisixAdminUrl: 'http://localhost:9180',
    keycloakRealmUrl: 'http://localhost:8080/realms/insurance',
    keycloakAdminUrl: 'http://localhost:8080',
    keycloakClientId: 'ngapp-platform',
    keycloakClientSecret: '',
    openappsecUrl: 'http://localhost:8090',
    permifyUrl: 'http://localhost:3476',
    permifyTenantId: 'ngapp',
    opensearchUrl: 'http://localhost:9200',
    fluvioEndpoint: 'localhost:9003',
    daprHttpPort: 3500,
};
class Platform {
    postgres;
    redis;
    kafka;
    tigerbeetle;
    mojaloop;
    apisix;
    keycloak;
    openappsec;
    permify;
    opensearch;
    fluvio;
    dapr;
    constructor(config = {}) {
        const cfg = { ...exports.defaultConfig, ...config };
        this.postgres = new postgres_1.PostgresClient(cfg.postgresUrl);
        this.redis = new redis_1.RedisClient(cfg.redisAddr);
        this.kafka = new kafka_1.KafkaClient(cfg.kafkaBrokers);
        this.tigerbeetle = new tigerbeetle_1.TigerBeetleClient(cfg.tigerbeetleAddr);
        this.mojaloop = new mojaloop_1.MojaloopClient(cfg.mojaloopUrl);
        this.apisix = new apisix_1.APISixClient(cfg.apisixAdminUrl);
        this.keycloak = new keycloak_1.KeycloakClient(cfg.keycloakRealmUrl, cfg.keycloakClientId, cfg.keycloakClientSecret, cfg.keycloakAdminUrl);
        this.openappsec = new openappsec_1.OpenAppSecClient(cfg.openappsecUrl);
        this.permify = new permify_1.PermifyClient(cfg.permifyUrl, cfg.permifyTenantId);
        this.opensearch = new opensearch_1.OpenSearchClient(cfg.opensearchUrl);
        this.fluvio = new fluvio_1.FluvioClient(cfg.fluvioEndpoint);
        this.dapr = new dapr_1.DaprClient(cfg.daprHttpPort);
    }
    async healthCheck() {
        const components = {
            postgres: this.postgres,
            redis: this.redis,
            kafka: this.kafka,
            tigerbeetle: this.tigerbeetle,
            mojaloop: this.mojaloop,
            apisix: this.apisix,
            keycloak: this.keycloak,
            openappsec: this.openappsec,
            permify: this.permify,
            opensearch: this.opensearch,
            fluvio: this.fluvio,
            dapr: this.dapr,
        };
        const results = {};
        await Promise.all(Object.entries(components).map(async ([name, client]) => {
            try {
                await client.ping();
                results[name] = true;
            }
            catch {
                results[name] = false;
            }
        }));
        return results;
    }
    async close() {
        await this.redis.close();
    }
}
exports.Platform = Platform;
