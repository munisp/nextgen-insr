/**
 * PostgreSQL client with connection pooling, retry logic, and migrations.
 */
export declare class PostgresClient {
    private url;
    constructor(url: string);
    ping(): Promise<void>;
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
    execute(sql: string, params?: unknown[]): Promise<void>;
    migrate(statements: string[]): Promise<void>;
}
export declare const PLATFORM_MIGRATIONS: string[];
