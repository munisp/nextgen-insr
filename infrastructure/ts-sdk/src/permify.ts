/**
 * Permify client with fine-grained RBAC, schema management, and default-deny.
 */

export class PermifyClient {
  private baseUrl: string;
  private tenantId: string;

  constructor(baseUrl: string, tenantId: string = 'ngapp') {
    this.baseUrl = baseUrl;
    this.tenantId = tenantId;
  }

  async ping(): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/healthz`);
    if (resp.status >= 500) throw new Error(`Permify unhealthy: ${resp.status}`);
  }

  async writeSchema(schema: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/v1/tenants/${this.tenantId}/schemas/write`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema }),
    });
    if (!resp.ok) throw new Error(`Schema write failed (${resp.status})`);
  }

  async writeRelationship(entity: string, entityId: string, relation: string, subjectType: string, subjectId: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/v1/tenants/${this.tenantId}/relationships/write`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metadata: { schema_version: '' },
        tuples: [{ entity: { type: entity, id: entityId }, relation, subject: { type: subjectType, id: subjectId } }],
      }),
    });
    if (!resp.ok) throw new Error(`Relationship write failed (${resp.status})`);
  }

  async checkPermission(entity: string, entityId: string, permission: string, subjectType: string, subjectId: string): Promise<boolean> {
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
      if (!resp.ok) return false; // Default-deny
      const data = await resp.json() as Record<string, unknown>;
      return data.can === 'CHECK_RESULT_ALLOWED';
    } catch (err) {
      console.error('[permify] permission check failed:', err instanceof Error ? err.message : err);
      return false; // Default-deny on error
    }
  }

  async writePlatformSchema(): Promise<void> {
    await this.writeSchema(PLATFORM_SCHEMA);
  }
}

export const PLATFORM_SCHEMA = `
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
