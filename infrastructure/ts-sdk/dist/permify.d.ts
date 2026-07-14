/**
 * Permify client with fine-grained RBAC, schema management, and default-deny.
 */
export declare class PermifyClient {
    private baseUrl;
    private tenantId;
    constructor(baseUrl: string, tenantId?: string);
    ping(): Promise<void>;
    writeSchema(schema: string): Promise<void>;
    writeRelationship(entity: string, entityId: string, relation: string, subjectType: string, subjectId: string): Promise<void>;
    checkPermission(entity: string, entityId: string, permission: string, subjectType: string, subjectId: string): Promise<boolean>;
    writePlatformSchema(): Promise<void>;
}
export declare const PLATFORM_SCHEMA = "\nentity user {}\nentity organization {\n  relation admin @user\n  relation member @user\n  permission manage = admin\n  permission view = admin or member\n}\nentity policy {\n  relation owner @user\n  relation organization @organization\n  permission view = owner or organization.member\n  permission manage = owner or organization.admin\n  permission approve = organization.admin\n}\nentity claim {\n  relation claimant @user\n  relation policy @policy\n  permission view = claimant or policy.organization.member\n  permission manage = claimant or policy.organization.admin\n  permission approve = policy.organization.admin\n}\nentity payment {\n  relation payer @user\n  relation policy @policy\n  permission view = payer or policy.organization.member\n  permission approve = policy.organization.admin\n}\n";
