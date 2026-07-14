/**
 * permifyClient.ts — Permify Authorization Service Client
 * Provides fine-grained RBAC/ABAC checks for the InsurePortal platform.
 */
import { ENV } from "../_core/env";

const PERMIFY_URL = () => process.env.PERMIFY_URL ?? "http://permify:3476";
const TENANT_ID = () => process.env.PERMIFY_TENANT_ID ?? "insureportal";

export interface PermifyCheckRequest {
  entity: { type: string; id: string };
  permission: string;
  subject: { type: string; id: string; relation?: string };
}

export interface PermifyWriteRelationRequest {
  entity: { type: string; id: string };
  relation: string;
  subject: { type: string; id: string; relation?: string };
}

async function permifyRequest<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${PERMIFY_URL()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

export const permifyClient = {
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${PERMIFY_URL()}/healthz`, { signal: AbortSignal.timeout(2_000) });
      return res.ok;
    } catch { return false; }
  },

  async check(req: PermifyCheckRequest): Promise<boolean> {
    const result = await permifyRequest<{ can: string }>(`/v1/tenants/${TENANT_ID()}/permissions/check`, {
      metadata: { schema_version: "", snap_token: "", depth: 20 },
      entity: req.entity,
      permission: req.permission,
      subject: req.subject,
    });
    return result?.can === "RESULT_ALLOWED";
  },

  async writeRelation(req: PermifyWriteRelationRequest): Promise<boolean> {
    const result = await permifyRequest(`/v1/tenants/${TENANT_ID()}/relationships/write`, {
      metadata: { schema_version: "" },
      tuples: [{ entity: req.entity, relation: req.relation, subject: req.subject }],
    });
    return result !== null;
  },

  async deleteRelation(req: PermifyWriteRelationRequest): Promise<boolean> {
    const result = await permifyRequest(`/v1/tenants/${TENANT_ID()}/relationships/delete`, {
      metadata: { schema_version: "" },
      filter: { entity: req.entity, relation: req.relation, subject: req.subject },
    });
    return result !== null;
  },

  async lookupSubjects(entityType: string, entityId: string, permission: string, subjectType: string): Promise<string[]> {
    const result = await permifyRequest<{ subject_ids: string[] }>(`/v1/tenants/${TENANT_ID()}/permissions/lookup-subject`, {
      metadata: { schema_version: "", snap_token: "", depth: 20 },
      entity: { type: entityType, id: entityId },
      permission,
      subject_reference: { type: subjectType },
    });
    return result?.subject_ids ?? [];
  },

  async lookupResources(subjectType: string, subjectId: string, permission: string, entityType: string): Promise<string[]> {
    const result = await permifyRequest<{ entity_ids: string[] }>(`/v1/tenants/${TENANT_ID()}/permissions/lookup-entity`, {
      metadata: { schema_version: "", snap_token: "", depth: 20 },
      entity_type: entityType,
      permission,
      subject: { type: subjectType, id: subjectId },
    });
    return result?.entity_ids ?? [];
  },
};
