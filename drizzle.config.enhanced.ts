/**
 * drizzle.config.enhanced.ts
 *
 * Enhanced Drizzle Kit configuration — Sprint 99
 * Replaces the base drizzle.config.ts with:
 *   - Multi-schema support
 *   - Strict mode (no implicit type coercions)
 *   - Verbose migration output
 *   - Custom migration naming
 *   - Introspection settings
 */

import type { Config } from "drizzle-kit";

export default {
  schema: [
    "./drizzle/schema.ts",
    "./drizzle/schema.enhancements.ts",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
  // Naming convention for generated migration files
  migrations: {
    prefix: "timestamp",
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
  // Introspection: ignore system tables
  introspect: {
    casing: "camel",
  },
} satisfies Config;
