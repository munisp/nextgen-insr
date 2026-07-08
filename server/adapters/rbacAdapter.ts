// @ts-check

/**
 * RBAC Service Adapter (S88-08)
 * Bridges Node.js to Go rbac-service for role-based access control
 */
import { rbacService, type AdapterResponse } from "./goServiceAdapter";

export interface Role {
  id: string;
  name: string;
  permissions: string[];
  description: string;
  createdAt: string;
}

export interface PermissionCheck {
  allowed: boolean;
  role: string;
  permission: string;
  reason: string;
}

export async function listRoles(): Promise<AdapterResponse<Role[]>> {
  return rbacService.get<Role[]>("/api/v1/roles");
}

export async function createRole(
  name: string,
  permissions: string[],
  description?: string
): Promise<AdapterResponse<Role>> {
  return rbacService.post<Role>("/api/v1/roles", {
    name,
    permissions,
    description,
  });
}

export async function checkPermission(
  userId: string,
  permission: string
): Promise<AdapterResponse<PermissionCheck>> {
  return rbacService.post<PermissionCheck>("/api/v1/check", {
    userId,
    permission,
  });
}

export async function assignRole(
  userId: string,
  roleId: string
): Promise<AdapterResponse<{ success: boolean }>> {
  return rbacService.post<{ success: boolean }>("/api/v1/assign", {
    userId,
    roleId,
  });
}
