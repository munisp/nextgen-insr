// @ts-check

/**
 * Workflow Orchestrator Adapter (S88-02)
 * Bridges Node.js tRPC to Go workflow-orchestrator service
 */
import { workflowOrchestrator, type AdapterResponse } from "./goServiceAdapter";

export interface WorkflowDefinition {
  id: string;
  name: string;
  status: string;
  steps: Array<{ name: string; type: string; status: string }>;
  createdAt: string;
}

export interface WorkflowCreateInput {
  name: string;
  description?: string;
  steps: Array<{ name: string; type: string; assigneeRole?: string }>;
}

export async function createWorkflow(
  input: WorkflowCreateInput
): Promise<AdapterResponse<WorkflowDefinition>> {
  return workflowOrchestrator.post<WorkflowDefinition>(
    "/api/v1/workflow/create",
    input
  );
}

export async function advanceWorkflow(
  workflowId: string,
  stepIndex: number
): Promise<AdapterResponse<WorkflowDefinition>> {
  return workflowOrchestrator.post<WorkflowDefinition>(
    "/api/v1/workflow/advance",
    { workflowId, stepIndex }
  );
}

export async function listWorkflows(
  status?: string
): Promise<AdapterResponse<WorkflowDefinition[]>> {
  const params = status ? { status } : undefined;
  return workflowOrchestrator.get<WorkflowDefinition[]>(
    "/api/v1/workflow/list",
    params
  );
}

export async function getWorkflowHealth(): Promise<
  AdapterResponse<{ status: string }>
> {
  return workflowOrchestrator.healthCheck();
}
