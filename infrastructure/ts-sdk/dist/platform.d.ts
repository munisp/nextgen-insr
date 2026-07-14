/**
 * Unified platform client holding all 12 infrastructure component clients.
 */
import { PostgresClient } from './postgres';
import { RedisClient } from './redis';
import { KafkaClient } from './kafka';
import { TigerBeetleClient } from './tigerbeetle';
import { MojaloopClient } from './mojaloop';
import { APISixClient } from './apisix';
import { KeycloakClient } from './keycloak';
import { OpenAppSecClient } from './openappsec';
import { PermifyClient } from './permify';
import { OpenSearchClient } from './opensearch';
import { FluvioClient } from './fluvio';
import { DaprClient } from './dapr';
export interface PlatformConfig {
    postgresUrl: string;
    redisAddr: string;
    kafkaBrokers: string[];
    tigerbeetleAddr: string;
    mojaloopUrl: string;
    apisixAdminUrl: string;
    keycloakRealmUrl: string;
    keycloakAdminUrl: string;
    keycloakClientId: string;
    keycloakClientSecret: string;
    openappsecUrl: string;
    permifyUrl: string;
    permifyTenantId: string;
    opensearchUrl: string;
    fluvioEndpoint: string;
    daprHttpPort: number;
}
export declare const defaultConfig: PlatformConfig;
export declare class Platform {
    readonly postgres: PostgresClient;
    readonly redis: RedisClient;
    readonly kafka: KafkaClient;
    readonly tigerbeetle: TigerBeetleClient;
    readonly mojaloop: MojaloopClient;
    readonly apisix: APISixClient;
    readonly keycloak: KeycloakClient;
    readonly openappsec: OpenAppSecClient;
    readonly permify: PermifyClient;
    readonly opensearch: OpenSearchClient;
    readonly fluvio: FluvioClient;
    readonly dapr: DaprClient;
    constructor(config?: Partial<PlatformConfig>);
    healthCheck(): Promise<Record<string, boolean>>;
    close(): Promise<void>;
}
