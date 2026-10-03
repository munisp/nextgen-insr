// 2026-10-03 (W8-B3): DELEGATED to @insureportal/channel-core. The resilient
// ioredis client (C2-b11b12: lazyConnect, bounded retries, throttled error
// logs, per-URL cache, closeRedisClients test hook) was extracted verbatim —
// same semantics — into packages/channel-core/src/redisClient.ts and is
// consumed here from the vendored copy (vendor/channel-core). This module is
// a re-export shim so existing imports (`../lib/redisClient`) keep working.
// Note: channel-core's getRedisClient takes an optional serviceName used in
// the error-log label; the conversation store passes "telegram-bot" so the
// `[telegram-bot] [Redis] connection error ...` log text is preserved. Direct
// callers that omit it get the "[channel-core]" label.
export { getRedisClient, closeRedisClients } from "@insureportal/channel-core";
