/**
 * Hierarchy Engine Adapter (S88-11)
 * Bridges Node.js to Go hierarchy-engine for organizational tree management
 */
import { hierarchyEngine, type AdapterResponse } from "./goServiceAdapter";

export interface OrgNode {
  id: string;
  name: string;
  type: "region" | "district" | "branch" | "agent";
  parentId?: string;
  children: OrgNode[];
  metadata: Record<string, unknown>;
}

export interface AgentHierarchy {
  agentId: string;
  branch: string;
  district: string;
  region: string;
  supervisorCode?: string;
  subordinates: string[];
}

export async function getOrgTree(
  rootId?: string
): Promise<AdapterResponse<OrgNode>> {
  return hierarchyEngine.get<OrgNode>(
    "/api/v1/org/tree",
    rootId ? { rootId } : undefined
  );
}

export async function getAgentHierarchy(
  agentId: string
): Promise<AdapterResponse<AgentHierarchy>> {
  return hierarchyEngine.get<AgentHierarchy>(
    `/api/v1/agent/${agentId}/hierarchy`
  );
}

export async function moveNode(
  nodeId: string,
  newParentId: string
): Promise<AdapterResponse<OrgNode>> {
  return hierarchyEngine.post<OrgNode>("/api/v1/org/move", {
    nodeId,
    newParentId,
  });
}

export async function createNode(
  name: string,
  type: string,
  parentId: string
): Promise<AdapterResponse<OrgNode>> {
  return hierarchyEngine.post<OrgNode>("/api/v1/org/node", {
    name,
    type,
    parentId,
  });
}
