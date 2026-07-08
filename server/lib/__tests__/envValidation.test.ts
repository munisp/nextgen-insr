// @ts-check

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateEnvironment, getJwtSecret } from "../envValidation";

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

      const result = validateEnvironment();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
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
  });
});
