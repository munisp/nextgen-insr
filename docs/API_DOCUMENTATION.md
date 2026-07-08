# NextGen INS API Documentation

> **Generated:** 2026-07-08T18:34:00.845Z
> **Total Endpoints:** 5243
> **Version:** 1.0.0

---

## Overview

This documentation covers all tRPC endpoints in the NextGen INS platform.

## Quick Start

```typescript
import { createTRPCReact } from '@trpc/react-query';

const trpc = createTRPCReact();

// Query example
const customers = trpc.customer.getAll.useQuery();

// Mutation example
const createCustomer = trpc.customer.create.useMutation();
```

---

## Endpoints

### index
*File: `server/_core/index.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/index.unknown`


### systemRouter
*File: `server/_core/systemRouter.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemRouter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/systemRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemRouter.unknown`


### voiceTranscription
*File: `server/_core/voiceTranscription.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/voiceTranscription.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/voiceTranscription.unknown`


### healthCheck
*File: `server/lib/healthCheck.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/healthCheck.unknown`


### highAvailability
*File: `server/lib/highAvailability.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/highAvailability.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/highAvailability.unknown`


### performanceTuning
*File: `server/lib/performanceTuning.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/performanceTuning.unknown`


### index
*File: `server/middleware/index.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/index.unknown`


### serviceOrchestrator
*File: `server/middleware/serviceOrchestrator.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/serviceOrchestrator.unknown`


### tenantIsolation
*File: `server/middleware/tenantIsolation.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantIsolation.unknown`


### accountOpening
*File: `server/routers/accountOpening.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/accountOpening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/accountOpening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/accountOpening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/accountOpening.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/accountOpening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/accountOpening.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/accountOpening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/accountOpening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/accountOpening.unknown`


### activityAuditLog
*File: `server/routers/activityAuditLog.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/activityAuditLog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/activityAuditLog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/activityAuditLog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/activityAuditLog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/activityAuditLog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/activityAuditLog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/activityAuditLog.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/activityAuditLog.unknown`


### adminDashboard
*File: `server/routers/adminDashboard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/adminDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/adminDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/adminDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/adminDashboard.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/adminDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/adminDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/adminDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/adminDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/adminDashboard.unknown`


### advancedAuditLogViewer
*File: `server/routers/advancedAuditLogViewer.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedAuditLogViewer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedAuditLogViewer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedAuditLogViewer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedAuditLogViewer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedAuditLogViewer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedAuditLogViewer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedAuditLogViewer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedAuditLogViewer.unknown`


### advancedBiReporting
*File: `server/routers/advancedBiReporting.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedBiReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedBiReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedBiReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedBiReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedBiReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedBiReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedBiReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedBiReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedBiReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedBiReporting.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/advancedBiReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedBiReporting.unknown`


### advancedLoadingStates
*File: `server/routers/advancedLoadingStates.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedLoadingStates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedLoadingStates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedLoadingStates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedLoadingStates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedLoadingStates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedLoadingStates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedLoadingStates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedLoadingStates.unknown`


### advancedNotifications
*File: `server/routers/advancedNotifications.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedNotifications.unknown`


### advancedRateLimiter
*File: `server/routers/advancedRateLimiter.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedRateLimiter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedRateLimiter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedRateLimiter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedRateLimiter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/advancedRateLimiter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedRateLimiter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/advancedRateLimiter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedRateLimiter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedRateLimiter.unknown`


### advancedSearchFiltering
*File: `server/routers/advancedSearchFiltering.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedSearchFiltering.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedSearchFiltering.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedSearchFiltering.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedSearchFiltering.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedSearchFiltering.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedSearchFiltering.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedSearchFiltering.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/advancedSearchFiltering.unknown`


### agent
*File: `server/routers/agent.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agent.unknown`


### agentBankAccountsCrud
*File: `server/routers/agentBankAccountsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBankAccountsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBankAccountsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBankAccountsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBankAccountsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBankAccountsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentBankAccountsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBankAccountsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentBankAccountsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBankAccountsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentBankAccountsCrud.unknown`


### agentBenchmarking
*File: `server/routers/agentBenchmarking.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBenchmarking.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBenchmarking.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBenchmarking.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBenchmarking.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBenchmarking.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBenchmarking.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBenchmarking.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBenchmarking.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentBenchmarking.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentBenchmarking.unknown`


### agentClusterAnalytics
*File: `server/routers/agentClusterAnalytics.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentClusterAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentClusterAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentClusterAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentClusterAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentClusterAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentClusterAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentClusterAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentClusterAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentClusterAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentClusterAnalytics.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentClusterAnalytics.unknown`


### agentCommissionCalc
*File: `server/routers/agentCommissionCalc.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommissionCalc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommissionCalc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommissionCalc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentCommissionCalc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommissionCalc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommissionCalc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommissionCalc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentCommissionCalc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommissionCalc.unknown`


### agentCommunicationHub
*File: `server/routers/agentCommunicationHub.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommunicationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommunicationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommunicationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommunicationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommunicationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommunicationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommunicationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentCommunicationHub.unknown`


### agentDeviceFingerprint
*File: `server/routers/agentDeviceFingerprint.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentDeviceFingerprint.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentDeviceFingerprint.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentDeviceFingerprint.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentDeviceFingerprint.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentDeviceFingerprint.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentDeviceFingerprint.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentDeviceFingerprint.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentDeviceFingerprint.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentDeviceFingerprint.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentDeviceFingerprint.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentDeviceFingerprint.unknown`


### agentFloatInsuranceClaims
*File: `server/routers/agentFloatInsuranceClaims.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentFloatInsuranceClaims.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentFloatInsuranceClaims.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentFloatInsuranceClaims.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentFloatInsuranceClaims.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentFloatInsuranceClaims.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentFloatInsuranceClaims.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentFloatInsuranceClaims.unknown`


### agentGamification
*File: `server/routers/agentGamification.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentGamification.unknown`


### agentHierarchy
*File: `server/routers/agentHierarchy.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchy.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentHierarchy.unknown`


### agentHierarchyTerritory
*File: `server/routers/agentHierarchyTerritory.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentHierarchyTerritory.unknown`


### agentInventoryMgmt
*File: `server/routers/agentInventoryMgmt.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentInventoryMgmt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentInventoryMgmt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentInventoryMgmt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentInventoryMgmt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentInventoryMgmt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentInventoryMgmt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentInventoryMgmt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentInventoryMgmt.unknown`


### agentKyc
*File: `server/routers/agentKyc.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKyc.unknown`


### agentKycDocVault
*File: `server/routers/agentKycDocVault.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKycDocVault.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKycDocVault.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKycDocVault.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKycDocVault.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentKycDocVault.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentKycDocVault.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentKycDocVault.unknown`


### agentLoanAdvance
*File: `server/routers/agentLoanAdvance.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanAdvance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanAdvance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanAdvance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanAdvance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanAdvance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanAdvance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanAdvance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanAdvance.unknown`


### agentLoanOrigination
*File: `server/routers/agentLoanOrigination.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination.unknown`


### agentLoanOrigination2
*File: `server/routers/agentLoanOrigination2.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination2.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination2.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination2.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination2.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination2.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination2.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination2.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentLoanOrigination2.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination2.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentLoanOrigination2.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentLoanOrigination2.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentLoanOrigination2.unknown`


### agentManagement
*File: `server/routers/agentManagement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentManagement.unknown`


### agentMicroInsurance
*File: `server/routers/agentMicroInsurance.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentMicroInsurance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentMicroInsurance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentMicroInsurance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentMicroInsurance.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentMicroInsurance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentMicroInsurance.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentMicroInsurance.unknown`


### agentNetworkTopology
*File: `server/routers/agentNetworkTopology.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentNetworkTopology.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentNetworkTopology.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentNetworkTopology.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentNetworkTopology.unknown`


### agentOnboarding
*File: `server/routers/agentOnboarding.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentOnboarding.unknown`


### agentOnboardingWizard
*File: `server/routers/agentOnboardingWizard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboardingWizard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboardingWizard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboardingWizard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboardingWizard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboardingWizard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboardingWizard.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentOnboardingWizard.unknown`


### agentOnboardingWorkflow
*File: `server/routers/agentOnboardingWorkflow.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboardingWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboardingWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboardingWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboardingWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboardingWorkflow.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentOnboardingWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboardingWorkflow.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentOnboardingWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentOnboardingWorkflow.unknown`


### agentPerformanceAnalytics
*File: `server/routers/agentPerformanceAnalytics.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceAnalytics.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentPerformanceAnalytics.unknown`


### agentPerformanceIncentives
*File: `server/routers/agentPerformanceIncentives.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceIncentives.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceIncentives.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceIncentives.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceIncentives.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceIncentives.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceIncentives.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentPerformanceIncentives.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceIncentives.unknown`


### agentPerformanceLeaderboard
*File: `server/routers/agentPerformanceLeaderboard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceLeaderboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceLeaderboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceLeaderboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceLeaderboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceLeaderboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceLeaderboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceLeaderboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceLeaderboard.unknown`


### agentPerformanceScorecard
*File: `server/routers/agentPerformanceScorecard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScorecard.unknown`


### agentPerformanceScoresCrud
*File: `server/routers/agentPerformanceScoresCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScoresCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScoresCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScoresCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScoresCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScoresCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentPerformanceScoresCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScoresCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScoresCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScoresCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScoresCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentPerformanceScoresCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentPerformanceScoresCrud.unknown`


### agentRevenueAttribution
*File: `server/routers/agentRevenueAttribution.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentRevenueAttribution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentRevenueAttribution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentRevenueAttribution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentRevenueAttribution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentRevenueAttribution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentRevenueAttribution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentRevenueAttribution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentRevenueAttribution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentRevenueAttribution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentRevenueAttribution.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentRevenueAttribution.unknown`


### agentScorecard
*File: `server/routers/agentScorecard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentScorecard.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentScorecard.unknown`


### agentSuspensionLogCrud
*File: `server/routers/agentSuspensionLogCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionLogCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentSuspensionLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionLogCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentSuspensionLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionLogCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentSuspensionLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionLogCrud.unknown`


### agentSuspensionWorkflow
*File: `server/routers/agentSuspensionWorkflow.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionWorkflow.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentSuspensionWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionWorkflow.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentSuspensionWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentSuspensionWorkflow.unknown`


### agentTerritoryHeatmap
*File: `server/routers/agentTerritoryHeatmap.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryHeatmap.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryHeatmap.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryHeatmap.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryHeatmap.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryHeatmap.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryHeatmap.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryHeatmap.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryHeatmap.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryHeatmap.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentTerritoryHeatmap.unknown`


### agentTerritoryMgmt
*File: `server/routers/agentTerritoryMgmt.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryMgmt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryMgmt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryMgmt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryMgmt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryMgmt.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentTerritoryMgmt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryMgmt.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentTerritoryMgmt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryMgmt.unknown`


### agentTerritoryOptimizer
*File: `server/routers/agentTerritoryOptimizer.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTerritoryOptimizer.unknown`


### agentTraining
*File: `server/routers/agentTraining.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTraining.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTraining.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTraining.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTraining.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTraining.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTraining.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTraining.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentTraining.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTraining.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentTraining.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTraining.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTraining.unknown`


### agentTrainingAcademy
*File: `server/routers/agentTrainingAcademy.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingAcademy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingAcademy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingAcademy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingAcademy.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentTrainingAcademy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingAcademy.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentTrainingAcademy.unknown`


### agentTrainingGamification
*File: `server/routers/agentTrainingGamification.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingGamification.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentTrainingGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingGamification.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentTrainingGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingGamification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingGamification.unknown`


### agentTrainingPortal
*File: `server/routers/agentTrainingPortal.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingPortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentTrainingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/agentTrainingPortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/agentTrainingPortal.unknown`


### aiCashFlowPredictor
*File: `server/routers/aiCashFlowPredictor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiCashFlowPredictor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiCashFlowPredictor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiCashFlowPredictor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiCashFlowPredictor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiCashFlowPredictor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiCashFlowPredictor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiCashFlowPredictor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiCashFlowPredictor.unknown`


### aiChatSupport
*File: `server/routers/aiChatSupport.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiChatSupport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiChatSupport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiChatSupport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiChatSupport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiChatSupport.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/aiChatSupport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiChatSupport.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/aiChatSupport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiChatSupport.unknown`


### aiMonitoring
*File: `server/routers/aiMonitoring.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/aiMonitoring.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/aiMonitoring.unknown`


### alertNotifications
*File: `server/routers/alertNotifications.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/alertNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/alertNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/alertNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/alertNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/alertNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/alertNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/alertNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/alertNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/alertNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/alertNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/alertNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/alertNotifications.unknown`


### amlScreening
*File: `server/routers/amlScreening.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/amlScreening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/amlScreening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/amlScreening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/amlScreening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/amlScreening.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/amlScreening.unknown`


### analytics
*File: `server/routers/analytics.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analytics.unknown`


### analyticsDashboard
*File: `server/routers/analyticsDashboard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboard.unknown`


### analyticsDashboardsCrud
*File: `server/routers/analyticsDashboardsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboardsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboardsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboardsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboardsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboardsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/analyticsDashboardsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboardsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/analyticsDashboardsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsDashboardsCrud.unknown`


### analyticsQuery
*File: `server/routers/analyticsQuery.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/analyticsQuery.unknown`


### announcementReactions
*File: `server/routers/announcementReactions.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/announcementReactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/announcementReactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/announcementReactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/announcementReactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/announcementReactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/announcementReactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/announcementReactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/announcementReactions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/announcementReactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/announcementReactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/announcementReactions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/announcementReactions.unknown`


### apacheAirflow
*File: `server/routers/apacheAirflow.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheAirflow.unknown`


### apacheNifi
*File: `server/routers/apacheNifi.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apacheNifi.unknown`


### apiAnalyticsDash
*File: `server/routers/apiAnalyticsDash.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiAnalyticsDash.unknown`


### apiDocs
*File: `server/routers/apiDocs.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiDocs.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiDocs.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiDocs.unknown`


### apiGateway
*File: `server/routers/apiGateway.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiGateway.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/apiGateway.unknown`


### apiKeyManagement
*File: `server/routers/apiKeyManagement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiKeyManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiKeyManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiKeyManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiKeyManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiKeyManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiKeyManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiKeyManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiKeyManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiKeyManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/apiKeyManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiKeyManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/apiKeyManagement.unknown`


### apiRateLimiterDash
*File: `server/routers/apiRateLimiterDash.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiRateLimiterDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiRateLimiterDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiRateLimiterDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiRateLimiterDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiRateLimiterDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiRateLimiterDash.unknown`


### apiVersioning
*File: `server/routers/apiVersioning.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiVersioning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiVersioning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiVersioning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiVersioning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiVersioning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiVersioning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiVersioning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiVersioning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiVersioning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/apiVersioning.unknown`


### archivalAdmin
*File: `server/routers/archivalAdmin.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/archivalAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/archivalAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/archivalAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/archivalAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/archivalAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/archivalAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/archivalAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/archivalAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/archivalAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/archivalAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/archivalAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/archivalAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/archivalAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/archivalAdmin.unknown`


### artRobustness
*File: `server/routers/artRobustness.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/artRobustness.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/artRobustness.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/artRobustness.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/artRobustness.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/artRobustness.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/artRobustness.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/artRobustness.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/artRobustness.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/artRobustness.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/artRobustness.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/artRobustness.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/artRobustness.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/artRobustness.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/artRobustness.unknown`


### auditExport
*File: `server/routers/auditExport.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditExport.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/auditExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditExport.unknown`


### auditLog
*File: `server/routers/auditLog.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditLog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditLog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditLog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditLog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditLog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditLog.unknown`


### auditTrail
*File: `server/routers/auditTrail.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrail.unknown`


### auditTrailExport
*File: `server/routers/auditTrailExport.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrailExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrailExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrailExport.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/auditTrailExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrailExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/auditTrailExport.unknown`


### autoComplianceWorkflow
*File: `server/routers/autoComplianceWorkflow.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/autoComplianceWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/autoComplianceWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/autoComplianceWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/autoComplianceWorkflow.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/autoComplianceWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/autoComplianceWorkflow.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/autoComplianceWorkflow.unknown`


### autoReconciliationEngine
*File: `server/routers/autoReconciliationEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/autoReconciliationEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/autoReconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/autoReconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/autoReconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/autoReconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/autoReconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/autoReconciliationEngine.unknown`


### automatedComplianceChecker
*File: `server/routers/automatedComplianceChecker.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedComplianceChecker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedComplianceChecker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedComplianceChecker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedComplianceChecker.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/automatedComplianceChecker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedComplianceChecker.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/automatedComplianceChecker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedComplianceChecker.unknown`


### automatedSettlementScheduler
*File: `server/routers/automatedSettlementScheduler.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedSettlementScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedSettlementScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedSettlementScheduler.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/automatedSettlementScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedSettlementScheduler.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/automatedSettlementScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedSettlementScheduler.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/automatedSettlementScheduler.unknown`


### automatedTestingFramework
*File: `server/routers/automatedTestingFramework.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedTestingFramework.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedTestingFramework.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedTestingFramework.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedTestingFramework.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedTestingFramework.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedTestingFramework.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedTestingFramework.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedTestingFramework.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/automatedTestingFramework.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/automatedTestingFramework.unknown`


### backupDisasterRecovery
*File: `server/routers/backupDisasterRecovery.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/backupDisasterRecovery.unknown`


### bankAccountManagement
*File: `server/routers/bankAccountManagement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankAccountManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/bankAccountManagement.unknown`


### bankingWorkflowPatterns
*File: `server/routers/bankingWorkflowPatterns.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankingWorkflowPatterns.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankingWorkflowPatterns.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankingWorkflowPatterns.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankingWorkflowPatterns.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankingWorkflowPatterns.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankingWorkflowPatterns.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankingWorkflowPatterns.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/bankingWorkflowPatterns.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bankingWorkflowPatterns.unknown`


### batchProcessing
*File: `server/routers/batchProcessing.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/batchProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/batchProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/batchProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/batchProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/batchProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/batchProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/batchProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/batchProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/batchProcessing.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/batchProcessing.unknown`


### biReportDefinitionsCrud
*File: `server/routers/biReportDefinitionsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biReportDefinitionsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biReportDefinitionsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biReportDefinitionsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biReportDefinitionsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biReportDefinitionsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/biReportDefinitionsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biReportDefinitionsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/biReportDefinitionsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biReportDefinitionsCrud.unknown`


### billingAudit
*File: `server/routers/billingAudit.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingAudit.unknown`


### billingInvoice
*File: `server/routers/billingInvoice.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingInvoice.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingInvoice.unknown`


### billingLedger
*File: `server/routers/billingLedger.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLedger.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLedger.unknown`


### billingLifecycle
*File: `server/routers/billingLifecycle.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingLifecycle.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingLifecycle.unknown`


### billingProduction
*File: `server/routers/billingProduction.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingProduction.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingProduction.unknown`


### billingRbac
*File: `server/routers/billingRbac.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRbac.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRbac.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRbac.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingRbac.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRbac.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingRbac.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRbac.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRbac.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRbac.unknown`


### billingRevenuePeriodsCrud
*File: `server/routers/billingRevenuePeriodsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRevenuePeriodsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRevenuePeriodsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRevenuePeriodsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRevenuePeriodsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRevenuePeriodsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingRevenuePeriodsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRevenuePeriodsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRevenuePeriodsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/billingRevenuePeriodsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/billingRevenuePeriodsCrud.unknown`


### biometricAuditDashboard
*File: `server/routers/biometricAuditDashboard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuditDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuditDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuditDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuditDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuditDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuditDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuditDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuditDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuditDashboard.unknown`


### biometricAuth
*File: `server/routers/biometricAuth.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuth.unknown`


### biometricAuthGateway
*File: `server/routers/biometricAuthGateway.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuthGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuthGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuthGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuthGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuthGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuthGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuthGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/biometricAuthGateway.unknown`


### blockchainAuditTrail
*File: `server/routers/blockchainAuditTrail.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/blockchainAuditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/blockchainAuditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/blockchainAuditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/blockchainAuditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/blockchainAuditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/blockchainAuditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/blockchainAuditTrail.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/blockchainAuditTrail.unknown`


### broadcastAnnouncements
*File: `server/routers/broadcastAnnouncements.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/broadcastAnnouncements.unknown`


### bulkDisbursementEngine
*File: `server/routers/bulkDisbursementEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkDisbursementEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkDisbursementEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkDisbursementEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkDisbursementEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkDisbursementEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkDisbursementEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkDisbursementEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkDisbursementEngine.unknown`


### bulkOperations
*File: `server/routers/bulkOperations.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkOperations.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkOperations.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkOperations.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/bulkOperations.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkOperations.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkOperations.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkOperations.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/bulkOperations.unknown`


### bulkPaymentProcessor
*File: `server/routers/bulkPaymentProcessor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/bulkPaymentProcessor.unknown`


### bulkRoleImport
*File: `server/routers/bulkRoleImport.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkRoleImport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkRoleImport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkRoleImport.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/bulkRoleImport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkRoleImport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkRoleImport.unknown`


### bulkTransactionProcessing
*File: `server/routers/bulkTransactionProcessing.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessing.unknown`


### bulkTransactionProcessor
*File: `server/routers/bulkTransactionProcessor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/bulkTransactionProcessor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/bulkTransactionProcessor.unknown`


### businessRules
*File: `server/routers/businessRules.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/businessRules.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/businessRules.unknown`


### canaryReleaseManager
*File: `server/routers/canaryReleaseManager.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/canaryReleaseManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/canaryReleaseManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/canaryReleaseManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/canaryReleaseManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/canaryReleaseManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/canaryReleaseManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/canaryReleaseManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/canaryReleaseManager.unknown`


### capacityPlanning
*File: `server/routers/capacityPlanning.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/capacityPlanning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/capacityPlanning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/capacityPlanning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/capacityPlanning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/capacityPlanning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/capacityPlanning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/capacityPlanning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/capacityPlanning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/capacityPlanning.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/capacityPlanning.unknown`


### cardBinLookup
*File: `server/routers/cardBinLookup.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cardBinLookup.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cardBinLookup.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cardBinLookup.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cardBinLookup.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cardBinLookup.unknown`


### cardRequest
*File: `server/routers/cardRequest.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cardRequest.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cardRequest.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cardRequest.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cardRequest.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cardRequest.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cardRequest.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cardRequest.unknown`


### carrierCost
*File: `server/routers/carrierCost.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierCost.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierCost.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierCost.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierCost.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierCost.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierCost.unknown`


### carrierLivePricing
*File: `server/routers/carrierLivePricing.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierLivePricing.unknown`


### carrierSla
*File: `server/routers/carrierSla.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierSla.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierSla.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierSla.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierSla.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/carrierSla.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierSla.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/carrierSla.unknown`


### carrierSwitching
*File: `server/routers/carrierSwitching.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierSwitching.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierSwitching.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierSwitching.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierSwitching.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/carrierSwitching.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierSwitching.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/carrierSwitching.unknown`


### cbdcIntegrationGateway
*File: `server/routers/cbdcIntegrationGateway.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbdcIntegrationGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbdcIntegrationGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbdcIntegrationGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbdcIntegrationGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbdcIntegrationGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbdcIntegrationGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbdcIntegrationGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbdcIntegrationGateway.unknown`


### cbnReporting
*File: `server/routers/cbnReporting.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbnReporting.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/cbnReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbnReporting.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/cbnReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbnReporting.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/cbnReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbnReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbnReporting.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/cbnReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbnReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbnReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbnReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbnReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cbnReporting.unknown`


### cdnCacheManager
*File: `server/routers/cdnCacheManager.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cdnCacheManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cdnCacheManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cdnCacheManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cdnCacheManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cdnCacheManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cdnCacheManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cdnCacheManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cdnCacheManager.unknown`


### chaosEngineeringConsole
*File: `server/routers/chaosEngineeringConsole.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chaosEngineeringConsole.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chaosEngineeringConsole.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chaosEngineeringConsole.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chaosEngineeringConsole.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chaosEngineeringConsole.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chaosEngineeringConsole.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chaosEngineeringConsole.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chaosEngineeringConsole.unknown`


### chargebackManagement
*File: `server/routers/chargebackManagement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chargebackManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chargebackManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chargebackManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chargebackManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chargebackManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/chargebackManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chargebackManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/chargebackManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chargebackManagement.unknown`


### chat
*File: `server/routers/chat.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/chat.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/chat.unknown`


### cocoIndexPipeline
*File: `server/routers/cocoIndexPipeline.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cocoIndexPipeline.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cocoIndexPipeline.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cocoIndexPipeline.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cocoIndexPipeline.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/cocoIndexPipeline.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cocoIndexPipeline.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/cocoIndexPipeline.unknown`


### commissionCalculator
*File: `server/routers/commissionCalculator.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCalculator.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCalculator.unknown`


### commissionCascadeHistoryCrud
*File: `server/routers/commissionCascadeHistoryCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCascadeHistoryCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCascadeHistoryCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCascadeHistoryCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCascadeHistoryCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCascadeHistoryCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCascadeHistoryCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCascadeHistoryCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCascadeHistoryCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCascadeHistoryCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionCascadeHistoryCrud.unknown`


### commissionClawback
*File: `server/routers/commissionClawback.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionClawback.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionClawback.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionClawback.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionClawback.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionClawback.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionClawback.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionClawback.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionClawback.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionClawback.unknown`


### commissionEngine
*File: `server/routers/commissionEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionEngine.unknown`


### commissionPayouts
*File: `server/routers/commissionPayouts.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionPayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionPayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionPayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionPayouts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionPayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionPayouts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionPayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionPayouts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionPayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/commissionPayouts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/commissionPayouts.unknown`


### complianceAutomation
*File: `server/routers/complianceAutomation.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceAutomation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/complianceAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceAutomation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/complianceAutomation.unknown`


### complianceCertManager
*File: `server/routers/complianceCertManager.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceCertManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceCertManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceCertManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceCertManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceCertManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceCertManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceCertManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceCertManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceCertManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceCertManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceCertManager.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/complianceCertManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceCertManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceCertManager.unknown`


### complianceChatbot
*File: `server/routers/complianceChatbot.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceChatbot.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceChatbot.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceChatbot.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/complianceChatbot.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceChatbot.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceChatbot.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceChatbot.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceChatbot.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceChatbot.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceChatbot.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceChatbot.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceChatbot.unknown`


### complianceFiling
*File: `server/routers/complianceFiling.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceFiling.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceFiling.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceFiling.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/complianceFiling.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceFiling.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/complianceFiling.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceFiling.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/complianceFiling.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceFiling.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceFiling.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceFiling.unknown`


### complianceReporting
*File: `server/routers/complianceReporting.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceReporting.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/complianceReporting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceReporting.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/complianceReporting.unknown`


### complianceTrainingTracker
*File: `server/routers/complianceTrainingTracker.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceTrainingTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceTrainingTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceTrainingTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceTrainingTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceTrainingTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceTrainingTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceTrainingTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/complianceTrainingTracker.unknown`


### configManagement
*File: `server/routers/configManagement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/configManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/configManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/configManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/configManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/configManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/configManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/configManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/configManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/configManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/configManagement.unknown`


### connectionPoolMonitor
*File: `server/routers/connectionPoolMonitor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/connectionPoolMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/connectionPoolMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/connectionPoolMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/connectionPoolMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/connectionPoolMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/connectionPoolMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/connectionPoolMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/connectionPoolMonitor.unknown`


### cqrsEventStore
*File: `server/routers/cqrsEventStore.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cqrsEventStore.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cqrsEventStore.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cqrsEventStore.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cqrsEventStore.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cqrsEventStore.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cqrsEventStore.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cqrsEventStore.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/cqrsEventStore.unknown`


### crossBorderRemittanceHub
*File: `server/routers/crossBorderRemittanceHub.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/crossBorderRemittanceHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/crossBorderRemittanceHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/crossBorderRemittanceHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/crossBorderRemittanceHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/crossBorderRemittanceHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/crossBorderRemittanceHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/crossBorderRemittanceHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/crossBorderRemittanceHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/crossBorderRemittanceHub.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/crossBorderRemittanceHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/crossBorderRemittanceHub.unknown`


### currencyHedging
*File: `server/routers/currencyHedging.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/currencyHedging.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/currencyHedging.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/currencyHedging.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/currencyHedging.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/currencyHedging.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/currencyHedging.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/currencyHedging.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/currencyHedging.unknown`


### customer
*File: `server/routers/customer.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customer.unknown`


### customer360
*File: `server/routers/customer360.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360.unknown`


### customer360View
*File: `server/routers/customer360View.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360View.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360View.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360View.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360View.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360View.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360View.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360View.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customer360View.unknown`


### customerDatabase
*File: `server/routers/customerDatabase.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDatabase.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDatabase.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDatabase.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDatabase.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDatabase.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerDatabase.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDatabase.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerDatabase.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDatabase.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDatabase.unknown`


### customerDisputePortal
*File: `server/routers/customerDisputePortal.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerDisputePortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerDisputePortal.unknown`


### customerFeedbackNps
*File: `server/routers/customerFeedbackNps.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerFeedbackNps.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerFeedbackNps.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerFeedbackNps.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerFeedbackNps.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerFeedbackNps.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerFeedbackNps.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerFeedbackNps.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerFeedbackNps.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerFeedbackNps.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerFeedbackNps.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerFeedbackNps.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerFeedbackNps.unknown`


### customerJourneyAnalytics
*File: `server/routers/customerJourneyAnalytics.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyAnalytics.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerJourneyAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyAnalytics.unknown`


### customerJourneyEventsCrud
*File: `server/routers/customerJourneyEventsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyEventsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyEventsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyEventsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyEventsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyEventsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerJourneyEventsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyEventsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyEventsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerJourneyEventsCrud.unknown`


### customerJourneyMapper
*File: `server/routers/customerJourneyMapper.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyMapper.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyMapper.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyMapper.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyMapper.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyMapper.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyMapper.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyMapper.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyMapper.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyMapper.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerJourneyMapper.unknown`


### customerLoyaltyProgram
*File: `server/routers/customerLoyaltyProgram.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerLoyaltyProgram.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerLoyaltyProgram.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerLoyaltyProgram.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerLoyaltyProgram.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerLoyaltyProgram.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerLoyaltyProgram.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerLoyaltyProgram.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerLoyaltyProgram.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerLoyaltyProgram.unknown`


### customerOnboardingPipeline
*File: `server/routers/customerOnboardingPipeline.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerOnboardingPipeline.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerOnboardingPipeline.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerOnboardingPipeline.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerOnboardingPipeline.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerOnboardingPipeline.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerOnboardingPipeline.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerOnboardingPipeline.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerOnboardingPipeline.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerOnboardingPipeline.unknown`


### customerSegmentationEngine
*File: `server/routers/customerSegmentationEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSegmentationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSegmentationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSegmentationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSegmentationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSegmentationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSegmentationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSegmentationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSegmentationEngine.unknown`


### customerSurveys
*File: `server/routers/customerSurveys.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSurveys.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSurveys.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSurveys.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSurveys.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSurveys.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSurveys.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSurveys.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSurveys.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerSurveys.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerSurveys.unknown`


### customerWalletSystem
*File: `server/routers/customerWalletSystem.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerWalletSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerWalletSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerWalletSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerWalletSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerWalletSystem.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/customerWalletSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/customerWalletSystem.unknown`


### dailyPnlReport
*File: `server/routers/dailyPnlReport.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dailyPnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dailyPnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dailyPnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dailyPnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dailyPnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dailyPnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dailyPnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dailyPnlReport.unknown`


### dashboardLayout
*File: `server/routers/dashboardLayout.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dashboardLayout.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dashboardLayout.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dashboardLayout.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dashboardLayout.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dashboardLayout.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dashboardLayout.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dashboardLayout.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dashboardLayout.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dashboardLayout.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dashboardLayout.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dashboardLayout.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dashboardLayout.unknown`


### dataConsentRecordsCrud
*File: `server/routers/dataConsentRecordsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataConsentRecordsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataConsentRecordsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataConsentRecordsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataConsentRecordsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataConsentRecordsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataConsentRecordsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataConsentRecordsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataConsentRecordsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataConsentRecordsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataConsentRecordsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataConsentRecordsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataConsentRecordsCrud.unknown`


### dataExport
*File: `server/routers/dataExport.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExport.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExport.unknown`


### dataExportHub
*File: `server/routers/dataExportHub.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportHub.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataExportHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportHub.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataExportHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportHub.unknown`


### dataExportImport
*File: `server/routers/dataExportImport.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportImport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportImport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportImport.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataExportImport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportImport.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataExportImport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportImport.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataExportImport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportImport.unknown`


### dataExportRouter
*File: `server/routers/dataExportRouter.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportRouter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataExportRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportRouter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataExportRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataExportRouter.unknown`


### dataQuality
*File: `server/routers/dataQuality.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataQuality.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataQuality.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataQuality.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataQuality.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataQuality.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataQuality.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataQuality.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataQuality.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataQuality.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataQuality.unknown`


### dataRetentionPolicy
*File: `server/routers/dataRetentionPolicy.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataRetentionPolicy.unknown`


### dataThresholdAlerts
*File: `server/routers/dataThresholdAlerts.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dataThresholdAlerts.unknown`


### databaseVisualization
*File: `server/routers/databaseVisualization.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/databaseVisualization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/databaseVisualization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/databaseVisualization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/databaseVisualization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/databaseVisualization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/databaseVisualization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/databaseVisualization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/databaseVisualization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/databaseVisualization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/databaseVisualization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/databaseVisualization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/databaseVisualization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/databaseVisualization.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/databaseVisualization.unknown`


### dbSchemaMigrationManager
*File: `server/routers/dbSchemaMigrationManager.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaMigrationManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaMigrationManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaMigrationManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaMigrationManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaMigrationManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaMigrationManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaMigrationManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaMigrationManager.unknown`


### dbSchemaPush
*File: `server/routers/dbSchemaPush.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaPush.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaPush.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaPush.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dbSchemaPush.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaPush.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaPush.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbSchemaPush.unknown`


### dbtIntegration
*File: `server/routers/dbtIntegration.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dbtIntegration.unknown`


### decentralizedIdentityManager
*File: `server/routers/decentralizedIdentityManager.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/decentralizedIdentityManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/decentralizedIdentityManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/decentralizedIdentityManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/decentralizedIdentityManager.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/decentralizedIdentityManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/decentralizedIdentityManager.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/decentralizedIdentityManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/decentralizedIdentityManager.unknown`


### deepface
*File: `server/routers/deepface.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/deepface.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deepface.unknown`


### developerPortal
*File: `server/routers/developerPortal.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/developerPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/developerPortal.unknown`


### deviceFleetManager
*File: `server/routers/deviceFleetManager.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deviceFleetManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deviceFleetManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deviceFleetManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deviceFleetManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deviceFleetManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deviceFleetManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deviceFleetManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deviceFleetManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deviceFleetManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deviceFleetManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/deviceFleetManager.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/deviceFleetManager.unknown`


### digitalTwinSimulator
*File: `server/routers/digitalTwinSimulator.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/digitalTwinSimulator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/digitalTwinSimulator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/digitalTwinSimulator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/digitalTwinSimulator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/digitalTwinSimulator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/digitalTwinSimulator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/digitalTwinSimulator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/digitalTwinSimulator.unknown`


### disputeAnalytics
*File: `server/routers/disputeAnalytics.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeAnalytics.unknown`


### disputeMediationAI
*File: `server/routers/disputeMediationAI.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeMediationAI.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeMediationAI.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeMediationAI.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeMediationAI.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/disputeMediationAI.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeMediationAI.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/disputeMediationAI.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeMediationAI.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/disputeMediationAI.unknown`


### disputeNotifications
*File: `server/routers/disputeNotifications.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/disputeNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/disputeNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeNotifications.unknown`


### disputeRefund
*File: `server/routers/disputeRefund.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeRefund.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeRefund.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeRefund.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/disputeRefund.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeRefund.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeRefund.unknown`


### disputeResolution
*File: `server/routers/disputeResolution.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeResolution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeResolution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeResolution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeResolution.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/disputeResolution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeResolution.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/disputeResolution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeResolution.unknown`


### disputeWorkflowEngine
*File: `server/routers/disputeWorkflowEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeWorkflowEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/disputeWorkflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeWorkflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeWorkflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeWorkflowEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/disputeWorkflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeWorkflowEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/disputeWorkflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeWorkflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeWorkflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeWorkflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputeWorkflowEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/disputeWorkflowEngine.unknown`


### disputes
*File: `server/routers/disputes.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/disputes.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/disputes.unknown`


### distributedTracingDash
*File: `server/routers/distributedTracingDash.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/distributedTracingDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/distributedTracingDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/distributedTracingDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/distributedTracingDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/distributedTracingDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/distributedTracingDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/distributedTracingDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/distributedTracingDash.unknown`


### documentManagement
*File: `server/routers/documentManagement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/documentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/documentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/documentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/documentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/documentManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/documentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/documentManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/documentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/documentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/documentManagement.unknown`


### dragDropReportBuilder
*File: `server/routers/dragDropReportBuilder.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dragDropReportBuilder.unknown`


### dynamicFeeCalculator
*File: `server/routers/dynamicFeeCalculator.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeCalculator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeCalculator.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dynamicFeeCalculator.unknown`


### dynamicFeeEngine
*File: `server/routers/dynamicFeeEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dynamicFeeEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dynamicFeeEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicFeeEngine.unknown`


### dynamicPricingEngine
*File: `server/routers/dynamicPricingEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicPricingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicPricingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicPricingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicPricingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicPricingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicPricingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicPricingEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dynamicPricingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicPricingEngine.unknown`


### dynamicQrPayment
*File: `server/routers/dynamicQrPayment.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicQrPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicQrPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicQrPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicQrPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicQrPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicQrPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicQrPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicQrPayment.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/dynamicQrPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicQrPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/dynamicQrPayment.unknown`


### e2eTestFramework
*File: `server/routers/e2eTestFramework.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/e2eTestFramework.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/e2eTestFramework.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/e2eTestFramework.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/e2eTestFramework.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/e2eTestFramework.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/e2eTestFramework.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/e2eTestFramework.unknown`


### ecommerceCart
*File: `server/routers/ecommerceCart.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCart.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCart.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCart.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceCart.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCart.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceCart.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCart.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceCart.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCart.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceCart.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCart.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceCart.unknown`


### ecommerceCatalog
*File: `server/routers/ecommerceCatalog.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceCatalog.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceCatalog.unknown`


### ecommerceOrders
*File: `server/routers/ecommerceOrders.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceOrders.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceOrders.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceOrders.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceOrders.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceOrders.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceOrders.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceOrders.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceOrders.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceOrders.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceOrders.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ecommerceOrders.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ecommerceOrders.unknown`


### emailDeliveryLogCrud
*File: `server/routers/emailDeliveryLogCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailDeliveryLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailDeliveryLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailDeliveryLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailDeliveryLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailDeliveryLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailDeliveryLogCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/emailDeliveryLogCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailDeliveryLogCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/emailDeliveryLogCrud.unknown`


### emailNotifications
*File: `server/routers/emailNotifications.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/emailNotifications.unknown`


### encryptedFieldsCrud
*File: `server/routers/encryptedFieldsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/encryptedFieldsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/encryptedFieldsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/encryptedFieldsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/encryptedFieldsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/encryptedFieldsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/encryptedFieldsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/encryptedFieldsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/encryptedFieldsCrud.unknown`


### eodReconciliation
*File: `server/routers/eodReconciliation.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eodReconciliation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/eodReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eodReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eodReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eodReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eodReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eodReconciliation.unknown`


### erp
*File: `server/routers/erp.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/erp.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/erp.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/erp.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/erp.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/erp.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/erp.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/erp.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/erp.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/erp.unknown`


### escalationChains
*File: `server/routers/escalationChains.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/escalationChains.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/escalationChains.unknown`


### esgCarbonTracker
*File: `server/routers/esgCarbonTracker.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/esgCarbonTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/esgCarbonTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/esgCarbonTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/esgCarbonTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/esgCarbonTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/esgCarbonTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/esgCarbonTracker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/esgCarbonTracker.unknown`


### eventDrivenArch
*File: `server/routers/eventDrivenArch.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/eventDrivenArch.unknown`


### executiveCommandCenter
*File: `server/routers/executiveCommandCenter.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/executiveCommandCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/executiveCommandCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/executiveCommandCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/executiveCommandCenter.unknown`


### export
*File: `server/routers/export.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/export.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/export.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/export.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/export.unknown`


### faceEnrollment
*File: `server/routers/faceEnrollment.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/faceEnrollment.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/faceEnrollment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/faceEnrollment.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/faceEnrollment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/faceEnrollment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/faceEnrollment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/faceEnrollment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/faceEnrollment.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/faceEnrollment.unknown`


### falkordbGraph
*File: `server/routers/falkordbGraph.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/falkordbGraph.unknown`


### featureFlags
*File: `server/routers/featureFlags.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/featureFlags.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/featureFlags.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/featureFlags.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/featureFlags.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/featureFlags.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/featureFlags.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/featureFlags.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/featureFlags.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/featureFlags.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/featureFlags.unknown`


### financialNlEngine
*File: `server/routers/financialNlEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialNlEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialNlEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialNlEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialNlEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialNlEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialNlEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialNlEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialNlEngine.unknown`


### financialReconciliationDash
*File: `server/routers/financialReconciliationDash.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReconciliationDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReconciliationDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReconciliationDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReconciliationDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReconciliationDash.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/financialReconciliationDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReconciliationDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReconciliationDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReconciliationDash.unknown`


### financialReportingSuite
*File: `server/routers/financialReportingSuite.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/financialReportingSuite.unknown`


### floatReconciliationsCrud
*File: `server/routers/floatReconciliationsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/floatReconciliationsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/floatReconciliationsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/floatReconciliationsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/floatReconciliationsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/floatReconciliationsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/floatReconciliationsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/floatReconciliationsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/floatReconciliationsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/floatReconciliationsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/floatReconciliationsCrud.unknown`


### fraud
*File: `server/routers/fraud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/fraud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraud.unknown`


### fraudCaseManagement
*File: `server/routers/fraudCaseManagement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudCaseManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudCaseManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudCaseManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudCaseManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudCaseManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudCaseManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudCaseManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudCaseManagement.unknown`


### fraudMlScoringEngine
*File: `server/routers/fraudMlScoringEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudMlScoringEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudMlScoringEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudMlScoringEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudMlScoringEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudMlScoringEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/fraudMlScoringEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudMlScoringEngine.unknown`


### fraudRealtimeViz
*File: `server/routers/fraudRealtimeViz.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudRealtimeViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudRealtimeViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudRealtimeViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudRealtimeViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudRealtimeViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudRealtimeViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudRealtimeViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudRealtimeViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudRealtimeViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudRealtimeViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudRealtimeViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudRealtimeViz.unknown`


### fraudReportGenerator
*File: `server/routers/fraudReportGenerator.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudReportGenerator.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/fraudReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fraudReportGenerator.unknown`


### fxRates
*File: `server/routers/fxRates.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fxRates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fxRates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fxRates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fxRates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fxRates.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/fxRates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fxRates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fxRates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fxRates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/fxRates.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/fxRates.unknown`


### gatewayHealthMonitor
*File: `server/routers/gatewayHealthMonitor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gatewayHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gatewayHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gatewayHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gatewayHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gatewayHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gatewayHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gatewayHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gatewayHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gatewayHealthMonitor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/gatewayHealthMonitor.unknown`


### gdpr
*File: `server/routers/gdpr.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gdpr.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gdpr.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/gdpr.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gdpr.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/gdpr.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gdpr.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gdpr.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gdpr.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/gdpr.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gdpr.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gdpr.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/gdpr.unknown`


### generalLedger
*File: `server/routers/generalLedger.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/generalLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/generalLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/generalLedger.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/generalLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/generalLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/generalLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/generalLedger.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/generalLedger.unknown`


### geoFenceDedicated
*File: `server/routers/geoFenceDedicated.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFenceDedicated.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFenceDedicated.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFenceDedicated.unknown`


### geoFencesCrud
*File: `server/routers/geoFencesCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencesCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/geoFencesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencesCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/geoFencesCrud.unknown`


### geoFencing
*File: `server/routers/geoFencing.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/geoFencing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencing.unknown`


### geoFencingDedicated
*File: `server/routers/geoFencingDedicated.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencingDedicated.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencingDedicated.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencingDedicated.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencingDedicated.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencingDedicated.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/geoFencingDedicated.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencingDedicated.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/geoFencingDedicated.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/geoFencingDedicated.unknown`


### glAccountsCrud
*File: `server/routers/glAccountsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glAccountsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glAccountsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glAccountsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glAccountsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glAccountsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/glAccountsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glAccountsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glAccountsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/glAccountsCrud.unknown`


### glJournalEntriesCrud
*File: `server/routers/glJournalEntriesCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glJournalEntriesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glJournalEntriesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glJournalEntriesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glJournalEntriesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glJournalEntriesCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/glJournalEntriesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glJournalEntriesCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/glJournalEntriesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/glJournalEntriesCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/glJournalEntriesCrud.unknown`


### globalSearch
*File: `server/routers/globalSearch.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/globalSearch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/globalSearch.unknown`


### goServiceBridge
*File: `server/routers/goServiceBridge.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/goServiceBridge.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/goServiceBridge.unknown`


### graphqlFederation
*File: `server/routers/graphqlFederation.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlFederation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlFederation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlFederation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlFederation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlFederation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlFederation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlFederation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlFederation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlFederation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlFederation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/graphqlFederation.unknown`


### graphqlSubscriptionGateway
*File: `server/routers/graphqlSubscriptionGateway.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlSubscriptionGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlSubscriptionGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlSubscriptionGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlSubscriptionGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlSubscriptionGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlSubscriptionGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlSubscriptionGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/graphqlSubscriptionGateway.unknown`


### guideFeedback
*File: `server/routers/guideFeedback.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/guideFeedback.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/guideFeedback.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/guideFeedback.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/guideFeedback.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/guideFeedback.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/guideFeedback.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/guideFeedback.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/guideFeedback.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/guideFeedback.unknown`


### healthCheck
*File: `server/routers/healthCheck.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/healthCheck.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/healthCheck.unknown`


### helpDesk
*File: `server/routers/helpDesk.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/helpDesk.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/helpDesk.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/helpDesk.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/helpDesk.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/helpDesk.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/helpDesk.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/helpDesk.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/helpDesk.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/helpDesk.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/helpDesk.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/helpDesk.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/helpDesk.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/helpDesk.unknown`


### incidentCommandCenter
*File: `server/routers/incidentCommandCenter.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentCommandCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentCommandCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentCommandCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentCommandCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentCommandCenter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/incidentCommandCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentCommandCenter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/incidentCommandCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentCommandCenter.unknown`


### incidentManagement
*File: `server/routers/incidentManagement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/incidentManagement.unknown`


### incidentPlaybook
*File: `server/routers/incidentPlaybook.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentPlaybook.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentPlaybook.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentPlaybook.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentPlaybook.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentPlaybook.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentPlaybook.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentPlaybook.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/incidentPlaybook.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentPlaybook.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/incidentPlaybook.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/incidentPlaybook.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/incidentPlaybook.unknown`


### insuranceProducts
*File: `server/routers/insuranceProducts.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/insuranceProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/insuranceProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/insuranceProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/insuranceProducts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/insuranceProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/insuranceProducts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/insuranceProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/insuranceProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/insuranceProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/insuranceProducts.unknown`


### integrationMarketplace
*File: `server/routers/integrationMarketplace.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/integrationMarketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/integrationMarketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/integrationMarketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/integrationMarketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/integrationMarketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/integrationMarketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/integrationMarketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/integrationMarketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/integrationMarketplace.unknown`


### intelligentRoutingEngine
*File: `server/routers/intelligentRoutingEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/intelligentRoutingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/intelligentRoutingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/intelligentRoutingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/intelligentRoutingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/intelligentRoutingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/intelligentRoutingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/intelligentRoutingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/intelligentRoutingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/intelligentRoutingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/intelligentRoutingEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/intelligentRoutingEngine.unknown`


### inviteCodes
*File: `server/routers/inviteCodes.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/inviteCodes.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/inviteCodes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/inviteCodes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/inviteCodes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/inviteCodes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/inviteCodes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/inviteCodes.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/inviteCodes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/inviteCodes.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/inviteCodes.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/inviteCodes.unknown`


### kafkaConsumer
*File: `server/routers/kafkaConsumer.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kafkaConsumer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kafkaConsumer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kafkaConsumer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kafkaConsumer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kafkaConsumer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kafkaConsumer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kafkaConsumer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kafkaConsumer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kafkaConsumer.unknown`


### kyb
*File: `server/routers/kyb.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyb.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyb.unknown`


### kyc
*File: `server/routers/kyc.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kyc.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kyc.unknown`


### kycDocumentManagement
*File: `server/routers/kycDocumentManagement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycDocumentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycDocumentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentManagement.unknown`


### kycDocumentsCrud
*File: `server/routers/kycDocumentsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycDocumentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycDocumentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycDocumentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycDocumentsCrud.unknown`


### kycEnforcement
*File: `server/routers/kycEnforcement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/kycEnforcement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/kycEnforcement.unknown`


### lakehouse
*File: `server/routers/lakehouse.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouse.unknown`


### lakehouseAiIntegration
*File: `server/routers/lakehouseAiIntegration.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/lakehouseAiIntegration.unknown`


### liveBillingDashboard
*File: `server/routers/liveBillingDashboard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/liveBillingDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/liveBillingDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/liveBillingDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/liveBillingDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/liveBillingDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/liveBillingDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/liveBillingDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/liveBillingDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/liveBillingDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/liveBillingDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/liveBillingDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/liveBillingDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/liveBillingDashboard.unknown`


### loadTestMetrics
*File: `server/routers/loadTestMetrics.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loadTestMetrics.unknown`


### loanDisbursement
*File: `server/routers/loanDisbursement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loanDisbursement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loanDisbursement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loanDisbursement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loanDisbursement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loanDisbursement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loanDisbursement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loanDisbursement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loanDisbursement.unknown`


### loyalty
*File: `server/routers/loyalty.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loyalty.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/loyalty.unknown`


### management
*File: `server/routers/management.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/management.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/management.unknown`


### marketplace
*File: `server/routers/marketplace.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/marketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/marketplace.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/marketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/marketplace.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/marketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/marketplace.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/marketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/marketplace.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/marketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/marketplace.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/marketplace.unknown`


### mccManager
*File: `server/routers/mccManager.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mccManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mccManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mccManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mccManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mccManager.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mccManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mccManager.unknown`


### mdm
*File: `server/routers/mdm.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mdm.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mdm.unknown`


### merchant
*File: `server/routers/merchant.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchant.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchant.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/merchant.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchant.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchant.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchant.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchant.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchant.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/merchant.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchant.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchant.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/merchant.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchant.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchant.unknown`


### merchantAcquirerGateway
*File: `server/routers/merchantAcquirerGateway.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAcquirerGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAcquirerGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAcquirerGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAcquirerGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAcquirerGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAcquirerGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAcquirerGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAcquirerGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAcquirerGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAcquirerGateway.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/merchantAcquirerGateway.unknown`


### merchantAnalyticsDash
*File: `server/routers/merchantAnalyticsDash.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAnalyticsDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantAnalyticsDash.unknown`


### merchantKycOnboarding
*File: `server/routers/merchantKycOnboarding.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantKycOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantKycOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantKycOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/merchantKycOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantKycOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/merchantKycOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantKycOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantKycOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantKycOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantKycOnboarding.unknown`


### merchantOnboardingPortal
*File: `server/routers/merchantOnboardingPortal.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantOnboardingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantOnboardingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantOnboardingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantOnboardingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantOnboardingPortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/merchantOnboardingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantOnboardingPortal.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/merchantOnboardingPortal.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantOnboardingPortal.unknown`


### merchantPayoutSettlement
*File: `server/routers/merchantPayoutSettlement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantPayoutSettlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantPayoutSettlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantPayoutSettlement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/merchantPayoutSettlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantPayoutSettlement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/merchantPayoutSettlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantPayoutSettlement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/merchantPayoutSettlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantPayoutSettlement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/merchantPayoutSettlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantPayoutSettlement.unknown`


### merchantRiskScoring
*File: `server/routers/merchantRiskScoring.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantRiskScoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantRiskScoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantRiskScoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantRiskScoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantRiskScoring.unknown`


### merchantSettlementDashboard
*File: `server/routers/merchantSettlementDashboard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantSettlementDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantSettlementDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantSettlementDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantSettlementDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantSettlementDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantSettlementDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantSettlementDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/merchantSettlementDashboard.unknown`


### mfaManager
*File: `server/routers/mfaManager.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mfaManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mfaManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mfaManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mfaManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mfaManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mfaManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mfaManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mfaManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mfaManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mfaManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mfaManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mfaManager.unknown`


### middlewareServiceManager
*File: `server/routers/middlewareServiceManager.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/middlewareServiceManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/middlewareServiceManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/middlewareServiceManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/middlewareServiceManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/middlewareServiceManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/middlewareServiceManager.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/middlewareServiceManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/middlewareServiceManager.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/middlewareServiceManager.unknown`


### mlScoringService
*File: `server/routers/mlScoringService.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mlScoringService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mlScoringService.unknown`


### mobileApiLayer
*File: `server/routers/mobileApiLayer.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mobileApiLayer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mobileApiLayer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mobileApiLayer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mobileApiLayer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mobileApiLayer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mobileApiLayer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mobileApiLayer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mobileApiLayer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mobileApiLayer.unknown`


### mqttBridge
*File: `server/routers/mqttBridge.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mqttBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mqttBridge.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mqttBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mqttBridge.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mqttBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mqttBridge.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/mqttBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mqttBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/mqttBridge.unknown`


### multiChannelNotificationHub
*File: `server/routers/multiChannelNotificationHub.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelNotificationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelNotificationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelNotificationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelNotificationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelNotificationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelNotificationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelNotificationHub.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelNotificationHub.unknown`


### multiChannelPaymentOrch
*File: `server/routers/multiChannelPaymentOrch.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelPaymentOrch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelPaymentOrch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelPaymentOrch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelPaymentOrch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelPaymentOrch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelPaymentOrch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelPaymentOrch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiChannelPaymentOrch.unknown`


### multiCurrency
*File: `server/routers/multiCurrency.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrency.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrency.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrency.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrency.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrency.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrency.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrency.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrency.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrency.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrency.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrency.unknown`


### multiCurrencyExchange
*File: `server/routers/multiCurrencyExchange.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrencyExchange.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrencyExchange.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrencyExchange.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrencyExchange.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrencyExchange.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrencyExchange.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrencyExchange.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrencyExchange.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrencyExchange.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrencyExchange.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiCurrencyExchange.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/multiCurrencyExchange.unknown`


### multiSimFailover
*File: `server/routers/multiSimFailover.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiSimFailover.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiSimFailover.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiSimFailover.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/multiSimFailover.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiSimFailover.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/multiSimFailover.unknown`


### multiTenancy
*File: `server/routers/multiTenancy.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenancy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenancy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenancy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenancy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenancy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenancy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenancy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenancy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenancy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenancy.unknown`


### multiTenantIsolation
*File: `server/routers/multiTenantIsolation.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenantIsolation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenantIsolation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenantIsolation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenantIsolation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenantIsolation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/multiTenantIsolation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenantIsolation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/multiTenantIsolation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/multiTenantIsolation.unknown`


### networkQualityHeatmap
*File: `server/routers/networkQualityHeatmap.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkQualityHeatmap.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkQualityHeatmap.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkQualityHeatmap.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkQualityHeatmap.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkQualityHeatmap.unknown`


### networkResilience
*File: `server/routers/networkResilience.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkResilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkResilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkResilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkResilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/networkResilience.unknown`


### networkStatusDashboard
*File: `server/routers/networkStatusDashboard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkStatusDashboard.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/networkStatusDashboard.unknown`


### networkTelemetry
*File: `server/routers/networkTelemetry.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkTelemetry.unknown`


### networkTrends
*File: `server/routers/networkTrends.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkTrends.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkTrends.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkTrends.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkTrends.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkTrends.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/networkTrends.unknown`


### nlAnalyticsQuery
*File: `server/routers/nlAnalyticsQuery.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlAnalyticsQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlAnalyticsQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlAnalyticsQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlAnalyticsQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlAnalyticsQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlAnalyticsQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlAnalyticsQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlAnalyticsQuery.unknown`


### nlFinancialQuery
*File: `server/routers/nlFinancialQuery.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlFinancialQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlFinancialQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlFinancialQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlFinancialQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlFinancialQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlFinancialQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlFinancialQuery.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/nlFinancialQuery.unknown`


### notificationCenter
*File: `server/routers/notificationCenter.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationCenter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/notificationCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationCenter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/notificationCenter.unknown`


### notificationChannelsCrud
*File: `server/routers/notificationChannelsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationChannelsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationChannelsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationChannelsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationChannelsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationChannelsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/notificationChannelsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationChannelsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationChannelsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/notificationChannelsCrud.unknown`


### notificationInbox
*File: `server/routers/notificationInbox.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationInbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationInbox.unknown`


### notificationLogsCrud
*File: `server/routers/notificationLogsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationLogsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationLogsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationLogsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationLogsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationLogsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationLogsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/notificationLogsCrud.unknown`


### notificationOrchestrator
*File: `server/routers/notificationOrchestrator.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationOrchestrator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationOrchestrator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationOrchestrator.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/notificationOrchestrator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationOrchestrator.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/notificationOrchestrator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationOrchestrator.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/notificationOrchestrator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationOrchestrator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationOrchestrator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/notificationOrchestrator.unknown`


### observabilityAlertsCrud
*File: `server/routers/observabilityAlertsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/observabilityAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/observabilityAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/observabilityAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/observabilityAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/observabilityAlertsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/observabilityAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/observabilityAlertsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/observabilityAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/observabilityAlertsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/observabilityAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/observabilityAlertsCrud.unknown`


### offlinePosMode
*File: `server/routers/offlinePosMode.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlinePosMode.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlinePosMode.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/offlinePosMode.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlinePosMode.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/offlinePosMode.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlinePosMode.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/offlinePosMode.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlinePosMode.unknown`


### offlineQueue
*File: `server/routers/offlineQueue.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineQueue.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineQueue.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineQueue.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineQueue.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineQueue.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineQueue.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineQueue.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineQueue.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/offlineQueue.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineQueue.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineQueue.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineQueue.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineQueue.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/offlineQueue.unknown`


### offlineSync
*File: `server/routers/offlineSync.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineSync.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/offlineSync.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineSync.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineSync.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineSync.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineSync.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineSync.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/offlineSync.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineSync.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineSync.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/offlineSync.unknown`


### ollamaLLM
*File: `server/routers/ollamaLLM.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ollamaLLM.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ollamaLLM.unknown`


### openTelemetry
*File: `server/routers/openTelemetry.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/openTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/openTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/openTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/openTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/openTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/openTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/openTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/openTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/openTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/openTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/openTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/openTelemetry.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/openTelemetry.unknown`


### operationalCommandBridge
*File: `server/routers/operationalCommandBridge.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalCommandBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalCommandBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalCommandBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalCommandBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalCommandBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalCommandBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalCommandBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalCommandBridge.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/operationalCommandBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalCommandBridge.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalCommandBridge.unknown`


### operationalRunbook
*File: `server/routers/operationalRunbook.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalRunbook.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalRunbook.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalRunbook.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/operationalRunbook.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/operationalRunbook.unknown`


### partnerOnboarding
*File: `server/routers/partnerOnboarding.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/partnerOnboarding.unknown`


### partnerRevenueSharing
*File: `server/routers/partnerRevenueSharing.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerRevenueSharing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerRevenueSharing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerRevenueSharing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerRevenueSharing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerRevenueSharing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerRevenueSharing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerRevenueSharing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerRevenueSharing.unknown`


### partnerSelfService
*File: `server/routers/partnerSelfService.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerSelfService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerSelfService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerSelfService.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/partnerSelfService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerSelfService.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/partnerSelfService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerSelfService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerSelfService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerSelfService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerSelfService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/partnerSelfService.unknown`


### paymentDisputeArbitration
*File: `server/routers/paymentDisputeArbitration.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentDisputeArbitration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentDisputeArbitration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentDisputeArbitration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentDisputeArbitration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentDisputeArbitration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentDisputeArbitration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentDisputeArbitration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentDisputeArbitration.unknown`


### paymentGatewayRouter
*File: `server/routers/paymentGatewayRouter.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentGatewayRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentGatewayRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentGatewayRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentGatewayRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentGatewayRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentGatewayRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentGatewayRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentGatewayRouter.unknown`


### paymentLinkGenerator
*File: `server/routers/paymentLinkGenerator.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentLinkGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentLinkGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentLinkGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentLinkGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentLinkGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentLinkGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentLinkGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentLinkGenerator.unknown`


### paymentNotificationSystem
*File: `server/routers/paymentNotificationSystem.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentNotificationSystem.unknown`


### paymentReconciliation
*File: `server/routers/paymentReconciliation.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentReconciliation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/paymentReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentReconciliation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/paymentReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentReconciliation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/paymentReconciliation.unknown`


### paymentTokenVault
*File: `server/routers/paymentTokenVault.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentTokenVault.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentTokenVault.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentTokenVault.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/paymentTokenVault.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentTokenVault.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/paymentTokenVault.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/paymentTokenVault.unknown`


### pbacManagement
*File: `server/routers/pbacManagement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pbacManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/pbacManagement.unknown`


### pensionCollection
*File: `server/routers/pensionCollection.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pensionCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pensionCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pensionCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pensionCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pensionCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pensionCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pensionCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pensionCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pensionCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pensionCollection.unknown`


### performanceProfiler
*File: `server/routers/performanceProfiler.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/performanceProfiler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/performanceProfiler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/performanceProfiler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/performanceProfiler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/performanceProfiler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/performanceProfiler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/performanceProfiler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/performanceProfiler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/performanceProfiler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/performanceProfiler.unknown`


### pipelineMonitoring
*File: `server/routers/pipelineMonitoring.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pipelineMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pipelineMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pipelineMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pipelineMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pipelineMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pipelineMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pipelineMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pipelineMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pipelineMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pipelineMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pipelineMonitoring.unknown`


### platformABTesting
*File: `server/routers/platformABTesting.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformABTesting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformABTesting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformABTesting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformABTesting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformABTesting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformABTesting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformABTesting.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformABTesting.unknown`


### platformCapacityPlanner
*File: `server/routers/platformCapacityPlanner.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCapacityPlanner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCapacityPlanner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCapacityPlanner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCapacityPlanner.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformCapacityPlanner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCapacityPlanner.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformCapacityPlanner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCapacityPlanner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCapacityPlanner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCapacityPlanner.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformCapacityPlanner.unknown`


### platformChangelog
*File: `server/routers/platformChangelog.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformChangelog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformChangelog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformChangelog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformChangelog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformChangelog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformChangelog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformChangelog.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformChangelog.unknown`


### platformConfigCenter
*File: `server/routers/platformConfigCenter.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformConfigCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformConfigCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformConfigCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformConfigCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformConfigCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformConfigCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformConfigCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformConfigCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformConfigCenter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformConfigCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformConfigCenter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformConfigCenter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformConfigCenter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformConfigCenter.unknown`


### platformCostAllocator
*File: `server/routers/platformCostAllocator.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCostAllocator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCostAllocator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCostAllocator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCostAllocator.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformCostAllocator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCostAllocator.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformCostAllocator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCostAllocator.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformCostAllocator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCostAllocator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformCostAllocator.unknown`


### platformFeatureFlags
*File: `server/routers/platformFeatureFlags.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformFeatureFlags.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformFeatureFlags.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformFeatureFlags.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformFeatureFlags.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformFeatureFlags.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformFeatureFlags.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformFeatureFlags.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformFeatureFlags.unknown`


### platformHealth
*File: `server/routers/platformHealth.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealth.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealth.unknown`


### platformHealthDash
*File: `server/routers/platformHealthDash.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthDash.unknown`


### platformHealthMonitor
*File: `server/routers/platformHealthMonitor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthMonitor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformHealthMonitor.unknown`


### platformHealthScorecard
*File: `server/routers/platformHealthScorecard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformHealthScorecard.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformHealthScorecard.unknown`


### platformMaturityScorecard
*File: `server/routers/platformMaturityScorecard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMaturityScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMaturityScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMaturityScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMaturityScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMaturityScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMaturityScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMaturityScorecard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMaturityScorecard.unknown`


### platformMetricsExporter
*File: `server/routers/platformMetricsExporter.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMetricsExporter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMetricsExporter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMetricsExporter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMetricsExporter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMetricsExporter.unknown`


### platformMigrationToolkit
*File: `server/routers/platformMigrationToolkit.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMigrationToolkit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMigrationToolkit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMigrationToolkit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMigrationToolkit.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformMigrationToolkit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMigrationToolkit.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformMigrationToolkit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformMigrationToolkit.unknown`


### platformProxy
*File: `server/routers/platformProxy.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformProxy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformProxy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformProxy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformProxy.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformProxy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformProxy.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformProxy.unknown`


### platformRecommendations
*File: `server/routers/platformRecommendations.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRecommendations.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRecommendations.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRecommendations.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRecommendations.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformRecommendations.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRecommendations.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformRecommendations.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRecommendations.unknown`


### platformRevenueOptimizer
*File: `server/routers/platformRevenueOptimizer.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRevenueOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRevenueOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRevenueOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRevenueOptimizer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformRevenueOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRevenueOptimizer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformRevenueOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRevenueOptimizer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformRevenueOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRevenueOptimizer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformRevenueOptimizer.unknown`


### platformSlaMonitor
*File: `server/routers/platformSlaMonitor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformSlaMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformSlaMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformSlaMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformSlaMonitor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformSlaMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformSlaMonitor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/platformSlaMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/platformSlaMonitor.unknown`


### pnlReport
*File: `server/routers/pnlReport.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReport.unknown`


### pnlReportsCrud
*File: `server/routers/pnlReportsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReportsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReportsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReportsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReportsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReportsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReportsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pnlReportsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/pnlReportsCrud.unknown`


### posDispute
*File: `server/routers/posDispute.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posDispute.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/posDispute.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posDispute.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posDispute.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posDispute.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posDispute.unknown`


### posFirmwareOTA
*File: `server/routers/posFirmwareOTA.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posFirmwareOTA.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posFirmwareOTA.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posFirmwareOTA.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/posFirmwareOTA.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posFirmwareOTA.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/posFirmwareOTA.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posFirmwareOTA.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posFirmwareOTA.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posFirmwareOTA.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/posFirmwareOTA.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posFirmwareOTA.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posFirmwareOTA.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posFirmwareOTA.unknown`


### posTerminalFleet
*File: `server/routers/posTerminalFleet.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/posTerminalFleet.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/posTerminalFleet.unknown`


### predictiveAgentChurn
*File: `server/routers/predictiveAgentChurn.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/predictiveAgentChurn.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/predictiveAgentChurn.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/predictiveAgentChurn.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/predictiveAgentChurn.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/predictiveAgentChurn.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/predictiveAgentChurn.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/predictiveAgentChurn.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/predictiveAgentChurn.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/predictiveAgentChurn.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/predictiveAgentChurn.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/predictiveAgentChurn.unknown`


### productionFeatures
*File: `server/routers/productionFeatures.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/productionFeatures.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/productionFeatures.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/productionFeatures.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/productionFeatures.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/productionFeatures.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/productionFeatures.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/productionFeatures.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/productionFeatures.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/productionFeatures.unknown`


### promotions
*File: `server/routers/promotions.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/promotions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/promotions.unknown`


### publishReadinessChecker
*File: `server/routers/publishReadinessChecker.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/publishReadinessChecker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/publishReadinessChecker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/publishReadinessChecker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/publishReadinessChecker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/publishReadinessChecker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/publishReadinessChecker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/publishReadinessChecker.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/publishReadinessChecker.unknown`


### pushNotifications
*File: `server/routers/pushNotifications.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pushNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pushNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/pushNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pushNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/pushNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pushNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pushNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/pushNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/pushNotifications.unknown`


### qdrantVectorSearch
*File: `server/routers/qdrantVectorSearch.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/qdrantVectorSearch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/qdrantVectorSearch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/qdrantVectorSearch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/qdrantVectorSearch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/qdrantVectorSearch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/qdrantVectorSearch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/qdrantVectorSearch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/qdrantVectorSearch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/qdrantVectorSearch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/qdrantVectorSearch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/qdrantVectorSearch.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/qdrantVectorSearch.unknown`


### ransomwareAlerts
*File: `server/routers/ransomwareAlerts.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ransomwareAlerts.unknown`


### rateAlerts
*File: `server/routers/rateAlerts.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateAlerts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/rateAlerts.unknown`


### rateLimitEngine
*File: `server/routers/rateLimitEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateLimitEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateLimitEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateLimitEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/rateLimitEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateLimitEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/rateLimitEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateLimitEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/rateLimitEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateLimitEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateLimitEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateLimitEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/rateLimitEngine.unknown`


### realtimeDashboardWidgets
*File: `server/routers/realtimeDashboardWidgets.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeDashboardWidgets.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeDashboardWidgets.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeDashboardWidgets.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeDashboardWidgets.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeDashboardWidgets.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeDashboardWidgets.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeDashboardWidgets.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeDashboardWidgets.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeDashboardWidgets.unknown`


### realtimeNotifications
*File: `server/routers/realtimeNotifications.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/realtimeNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/realtimeNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/realtimeNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/realtimeNotifications.unknown`


### realtimePnlDashboard
*File: `server/routers/realtimePnlDashboard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimePnlDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimePnlDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimePnlDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimePnlDashboard.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/realtimePnlDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimePnlDashboard.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/realtimePnlDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimePnlDashboard.unknown`


### realtimeTxAlertsCrud
*File: `server/routers/realtimeTxAlertsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxAlertsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/realtimeTxAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxAlertsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/realtimeTxAlertsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxAlertsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/realtimeTxAlertsCrud.unknown`


### realtimeTxMonitor
*File: `server/routers/realtimeTxMonitor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxMonitor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/realtimeTxMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeTxMonitor.unknown`


### realtimeWebSocketFeeds
*File: `server/routers/realtimeWebSocketFeeds.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeWebSocketFeeds.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeWebSocketFeeds.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeWebSocketFeeds.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeWebSocketFeeds.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeWebSocketFeeds.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeWebSocketFeeds.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeWebSocketFeeds.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/realtimeWebSocketFeeds.unknown`


### receiptTemplates
*File: `server/routers/receiptTemplates.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/receiptTemplates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/receiptTemplates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/receiptTemplates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/receiptTemplates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/receiptTemplates.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/receiptTemplates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/receiptTemplates.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/receiptTemplates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/receiptTemplates.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/receiptTemplates.unknown`


### reconciliationEngine
*File: `server/routers/reconciliationEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reconciliationEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reconciliationEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reconciliationEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reconciliationEngine.unknown`


### recurringPayments
*File: `server/routers/recurringPayments.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/recurringPayments.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/recurringPayments.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/recurringPayments.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/recurringPayments.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/recurringPayments.unknown`


### referralProgram
*File: `server/routers/referralProgram.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referralProgram.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referralProgram.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referralProgram.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/referralProgram.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referralProgram.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referralProgram.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referralProgram.unknown`


### referrals
*File: `server/routers/referrals.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/referrals.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/referrals.unknown`


### regulatoryCompliance
*File: `server/routers/regulatoryCompliance.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryCompliance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryCompliance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryCompliance.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/regulatoryCompliance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryCompliance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryCompliance.unknown`


### regulatoryComplianceChecks
*File: `server/routers/regulatoryComplianceChecks.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryComplianceChecks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryComplianceChecks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryComplianceChecks.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/regulatoryComplianceChecks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryComplianceChecks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryComplianceChecks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryComplianceChecks.unknown`


### regulatoryFilingAutomation
*File: `server/routers/regulatoryFilingAutomation.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryFilingAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryFilingAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryFilingAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryFilingAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryFilingAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryFilingAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryFilingAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryFilingAutomation.unknown`


### regulatoryReportGenerator
*File: `server/routers/regulatoryReportGenerator.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportGenerator.unknown`


### regulatoryReportingEngine
*File: `server/routers/regulatoryReportingEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatoryReportingEngine.unknown`


### regulatorySandbox
*File: `server/routers/regulatorySandbox.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandbox.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandbox.unknown`


### regulatorySandboxTester
*File: `server/routers/regulatorySandboxTester.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandboxTester.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandboxTester.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandboxTester.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandboxTester.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandboxTester.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandboxTester.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandboxTester.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandboxTester.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandboxTester.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/regulatorySandboxTester.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/regulatorySandboxTester.unknown`


### remittance
*File: `server/routers/remittance.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/remittance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/remittance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/remittance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/remittance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/remittance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/remittance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/remittance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/remittance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/remittance.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/remittance.unknown`


### reportBuilderTemplates
*File: `server/routers/reportBuilderTemplates.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportBuilderTemplates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportBuilderTemplates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportBuilderTemplates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportBuilderTemplates.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportBuilderTemplates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportBuilderTemplates.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportBuilderTemplates.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportBuilderTemplates.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportBuilderTemplates.unknown`


### reportScheduler
*File: `server/routers/reportScheduler.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportScheduler.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportScheduler.unknown`


### reportTemplateDesigner
*File: `server/routers/reportTemplateDesigner.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reportTemplateDesigner.unknown`


### resilience
*File: `server/routers/resilience.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilience.unknown`


### resilienceHardening
*File: `server/routers/resilienceHardening.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/resilienceHardening.unknown`


### revenueAnalytics
*File: `server/routers/revenueAnalytics.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueAnalytics.unknown`


### revenueForecastingEngine
*File: `server/routers/revenueForecastingEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueForecastingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueForecastingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueForecastingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueForecastingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueForecastingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueForecastingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueForecastingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueForecastingEngine.unknown`


### revenueLeakageDetector
*File: `server/routers/revenueLeakageDetector.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueLeakageDetector.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueLeakageDetector.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueLeakageDetector.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueLeakageDetector.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueLeakageDetector.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueLeakageDetector.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueLeakageDetector.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueLeakageDetector.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueLeakageDetector.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/revenueLeakageDetector.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueLeakageDetector.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/revenueLeakageDetector.unknown`


### revenueReconciliation
*File: `server/routers/revenueReconciliation.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/revenueReconciliation.unknown`


### reversalApproval
*File: `server/routers/reversalApproval.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reversalApproval.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reversalApproval.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reversalApproval.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reversalApproval.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reversalApproval.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reversalApproval.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reversalApproval.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/reversalApproval.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reversalApproval.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/reversalApproval.unknown`


### runtimeConfigAdmin
*File: `server/routers/runtimeConfigAdmin.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/runtimeConfigAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/runtimeConfigAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/runtimeConfigAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/runtimeConfigAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/runtimeConfigAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/runtimeConfigAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/runtimeConfigAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/runtimeConfigAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/runtimeConfigAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/runtimeConfigAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/runtimeConfigAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/runtimeConfigAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/runtimeConfigAdmin.unknown`


### savingsProducts
*File: `server/routers/savingsProducts.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/savingsProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/savingsProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/savingsProducts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/savingsProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/savingsProducts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/savingsProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/savingsProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/savingsProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/savingsProducts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/savingsProducts.unknown`


### scheduledReports
*File: `server/routers/scheduledReports.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/scheduledReports.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/scheduledReports.unknown`


### securityAudit
*File: `server/routers/securityAudit.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityAudit.unknown`


### securityHardening
*File: `server/routers/securityHardening.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/securityHardening.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/securityHardening.unknown`


### serviceMesh
*File: `server/routers/serviceMesh.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/serviceMesh.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/serviceMesh.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/serviceMesh.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/serviceMesh.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/serviceMesh.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/serviceMesh.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/serviceMesh.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/serviceMesh.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/serviceMesh.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/serviceMesh.unknown`


### settlement
*File: `server/routers/settlement.ts`*

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/settlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/settlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/settlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlement.unknown`


### settlementBatchProcessor
*File: `server/routers/settlementBatchProcessor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementBatchProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementBatchProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementBatchProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementBatchProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementBatchProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementBatchProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementBatchProcessor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementBatchProcessor.unknown`


### settlementNettingEngine
*File: `server/routers/settlementNettingEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementNettingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementNettingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementNettingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementNettingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementNettingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementNettingEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/settlementNettingEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementNettingEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/settlementNettingEngine.unknown`


### settlementReconciliation
*File: `server/routers/settlementReconciliation.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementReconciliation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/settlementReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementReconciliation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/settlementReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/settlementReconciliation.unknown`


### sharedLayouts
*File: `server/routers/sharedLayouts.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sharedLayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sharedLayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sharedLayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sharedLayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sharedLayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sharedLayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sharedLayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sharedLayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sharedLayouts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sharedLayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sharedLayouts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sharedLayouts.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sharedLayouts.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sharedLayouts.unknown`


### skillCreatorIntegration
*File: `server/routers/skillCreatorIntegration.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/skillCreatorIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/skillCreatorIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/skillCreatorIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/skillCreatorIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/skillCreatorIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/skillCreatorIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/skillCreatorIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/skillCreatorIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/skillCreatorIntegration.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/skillCreatorIntegration.unknown`


### slaManagement
*File: `server/routers/slaManagement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaManagement.unknown`


### slaMonitoring
*File: `server/routers/slaMonitoring.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoring.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/slaMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoring.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/slaMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoring.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/slaMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoring.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/slaMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoring.unknown`


### slaMonitoringDash
*File: `server/routers/slaMonitoringDash.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoringDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoringDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoringDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoringDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoringDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoringDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoringDash.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/slaMonitoringDash.unknown`


### smartContractPayment
*File: `server/routers/smartContractPayment.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smartContractPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smartContractPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smartContractPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smartContractPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smartContractPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smartContractPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smartContractPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smartContractPayment.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/smartContractPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smartContractPayment.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smartContractPayment.unknown`


### smsNotifications
*File: `server/routers/smsNotifications.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/smsNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsNotifications.unknown`


### smsReceipt
*File: `server/routers/smsReceipt.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/smsReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/smsReceipt.unknown`


### socialCommerceGateway
*File: `server/routers/socialCommerceGateway.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/socialCommerceGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/socialCommerceGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/socialCommerceGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/socialCommerceGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/socialCommerceGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/socialCommerceGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/socialCommerceGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/socialCommerceGateway.unknown`


### sprint15Features
*File: `server/routers/sprint15Features.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/sprint15Features.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint15Features.unknown`


### sprint23Router
*File: `server/routers/sprint23Router.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint23Router.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint23Router.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint23Router.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint23Router.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint23Router.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint23Router.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint23Router.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint23Router.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint23Router.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint23Router.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint23Router.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint23Router.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/sprint23Router.unknown`


### superAdmin
*File: `server/routers/superAdmin.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/superAdmin.unknown`


### supervisor
*File: `server/routers/supervisor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supervisor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supervisor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supervisor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supervisor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supervisor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supervisor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supervisor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supervisor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supervisor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supervisor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supervisor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supervisor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supervisor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supervisor.unknown`


### supplyChain
*File: `server/routers/supplyChain.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/supplyChain.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/supplyChain.unknown`


### systemConfig
*File: `server/routers/systemConfig.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfig.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfig.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfig.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfig.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/systemConfig.unknown`


### systemConfigManager
*File: `server/routers/systemConfigManager.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfigManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfigManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfigManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfigManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfigManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfigManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfigManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfigManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfigManager.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/systemConfigManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemConfigManager.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/systemConfigManager.unknown`


### systemHealthDashboard
*File: `server/routers/systemHealthDashboard.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthDashboard.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/systemHealthDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthDashboard.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthDashboard.unknown`


### systemHealthMonitor
*File: `server/routers/systemHealthMonitor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemHealthMonitor.unknown`


### systemMigrationTools
*File: `server/routers/systemMigrationTools.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemMigrationTools.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemMigrationTools.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemMigrationTools.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemMigrationTools.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemMigrationTools.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemMigrationTools.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemMigrationTools.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/systemMigrationTools.unknown`


### taxCollection
*File: `server/routers/taxCollection.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/taxCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/taxCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/taxCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/taxCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/taxCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/taxCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/taxCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/taxCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/taxCollection.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/taxCollection.unknown`


### temporalWorkflows
*File: `server/routers/temporalWorkflows.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/temporalWorkflows.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/temporalWorkflows.unknown`


### tenantAdmin
*File: `server/routers/tenantAdmin.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantAdmin.unknown`


### tenantBillingOnboarding
*File: `server/routers/tenantBillingOnboarding.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBillingOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBillingOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantBillingOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBillingOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBillingOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBillingOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantBillingOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBillingOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBillingOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBillingOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantBillingOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBillingOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantBillingOnboarding.unknown`


### tenantBrandingCrud
*File: `server/routers/tenantBrandingCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBrandingCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBrandingCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBrandingCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBrandingCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBrandingCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBrandingCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBrandingCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantBrandingCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantBrandingCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantBrandingCrud.unknown`


### tenantFeatureToggle
*File: `server/routers/tenantFeatureToggle.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeatureToggle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeatureToggle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeatureToggle.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantFeatureToggle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeatureToggle.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantFeatureToggle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeatureToggle.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantFeatureToggle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeatureToggle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeatureToggle.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeatureToggle.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantFeatureToggle.unknown`


### tenantFeeOverridesCrud
*File: `server/routers/tenantFeeOverridesCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeeOverridesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeeOverridesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeeOverridesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeeOverridesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeeOverridesCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantFeeOverridesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeeOverridesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeeOverridesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/tenantFeeOverridesCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/tenantFeeOverridesCrud.unknown`


### terminalLeasing
*File: `server/routers/terminalLeasing.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/terminalLeasing.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/terminalLeasing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/terminalLeasing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/terminalLeasing.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/terminalLeasing.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/terminalLeasing.unknown`


### trainingCertification
*File: `server/routers/trainingCertification.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCertification.unknown`


### trainingCoursesCrud
*File: `server/routers/trainingCoursesCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCoursesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCoursesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCoursesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCoursesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCoursesCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/trainingCoursesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCoursesCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/trainingCoursesCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingCoursesCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/trainingCoursesCrud.unknown`


### trainingEnrollmentsCrud
*File: `server/routers/trainingEnrollmentsCrud.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/trainingEnrollmentsCrud.unknown`


### transactionCsvExport
*File: `server/routers/transactionCsvExport.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionCsvExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionCsvExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionCsvExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionCsvExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionCsvExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionCsvExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionCsvExport.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionCsvExport.unknown`


### transactionDisputeResolution
*File: `server/routers/transactionDisputeResolution.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionDisputeResolution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionDisputeResolution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionDisputeResolution.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactionDisputeResolution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionDisputeResolution.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactionDisputeResolution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionDisputeResolution.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactionDisputeResolution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionDisputeResolution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionDisputeResolution.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionDisputeResolution.unknown`


### transactionEnrichmentService
*File: `server/routers/transactionEnrichmentService.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionEnrichmentService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionEnrichmentService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionEnrichmentService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionEnrichmentService.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactionEnrichmentService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionEnrichmentService.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactionEnrichmentService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionEnrichmentService.unknown`


### transactionExportEngine
*File: `server/routers/transactionExportEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionExportEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionExportEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionExportEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionExportEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionExportEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionExportEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionExportEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionExportEngine.unknown`


### transactionFeeCalc
*File: `server/routers/transactionFeeCalc.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionFeeCalc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionFeeCalc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionFeeCalc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionFeeCalc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionFeeCalc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionFeeCalc.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionFeeCalc.unknown`


### transactionGraphAnalyzer
*File: `server/routers/transactionGraphAnalyzer.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionGraphAnalyzer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionGraphAnalyzer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionGraphAnalyzer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionGraphAnalyzer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionGraphAnalyzer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionGraphAnalyzer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionGraphAnalyzer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionGraphAnalyzer.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactionGraphAnalyzer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionGraphAnalyzer.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionGraphAnalyzer.unknown`


### transactionLimitsEngine
*File: `server/routers/transactionLimitsEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionLimitsEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionLimitsEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionLimitsEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionLimitsEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionLimitsEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionLimitsEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactionLimitsEngine.unknown`


### transactionMapLoading
*File: `server/routers/transactionMapLoading.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapLoading.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapLoading.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapLoading.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapLoading.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapLoading.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapLoading.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapLoading.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapLoading.unknown`


### transactionMapViz
*File: `server/routers/transactionMapViz.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapViz.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMapViz.unknown`


### transactionMonitoring
*File: `server/routers/transactionMonitoring.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMonitoring.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionMonitoring.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactionMonitoring.unknown`


### transactionReceiptGenerator
*File: `server/routers/transactionReceiptGenerator.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReceiptGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReceiptGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReceiptGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReceiptGenerator.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactionReceiptGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReceiptGenerator.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactionReceiptGenerator.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReceiptGenerator.unknown`


### transactionReconciliation
*File: `server/routers/transactionReconciliation.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReconciliation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReconciliation.unknown`


### transactionReversalManager
*File: `server/routers/transactionReversalManager.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalManager.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalManager.unknown`


### transactionReversalWorkflow
*File: `server/routers/transactionReversalWorkflow.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalWorkflow.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactionReversalWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalWorkflow.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactionReversalWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalWorkflow.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactionReversalWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalWorkflow.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionReversalWorkflow.unknown`


### transactionVelocityMonitor
*File: `server/routers/transactionVelocityMonitor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionVelocityMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionVelocityMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionVelocityMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionVelocityMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionVelocityMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionVelocityMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactionVelocityMonitor.unknown`


### transactions
*File: `server/routers/transactions.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/transactions.unknown`


### txDisputeArbitration
*File: `server/routers/txDisputeArbitration.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txDisputeArbitration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txDisputeArbitration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txDisputeArbitration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txDisputeArbitration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txDisputeArbitration.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/txDisputeArbitration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txDisputeArbitration.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/txDisputeArbitration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txDisputeArbitration.unknown`


### txMonitor
*File: `server/routers/txMonitor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/txMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txMonitor.unknown`


### txVelocityMonitor
*File: `server/routers/txVelocityMonitor.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txVelocityMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txVelocityMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txVelocityMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txVelocityMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txVelocityMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txVelocityMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txVelocityMonitor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/txVelocityMonitor.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/txVelocityMonitor.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/txVelocityMonitor.unknown`


### userNotifPreferences
*File: `server/routers/userNotifPreferences.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/userNotifPreferences.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/userNotifPreferences.unknown`


### ussdAnalytics
*File: `server/routers/ussdAnalytics.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdAnalytics.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdAnalytics.unknown`


### ussdGateway
*File: `server/routers/ussdGateway.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdGateway.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ussdGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdGateway.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdGateway.unknown`


### ussdIntegration
*File: `server/routers/ussdIntegration.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdIntegration.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ussdIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdIntegration.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ussdIntegration.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdIntegration.unknown`


### ussdLocalization
*File: `server/routers/ussdLocalization.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdLocalization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdLocalization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdLocalization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdLocalization.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdLocalization.unknown`


### ussdReceipt
*File: `server/routers/ussdReceipt.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdReceipt.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/ussdReceipt.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdReceipt.unknown`


### ussdSessionReplay
*File: `server/routers/ussdSessionReplay.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/ussdSessionReplay.unknown`


### vaultSecrets
*File: `server/routers/vaultSecrets.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/vaultSecrets.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/vaultSecrets.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/vaultSecrets.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/vaultSecrets.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/vaultSecrets.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/vaultSecrets.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/vaultSecrets.unknown`


### webhookDeliverySystem
*File: `server/routers/webhookDeliverySystem.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookDeliverySystem.unknown`


### webhookManagement
*File: `server/routers/webhookManagement.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookManagement.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookManagement.unknown`


### webhookNotifications
*File: `server/routers/webhookNotifications.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhookNotifications.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhookNotifications.unknown`


### webhooks
*File: `server/routers/webhooks.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/webhooks.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/webhooks.unknown`


### websocketService
*File: `server/routers/websocketService.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/websocketService.unknown`


### weeklyReports
*File: `server/routers/weeklyReports.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/weeklyReports.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/weeklyReports.unknown`


### whatsappChannel
*File: `server/routers/whatsappChannel.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whatsappChannel.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whatsappChannel.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whatsappChannel.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whatsappChannel.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whatsappChannel.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whatsappChannel.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whatsappChannel.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whatsappChannel.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whatsappChannel.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whatsappChannel.unknown`


### whiteLabelApproval
*File: `server/routers/whiteLabelApproval.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelApproval.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelApproval.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelApproval.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelApproval.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/whiteLabelApproval.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelApproval.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/whiteLabelApproval.unknown`


### whiteLabelBranding
*File: `server/routers/whiteLabelBranding.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelBranding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelBranding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelBranding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelBranding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/whiteLabelBranding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelBranding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelBranding.unknown`


### whiteLabelOnboarding
*File: `server/routers/whiteLabelOnboarding.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/whiteLabelOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelOnboarding.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/whiteLabelOnboarding.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/whiteLabelOnboarding.unknown`


### workflowAutomation
*File: `server/routers/workflowAutomation.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowAutomation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/workflowAutomation.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowAutomation.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/workflowAutomation.unknown`


### workflowEngine
*File: `server/routers/workflowEngine.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowEngine.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/workflowEngine.unknown`


### routers
*File: `server/routers.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/routers.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/routers.unknown`


### stripeRouter
*File: `server/stripe/stripeRouter.ts`*

#### unknown
- **Type:** query
- **Path:** `/api/trpc/stripeRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/stripeRouter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/stripeRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/stripeRouter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/stripeRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/stripeRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/stripeRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/stripeRouter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/stripeRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/stripeRouter.unknown`

#### unknown
- **Type:** query
- **Path:** `/api/trpc/stripeRouter.unknown`

#### unknown
- **Type:** mutation
- **Path:** `/api/trpc/stripeRouter.unknown`


---

## OpenAPI Specification

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "NextGen INS API",
    "version": "1.0.0",
    "description": "Insurance platform API documentation"
  },
  "servers": [
    {
      "url": "http://localhost:3000",
      "description": "Local development server"
    }
  ],
  "paths": {
    "/api/trpc/index.unknown": {
      "post": {
        "summary": "unknown (index)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/systemRouter.unknown": {
      "post": {
        "summary": "unknown (systemRouter)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/voiceTranscription.unknown": {
      "post": {
        "summary": "unknown (voiceTranscription)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/healthCheck.unknown": {
      "post": {
        "summary": "unknown (healthCheck)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/highAvailability.unknown": {
      "post": {
        "summary": "unknown (highAvailability)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/performanceTuning.unknown": {
      "post": {
        "summary": "unknown (performanceTuning)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/serviceOrchestrator.unknown": {
      "post": {
        "summary": "unknown (serviceOrchestrator)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/tenantIsolation.unknown": {
      "post": {
        "summary": "unknown (tenantIsolation)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/accountOpening.unknown": {
      "post": {
        "summary": "unknown (accountOpening)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/activityAuditLog.unknown": {
      "post": {
        "summary": "unknown (activityAuditLog)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/adminDashboard.unknown": {
      "post": {
        "summary": "unknown (adminDashboard)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/advancedAuditLogViewer.unknown": {
      "post": {
        "summary": "unknown (advancedAuditLogViewer)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/advancedBiReporting.unknown": {
      "post": {
        "summary": "unknown (advancedBiReporting)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/advancedLoadingStates.unknown": {
      "post": {
        "summary": "unknown (advancedLoadingStates)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/advancedNotifications.unknown": {
      "post": {
        "summary": "unknown (advancedNotifications)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/advancedRateLimiter.unknown": {
      "post": {
        "summary": "unknown (advancedRateLimiter)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/advancedSearchFiltering.unknown": {
      "post": {
        "summary": "unknown (advancedSearchFiltering)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agent.unknown": {
      "post": {
        "summary": "unknown (agent)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentBankAccountsCrud.unknown": {
      "post": {
        "summary": "unknown (agentBankAccountsCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentBenchmarking.unknown": {
      "post": {
        "summary": "unknown (agentBenchmarking)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentClusterAnalytics.unknown": {
      "post": {
        "summary": "unknown (agentClusterAnalytics)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentCommissionCalc.unknown": {
      "post": {
        "summary": "unknown (agentCommissionCalc)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentCommunicationHub.unknown": {
      "post": {
        "summary": "unknown (agentCommunicationHub)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentDeviceFingerprint.unknown": {
      "post": {
        "summary": "unknown (agentDeviceFingerprint)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentFloatInsuranceClaims.unknown": {
      "post": {
        "summary": "unknown (agentFloatInsuranceClaims)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentGamification.unknown": {
      "post": {
        "summary": "unknown (agentGamification)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentHierarchy.unknown": {
      "post": {
        "summary": "unknown (agentHierarchy)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentHierarchyTerritory.unknown": {
      "post": {
        "summary": "unknown (agentHierarchyTerritory)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentInventoryMgmt.unknown": {
      "post": {
        "summary": "unknown (agentInventoryMgmt)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentKyc.unknown": {
      "post": {
        "summary": "unknown (agentKyc)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentKycDocVault.unknown": {
      "post": {
        "summary": "unknown (agentKycDocVault)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentLoanAdvance.unknown": {
      "post": {
        "summary": "unknown (agentLoanAdvance)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentLoanOrigination.unknown": {
      "post": {
        "summary": "unknown (agentLoanOrigination)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentLoanOrigination2.unknown": {
      "post": {
        "summary": "unknown (agentLoanOrigination2)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentManagement.unknown": {
      "post": {
        "summary": "unknown (agentManagement)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentMicroInsurance.unknown": {
      "post": {
        "summary": "unknown (agentMicroInsurance)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentNetworkTopology.unknown": {
      "post": {
        "summary": "unknown (agentNetworkTopology)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentOnboarding.unknown": {
      "post": {
        "summary": "unknown (agentOnboarding)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentOnboardingWizard.unknown": {
      "post": {
        "summary": "unknown (agentOnboardingWizard)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentOnboardingWorkflow.unknown": {
      "post": {
        "summary": "unknown (agentOnboardingWorkflow)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentPerformanceAnalytics.unknown": {
      "post": {
        "summary": "unknown (agentPerformanceAnalytics)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentPerformanceIncentives.unknown": {
      "post": {
        "summary": "unknown (agentPerformanceIncentives)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentPerformanceLeaderboard.unknown": {
      "post": {
        "summary": "unknown (agentPerformanceLeaderboard)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentPerformanceScorecard.unknown": {
      "post": {
        "summary": "unknown (agentPerformanceScorecard)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentPerformanceScoresCrud.unknown": {
      "post": {
        "summary": "unknown (agentPerformanceScoresCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentRevenueAttribution.unknown": {
      "post": {
        "summary": "unknown (agentRevenueAttribution)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentScorecard.unknown": {
      "post": {
        "summary": "unknown (agentScorecard)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentSuspensionLogCrud.unknown": {
      "post": {
        "summary": "unknown (agentSuspensionLogCrud)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentSuspensionWorkflow.unknown": {
      "post": {
        "summary": "unknown (agentSuspensionWorkflow)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentTerritoryHeatmap.unknown": {
      "post": {
        "summary": "unknown (agentTerritoryHeatmap)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentTerritoryMgmt.unknown": {
      "post": {
        "summary": "unknown (agentTerritoryMgmt)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentTerritoryOptimizer.unknown": {
      "post": {
        "summary": "unknown (agentTerritoryOptimizer)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentTraining.unknown": {
      "post": {
        "summary": "unknown (agentTraining)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentTrainingAcademy.unknown": {
      "post": {
        "summary": "unknown (agentTrainingAcademy)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentTrainingGamification.unknown": {
      "post": {
        "summary": "unknown (agentTrainingGamification)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/agentTrainingPortal.unknown": {
      "post": {
        "summary": "unknown (agentTrainingPortal)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/aiCashFlowPredictor.unknown": {
      "post": {
        "summary": "unknown (aiCashFlowPredictor)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/aiChatSupport.unknown": {
      "post": {
        "summary": "unknown (aiChatSupport)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/aiMonitoring.unknown": {
      "post": {
        "summary": "unknown (aiMonitoring)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/alertNotifications.unknown": {
      "post": {
        "summary": "unknown (alertNotifications)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/amlScreening.unknown": {
      "post": {
        "summary": "unknown (amlScreening)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/analytics.unknown": {
      "post": {
        "summary": "unknown (analytics)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/analyticsDashboard.unknown": {
      "post": {
        "summary": "unknown (analyticsDashboard)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/analyticsDashboardsCrud.unknown": {
      "post": {
        "summary": "unknown (analyticsDashboardsCrud)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/analyticsQuery.unknown": {
      "post": {
        "summary": "unknown (analyticsQuery)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/announcementReactions.unknown": {
      "post": {
        "summary": "unknown (announcementReactions)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/apacheAirflow.unknown": {
      "post": {
        "summary": "unknown (apacheAirflow)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/apacheNifi.unknown": {
      "post": {
        "summary": "unknown (apacheNifi)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/apiAnalyticsDash.unknown": {
      "post": {
        "summary": "unknown (apiAnalyticsDash)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/apiDocs.unknown": {
      "post": {
        "summary": "unknown (apiDocs)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/apiGateway.unknown": {
      "post": {
        "summary": "unknown (apiGateway)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/apiKeyManagement.unknown": {
      "post": {
        "summary": "unknown (apiKeyManagement)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/apiRateLimiterDash.unknown": {
      "post": {
        "summary": "unknown (apiRateLimiterDash)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/apiVersioning.unknown": {
      "post": {
        "summary": "unknown (apiVersioning)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/archivalAdmin.unknown": {
      "post": {
        "summary": "unknown (archivalAdmin)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/artRobustness.unknown": {
      "post": {
        "summary": "unknown (artRobustness)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/auditExport.unknown": {
      "post": {
        "summary": "unknown (auditExport)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/auditLog.unknown": {
      "post": {
        "summary": "unknown (auditLog)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/auditTrail.unknown": {
      "post": {
        "summary": "unknown (auditTrail)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/auditTrailExport.unknown": {
      "post": {
        "summary": "unknown (auditTrailExport)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/autoComplianceWorkflow.unknown": {
      "post": {
        "summary": "unknown (autoComplianceWorkflow)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/autoReconciliationEngine.unknown": {
      "post": {
        "summary": "unknown (autoReconciliationEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/automatedComplianceChecker.unknown": {
      "post": {
        "summary": "unknown (automatedComplianceChecker)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/automatedSettlementScheduler.unknown": {
      "post": {
        "summary": "unknown (automatedSettlementScheduler)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/automatedTestingFramework.unknown": {
      "post": {
        "summary": "unknown (automatedTestingFramework)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/backupDisasterRecovery.unknown": {
      "post": {
        "summary": "unknown (backupDisasterRecovery)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/bankAccountManagement.unknown": {
      "post": {
        "summary": "unknown (bankAccountManagement)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/bankingWorkflowPatterns.unknown": {
      "post": {
        "summary": "unknown (bankingWorkflowPatterns)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/batchProcessing.unknown": {
      "post": {
        "summary": "unknown (batchProcessing)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/biReportDefinitionsCrud.unknown": {
      "post": {
        "summary": "unknown (biReportDefinitionsCrud)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/billingAudit.unknown": {
      "post": {
        "summary": "unknown (billingAudit)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/billingInvoice.unknown": {
      "post": {
        "summary": "unknown (billingInvoice)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/billingLedger.unknown": {
      "post": {
        "summary": "unknown (billingLedger)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/billingLifecycle.unknown": {
      "post": {
        "summary": "unknown (billingLifecycle)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/billingProduction.unknown": {
      "post": {
        "summary": "unknown (billingProduction)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/billingRbac.unknown": {
      "post": {
        "summary": "unknown (billingRbac)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/billingRevenuePeriodsCrud.unknown": {
      "post": {
        "summary": "unknown (billingRevenuePeriodsCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/biometricAuditDashboard.unknown": {
      "post": {
        "summary": "unknown (biometricAuditDashboard)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/biometricAuth.unknown": {
      "post": {
        "summary": "unknown (biometricAuth)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/biometricAuthGateway.unknown": {
      "post": {
        "summary": "unknown (biometricAuthGateway)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/blockchainAuditTrail.unknown": {
      "post": {
        "summary": "unknown (blockchainAuditTrail)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/broadcastAnnouncements.unknown": {
      "post": {
        "summary": "unknown (broadcastAnnouncements)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/bulkDisbursementEngine.unknown": {
      "post": {
        "summary": "unknown (bulkDisbursementEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/bulkOperations.unknown": {
      "post": {
        "summary": "unknown (bulkOperations)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/bulkPaymentProcessor.unknown": {
      "post": {
        "summary": "unknown (bulkPaymentProcessor)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/bulkRoleImport.unknown": {
      "post": {
        "summary": "unknown (bulkRoleImport)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/bulkTransactionProcessing.unknown": {
      "post": {
        "summary": "unknown (bulkTransactionProcessing)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/bulkTransactionProcessor.unknown": {
      "post": {
        "summary": "unknown (bulkTransactionProcessor)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/businessRules.unknown": {
      "post": {
        "summary": "unknown (businessRules)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/canaryReleaseManager.unknown": {
      "post": {
        "summary": "unknown (canaryReleaseManager)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/capacityPlanning.unknown": {
      "post": {
        "summary": "unknown (capacityPlanning)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/cardBinLookup.unknown": {
      "post": {
        "summary": "unknown (cardBinLookup)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/cardRequest.unknown": {
      "post": {
        "summary": "unknown (cardRequest)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/carrierCost.unknown": {
      "post": {
        "summary": "unknown (carrierCost)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/carrierLivePricing.unknown": {
      "post": {
        "summary": "unknown (carrierLivePricing)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/carrierSla.unknown": {
      "post": {
        "summary": "unknown (carrierSla)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/carrierSwitching.unknown": {
      "post": {
        "summary": "unknown (carrierSwitching)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/cbdcIntegrationGateway.unknown": {
      "post": {
        "summary": "unknown (cbdcIntegrationGateway)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/cbnReporting.unknown": {
      "post": {
        "summary": "unknown (cbnReporting)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/cdnCacheManager.unknown": {
      "post": {
        "summary": "unknown (cdnCacheManager)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/chaosEngineeringConsole.unknown": {
      "post": {
        "summary": "unknown (chaosEngineeringConsole)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/chargebackManagement.unknown": {
      "post": {
        "summary": "unknown (chargebackManagement)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/chat.unknown": {
      "post": {
        "summary": "unknown (chat)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/cocoIndexPipeline.unknown": {
      "post": {
        "summary": "unknown (cocoIndexPipeline)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/commissionCalculator.unknown": {
      "post": {
        "summary": "unknown (commissionCalculator)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/commissionCascadeHistoryCrud.unknown": {
      "post": {
        "summary": "unknown (commissionCascadeHistoryCrud)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/commissionClawback.unknown": {
      "post": {
        "summary": "unknown (commissionClawback)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/commissionEngine.unknown": {
      "post": {
        "summary": "unknown (commissionEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/commissionPayouts.unknown": {
      "post": {
        "summary": "unknown (commissionPayouts)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/complianceAutomation.unknown": {
      "post": {
        "summary": "unknown (complianceAutomation)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/complianceCertManager.unknown": {
      "post": {
        "summary": "unknown (complianceCertManager)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/complianceChatbot.unknown": {
      "post": {
        "summary": "unknown (complianceChatbot)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/complianceFiling.unknown": {
      "post": {
        "summary": "unknown (complianceFiling)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/complianceReporting.unknown": {
      "post": {
        "summary": "unknown (complianceReporting)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/complianceTrainingTracker.unknown": {
      "post": {
        "summary": "unknown (complianceTrainingTracker)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/configManagement.unknown": {
      "post": {
        "summary": "unknown (configManagement)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/connectionPoolMonitor.unknown": {
      "post": {
        "summary": "unknown (connectionPoolMonitor)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/cqrsEventStore.unknown": {
      "post": {
        "summary": "unknown (cqrsEventStore)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/crossBorderRemittanceHub.unknown": {
      "post": {
        "summary": "unknown (crossBorderRemittanceHub)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/currencyHedging.unknown": {
      "post": {
        "summary": "unknown (currencyHedging)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customer.unknown": {
      "post": {
        "summary": "unknown (customer)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customer360.unknown": {
      "post": {
        "summary": "unknown (customer360)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customer360View.unknown": {
      "post": {
        "summary": "unknown (customer360View)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customerDatabase.unknown": {
      "post": {
        "summary": "unknown (customerDatabase)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customerDisputePortal.unknown": {
      "post": {
        "summary": "unknown (customerDisputePortal)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customerFeedbackNps.unknown": {
      "post": {
        "summary": "unknown (customerFeedbackNps)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customerJourneyAnalytics.unknown": {
      "post": {
        "summary": "unknown (customerJourneyAnalytics)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customerJourneyEventsCrud.unknown": {
      "post": {
        "summary": "unknown (customerJourneyEventsCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customerJourneyMapper.unknown": {
      "post": {
        "summary": "unknown (customerJourneyMapper)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customerLoyaltyProgram.unknown": {
      "post": {
        "summary": "unknown (customerLoyaltyProgram)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customerOnboardingPipeline.unknown": {
      "post": {
        "summary": "unknown (customerOnboardingPipeline)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customerSegmentationEngine.unknown": {
      "post": {
        "summary": "unknown (customerSegmentationEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customerSurveys.unknown": {
      "post": {
        "summary": "unknown (customerSurveys)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/customerWalletSystem.unknown": {
      "post": {
        "summary": "unknown (customerWalletSystem)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dailyPnlReport.unknown": {
      "post": {
        "summary": "unknown (dailyPnlReport)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dashboardLayout.unknown": {
      "post": {
        "summary": "unknown (dashboardLayout)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dataConsentRecordsCrud.unknown": {
      "post": {
        "summary": "unknown (dataConsentRecordsCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dataExport.unknown": {
      "post": {
        "summary": "unknown (dataExport)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dataExportHub.unknown": {
      "post": {
        "summary": "unknown (dataExportHub)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dataExportImport.unknown": {
      "post": {
        "summary": "unknown (dataExportImport)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dataExportRouter.unknown": {
      "post": {
        "summary": "unknown (dataExportRouter)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dataQuality.unknown": {
      "post": {
        "summary": "unknown (dataQuality)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dataRetentionPolicy.unknown": {
      "post": {
        "summary": "unknown (dataRetentionPolicy)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dataThresholdAlerts.unknown": {
      "post": {
        "summary": "unknown (dataThresholdAlerts)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/databaseVisualization.unknown": {
      "post": {
        "summary": "unknown (databaseVisualization)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dbSchemaMigrationManager.unknown": {
      "post": {
        "summary": "unknown (dbSchemaMigrationManager)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dbSchemaPush.unknown": {
      "post": {
        "summary": "unknown (dbSchemaPush)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dbtIntegration.unknown": {
      "post": {
        "summary": "unknown (dbtIntegration)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/decentralizedIdentityManager.unknown": {
      "post": {
        "summary": "unknown (decentralizedIdentityManager)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/deepface.unknown": {
      "post": {
        "summary": "unknown (deepface)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/developerPortal.unknown": {
      "post": {
        "summary": "unknown (developerPortal)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/deviceFleetManager.unknown": {
      "post": {
        "summary": "unknown (deviceFleetManager)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/digitalTwinSimulator.unknown": {
      "post": {
        "summary": "unknown (digitalTwinSimulator)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/disputeAnalytics.unknown": {
      "post": {
        "summary": "unknown (disputeAnalytics)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/disputeMediationAI.unknown": {
      "post": {
        "summary": "unknown (disputeMediationAI)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/disputeNotifications.unknown": {
      "post": {
        "summary": "unknown (disputeNotifications)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/disputeRefund.unknown": {
      "post": {
        "summary": "unknown (disputeRefund)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/disputeResolution.unknown": {
      "post": {
        "summary": "unknown (disputeResolution)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/disputeWorkflowEngine.unknown": {
      "post": {
        "summary": "unknown (disputeWorkflowEngine)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/disputes.unknown": {
      "post": {
        "summary": "unknown (disputes)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/distributedTracingDash.unknown": {
      "post": {
        "summary": "unknown (distributedTracingDash)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/documentManagement.unknown": {
      "post": {
        "summary": "unknown (documentManagement)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dragDropReportBuilder.unknown": {
      "post": {
        "summary": "unknown (dragDropReportBuilder)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dynamicFeeCalculator.unknown": {
      "post": {
        "summary": "unknown (dynamicFeeCalculator)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dynamicFeeEngine.unknown": {
      "post": {
        "summary": "unknown (dynamicFeeEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dynamicPricingEngine.unknown": {
      "post": {
        "summary": "unknown (dynamicPricingEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/dynamicQrPayment.unknown": {
      "post": {
        "summary": "unknown (dynamicQrPayment)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/e2eTestFramework.unknown": {
      "post": {
        "summary": "unknown (e2eTestFramework)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/ecommerceCart.unknown": {
      "post": {
        "summary": "unknown (ecommerceCart)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/ecommerceCatalog.unknown": {
      "post": {
        "summary": "unknown (ecommerceCatalog)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/ecommerceOrders.unknown": {
      "post": {
        "summary": "unknown (ecommerceOrders)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/emailDeliveryLogCrud.unknown": {
      "post": {
        "summary": "unknown (emailDeliveryLogCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/emailNotifications.unknown": {
      "post": {
        "summary": "unknown (emailNotifications)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/encryptedFieldsCrud.unknown": {
      "post": {
        "summary": "unknown (encryptedFieldsCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/eodReconciliation.unknown": {
      "post": {
        "summary": "unknown (eodReconciliation)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/erp.unknown": {
      "post": {
        "summary": "unknown (erp)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/escalationChains.unknown": {
      "post": {
        "summary": "unknown (escalationChains)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/esgCarbonTracker.unknown": {
      "post": {
        "summary": "unknown (esgCarbonTracker)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/eventDrivenArch.unknown": {
      "post": {
        "summary": "unknown (eventDrivenArch)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/executiveCommandCenter.unknown": {
      "post": {
        "summary": "unknown (executiveCommandCenter)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/export.unknown": {
      "post": {
        "summary": "unknown (export)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/faceEnrollment.unknown": {
      "post": {
        "summary": "unknown (faceEnrollment)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/falkordbGraph.unknown": {
      "post": {
        "summary": "unknown (falkordbGraph)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/featureFlags.unknown": {
      "post": {
        "summary": "unknown (featureFlags)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/financialNlEngine.unknown": {
      "post": {
        "summary": "unknown (financialNlEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/financialReconciliationDash.unknown": {
      "post": {
        "summary": "unknown (financialReconciliationDash)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/financialReportingSuite.unknown": {
      "post": {
        "summary": "unknown (financialReportingSuite)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/floatReconciliationsCrud.unknown": {
      "post": {
        "summary": "unknown (floatReconciliationsCrud)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/fraud.unknown": {
      "post": {
        "summary": "unknown (fraud)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/fraudCaseManagement.unknown": {
      "post": {
        "summary": "unknown (fraudCaseManagement)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/fraudMlScoringEngine.unknown": {
      "post": {
        "summary": "unknown (fraudMlScoringEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/fraudRealtimeViz.unknown": {
      "post": {
        "summary": "unknown (fraudRealtimeViz)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/fraudReportGenerator.unknown": {
      "post": {
        "summary": "unknown (fraudReportGenerator)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/fxRates.unknown": {
      "post": {
        "summary": "unknown (fxRates)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/gatewayHealthMonitor.unknown": {
      "post": {
        "summary": "unknown (gatewayHealthMonitor)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/gdpr.unknown": {
      "post": {
        "summary": "unknown (gdpr)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/generalLedger.unknown": {
      "post": {
        "summary": "unknown (generalLedger)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/geoFenceDedicated.unknown": {
      "post": {
        "summary": "unknown (geoFenceDedicated)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/geoFencesCrud.unknown": {
      "post": {
        "summary": "unknown (geoFencesCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/geoFencing.unknown": {
      "post": {
        "summary": "unknown (geoFencing)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/geoFencingDedicated.unknown": {
      "post": {
        "summary": "unknown (geoFencingDedicated)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/glAccountsCrud.unknown": {
      "post": {
        "summary": "unknown (glAccountsCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/glJournalEntriesCrud.unknown": {
      "post": {
        "summary": "unknown (glJournalEntriesCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/globalSearch.unknown": {
      "post": {
        "summary": "unknown (globalSearch)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/goServiceBridge.unknown": {
      "post": {
        "summary": "unknown (goServiceBridge)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/graphqlFederation.unknown": {
      "post": {
        "summary": "unknown (graphqlFederation)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/graphqlSubscriptionGateway.unknown": {
      "post": {
        "summary": "unknown (graphqlSubscriptionGateway)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/guideFeedback.unknown": {
      "post": {
        "summary": "unknown (guideFeedback)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/helpDesk.unknown": {
      "post": {
        "summary": "unknown (helpDesk)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/incidentCommandCenter.unknown": {
      "post": {
        "summary": "unknown (incidentCommandCenter)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/incidentManagement.unknown": {
      "post": {
        "summary": "unknown (incidentManagement)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/incidentPlaybook.unknown": {
      "post": {
        "summary": "unknown (incidentPlaybook)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/insuranceProducts.unknown": {
      "post": {
        "summary": "unknown (insuranceProducts)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/integrationMarketplace.unknown": {
      "post": {
        "summary": "unknown (integrationMarketplace)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/intelligentRoutingEngine.unknown": {
      "post": {
        "summary": "unknown (intelligentRoutingEngine)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/inviteCodes.unknown": {
      "post": {
        "summary": "unknown (inviteCodes)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/kafkaConsumer.unknown": {
      "post": {
        "summary": "unknown (kafkaConsumer)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/kyb.unknown": {
      "post": {
        "summary": "unknown (kyb)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/kyc.unknown": {
      "post": {
        "summary": "unknown (kyc)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/kycDocumentManagement.unknown": {
      "post": {
        "summary": "unknown (kycDocumentManagement)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/kycDocumentsCrud.unknown": {
      "post": {
        "summary": "unknown (kycDocumentsCrud)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/kycEnforcement.unknown": {
      "post": {
        "summary": "unknown (kycEnforcement)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/lakehouse.unknown": {
      "post": {
        "summary": "unknown (lakehouse)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/lakehouseAiIntegration.unknown": {
      "post": {
        "summary": "unknown (lakehouseAiIntegration)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/liveBillingDashboard.unknown": {
      "post": {
        "summary": "unknown (liveBillingDashboard)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/loadTestMetrics.unknown": {
      "post": {
        "summary": "unknown (loadTestMetrics)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/loanDisbursement.unknown": {
      "post": {
        "summary": "unknown (loanDisbursement)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/loyalty.unknown": {
      "post": {
        "summary": "unknown (loyalty)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/management.unknown": {
      "post": {
        "summary": "unknown (management)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/marketplace.unknown": {
      "post": {
        "summary": "unknown (marketplace)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/mccManager.unknown": {
      "post": {
        "summary": "unknown (mccManager)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/mdm.unknown": {
      "post": {
        "summary": "unknown (mdm)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/merchant.unknown": {
      "post": {
        "summary": "unknown (merchant)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/merchantAcquirerGateway.unknown": {
      "post": {
        "summary": "unknown (merchantAcquirerGateway)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/merchantAnalyticsDash.unknown": {
      "post": {
        "summary": "unknown (merchantAnalyticsDash)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/merchantKycOnboarding.unknown": {
      "post": {
        "summary": "unknown (merchantKycOnboarding)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/merchantOnboardingPortal.unknown": {
      "post": {
        "summary": "unknown (merchantOnboardingPortal)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/merchantPayoutSettlement.unknown": {
      "post": {
        "summary": "unknown (merchantPayoutSettlement)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/merchantRiskScoring.unknown": {
      "post": {
        "summary": "unknown (merchantRiskScoring)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/merchantSettlementDashboard.unknown": {
      "post": {
        "summary": "unknown (merchantSettlementDashboard)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/mfaManager.unknown": {
      "post": {
        "summary": "unknown (mfaManager)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/middlewareServiceManager.unknown": {
      "post": {
        "summary": "unknown (middlewareServiceManager)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/mlScoringService.unknown": {
      "post": {
        "summary": "unknown (mlScoringService)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/mobileApiLayer.unknown": {
      "post": {
        "summary": "unknown (mobileApiLayer)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/mqttBridge.unknown": {
      "post": {
        "summary": "unknown (mqttBridge)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/multiChannelNotificationHub.unknown": {
      "post": {
        "summary": "unknown (multiChannelNotificationHub)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/multiChannelPaymentOrch.unknown": {
      "post": {
        "summary": "unknown (multiChannelPaymentOrch)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/multiCurrency.unknown": {
      "post": {
        "summary": "unknown (multiCurrency)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/multiCurrencyExchange.unknown": {
      "post": {
        "summary": "unknown (multiCurrencyExchange)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/multiSimFailover.unknown": {
      "post": {
        "summary": "unknown (multiSimFailover)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/multiTenancy.unknown": {
      "post": {
        "summary": "unknown (multiTenancy)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/multiTenantIsolation.unknown": {
      "post": {
        "summary": "unknown (multiTenantIsolation)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/networkQualityHeatmap.unknown": {
      "post": {
        "summary": "unknown (networkQualityHeatmap)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/networkResilience.unknown": {
      "post": {
        "summary": "unknown (networkResilience)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/networkStatusDashboard.unknown": {
      "post": {
        "summary": "unknown (networkStatusDashboard)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/networkTelemetry.unknown": {
      "post": {
        "summary": "unknown (networkTelemetry)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/networkTrends.unknown": {
      "post": {
        "summary": "unknown (networkTrends)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/nlAnalyticsQuery.unknown": {
      "post": {
        "summary": "unknown (nlAnalyticsQuery)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/nlFinancialQuery.unknown": {
      "post": {
        "summary": "unknown (nlFinancialQuery)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/notificationCenter.unknown": {
      "post": {
        "summary": "unknown (notificationCenter)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/notificationChannelsCrud.unknown": {
      "post": {
        "summary": "unknown (notificationChannelsCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/notificationInbox.unknown": {
      "post": {
        "summary": "unknown (notificationInbox)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/notificationLogsCrud.unknown": {
      "post": {
        "summary": "unknown (notificationLogsCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/notificationOrchestrator.unknown": {
      "post": {
        "summary": "unknown (notificationOrchestrator)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/observabilityAlertsCrud.unknown": {
      "post": {
        "summary": "unknown (observabilityAlertsCrud)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/offlinePosMode.unknown": {
      "post": {
        "summary": "unknown (offlinePosMode)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/offlineQueue.unknown": {
      "post": {
        "summary": "unknown (offlineQueue)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/offlineSync.unknown": {
      "post": {
        "summary": "unknown (offlineSync)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/ollamaLLM.unknown": {
      "post": {
        "summary": "unknown (ollamaLLM)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/openTelemetry.unknown": {
      "post": {
        "summary": "unknown (openTelemetry)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/operationalCommandBridge.unknown": {
      "post": {
        "summary": "unknown (operationalCommandBridge)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/operationalRunbook.unknown": {
      "post": {
        "summary": "unknown (operationalRunbook)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/partnerOnboarding.unknown": {
      "post": {
        "summary": "unknown (partnerOnboarding)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/partnerRevenueSharing.unknown": {
      "post": {
        "summary": "unknown (partnerRevenueSharing)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/partnerSelfService.unknown": {
      "post": {
        "summary": "unknown (partnerSelfService)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/paymentDisputeArbitration.unknown": {
      "post": {
        "summary": "unknown (paymentDisputeArbitration)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/paymentGatewayRouter.unknown": {
      "post": {
        "summary": "unknown (paymentGatewayRouter)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/paymentLinkGenerator.unknown": {
      "post": {
        "summary": "unknown (paymentLinkGenerator)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/paymentNotificationSystem.unknown": {
      "post": {
        "summary": "unknown (paymentNotificationSystem)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/paymentReconciliation.unknown": {
      "post": {
        "summary": "unknown (paymentReconciliation)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/paymentTokenVault.unknown": {
      "post": {
        "summary": "unknown (paymentTokenVault)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/pbacManagement.unknown": {
      "post": {
        "summary": "unknown (pbacManagement)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/pensionCollection.unknown": {
      "post": {
        "summary": "unknown (pensionCollection)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/performanceProfiler.unknown": {
      "post": {
        "summary": "unknown (performanceProfiler)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/pipelineMonitoring.unknown": {
      "post": {
        "summary": "unknown (pipelineMonitoring)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformABTesting.unknown": {
      "post": {
        "summary": "unknown (platformABTesting)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformCapacityPlanner.unknown": {
      "post": {
        "summary": "unknown (platformCapacityPlanner)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformChangelog.unknown": {
      "post": {
        "summary": "unknown (platformChangelog)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformConfigCenter.unknown": {
      "post": {
        "summary": "unknown (platformConfigCenter)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformCostAllocator.unknown": {
      "post": {
        "summary": "unknown (platformCostAllocator)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformFeatureFlags.unknown": {
      "post": {
        "summary": "unknown (platformFeatureFlags)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformHealth.unknown": {
      "post": {
        "summary": "unknown (platformHealth)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformHealthDash.unknown": {
      "post": {
        "summary": "unknown (platformHealthDash)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformHealthMonitor.unknown": {
      "post": {
        "summary": "unknown (platformHealthMonitor)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformHealthScorecard.unknown": {
      "post": {
        "summary": "unknown (platformHealthScorecard)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformMaturityScorecard.unknown": {
      "post": {
        "summary": "unknown (platformMaturityScorecard)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformMetricsExporter.unknown": {
      "post": {
        "summary": "unknown (platformMetricsExporter)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformMigrationToolkit.unknown": {
      "post": {
        "summary": "unknown (platformMigrationToolkit)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformProxy.unknown": {
      "post": {
        "summary": "unknown (platformProxy)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformRecommendations.unknown": {
      "post": {
        "summary": "unknown (platformRecommendations)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformRevenueOptimizer.unknown": {
      "post": {
        "summary": "unknown (platformRevenueOptimizer)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/platformSlaMonitor.unknown": {
      "post": {
        "summary": "unknown (platformSlaMonitor)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/pnlReport.unknown": {
      "post": {
        "summary": "unknown (pnlReport)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/pnlReportsCrud.unknown": {
      "post": {
        "summary": "unknown (pnlReportsCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/posDispute.unknown": {
      "post": {
        "summary": "unknown (posDispute)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/posFirmwareOTA.unknown": {
      "post": {
        "summary": "unknown (posFirmwareOTA)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/posTerminalFleet.unknown": {
      "post": {
        "summary": "unknown (posTerminalFleet)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/predictiveAgentChurn.unknown": {
      "post": {
        "summary": "unknown (predictiveAgentChurn)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/productionFeatures.unknown": {
      "post": {
        "summary": "unknown (productionFeatures)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/promotions.unknown": {
      "post": {
        "summary": "unknown (promotions)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/publishReadinessChecker.unknown": {
      "post": {
        "summary": "unknown (publishReadinessChecker)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/pushNotifications.unknown": {
      "post": {
        "summary": "unknown (pushNotifications)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/qdrantVectorSearch.unknown": {
      "post": {
        "summary": "unknown (qdrantVectorSearch)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/ransomwareAlerts.unknown": {
      "post": {
        "summary": "unknown (ransomwareAlerts)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/rateAlerts.unknown": {
      "post": {
        "summary": "unknown (rateAlerts)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/rateLimitEngine.unknown": {
      "post": {
        "summary": "unknown (rateLimitEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/realtimeDashboardWidgets.unknown": {
      "post": {
        "summary": "unknown (realtimeDashboardWidgets)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/realtimeNotifications.unknown": {
      "post": {
        "summary": "unknown (realtimeNotifications)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/realtimePnlDashboard.unknown": {
      "post": {
        "summary": "unknown (realtimePnlDashboard)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/realtimeTxAlertsCrud.unknown": {
      "post": {
        "summary": "unknown (realtimeTxAlertsCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/realtimeTxMonitor.unknown": {
      "post": {
        "summary": "unknown (realtimeTxMonitor)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/realtimeWebSocketFeeds.unknown": {
      "post": {
        "summary": "unknown (realtimeWebSocketFeeds)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/receiptTemplates.unknown": {
      "post": {
        "summary": "unknown (receiptTemplates)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/reconciliationEngine.unknown": {
      "post": {
        "summary": "unknown (reconciliationEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/recurringPayments.unknown": {
      "post": {
        "summary": "unknown (recurringPayments)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/referralProgram.unknown": {
      "post": {
        "summary": "unknown (referralProgram)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/referrals.unknown": {
      "post": {
        "summary": "unknown (referrals)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/regulatoryCompliance.unknown": {
      "post": {
        "summary": "unknown (regulatoryCompliance)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/regulatoryComplianceChecks.unknown": {
      "post": {
        "summary": "unknown (regulatoryComplianceChecks)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/regulatoryFilingAutomation.unknown": {
      "post": {
        "summary": "unknown (regulatoryFilingAutomation)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/regulatoryReportGenerator.unknown": {
      "post": {
        "summary": "unknown (regulatoryReportGenerator)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/regulatoryReportingEngine.unknown": {
      "post": {
        "summary": "unknown (regulatoryReportingEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/regulatorySandbox.unknown": {
      "post": {
        "summary": "unknown (regulatorySandbox)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/regulatorySandboxTester.unknown": {
      "post": {
        "summary": "unknown (regulatorySandboxTester)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/remittance.unknown": {
      "post": {
        "summary": "unknown (remittance)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/reportBuilderTemplates.unknown": {
      "post": {
        "summary": "unknown (reportBuilderTemplates)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/reportScheduler.unknown": {
      "post": {
        "summary": "unknown (reportScheduler)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/reportTemplateDesigner.unknown": {
      "post": {
        "summary": "unknown (reportTemplateDesigner)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/resilience.unknown": {
      "post": {
        "summary": "unknown (resilience)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/resilienceHardening.unknown": {
      "post": {
        "summary": "unknown (resilienceHardening)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/revenueAnalytics.unknown": {
      "post": {
        "summary": "unknown (revenueAnalytics)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/revenueForecastingEngine.unknown": {
      "post": {
        "summary": "unknown (revenueForecastingEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/revenueLeakageDetector.unknown": {
      "post": {
        "summary": "unknown (revenueLeakageDetector)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/revenueReconciliation.unknown": {
      "post": {
        "summary": "unknown (revenueReconciliation)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/reversalApproval.unknown": {
      "post": {
        "summary": "unknown (reversalApproval)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/runtimeConfigAdmin.unknown": {
      "post": {
        "summary": "unknown (runtimeConfigAdmin)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/savingsProducts.unknown": {
      "post": {
        "summary": "unknown (savingsProducts)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/scheduledReports.unknown": {
      "post": {
        "summary": "unknown (scheduledReports)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/securityAudit.unknown": {
      "post": {
        "summary": "unknown (securityAudit)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/securityHardening.unknown": {
      "post": {
        "summary": "unknown (securityHardening)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/serviceMesh.unknown": {
      "post": {
        "summary": "unknown (serviceMesh)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/settlement.unknown": {
      "post": {
        "summary": "unknown (settlement)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/settlementBatchProcessor.unknown": {
      "post": {
        "summary": "unknown (settlementBatchProcessor)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/settlementNettingEngine.unknown": {
      "post": {
        "summary": "unknown (settlementNettingEngine)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/settlementReconciliation.unknown": {
      "post": {
        "summary": "unknown (settlementReconciliation)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/sharedLayouts.unknown": {
      "post": {
        "summary": "unknown (sharedLayouts)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/skillCreatorIntegration.unknown": {
      "post": {
        "summary": "unknown (skillCreatorIntegration)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/slaManagement.unknown": {
      "post": {
        "summary": "unknown (slaManagement)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/slaMonitoring.unknown": {
      "post": {
        "summary": "unknown (slaMonitoring)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/slaMonitoringDash.unknown": {
      "post": {
        "summary": "unknown (slaMonitoringDash)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/smartContractPayment.unknown": {
      "post": {
        "summary": "unknown (smartContractPayment)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/smsNotifications.unknown": {
      "post": {
        "summary": "unknown (smsNotifications)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/smsReceipt.unknown": {
      "post": {
        "summary": "unknown (smsReceipt)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/socialCommerceGateway.unknown": {
      "post": {
        "summary": "unknown (socialCommerceGateway)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/sprint15Features.unknown": {
      "post": {
        "summary": "unknown (sprint15Features)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/sprint23Router.unknown": {
      "post": {
        "summary": "unknown (sprint23Router)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/superAdmin.unknown": {
      "post": {
        "summary": "unknown (superAdmin)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/supervisor.unknown": {
      "post": {
        "summary": "unknown (supervisor)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/supplyChain.unknown": {
      "post": {
        "summary": "unknown (supplyChain)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/systemConfig.unknown": {
      "post": {
        "summary": "unknown (systemConfig)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/systemConfigManager.unknown": {
      "post": {
        "summary": "unknown (systemConfigManager)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/systemHealthDashboard.unknown": {
      "post": {
        "summary": "unknown (systemHealthDashboard)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/systemHealthMonitor.unknown": {
      "post": {
        "summary": "unknown (systemHealthMonitor)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/systemMigrationTools.unknown": {
      "post": {
        "summary": "unknown (systemMigrationTools)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/taxCollection.unknown": {
      "post": {
        "summary": "unknown (taxCollection)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/temporalWorkflows.unknown": {
      "post": {
        "summary": "unknown (temporalWorkflows)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/tenantAdmin.unknown": {
      "post": {
        "summary": "unknown (tenantAdmin)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/tenantBillingOnboarding.unknown": {
      "post": {
        "summary": "unknown (tenantBillingOnboarding)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/tenantBrandingCrud.unknown": {
      "post": {
        "summary": "unknown (tenantBrandingCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/tenantFeatureToggle.unknown": {
      "post": {
        "summary": "unknown (tenantFeatureToggle)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/tenantFeeOverridesCrud.unknown": {
      "post": {
        "summary": "unknown (tenantFeeOverridesCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/terminalLeasing.unknown": {
      "post": {
        "summary": "unknown (terminalLeasing)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/trainingCertification.unknown": {
      "post": {
        "summary": "unknown (trainingCertification)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/trainingCoursesCrud.unknown": {
      "post": {
        "summary": "unknown (trainingCoursesCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/trainingEnrollmentsCrud.unknown": {
      "post": {
        "summary": "unknown (trainingEnrollmentsCrud)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionCsvExport.unknown": {
      "post": {
        "summary": "unknown (transactionCsvExport)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionDisputeResolution.unknown": {
      "post": {
        "summary": "unknown (transactionDisputeResolution)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionEnrichmentService.unknown": {
      "post": {
        "summary": "unknown (transactionEnrichmentService)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionExportEngine.unknown": {
      "post": {
        "summary": "unknown (transactionExportEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionFeeCalc.unknown": {
      "post": {
        "summary": "unknown (transactionFeeCalc)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionGraphAnalyzer.unknown": {
      "post": {
        "summary": "unknown (transactionGraphAnalyzer)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionLimitsEngine.unknown": {
      "post": {
        "summary": "unknown (transactionLimitsEngine)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionMapLoading.unknown": {
      "post": {
        "summary": "unknown (transactionMapLoading)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionMapViz.unknown": {
      "post": {
        "summary": "unknown (transactionMapViz)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionMonitoring.unknown": {
      "post": {
        "summary": "unknown (transactionMonitoring)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionReceiptGenerator.unknown": {
      "post": {
        "summary": "unknown (transactionReceiptGenerator)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionReconciliation.unknown": {
      "post": {
        "summary": "unknown (transactionReconciliation)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionReversalManager.unknown": {
      "post": {
        "summary": "unknown (transactionReversalManager)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionReversalWorkflow.unknown": {
      "post": {
        "summary": "unknown (transactionReversalWorkflow)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactionVelocityMonitor.unknown": {
      "post": {
        "summary": "unknown (transactionVelocityMonitor)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/transactions.unknown": {
      "post": {
        "summary": "unknown (transactions)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/txDisputeArbitration.unknown": {
      "post": {
        "summary": "unknown (txDisputeArbitration)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/txMonitor.unknown": {
      "post": {
        "summary": "unknown (txMonitor)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/txVelocityMonitor.unknown": {
      "post": {
        "summary": "unknown (txVelocityMonitor)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/userNotifPreferences.unknown": {
      "post": {
        "summary": "unknown (userNotifPreferences)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/ussdAnalytics.unknown": {
      "post": {
        "summary": "unknown (ussdAnalytics)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/ussdGateway.unknown": {
      "post": {
        "summary": "unknown (ussdGateway)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/ussdIntegration.unknown": {
      "post": {
        "summary": "unknown (ussdIntegration)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/ussdLocalization.unknown": {
      "post": {
        "summary": "unknown (ussdLocalization)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/ussdReceipt.unknown": {
      "post": {
        "summary": "unknown (ussdReceipt)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/ussdSessionReplay.unknown": {
      "post": {
        "summary": "unknown (ussdSessionReplay)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/vaultSecrets.unknown": {
      "post": {
        "summary": "unknown (vaultSecrets)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/webhookDeliverySystem.unknown": {
      "post": {
        "summary": "unknown (webhookDeliverySystem)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/webhookManagement.unknown": {
      "post": {
        "summary": "unknown (webhookManagement)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/webhookNotifications.unknown": {
      "post": {
        "summary": "unknown (webhookNotifications)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/webhooks.unknown": {
      "post": {
        "summary": "unknown (webhooks)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/websocketService.unknown": {
      "post": {
        "summary": "unknown (websocketService)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/weeklyReports.unknown": {
      "post": {
        "summary": "unknown (weeklyReports)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/whatsappChannel.unknown": {
      "post": {
        "summary": "unknown (whatsappChannel)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/whiteLabelApproval.unknown": {
      "post": {
        "summary": "unknown (whiteLabelApproval)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/whiteLabelBranding.unknown": {
      "post": {
        "summary": "unknown (whiteLabelBranding)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/whiteLabelOnboarding.unknown": {
      "post": {
        "summary": "unknown (whiteLabelOnboarding)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/workflowAutomation.unknown": {
      "post": {
        "summary": "unknown (workflowAutomation)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/workflowEngine.unknown": {
      "post": {
        "summary": "unknown (workflowEngine)",
        "description": "tRPC query: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/routers.unknown": {
      "post": {
        "summary": "unknown (routers)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/trpc/stripeRouter.unknown": {
      "post": {
        "summary": "unknown (stripeRouter)",
        "description": "tRPC mutation: unknown",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "input": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "result": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

---

## Notes

- All endpoints require authentication unless marked as public
- Rate limiting applies to all endpoints
- Request/response formats follow tRPC conventions
- Error responses include detailed error messages

