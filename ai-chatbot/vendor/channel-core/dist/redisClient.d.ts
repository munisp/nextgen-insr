import Redis from "ioredis";
export declare function getRedisClient(url?: string, serviceName?: string): Redis;
/** Test/helper hook: close every cached client. */
export declare function closeRedisClients(): Promise<void>;
//# sourceMappingURL=redisClient.d.ts.map