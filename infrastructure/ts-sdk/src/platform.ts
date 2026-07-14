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

export const defaultConfig: PlatformConfig = {
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

export class Platform {
  public readonly postgres: PostgresClient;
  public readonly redis: RedisClient;
  public readonly kafka: KafkaClient;
  public readonly tigerbeetle: TigerBeetleClient;
  public readonly mojaloop: MojaloopClient;
  public readonly apisix: APISixClient;
  public readonly keycloak: KeycloakClient;
  public readonly openappsec: OpenAppSecClient;
  public readonly permify: PermifyClient;
  public readonly opensearch: OpenSearchClient;
  public readonly fluvio: FluvioClient;
  public readonly dapr: DaprClient;

  constructor(config: Partial<PlatformConfig> = {}) {
    const cfg = { ...defaultConfig, ...config };
    this.postgres = new PostgresClient(cfg.postgresUrl);
    this.redis = new RedisClient(cfg.redisAddr);
    this.kafka = new KafkaClient(cfg.kafkaBrokers);
    this.tigerbeetle = new TigerBeetleClient(cfg.tigerbeetleAddr);
    this.mojaloop = new MojaloopClient(cfg.mojaloopUrl);
    this.apisix = new APISixClient(cfg.apisixAdminUrl);
    this.keycloak = new KeycloakClient(cfg.keycloakRealmUrl, cfg.keycloakClientId, cfg.keycloakClientSecret, cfg.keycloakAdminUrl);
    this.openappsec = new OpenAppSecClient(cfg.openappsecUrl);
    this.permify = new PermifyClient(cfg.permifyUrl, cfg.permifyTenantId);
    this.opensearch = new OpenSearchClient(cfg.opensearchUrl);
    this.fluvio = new FluvioClient(cfg.fluvioEndpoint);
    this.dapr = new DaprClient(cfg.daprHttpPort);
  }

  async healthCheck(): Promise<Record<string, boolean>> {
    const components: Record<string, { ping(): Promise<void> }> = {
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

    const results: Record<string, boolean> = {};
    await Promise.all(
      Object.entries(components).map(async ([name, client]) => {
        try {
          await client.ping();
          results[name] = true;
        } catch (err) {
          console.error(`[platform] health check failed for ${name}:`, err instanceof Error ? err.message : err);
          results[name] = false;
        }
      })
    );
    return results;
  }

  async close(): Promise<void> {
    await this.redis.close();
  }
}
