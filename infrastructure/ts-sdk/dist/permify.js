"use strict";
/**
 * Permify client with fine-grained RBAC, schema management, and default-deny.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_SCHEMA = exports.PermifyClient = void 0;
class PermifyClient {
    baseUrl;
    tenantId;
    constructor(baseUrl, tenantId = 'ngapp') {
        this.baseUrl = baseUrl;
        this.tenantId = tenantId;
    }
    async ping() {
        const resp = await fetch(`${this.baseUrl}/healthz`);
        if (resp.status >= 500)
            throw new Error(`Permify unhealthy: ${resp.status}`);
    }
    async writeSchema(schema) {
        const resp = await fetch(`${this.baseUrl}/v1/tenants/${this.tenantId}/schemas/write`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schema }),
        });
        if (!resp.ok)
            throw new Error(`Schema write failed (${resp.status})`);
    }
    async writeRelationship(entity, entityId, relation, subjectType, subjectId) {
        const resp = await fetch(`${this.baseUrl}/v1/tenants/${this.tenantId}/relationships/write`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                metadata: { schema_version: '' },
                tuples: [{ entity: { type: entity, id: entityId }, relation, subject: { type: subjectType, id: subjectId } }],
            }),
        });
        if (!resp.ok)
            throw new Error(`Relationship write failed (${resp.status})`);
    }
    async checkPermission(entity, entityId, permission, subjectType, subjectId) {
        try {
            const resp = await fetch(`${this.baseUrl}/v1/tenants/${this.tenantId}/permissions/check`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    metadata: { schema_version: '', snap_token: '', depth: 10 },
                    entity: { type: entity, id: entityId },
                    permission,
                    subject: { type: subjectType, id: subjectId },
                }),
            });
            if (!resp.ok)
                return false; // Default-deny
            const data = await resp.json();
            return data.can === 'CHECK_RESULT_ALLOWED';
        }
        catch {
            return false; // Default-deny on error
        }
    }
    async writePlatformSchema() {
        await this.writeSchema(exports.PLATFORM_SCHEMA);
    }
}
exports.PermifyClient = PermifyClient;
exports.PLATFORM_SCHEMA = `
entity user {}
entity organization {
  relation admin @user
  relation member @user
  permission manage = admin
  permission view = admin or member
}
entity policy {
  relation owner @user
  relation organization @organization
  permission view = owner or organization.member
  permission manage = owner or organization.admin
  permission approve = organization.admin
}
entity claim {
  relation claimant @user
  relation policy @policy
  permission view = claimant or policy.organization.member
  permission manage = claimant or policy.organization.admin
  permission approve = policy.organization.admin
}
entity payment {
  relation payer @user
  relation policy @policy
  permission view = payer or policy.organization.member
  permission approve = policy.organization.admin
}
`;
