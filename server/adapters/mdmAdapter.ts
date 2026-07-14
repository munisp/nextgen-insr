/**
 * MDM Compliance Engine Adapter (S88-04)
 * Bridges Node.js to Go mdm-compliance-engine for device management
 */
import { mdmComplianceEngine, type AdapterResponse } from "./goServiceAdapter";

export interface DeviceCheckResult {
  deviceId: string;
  compliant: boolean;
  violations: string[];
  lastChecked: string;
  riskScore: number;
}

export interface DeviceInfo {
  deviceId: string;
  agentId: string;
  model: string;
  os: string;
  osVersion: string;
  appVersion: string;
  enrolled: boolean;
  lastSeen: string;
}

export async function checkDevice(
  deviceId: string,
  agentId: string
): Promise<AdapterResponse<DeviceCheckResult>> {
  return mdmComplianceEngine.post<DeviceCheckResult>("/api/v1/device/check", {
    deviceId,
    agentId,
  });
}

export async function listDevices(
  agentId?: string
): Promise<AdapterResponse<DeviceInfo[]>> {
  const params = agentId ? { agentId } : undefined;
  return mdmComplianceEngine.get<DeviceInfo[]>("/api/v1/device/list", params);
}

export async function enrollDevice(
  deviceId: string,
  agentId: string,
  model: string
): Promise<AdapterResponse<DeviceInfo>> {
  return mdmComplianceEngine.post<DeviceInfo>("/api/v1/device/enroll", {
    deviceId,
    agentId,
    model,
  });
}
