/**
 * NGApp Infrastructure SDK — unified clients for all 12 platform components.
 * Used by TypeScript services across the platform.
 * (2026-10-03, W7-B11: customer-portal-full retired — dropped stale mention.)
 */

export { Platform, PlatformConfig } from './platform';
export { PostgresClient } from './postgres';
export { RedisClient } from './redis';
export { KafkaClient } from './kafka';
export { TigerBeetleClient } from './tigerbeetle';
export { MojaloopClient } from './mojaloop';
export { APISixClient } from './apisix';
export { KeycloakClient } from './keycloak';
export { OpenAppSecClient } from './openappsec';
export { PermifyClient } from './permify';
export { OpenSearchClient } from './opensearch';
export { FluvioClient } from './fluvio';
export { DaprClient } from './dapr';
