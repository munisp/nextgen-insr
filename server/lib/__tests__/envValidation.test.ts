import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateEnvironment,
  getJwtSecret,
  getFieldEncryptionKey,
  getServiceToken,
  getApisixAdminKey,
} from "../envValidation";

describe("envValidation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("validateEnvironment", () => {
    it("should pass in dev mode with missing vars and generate ephemeral secrets", () => {
      delete process.env.NODE_ENV;
      delete process.env.JWT_SECRET;
      delete process.env.DATABASE_URL;

      const result = validateEnvironment();

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.generatedSecrets.JWT_SECRET).toBeDefined();
      expect(result.generatedSecrets.JWT_SECRET.length).toBe(64); // 32 bytes hex
    });

    it("should fail in production mode with missing JWT_SECRET", () => {
      process.env.NODE_ENV = "production";
      delete process.env.JWT_SECRET;
      delete process.env.DATABASE_URL;

      const result = validateEnvironment();

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("JWT_SECRET"))).toBe(true);
    });

    it("should fail in production with hardcoded dev placeholder", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "posinsureportal-secret";
      process.env.DATABASE_URL = "postgresql://localhost/test";

      const result = validateEnvironment();

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("dev placeholder"))).toBe(true);
    });

    it("should fail in production with short JWT_SECRET", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "short";
      process.env.DATABASE_URL = "postgresql://localhost/test";

      const result = validateEnvironment();

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(e => e.includes("at least 32 characters"))
      ).toBe(true);
    });

    it("should pass in production with all required vars properly set", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET =
        "a-properly-long-production-secret-that-is-more-than-32-chars";
      process.env.DATABASE_URL = "postgresql://user:pass@host:5432/db";
      process.env.CRON_SECRET =
        "a-properly-long-cron-secret-that-is-more-than-32-chars-long";
      process.env.INTERNAL_API_KEY =
        "a-properly-long-internal-api-key-more-than-32-chars-long";
      process.env.TX_SIGNING_SECRET =
        "a-properly-long-tx-signing-secret-more-than-32-chars-long";
      process.env.KEYCLOAK_CLIENT_SECRET = "prod-keycloak-secret-value";
      process.env.PLATFORM_API_KEY = "prod-platform-api-key-value";
      process.env.PLATFORM_SERVICE_TOKEN = "prod-platform-service-token";
      process.env.MINIO_SECRET_KEY = "prod-minio-secret-key-value";
      process.env.MINIO_ACCESS_KEY = "prod-minio-access-key-value";
      process.env.APISIX_ADMIN_KEY = "prod-apisix-admin-key-value";
      process.env.TERMII_API_KEY = "prod-termii-api-key-value";
      process.env.FLUVIO_API_KEY = "prod-fluvio-api-key-value";
      process.env.MQTT_PASSWORD = "prod-mqtt-password-value";
      process.env.FIELD_ENCRYPTION_KEY = "prod-field-encryption-key-value";

      const result = validateEnvironment();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail in production when FIELD_ENCRYPTION_KEY is missing", () => {
      process.env.NODE_ENV = "production";
      delete process.env.FIELD_ENCRYPTION_KEY;

      const result = validateEnvironment();

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("FIELD_ENCRYPTION_KEY"))).toBe(
        true
      );
    });

    it("should fail in production when JWT_SECRET is the repo's own published default", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "default-key-for-dev";

      const result = validateEnvironment();

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("dev placeholder"))).toBe(true);
    });

    it("should fail in production when APISIX_ADMIN_KEY is the published APISIX default", () => {
      process.env.NODE_ENV = "production";
      process.env.APISIX_ADMIN_KEY = "edd1c9f034335f136f87ad84b625c8f1";

      const result = validateEnvironment();

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("dev placeholder"))).toBe(true);
    });
  });

  describe("getJwtSecret", () => {
    it("should return env var when set", () => {
      process.env.JWT_SECRET = "my-test-secret-12345678901234567890";
      expect(getJwtSecret()).toBe("my-test-secret-12345678901234567890");
    });

    it("should generate ephemeral secret in dev when not set", () => {
      delete process.env.JWT_SECRET;
      delete process.env.NODE_ENV;

      const secret = getJwtSecret();
      expect(secret).toBeDefined();
      expect(secret.length).toBe(64); // 32 bytes hex
      // Should be cached
      expect(getJwtSecret()).toBe(secret);
    });

    it("should throw in production when not set", () => {
      process.env.NODE_ENV = "production";
      delete process.env.JWT_SECRET;

      expect(() => getJwtSecret()).toThrow(
        "JWT_SECRET is required in production"
      );
    });

    it("should throw in production when set to a known public default", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "default-key-for-dev";

      expect(() => getJwtSecret()).toThrow(/publicly-known default/);
    });
  });

  describe("getFieldEncryptionKey", () => {
    it("should return the env var when set", () => {
      process.env.FIELD_ENCRYPTION_KEY = "field-key-12345678901234567890";
      expect(getFieldEncryptionKey()).toBe("field-key-12345678901234567890");
    });

    it("should throw in production when not set (no default key exists)", () => {
      process.env.NODE_ENV = "production";
      delete process.env.FIELD_ENCRYPTION_KEY;

      expect(() => getFieldEncryptionKey()).toThrow(
        "FIELD_ENCRYPTION_KEY is required in production"
      );
    });

    it("should generate an ephemeral key outside production", () => {
      delete process.env.FIELD_ENCRYPTION_KEY;
      delete process.env.NODE_ENV;

      const key = getFieldEncryptionKey();
      expect(key).toBeDefined();
      expect(key.length).toBe(64);
      expect(getFieldEncryptionKey()).toBe(key);
    });
  });

  describe("getServiceToken", () => {
    it("should return the configured token", () => {
      process.env.ML_SERVICE_TOKEN = "real-ml-token";
      expect(getServiceToken("ML_SERVICE_TOKEN")).toBe("real-ml-token");
    });

    it("should fall back to dev-token outside production", () => {
      delete process.env.ML_SERVICE_TOKEN;
      delete process.env.NODE_ENV;
      expect(getServiceToken("ML_SERVICE_TOKEN")).toBe("dev-token");
    });

    it("should throw in production when unset instead of sending dev-token", () => {
      process.env.NODE_ENV = "production";
      delete process.env.ML_SERVICE_TOKEN;

      expect(() => getServiceToken("ML_SERVICE_TOKEN")).toThrow(
        "ML_SERVICE_TOKEN is required in production"
      );
    });
  });

  describe("getApisixAdminKey", () => {
    it("should return the configured key", () => {
      process.env.APISIX_ADMIN_KEY = "real-apisix-key";
      expect(getApisixAdminKey()).toBe("real-apisix-key");
    });

    it("should never fall back to the published APISIX default", () => {
      delete process.env.APISIX_ADMIN_KEY;
      delete process.env.NODE_ENV;
      expect(getApisixAdminKey()).toBe("");
    });

    it("should throw in production when unset", () => {
      process.env.NODE_ENV = "production";
      delete process.env.APISIX_ADMIN_KEY;

      expect(() => getApisixAdminKey()).toThrow(
        "APISIX_ADMIN_KEY is required in production"
      );
    });

    it("should throw in production when set to the published APISIX default", () => {
      process.env.NODE_ENV = "production";
      process.env.APISIX_ADMIN_KEY = "edd1c9f034335f136f87ad84b625c8f1";

      expect(() => getApisixAdminKey()).toThrow(/publicly-known APISIX default/);
    });
  });
});
