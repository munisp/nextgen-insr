import { relations } from "drizzle-orm";
import {
  users,
  agents,
  transactions,
  fraudAlerts,
  loyaltyHistory,
  chatSessions,
  chatMessages,
  auditLog,
  floatTopUpRequests,
  otpTokens,
  devices,
  deviceCommands,
  supervisorAgents,
  disputes,
  disputeMessages,
  refunds,
  velocityLimits,
  kycSessions,
  fieldAgentDevices,
  terminalGroups,
  serviceRecords,
  softwareUpdates,
  commissionRules,
  qrCodes,
  inventoryItems,
  multiSimProfiles,
  reversalRequests,
  customers,
  tenants,
  erpSyncLog,
  vatRecords,
  emailQueue,
  merchants,
  merchantSettlements,
  apiKeys,
  apiKeyUsage,
  fido2Credentials,
  fido2Challenges,
  creditScoreHistory,
  creditApplications,
  otaReleases,
  otaUpdateLog,
  dataRightsRequests,
  fraudRules,
  agentPushSubscriptions,
  connectivityLog,
  dlqMessages,
  commissionPayouts,
  referrals,
  webhookEndpoints,
  webhookDeliveries,
  agentOnboardingProgress,
  settlementReconciliation,
  rateAlerts,
  emailDeliveryLog,
  inviteCodes,
  tenantBranding,
  premiumFeeSchedules,
  customerFeedbackNps,
  tenantUsers,
  commissionCascadeHistory,
  agentBankAccounts,
  kycDocuments,
  floatReconciliations,
  agentPerformanceScores,
  commissionClawbacks,
  pnlReports,
  transactionLimits,
  complianceChecks,
  agentSuspensionLog,
  txMonitoringAlerts,
  fraudMlScores,
  agentLoans,
  feeRules,
  feeAuditTrail,
  merchantKycDocs,
  merchantPayouts,
  complianceFilings,
  agentAchievements,
  agentBadges,
  tenantFeatureToggles,
  reconciliationBatches,
  reconciliationItems,
  analyticsDashboards,
  rateLimitRules,
  backupSnapshots,
  workflowDefinitions,
  workflowInstances,
  glEntries,
  trainingCourses,
  trainingEnrollments,
  biReportDefinitions,
  observabilityAlerts,
  encryptedFields,
  dataConsentRecords,
  platformBillingLedger,
  billingRevenuePeriods,
  billingReconciliationReports,
  billingRoleAssignments,
  billingAuditLog,
  tenantBillingConfig,
  billingProvisioningHistory,
  commissionTiers,
  commissionSplits,
  disputeEvidence,
  commissionAuditTrail,
  loadTestRuns,
} from "./schema";

// ─── User Relations ────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  agents: many(agents),
  transactions: many(transactions),
  chatSessions: many(chatSessions),
  auditLogs: many(auditLog),
  otpTokens: many(otpTokens),
  fido2Credentials: many(fido2Credentials),
  fido2Challenges: many(fido2Challenges),
  apiKeys: many(apiKeys),
  dataRightsRequests: many(dataRightsRequests),
  billingRoleAssignments: many(billingRoleAssignments),
  billingAuditLogs: many(billingAuditLog),
}));

// ─── Agent Relations ───────────────────────────────────────────────
export const agentsRelations = relations(agents, ({ one, many }) => ({
  user: one(users, { fields: [agents.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [agents.tenantId], references: [tenants.id] }),
  transactions: many(transactions),
  fraudAlerts: many(fraudAlerts),
  loyaltyHistory: many(loyaltyHistory),
  floatTopUpRequests: many(floatTopUpRequests),
  devices: many(devices),
  disputes: many(disputes),
  fieldAgentDevices: many(fieldAgentDevices),
  commissionPayouts: many(commissionPayouts),
  agentPushSubscriptions: many(agentPushSubscriptions),
  agentOnboardingProgress: many(agentOnboardingProgress),
  agentBankAccounts: many(agentBankAccounts),
  kycDocuments: many(kycDocuments),
  agentPerformanceScores: many(agentPerformanceScores),
  agentSuspensionLog: many(agentSuspensionLog),
  agentLoans: many(agentLoans),
  agentAchievements: many(agentAchievements),
  agentBadges: many(agentBadges),
  trainingEnrollments: many(trainingEnrollments),
}));

// ─── Transaction Relations ─────────────────────────────────────────
export const transactionsRelations = relations(
  transactions,
  ({ one, many }) => ({
    agent: one(agents, {
      fields: [transactions.agentId],
      references: [agents.id],
    }),
    user: one(users, { fields: [transactions.userId], references: [users.id] }),
    reversalRequests: many(reversalRequests),
    refunds: many(refunds),
    vatRecords: many(vatRecords),
    billingLedgerEntries: many(platformBillingLedger),
  })
);

// ─── Tenant Relations ──────────────────────────────────────────────
export const tenantsRelations = relations(tenants, ({ many }) => ({
  agents: many(agents),
  tenantUsers: many(tenantUsers),
  tenantBranding: many(tenantBranding),
  premiumFeeSchedules: many(premiumFeeSchedules),
  tenantFeatureToggles: many(tenantFeatureToggles),
  tenantBillingConfig: many(tenantBillingConfig),
  billingProvisioningHistory: many(billingProvisioningHistory),
  platformBillingLedger: many(platformBillingLedger),
  billingRevenuePeriods: many(billingRevenuePeriods),
  billingReconciliationReports: many(billingReconciliationReports),
  reconciliationBatches: many(reconciliationBatches),
  pnlReports: many(pnlReports),
  merchants: many(merchants),
}));

// ─── Chat Relations ────────────────────────────────────────────────
export const chatSessionsRelations = relations(
  chatSessions,
  ({ one, many }) => ({
    user: one(users, { fields: [chatSessions.userId], references: [users.id] }),
    messages: many(chatMessages),
  })
);

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [chatMessages.sessionId],
    references: [chatSessions.id],
  }),
}));

// ─── Dispute Relations ─────────────────────────────────────────────
export const disputesRelations = relations(disputes, ({ one, many }) => ({
  agent: one(agents, { fields: [disputes.agentId], references: [agents.id] }),
  messages: many(disputeMessages),
  evidence: many(disputeEvidence),
}));

export const disputeMessagesRelations = relations(
  disputeMessages,
  ({ one }) => ({
    dispute: one(disputes, {
      fields: [disputeMessages.disputeId],
      references: [disputes.id],
    }),
  })
);

export const disputeEvidenceRelations = relations(
  disputeEvidence,
  ({ one }) => ({
    dispute: one(disputes, {
      fields: [disputeEvidence.disputeId],
      references: [disputes.id],
    }),
  })
);

// ─── Device Relations ──────────────────────────────────────────────
export const devicesRelations = relations(devices, ({ one, many }) => ({
  agent: one(agents, { fields: [devices.agentId], references: [agents.id] }),
  commands: many(deviceCommands),
  serviceRecords: many(serviceRecords),
  softwareUpdates: many(softwareUpdates),
}));

export const deviceCommandsRelations = relations(deviceCommands, ({ one }) => ({
  device: one(devices, {
    fields: [deviceCommands.deviceId],
    references: [devices.id],
  }),
}));

// ─── POS Terminal Relations ────────────────────────────────────────
export const fieldAgentDevicesRelations = relations(fieldAgentDevices, ({ one }) => ({
  agent: one(agents, {
    fields: [fieldAgentDevices.agentId],
    references: [agents.id],
  }),
  terminalGroup: one(terminalGroups, {
    fields: [fieldAgentDevices.groupId],
    references: [terminalGroups.id],
  }),
}));

// ─── Commission Relations ──────────────────────────────────────────
export const commissionPayoutsRelations = relations(
  commissionPayouts,
  ({ one }) => ({
    agent: one(agents, {
      fields: [commissionPayouts.agentId],
      references: [agents.id],
    }),
  })
);

export const commissionCascadeHistoryRelations = relations(
  commissionCascadeHistory,
  ({ one }) => ({
    agent: one(agents, {
      fields: [commissionCascadeHistory.agentId],
      references: [agents.id],
    }),
  })
);

export const commissionClawbacksRelations = relations(
  commissionClawbacks,
  ({ one }) => ({
    agent: one(agents, {
      fields: [commissionClawbacks.agentId],
      references: [agents.id],
    }),
  })
);

export const commissionAuditTrailRelations = relations(
  commissionAuditTrail,
  ({ one }) => ({
    agent: one(agents, {
      fields: [commissionAuditTrail.agentId],
      references: [agents.id],
    }),
  })
);

// ─── Merchant Relations ────────────────────────────────────────────
export const merchantsRelations = relations(merchants, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [merchants.tenantId],
    references: [tenants.id],
  }),
  settlements: many(merchantSettlements),
  kycDocs: many(merchantKycDocs),
  payouts: many(merchantPayouts),
}));

export const merchantSettlementsRelations = relations(
  merchantSettlements,
  ({ one }) => ({
    merchant: one(merchants, {
      fields: [merchantSettlements.merchantId],
      references: [merchants.id],
    }),
  })
);

// ─── Webhook Relations ─────────────────────────────────────────────
export const webhookEndpointsRelations = relations(
  webhookEndpoints,
  ({ many }) => ({
    deliveries: many(webhookDeliveries),
  })
);

export const webhookDeliveriesRelations = relations(
  webhookDeliveries,
  ({ one }) => ({
    endpoint: one(webhookEndpoints, {
      fields: [webhookDeliveries.endpointId],
      references: [webhookEndpoints.id],
    }),
  })
);

// ─── KYC Relations ─────────────────────────────────────────────────
export const kycSessionsRelations = relations(kycSessions, ({ one }) => ({
  agent: one(agents, {
    fields: [kycSessions.agentId],
    references: [agents.id],
  }),
}));

export const kycDocumentsRelations = relations(kycDocuments, ({ one }) => ({
  agent: one(agents, {
    fields: [kycDocuments.agentId],
    references: [agents.id],
  }),
}));

// ─── API Key Relations ─────────────────────────────────────────────
export const apiKeysRelations = relations(apiKeys, ({ one, many }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
  usage: many(apiKeyUsage),
}));

export const apiKeyUsageRelations = relations(apiKeyUsage, ({ one }) => ({
  apiKey: one(apiKeys, {
    fields: [apiKeyUsage.apiKeyId],
    references: [apiKeys.id],
  }),
}));

// ─── Billing Relations ─────────────────────────────────────────────
export const platformBillingLedgerRelations = relations(
  platformBillingLedger,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [platformBillingLedger.tenantId],
      references: [tenants.id],
    }),
  })
);

export const billingRevenuePeriodsRelations = relations(
  billingRevenuePeriods,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [billingRevenuePeriods.tenantId],
      references: [tenants.id],
    }),
  })
);

export const billingReconciliationReportsRelations = relations(
  billingReconciliationReports,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [billingReconciliationReports.tenantId],
      references: [tenants.id],
    }),
  })
);

export const billingRoleAssignmentsRelations = relations(
  billingRoleAssignments,
  ({ one }) => ({
    user: one(users, {
      fields: [billingRoleAssignments.userId],
      references: [users.id],
    }),
  })
);

export const billingAuditLogRelations = relations(
  billingAuditLog,
  ({ one }) => ({
    user: one(users, {
      fields: [billingAuditLog.userId],
      references: [users.id],
    }),
  })
);

export const tenantBillingConfigRelations = relations(
  tenantBillingConfig,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantBillingConfig.tenantId],
      references: [tenants.id],
    }),
  })
);

export const billingProvisioningHistoryRelations = relations(
  billingProvisioningHistory,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [billingProvisioningHistory.tenantId],
      references: [tenants.id],
    }),
  })
);

// ─── Reconciliation Relations ──────────────────────────────────────
export const reconciliationBatchesRelations = relations(
  reconciliationBatches,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [reconciliationBatches.tenantId],
      references: [tenants.id],
    }),
    items: many(reconciliationItems),
  })
);

export const reconciliationItemsRelations = relations(
  reconciliationItems,
  ({ one }) => ({
    batch: one(reconciliationBatches, {
      fields: [reconciliationItems.batchId],
      references: [reconciliationBatches.id],
    }),
  })
);

// ─── Training Relations ────────────────────────────────────────────
export const trainingCoursesRelations = relations(
  trainingCourses,
  ({ many }) => ({
    enrollments: many(trainingEnrollments),
  })
);

export const trainingEnrollmentsRelations = relations(
  trainingEnrollments,
  ({ one }) => ({
    course: one(trainingCourses, {
      fields: [trainingEnrollments.courseId],
      references: [trainingCourses.id],
    }),
    agent: one(agents, {
      fields: [trainingEnrollments.agentId],
      references: [agents.id],
    }),
  })
);

// ─── Workflow Relations ────────────────────────────────────────────
export const workflowInstancesRelations = relations(
  workflowInstances,
  ({ one }) => ({
    definition: one(workflowDefinitions, {
      fields: [workflowInstances.definitionId],
      references: [workflowDefinitions.id],
    }),
  })
);

// ─── Fraud Relations ───────────────────────────────────────────────
export const fraudAlertsRelations = relations(fraudAlerts, ({ one }) => ({
  agent: one(agents, {
    fields: [fraudAlerts.agentId],
    references: [agents.id],
  }),
}));

export const fraudMlScoresRelations = relations(fraudMlScores, ({ one }) => ({
  agent: one(agents, {
    fields: [fraudMlScores.agentId],
    references: [agents.id],
  }),
}));

// ─── Float & Loan Relations ────────────────────────────────────────
export const floatTopUpRequestsRelations = relations(
  floatTopUpRequests,
  ({ one }) => ({
    agent: one(agents, {
      fields: [floatTopUpRequests.agentId],
      references: [agents.id],
    }),
  })
);

export const floatReconciliationsRelations = relations(
  floatReconciliations,
  ({ one }) => ({
    agent: one(agents, {
      fields: [floatReconciliations.agentId],
      references: [agents.id],
    }),
  })
);

export const agentLoansRelations = relations(agentLoans, ({ one }) => ({
  agent: one(agents, { fields: [agentLoans.agentId], references: [agents.id] }),
}));

// ─── Supervisor Relations ──────────────────────────────────────────
export const supervisorAgentsRelations = relations(
  supervisorAgents,
  ({ one }) => ({
    supervisor: one(users, {
      fields: [supervisorAgents.supervisorId],
      references: [users.id],
    }),
    agent: one(agents, {
      fields: [supervisorAgents.agentId],
      references: [agents.id],
    }),
  })
);

// ─── Tenant User Relations ─────────────────────────────────────────
export const tenantUsersRelations = relations(tenantUsers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantUsers.tenantId],
    references: [tenants.id],
  }),
  user: one(users, { fields: [tenantUsers.userId], references: [users.id] }),
}));

// ─── Referral Relations ────────────────────────────────────────────
export const referralsRelations = relations(referrals, ({ one }) => ({
  referrer: one(agents, {
    fields: [referrals.referrerId],
    references: [agents.id],
  }),
}));

// ─── Credit Relations ──────────────────────────────────────────────
export const creditScoreHistoryRelations = relations(
  creditScoreHistory,
  ({ one }) => ({
    agent: one(agents, {
      fields: [creditScoreHistory.agentId],
      references: [agents.id],
    }),
  })
);

export const creditApplicationsRelations = relations(
  creditApplications,
  ({ one }) => ({
    agent: one(agents, {
      fields: [creditApplications.agentId],
      references: [agents.id],
    }),
  })
);

// ─── Fee Relations ─────────────────────────────────────────────────
export const feeRulesRelations = relations(feeRules, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [feeRules.tenantId],
    references: [tenants.id],
  }),
  auditTrail: many(feeAuditTrail),
}));

export const feeAuditTrailRelations = relations(feeAuditTrail, ({ one }) => ({
  feeRule: one(feeRules, {
    fields: [feeAuditTrail.feeRuleId],
    references: [feeRules.id],
  }),
}));

// ─── Settlement Relations ──────────────────────────────────────────
export const settlementReconciliationRelations = relations(
  settlementReconciliation,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [settlementReconciliation.tenantId],
      references: [tenants.id],
    }),
  })
);

// ─── GL (General Ledger) Relations ─────────────────────────────────
export const glEntriesRelations = relations(glEntries, ({ one }) => ({
  tenant: one(tenants, {
    fields: [glEntries.tenantId],
    references: [tenants.id],
  }),
}));

// ─── Compliance Relations ──────────────────────────────────────────
export const complianceChecksRelations = relations(
  complianceChecks,
  ({ one }) => ({
    agent: one(agents, {
      fields: [complianceChecks.agentId],
      references: [agents.id],
    }),
  })
);

export const complianceFilingsRelations = relations(
  complianceFilings,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [complianceFilings.tenantId],
      references: [tenants.id],
    }),
  })
);

// ─── Inventory Relations ───────────────────────────────────────────
export const inventoryItemsRelations = relations(inventoryItems, ({ one }) => ({
  agent: one(agents, {
    fields: [inventoryItems.agentId],
    references: [agents.id],
  }),
}));

// ─── QR Code Relations ─────────────────────────────────────────────
export const qrCodesRelations = relations(qrCodes, ({ one }) => ({
  agent: one(agents, { fields: [qrCodes.agentId], references: [agents.id] }),
}));

// ─── OTA Relations ─────────────────────────────────────────────────
export const otaUpdateLogRelations = relations(otaUpdateLog, ({ one }) => ({
  release: one(otaReleases, {
    fields: [otaUpdateLog.releaseId],
    references: [otaReleases.id],
  }),
  device: one(devices, {
    fields: [otaUpdateLog.deviceId],
    references: [devices.id],
  }),
}));

// ─── Performance & Gamification Relations ──────────────────────────
export const agentPerformanceScoresRelations = relations(
  agentPerformanceScores,
  ({ one }) => ({
    agent: one(agents, {
      fields: [agentPerformanceScores.agentId],
      references: [agents.id],
    }),
  })
);

export const agentAchievementsRelations = relations(
  agentAchievements,
  ({ one }) => ({
    agent: one(agents, {
      fields: [agentAchievements.agentId],
      references: [agents.id],
    }),
  })
);

export const agentBadgesRelations = relations(agentBadges, ({ one }) => ({
  agent: one(agents, {
    fields: [agentBadges.agentId],
    references: [agents.id],
  }),
}));

// ─── Monitoring & Alerting Relations ───────────────────────────────
export const txMonitoringAlertsRelations = relations(
  txMonitoringAlerts,
  ({ one }) => ({
    agent: one(agents, {
      fields: [txMonitoringAlerts.agentId],
      references: [agents.id],
    }),
  })
);

export const rateAlertsRelations = relations(rateAlerts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [rateAlerts.tenantId],
    references: [tenants.id],
  }),
}));

// ─── Sprint 85: Auto-generated relations for remaining tables ────────

export const usersRelations = relations(users, () => ({}));

export const agentsRelations = relations(agents, () => ({}));

export const transactionsRelations = relations(transactions, () => ({}));

export const fraudAlertsRelations = relations(fraudAlerts, () => ({}));

export const loyaltyHistoryRelations = relations(loyaltyHistory, () => ({}));

export const chatSessionsRelations = relations(chatSessions, () => ({}));

export const chatMessagesRelations = relations(chatMessages, () => ({}));

export const auditLogRelations = relations(auditLog, () => ({}));

export const floatTopUpRequestsRelations = relations(
  floatTopUpRequests,
  () => ({})
);

export const otpTokensRelations = relations(otpTokens, () => ({}));

export const devicesRelations = relations(devices, () => ({}));

export const deviceCommandsRelations = relations(deviceCommands, () => ({}));

export const supervisorAgentsRelations = relations(
  supervisorAgents,
  () => ({})
);

export const disputesRelations = relations(disputes, () => ({}));

export const disputeMessagesRelations = relations(disputeMessages, () => ({}));

export const refundsRelations = relations(refunds, () => ({}));

export const platformSettingsRelations = relations(
  platformSettings,
  () => ({})
);

export const velocityLimitsRelations = relations(velocityLimits, () => ({}));

export const complianceReportsRelations = relations(
  complianceReports,
  () => ({})
);

export const geofenceZonesRelations = relations(geofenceZones, () => ({}));

export const agentGeofenceZonesRelations = relations(
  agentGeofenceZones,
  () => ({})
);

export const deviceLocationsRelations = relations(deviceLocations, () => ({}));

export const kycSessionsRelations = relations(kycSessions, () => ({}));

export const fieldAgentDevicesRelations = relations(fieldAgentDevices, () => ({}));

export const terminalGroupsRelations = relations(terminalGroups, () => ({}));

export const serviceRecordsRelations = relations(serviceRecords, ({ one }) => ({
  fieldAgentDevice: one(fieldAgentDevices, {
    fields: [serviceRecords.terminalId],
    references: [fieldAgentDevices.id],
  }),
}));

export const softwareUpdatesRelations = relations(softwareUpdates, () => ({}));

export const commissionRulesRelations = relations(commissionRules, () => ({}));

export const qrCodesRelations = relations(qrCodes, () => ({}));

export const inventoryItemsRelations = relations(inventoryItems, () => ({}));

export const multiSimProfilesRelations = relations(
  multiSimProfiles,
  ({ one }) => ({
    fieldAgentDevice: one(fieldAgentDevices, {
      fields: [multiSimProfiles.terminalId],
      references: [fieldAgentDevices.id],
    }),
  })
);

export const reversalRequestsRelations = relations(
  reversalRequests,
  () => ({})
);

export const shareableLinksRelations = relations(shareableLinks, () => ({}));

export const customersRelations = relations(customers, () => ({}));

export const tenantsRelations = relations(tenants, () => ({}));

export const erpSyncLogRelations = relations(erpSyncLog, () => ({}));


export const vatRecordsRelations = relations(vatRecords, () => ({}));

export const erpConfigRelations = relations(erpConfig, () => ({}));

export const mqttBridgeConfigRelations = relations(
  mqttBridgeConfig,
  () => ({})
);

export const analyticsMetricsRelations = relations(
  analyticsMetrics,
  () => ({})
);

export const webhookSecretsRelations = relations(webhookSecrets, () => ({}));

export const emailQueueRelations = relations(emailQueue, () => ({}));

export const merchantsRelations = relations(merchants, () => ({}));

export const merchantSettlementsRelations = relations(
  merchantSettlements,
  ({ one }) => ({
    merchant: one(merchants, {
      fields: [merchantSettlements.merchantId],
      references: [merchants.id],
    }),
  })
);

export const apiKeysRelations = relations(apiKeys, () => ({}));

export const apiKeyUsageRelations = relations(apiKeyUsage, () => ({}));

export const fido2CredentialsRelations = relations(
  fido2Credentials,
  ({ one }) => ({
    user: one(users, {
      fields: [fido2Credentials.userId],
      references: [users.id],
    }),
    agent: one(agents, {
      fields: [fido2Credentials.agentId],
      references: [agents.id],
    }),
  })
);

export const fido2ChallengesRelations = relations(fido2Challenges, () => ({}));

export const creditScoreHistoryRelations = relations(
  creditScoreHistory,
  ({ one }) => ({
    agent: one(agents, {
      fields: [creditScoreHistory.agentId],
      references: [agents.id],
    }),
  })
);

export const creditApplicationsRelations = relations(
  creditApplications,
  ({ one }) => ({
    agent: one(agents, {
      fields: [creditApplications.agentId],
      references: [agents.id],
    }),
  })
);

export const otaReleasesRelations = relations(otaReleases, () => ({}));

export const otaUpdateLogRelations = relations(otaUpdateLog, ({ one }) => ({
  device: one(devices, {
    fields: [otaUpdateLog.deviceId],
    references: [devices.id],
  }),
  otaRelease: one(otaReleases, {
    fields: [otaUpdateLog.releaseId],
    references: [otaReleases.id],
  }),
}));

export const dataRightsRequestsRelations = relations(
  dataRightsRequests,
  () => ({})
);

export const fraudRulesRelations = relations(fraudRules, () => ({}));

export const agentPushSubscriptionsRelations = relations(
  agentPushSubscriptions,
  () => ({})
);

export const connectivityLogRelations = relations(connectivityLog, () => ({}));

export const systemConfigRelations = relations(systemConfig, () => ({}));

export const simProbeLogRelations = relations(simProbeLog, () => ({}));

export const simOrchestratorConfigRelations = relations(
  simOrchestratorConfig,
  () => ({})
);

export const simFailoverLogRelations = relations(simFailoverLog, () => ({}));

export const deviceCompliancePoliciesRelations = relations(
  deviceCompliancePolicies,
  () => ({})
);

export const deviceComplianceViolationsRelations = relations(
  deviceComplianceViolations,
  () => ({})
);

export const mdmGeofenceViolationsRelations = relations(
  mdmGeofenceViolations,
  () => ({})
);

export const dlqMessagesRelations = relations(dlqMessages, () => ({}));

export const commissionPayoutsRelations = relations(
  commissionPayouts,
  ({ one }) => ({
    agent: one(agents, {
      fields: [commissionPayouts.agentId],
      references: [agents.id],
    }),
  })
);

export const referralsRelations = relations(referrals, ({ one }) => ({
  agent: one(agents, {
    fields: [referrals.referrerAgentId],
    references: [agents.id],
  }),
}));

export const webhookEndpointsRelations = relations(
  webhookEndpoints,
  () => ({})
);

export const webhookDeliveriesRelations = relations(
  webhookDeliveries,
  ({ one }) => ({
    webhookEndpoint: one(webhookEndpoints, {
      fields: [webhookDeliveries.endpointId],
      references: [webhookEndpoints.id],
    }),
  })
);

export const agentOnboardingProgressRelations = relations(
  agentOnboardingProgress,
  ({ one }) => ({
    agent: one(agents, {
      fields: [agentOnboardingProgress.agentId],
      references: [agents.id],
    }),
  })
);

export const settlementReconciliationRelations = relations(
  settlementReconciliation,
  () => ({})
);

export const rateAlertsRelations = relations(rateAlerts, () => ({}));

export const emailDeliveryLogRelations = relations(
  emailDeliveryLog,
  () => ({})
);

export const inviteCodesRelations = relations(inviteCodes, () => ({}));

export const tenantBrandingRelations = relations(tenantBranding, () => ({}));


export const premiumFeeSchedulesRelations = relations(
  premiumFeeSchedules,
  () => ({})
);

export const customerFeedbackNpsRelations = relations(
  customerFeedbackNps,
  () => ({})
);

export const tenantUsersRelations = relations(tenantUsers, () => ({}));

export const commissionCascadeHistoryRelations = relations(
  commissionCascadeHistory,
  () => ({})
);

export const agentBankAccountsRelations = relations(
  agentBankAccounts,
  () => ({})
);

export const kycDocumentsRelations = relations(kycDocuments, () => ({}));

export const floatReconciliationsRelations = relations(
  floatReconciliations,
  () => ({})
);

export const agentPerformanceScoresRelations = relations(
  agentPerformanceScores,
  () => ({})
);

export const commissionClawbacksRelations = relations(
  commissionClawbacks,
  () => ({})
);

export const pnlReportsRelations = relations(pnlReports, () => ({}));

export const geoFencesRelations = relations(geoFences, () => ({}));

export const transactionLimitsRelations = relations(
  transactionLimits,
  () => ({})
);

export const complianceChecksRelations = relations(
  complianceChecks,
  () => ({})
);

export const agentSuspensionLogRelations = relations(
  agentSuspensionLog,
  () => ({})
);

export const txMonitoringAlertsRelations = relations(
  txMonitoringAlerts,
  () => ({})
);

export const fraudMlScoresRelations = relations(fraudMlScores, () => ({}));

export const notificationDispatchLogRelations = relations(
  notificationDispatchLog,
  () => ({})
);

export const agentLoansRelations = relations(agentLoans, () => ({}));

export const feeRulesRelations = relations(feeRules, () => ({}));

export const feeAuditTrailRelations = relations(feeAuditTrail, () => ({}));

export const merchantKycDocsRelations = relations(merchantKycDocs, () => ({}));

export const merchantPayoutsRelations = relations(merchantPayouts, () => ({}));

export const complianceFilingsRelations = relations(
  complianceFilings,
  () => ({})
);

export const agentAchievementsRelations = relations(
  agentAchievements,
  () => ({})
);

export const agentBadgesRelations = relations(agentBadges, () => ({}));

export const tenantFeatureTogglesRelations = relations(
  tenantFeatureToggles,
  () => ({})
);

export const reconciliationBatchesRelations = relations(
  reconciliationBatches,
  () => ({})
);

export const reconciliationItemsRelations = relations(
  reconciliationItems,
  () => ({})
);

export const analyticsDashboardsRelations = relations(
  analyticsDashboards,
  () => ({})
);

export const customerJourneyStepsRelations = relations(
  customerJourneySteps,
  () => ({})
);

export const rateLimitRulesRelations = relations(rateLimitRules, () => ({}));

export const backupSnapshotsRelations = relations(backupSnapshots, () => ({}));

export const workflowDefinitionsRelations = relations(
  workflowDefinitions,
  () => ({})
);

export const workflowInstancesRelations = relations(
  workflowInstances,
  () => ({})
);

export const glEntriesRelations = relations(glEntries, () => ({}));

export const trainingCoursesRelations = relations(trainingCourses, () => ({}));

export const trainingEnrollmentsRelations = relations(
  trainingEnrollments,
  () => ({})
);

export const biReportDefinitionsRelations = relations(
  biReportDefinitions,
  () => ({})
);

export const observabilityAlertsRelations = relations(
  observabilityAlerts,
  () => ({})
);

export const encryptedFieldsRelations = relations(encryptedFields, () => ({}));

export const dataConsentRecordsRelations = relations(
  dataConsentRecords,
  () => ({})
);

export const realtime_tx_alertsRelations = relations(
  realtime_tx_alerts,
  () => ({})
);

export const notification_channelsRelations = relations(
  notification_channels,
  () => ({})
);

export const notification_logsRelations = relations(
  notification_logs,
  () => ({})
);

export const customer_journey_eventsRelations = relations(
  customer_journey_events,
  () => ({})
);

export const gl_accountsRelations = relations(gl_accounts, () => ({}));

export const gl_journal_entriesRelations = relations(
  gl_journal_entries,
  () => ({})
);

export const sla_definitionsRelations = relations(sla_definitions, () => ({}));

export const sla_breachesRelations = relations(sla_breaches, () => ({}));

export const data_export_jobsRelations = relations(
  data_export_jobs,
  () => ({})
);

export const platform_health_checksRelations = relations(
  platform_health_checks,
  () => ({})
);

export const platform_incidentsRelations = relations(
  platform_incidents,
  () => ({})
);

export const commissionTiersRelations = relations(commissionTiers, () => ({}));

export const commissionSplitsRelations = relations(
  commissionSplits,
  () => ({})
);

export const disputeEvidenceRelations = relations(disputeEvidence, () => ({}));

export const commissionAuditTrailRelations = relations(
  commissionAuditTrail,
  () => ({})
);

export const loadTestRunsRelations = relations(loadTestRuns, () => ({}));

export const platformBillingLedgerRelations = relations(
  platformBillingLedger,
  () => ({})
);

export const billingRevenuePeriodsRelations = relations(
  billingRevenuePeriods,
  () => ({})
);

export const billingReconciliationReportsRelations = relations(
  billingReconciliationReports,
  () => ({})
);

export const billingRoleAssignmentsRelations = relations(
  billingRoleAssignments,
  () => ({})
);

export const billingAuditLogRelations = relations(billingAuditLog, () => ({}));

export const tenantBillingConfigRelations = relations(
  tenantBillingConfig,
  () => ({})
);

export const billingProvisioningHistoryRelations = relations(
  billingProvisioningHistory,
  () => ({})
);
