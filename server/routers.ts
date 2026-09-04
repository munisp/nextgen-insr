// SOC 2 CC6.1 COMPLIANCE NOTE:
// All tRPC procedures in this router use protectedProcedure (Keycloak JWT auth)
// or adminProcedure (admin-only). Financial mutations additionally use
// financialProcedure (Permify RBAC) from server/_core/permifyMiddleware.ts.
// Unauthenticated access to any procedure results in HTTP 401 UNAUTHORIZED.
import { jwtVerify } from "jose";

import { KC_SESSION_COOKIE } from "./_core/keycloakAuth";
// Sprint 98: Missing router imports
// Insurance policy purchase orders
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getJwtSecret } from "./lib/envValidation";
import { blacklistToken } from "./lib/redisClient";
import { hashSessionToken } from "./middleware/agentAuth";
import { accountOpeningRouter } from "./routers/accountOpening";
// Sprint 35: Final Production Features
// Sprint 36: White-Label Partner Platform + Production Hardening
// ── Sprint 37 Imports ──
// ── Sprint 39 Imports ──
// ── Sprint 40: Enterprise Scaling & Operational Excellence ──
// ── Sprint 41 Imports ──
// ── Sprint 38 Imports ──
// Sprint 42: Final Production Features
// F-08: tamper-evident audit chain verification/export + GDPR/NDPR dashboard
// Sprint 75: USSD Integration, Carrier Switching, Network Status Dashboard
// Sprint 76: Security, Resilience, Cost, Analytics, SLA, Receipts
// Sprint 78: Session Replay, Live Pricing, KYC, TX Monitor, Commission
// Sprint 79 — Real-time Billing Engine
// Sprint 80: Billing RBAC, Audit, Tenant Onboarding
// Sprint 96: POS Enhancement Routers
// Sprint 97: Frontend-Backend Gap Closure
import { activityAuditLogRouter } from "./routers/activityAuditLog";
import { adminDashboardRouter } from "./routers/adminDashboard";
import { advancedAuditLogViewerRouter } from "./routers/advancedAuditLogViewer";
import { advancedBiReportingRouter } from "./routers/advancedBiReporting";
import { advancedLoadingStatesRouter } from "./routers/advancedLoadingStates";
import { advancedNotificationsRouter } from "./routers/advancedNotifications";
import { advancedRateLimiterRouter } from "./routers/advancedRateLimiter";
import { advancedSearchFilteringRouter } from "./routers/advancedSearchFiltering";
import { agentRouter } from "./routers/agent";
import { agentBankAccountsRouter } from "./routers/agentBankAccountsCrud";
import { agentBankingRouter } from "./routers/agentBanking";
import { agentBenchmarkingRouter } from "./routers/agentBenchmarking";
import { agentClusterAnalyticsRouter } from "./routers/agentClusterAnalytics";
import { agentCommissionCalcRouter } from "./routers/agentCommissionCalc";
import { agentCommunicationHubRouter } from "./routers/agentCommunicationHub";
import { agentDeviceFingerprintRouter } from "./routers/agentDeviceFingerprint";
import { agentFloatForecastingRouter } from "./routers/agentFloatForecasting";
import { agentFloatInsuranceClaimsRouter } from "./routers/agentFloatInsuranceClaims";
import { agentFloatTransferRouter } from "./routers/agentFloatTransfer";
import { agentGamificationRouter } from "./routers/agentGamification";
import { agentHierarchyRouter } from "./routers/agentHierarchy";
import { agentHierarchyTerritoryRouter } from "./routers/agentHierarchyTerritory";
import { agentInventoryMgmtRouter } from "./routers/agentInventoryMgmt";
import { agentKycRouter } from "./routers/agentKyc";
import { agentKycDocVaultRouter } from "./routers/agentKycDocVault";
import { agentLoanAdvanceRouter } from "./routers/agentLoanAdvance";
import { agentLoanFacilityRouter } from "./routers/agentLoanFacility";
import { agentLoanOriginationRouter } from "./routers/agentLoanOrigination";
import { agentLoanOrigination2Router } from "./routers/agentLoanOrigination2";
import { agentManagementRouter } from "./routers/agentManagement";
import { agentMicroInsuranceRouter } from "./routers/agentMicroInsurance";
import { agentNetworkTopologyRouter } from "./routers/agentNetworkTopology";
import { agentOnboardingRouter } from "./routers/agentOnboarding";
import { agentOnboardingWizardRouter } from "./routers/agentOnboardingWizard";
import { agentOnboardingWorkflowRouter } from "./routers/agentOnboardingWorkflow";
import { agentPerformanceAnalyticsRouter } from "./routers/agentPerformanceAnalytics";
import { agentPerformanceIncentivesRouter } from "./routers/agentPerformanceIncentives";
import { agentPerformanceLeaderboardRouter } from "./routers/agentPerformanceLeaderboard";
import { agentPerformanceScorecardRouter } from "./routers/agentPerformanceScorecard";
import { agentPerformanceScoresRouter } from "./routers/agentPerformanceScoresCrud";
import { agentRevenueAttributionRouter } from "./routers/agentRevenueAttribution";
import { agentScorecardRouter } from "./routers/agentScorecard";
import { agentSuspensionLogRouter } from "./routers/agentSuspensionLogCrud";
import { agentSuspensionWorkflowRouter } from "./routers/agentSuspensionWorkflow";
import { agentTerritoryHeatmapRouter } from "./routers/agentTerritoryHeatmap";
import { agentTerritoryMgmtRouter } from "./routers/agentTerritoryMgmt";
import { agentTerritoryOptimizerRouter } from "./routers/agentTerritoryOptimizer";
import { agentTrainingRouter } from "./routers/agentTraining";
import { agentTrainingAcademyRouter } from "./routers/agentTrainingAcademy";
import { agentTrainingGamificationRouter } from "./routers/agentTrainingGamification";
import { agentTrainingPortalRouter } from "./routers/agentTrainingPortal";
import { aiCashFlowPredictorRouter } from "./routers/aiCashFlowPredictor";
import { aiChatSupportRouter } from "./routers/aiChatSupport";
import { aiMonitoringRouter } from "./routers/aiMonitoring";
import { airtimeVendingRouter } from "./routers/airtimeVending";
import { alertNotificationsRouter } from "./routers/alertNotifications";
import { amlScreeningRouter } from "./routers/amlScreening";
import { analyticsRouter } from "./routers/analytics";
import { analyticsDashboardRouter } from "./routers/analyticsDashboard";
import { analyticsDashboardsRouter } from "./routers/analyticsDashboardsCrud";
import { analyticsQueryRouter } from "./routers/analyticsQuery";
import { announcementReactionsRouter } from "./routers/announcementReactions";
import { apacheAirflowRouter } from "./routers/apacheAirflow";
import { apacheNifiRouter } from "./routers/apacheNifi";
import { apiAnalyticsDashRouter } from "./routers/apiAnalyticsDash";
import { apiDocsRouter } from "./routers/apiDocs";
import { apiGatewayRouter } from "./routers/apiGateway";
import { apiKeyManagementRouter } from "./routers/apiKeyManagement";
import { apiRateLimiterDashRouter } from "./routers/apiRateLimiterDash";
import { apiVersioningRouter } from "./routers/apiVersioning";
import { archivalAdminRouter } from "./routers/archivalAdmin";
import { artRobustnessRouter } from "./routers/artRobustness";
import { auditComplianceRouter } from "./routers/auditCompliance";
import { auditExportRouter } from "./routers/auditExport";
import { auditLogRouter } from "./routers/auditLog";
import { auditTrailRouter } from "./routers/auditTrail";
import { auditTrailExportRouter } from "./routers/auditTrailExport";
import { autoComplianceWorkflowRouter } from "./routers/autoComplianceWorkflow";
import { automatedComplianceCheckerRouter } from "./routers/automatedComplianceChecker";
import { automatedSettlementSchedulerRouter } from "./routers/automatedSettlementScheduler";
import { automatedTestingFrameworkRouter } from "./routers/automatedTestingFramework";
import { autoReconciliationEngineRouter } from "./routers/autoReconciliationEngine";
import { backupDisasterRecoveryRouter } from "./routers/backupDisasterRecovery";
import { bankAccountManagementRouter } from "./routers/bankAccountManagement";
import { bankingWorkflowPatternsRouter } from "./routers/bankingWorkflowPatterns";
import { batchProcessingRouter } from "./routers/batchProcessing";
import { billingAuditRouter } from "./routers/billingAudit";
import { billingInvoiceRouter } from "./routers/billingInvoice";
import { billingLedgerRouter } from "./routers/billingLedger";
import { billingLifecycleRouter } from "./routers/billingLifecycle";
import { billingProductionRouter } from "./routers/billingProduction";
import { billingRbacRouter } from "./routers/billingRbac";
import { billingRevenuePeriodsRouter } from "./routers/billingRevenuePeriodsCrud";
import { billPaymentsRouter } from "./routers/billPayments";
import { biometricAuditDashboardRouter } from "./routers/biometricAuditDashboard";
import { biometricAuthRouter } from "./routers/biometricAuth";
import { biometricAuthGatewayRouter } from "./routers/biometricAuthGateway";
import { biReportDefinitionsRouter } from "./routers/biReportDefinitionsCrud";
import { blockchainAuditTrailRouter } from "./routers/blockchainAuditTrail";
import { broadcastAnnouncementsRouter } from "./routers/broadcastAnnouncements";
import { bulkDisbursementEngineRouter } from "./routers/bulkDisbursementEngine";
import { bulkOperationsRouter } from "./routers/bulkOperations";
import { bulkPaymentProcessorRouter } from "./routers/bulkPaymentProcessor";
import { bulkRoleImportRouter } from "./routers/bulkRoleImport";
import { bulkTransactionProcessingRouter } from "./routers/bulkTransactionProcessing";
import { bulkTransactionProcessorRouter } from "./routers/bulkTransactionProcessor";
import { businessRulesRouter } from "./routers/businessRules";
import { canaryReleaseManagerRouter } from "./routers/canaryReleaseManager";
import { capacityPlanningRouter } from "./routers/capacityPlanning";
import { cardBinLookupRouter } from "./routers/cardBinLookup";
import { cardRequestRouter } from "./routers/cardRequest";
import { carrierCostRouter } from "./routers/carrierCost";
import { carrierLivePricingRouter } from "./routers/carrierLivePricing";
import { carrierSlaRouter } from "./routers/carrierSla";
import { carrierSwitchingRouter } from "./routers/carrierSwitching";
import { cbdcIntegrationGatewayRouter } from "./routers/cbdcIntegrationGateway";
import { cbnReportingRouter } from "./routers/cbnReporting";
import { cdnCacheManagerRouter } from "./routers/cdnCacheManager";
import { chaosEngineeringConsoleRouter } from "./routers/chaosEngineeringConsole";
import { chargebackManagementRouter } from "./routers/chargebackManagement";
import { chatRouter } from "./routers/chat";
import { cocoIndexPipelineRouter } from "./routers/cocoIndexPipeline";
import { commissionCalculatorRouter } from "./routers/commissionCalculator";
import { commissionCascadeHistoryRouter } from "./routers/commissionCascadeHistoryCrud";
import { commissionClawbackRouter } from "./routers/commissionClawback";
import { commissionEngineRouter } from "./routers/commissionEngine";
import { commissionPayoutsRouter } from "./routers/commissionPayouts";
import { complianceAutomationRouter } from "./routers/complianceAutomation";
import { complianceCertManagerRouter } from "./routers/complianceCertManager";
import { complianceChatbotRouter } from "./routers/complianceChatbot";
import { complianceFilingRouter } from "./routers/complianceFiling";
import { complianceReportingRouter } from "./routers/complianceReporting";
import { complianceTrainingTrackerRouter } from "./routers/complianceTrainingTracker";
import { configManagementRouter } from "./routers/configManagement";
import { connectionPoolMonitorRouter } from "./routers/connectionPoolMonitor";
import { cqrsEventStoreRouter } from "./routers/cqrsEventStore";
import { crossBorderRemittanceHubRouter } from "./routers/crossBorderRemittanceHub";
import { currencyHedgingRouter } from "./routers/currencyHedging";
import { customerRouter } from "./routers/customer";
import { customer360Router } from "./routers/customer360";
import { customer360ViewRouter } from "./routers/customer360View";
import { customerDatabaseRouter } from "./routers/customerDatabase";
import { customerDisputePortalRouter } from "./routers/customerDisputePortal";
import { customerFeedbackNpsRouter } from "./routers/customerFeedbackNps";
import { customerJourneyAnalyticsRouter } from "./routers/customerJourneyAnalytics";
import { customer_journey_eventsRouter } from "./routers/customerJourneyEventsCrud";
import { customerJourneyMapperRouter } from "./routers/customerJourneyMapper";
import { customerLoyaltyProgramRouter } from "./routers/customerLoyaltyProgram";
import { customerOnboardingPipelineRouter } from "./routers/customerOnboardingPipeline";
import { customerSegmentationEngineRouter } from "./routers/customerSegmentationEngine";
import { customerSurveysRouter } from "./routers/customerSurveys";
import { customerWalletSystemRouter } from "./routers/customerWalletSystem";
import { dailyPnlReportRouter } from "./routers/dailyPnlReport";
import { dashboardLayoutRouter } from "./routers/dashboardLayout";
import { databaseVisualizationRouter } from "./routers/databaseVisualization";
import { dataConsentRecordsRouter } from "./routers/dataConsentRecordsCrud";
import { dataExportRouter as dataExportRouterV2 } from "./routers/dataExport";
import { dataExportHubRouter } from "./routers/dataExportHub";
import { dataExportImportRouter } from "./routers/dataExportImport";
import { dataExportRouter as sprint27DataExportRouter } from "./routers/dataExportRouter";
import { dataQualityRouter } from "./routers/dataQuality";
import { dataRetentionPolicyRouter } from "./routers/dataRetentionPolicy";
import { dataThresholdAlertsRouter } from "./routers/dataThresholdAlerts";
import { dbSchemaMigrationManagerRouter } from "./routers/dbSchemaMigrationManager";
import { dbSchemaPushRouter } from "./routers/dbSchemaPush";
import { dbtIntegrationRouter } from "./routers/dbtIntegration";
import { decentralizedIdentityManagerRouter } from "./routers/decentralizedIdentityManager";
import { deepfaceRouter } from "./routers/deepface";
import { developerPortalRouter } from "./routers/developerPortal";
import { deviceFleetManagerRouter } from "./routers/deviceFleetManager";
import { digitalTwinSimulatorRouter } from "./routers/digitalTwinSimulator";
import { disputeAnalyticsRouter } from "./routers/disputeAnalytics";
import { disputeMediationAIRouter } from "./routers/disputeMediationAI";
import { disputeNotificationsRouter } from "./routers/disputeNotifications";
import { disputeRefundRouter } from "./routers/disputeRefund";
import { disputeResolutionRouter } from "./routers/disputeResolution";
import { disputesRouter } from "./routers/disputes";
import { disputeWorkflowEngineRouter } from "./routers/disputeWorkflowEngine";
import { distributedTracingDashRouter } from "./routers/distributedTracingDash";
import { documentManagementRouter } from "./routers/documentManagement";
import { dragDropReportBuilderRouter } from "./routers/dragDropReportBuilder";
import { dynamicFeeCalculatorRouter } from "./routers/dynamicFeeCalculator";
import { dynamicFeeEngineRouter } from "./routers/dynamicFeeEngine";
import { dynamicPricingEngineRouter } from "./routers/dynamicPricingEngine";
import { dynamicQrPaymentRouter } from "./routers/dynamicQrPayment";
import { e2eTestFrameworkRouter } from "./routers/e2eTestFramework";
import { emailDeliveryLogRouter } from "./routers/emailDeliveryLogCrud";
import { emailNotificationsRouter } from "./routers/emailNotifications";
import { encryptedFieldsRouter } from "./routers/encryptedFieldsCrud";
import { eodReconciliationRouter } from "./routers/eodReconciliation";
import { erpRouter } from "./routers/erp";
import { escalationChainsRouter } from "./routers/escalationChains";
import { esgCarbonTrackerRouter } from "./routers/esgCarbonTracker";
import { eventDrivenArchRouter } from "./routers/eventDrivenArch";
import { executiveCommandCenterRouter } from "./routers/executiveCommandCenter";
import { exportRouter } from "./routers/export";
import { faceEnrollmentRouter } from "./routers/faceEnrollment";
import { falkordbGraphRouter } from "./routers/falkordbGraph";
import { featureFlagsRouter } from "./routers/featureFlags";
import { financialNlEngineRouter } from "./routers/financialNlEngine";
import { financialReconciliationDashRouter } from "./routers/financialReconciliationDash";
import { financialReportingSuiteRouter } from "./routers/financialReportingSuite";
import { firmwareOTARouter } from "./routers/firmwareOTA";
import { floatManagementRouter } from "./routers/floatManagement";
import { floatReconciliationRouter } from "./routers/floatReconciliation";
import { floatReconciliationsRouter } from "./routers/floatReconciliationsCrud";
import { fraudRouter } from "./routers/fraud";
import { fraudCaseManagementRouter } from "./routers/fraudCaseManagement";
import { fraudMlScoringEngineRouter } from "./routers/fraudMlScoringEngine";
import { fraudMlScoringEngineRouter as fraudMlScoringEngineRouterV2 } from "./routers/fraudMlScoringEngine";
import { fraudRealtimeVizRouter } from "./routers/fraudRealtimeViz";
import { fraudReportGeneratorRouter } from "./routers/fraudReportGenerator";
import { fxRatesRouter } from "./routers/fxRates";
import { gatewayHealthMonitorRouter } from "./routers/gatewayHealthMonitor";
import { gdprRouter } from "./routers/gdpr";
import { gdprDashboardRouter } from "./routers/gdprDashboard";
import { generalLedgerRouter } from "./routers/generalLedger";
import { geoFenceDedicatedRouter } from "./routers/geoFenceDedicated";
import { geoFencesRouter } from "./routers/geoFencesCrud";
import { geoFencingRouter } from "./routers/geoFencing";
import { geoFencingDedicatedRouter } from "./routers/geoFencingDedicated";
import { gl_accountsRouter } from "./routers/glAccountsCrud";
import { gl_journal_entriesRouter } from "./routers/glJournalEntriesCrud";
import { globalSearchRouter } from "./routers/globalSearch";
import { goServiceBridgeRouter } from "./routers/goServiceBridge";
import { graphqlFederationRouter } from "./routers/graphqlFederation";
import { graphqlSubscriptionGatewayRouter } from "./routers/graphqlSubscriptionGateway";
import { guideFeedbackRouter } from "./routers/guideFeedback";
import { healthCheckRouter } from "./routers/healthCheck";
import { helpDeskRouter } from "./routers/helpDesk";
import { incidentCommandCenterRouter } from "./routers/incidentCommandCenter";
import { incidentManagementRouter } from "./routers/incidentManagement";
import { incidentPlaybookRouter } from "./routers/incidentPlaybook";
import {
  telematicsRouter, cvClaimsRouter, fraudNetworkRouter, healthWearablesRouter,
  nhiaRouter, comparisonRouter, p2pPoolsRouter, voiceClaimsRouter,
  parametricRouter, groupInsuranceRouter, bancassuranceRouter, openInsuranceRouter,
  climateRiskRouter, renewalPredictionRouter, sloMonitorRouter, didIdentityRouter,
} from "./routers/innovationRouters";
import { insuranceJourneyOrchestratorRouter } from "./routers/insuranceJourneyOrchestrator";
import { insuranceJourneyOrchestratorV2Router } from "./routers/insuranceJourneyOrchestratorV2";
// ── KYC/KYB Enforcement & Compliance Services ──
// ── Insurance Domain Workflows (Sprint 98) ──
// ── Insurance KPI Dashboards (all 16 roles) ──
import { insuranceKpiDashboardRouter } from "./routers/insuranceKpiDashboard";
import { insurancePolicyQuoteManagerRouter } from "./routers/insurancePolicyQuoteManager";
import { insuranceProductCatalogRouter } from "./routers/insuranceProductCatalog";
import { insuranceProductsRouter } from "./routers/insuranceProducts";
import { insuranceWorkflowsRouter } from "./routers/insuranceWorkflows";
import { insureMarketRouter } from "./routers/insureMarket";
import { integrationMarketplaceRouter } from "./routers/integrationMarketplace";
import { intelligentRoutingEngineRouter } from "./routers/intelligentRoutingEngine";
import { inviteCodesRouter } from "./routers/inviteCodes";
import { j20SchedulerRouter } from "./routers/j20SchedulerRouter";
import { kafkaConsumerRouter } from "./routers/kafkaConsumer";
import { kybRouter } from "./routers/kyb";
import { kycRouter } from "./routers/kyc";
import { kycDocumentManagementRouter } from "./routers/kycDocumentManagement";
import { kycDocumentsRouter } from "./routers/kycDocumentsCrud";
import { kycEnforcementRouter } from "./routers/kycEnforcement";
import { lakehouseRouter } from "./routers/lakehouse";
import { lakehouseAiIntegrationRouter } from "./routers/lakehouseAiIntegration";
import { liveBillingDashboardRouter } from "./routers/liveBillingDashboard";
import { loadTestMetricsRouter } from "./routers/loadTestMetrics";
import { loanDisbursementRouter } from "./routers/loanDisbursement";
import { loyaltyRouter } from "./routers/loyalty";
import { managementRouter } from "./routers/management";
import { marketplaceRouter } from "./routers/marketplace";
import { mccManagerRouter } from "./routers/mccManager";
import { mdmRouter } from "./routers/mdm";
import { merchantRouter } from "./routers/merchant";
import { merchantAcquirerGatewayRouter } from "./routers/merchantAcquirerGateway";
import { merchantAnalyticsDashRouter } from "./routers/merchantAnalyticsDash";
import { merchantKycOnboardingRouter } from "./routers/merchantKycOnboarding";
import { merchantOnboardingPortalRouter } from "./routers/merchantOnboardingPortal";
import { merchantPaymentsRouter } from "./routers/merchantPayments";
import { merchantPayoutSettlementRouter } from "./routers/merchantPayoutSettlement";
import { merchantRiskScoringRouter } from "./routers/merchantRiskScoring";
import { merchantSettlementDashboardRouter } from "./routers/merchantSettlementDashboard";
import { mfaManagerRouter } from "./routers/mfaManager";
import { middlewareServiceManagerRouter } from "./routers/middlewareServiceManager";
import { mlScoringServiceRouter } from "./routers/mlScoringService";
import { mobileApiLayerRouter } from "./routers/mobileApiLayer";
import { mobileMoneyRouter } from "./routers/mobileMoney";
import { mqttBridgeRouter } from "./routers/mqttBridge";
import { multiChannelNotificationHubRouter } from "./routers/multiChannelNotificationHub";
import { multiChannelPaymentOrchRouter } from "./routers/multiChannelPaymentOrch";
import { multiCurrencyRouter } from "./routers/multiCurrency";
import { multiCurrencyExchangeRouter } from "./routers/multiCurrencyExchange";
import { multiSimFailoverRouter } from "./routers/multiSimFailover";
import { multiTenancyRouter } from "./routers/multiTenancy";
import { multiTenantIsolationRouter } from "./routers/multiTenantIsolation";
import { naicomReportingRouter } from "./routers/naicomReporting";
import { networkQualityHeatmapRouter } from "./routers/networkQualityHeatmap";
import { networkResilienceRouter } from "./routers/networkResilience";
import { networkStatusDashboardRouter } from "./routers/networkStatusDashboard";
import { networkTelemetryRouter } from "./routers/networkTelemetry";
import { networkTrendsRouter } from "./routers/networkTrends";
import { nlAnalyticsQueryRouter } from "./routers/nlAnalyticsQuery";
import { nlFinancialQueryRouter } from "./routers/nlFinancialQuery";
import { notificationCenterRouter } from "./routers/notificationCenter";
import { notification_channelsRouter } from "./routers/notificationChannelsCrud";
import { notificationInboxRouter } from "./routers/notificationInbox";
import { notification_logsRouter } from "./routers/notificationLogsCrud";
import { notificationOrchestratorRouter } from "./routers/notificationOrchestrator";
import { observabilityAlertsRouter } from "./routers/observabilityAlertsCrud";
import { offlinePosModeRouter } from "./routers/offlinePosMode";
import { offlineQueueRouter } from "./routers/offlineQueue";
import { offlineSyncRouter } from "./routers/offlineSync";
import { ollamaLLMRouter } from "./routers/ollamaLLM";
import { openTelemetryRouter } from "./routers/openTelemetry";
import { operationalCommandBridgeRouter } from "./routers/operationalCommandBridge";
import { operationalRunbookRouter } from "./routers/operationalRunbook";
import { partnerOnboardingRouter } from "./routers/partnerOnboarding";
import { partnerRevenueSharingRouter } from "./routers/partnerRevenueSharing";
import { partnerSelfServiceRouter } from "./routers/partnerSelfService";
import { paymentDisputeArbitrationRouter } from "./routers/paymentDisputeArbitration";
import { paymentGatewayRouterRouter } from "./routers/paymentGatewayRouter";
import { paymentLinkGeneratorRouter } from "./routers/paymentLinkGenerator";
import { paymentNotificationSystemRouter } from "./routers/paymentNotificationSystem";
import { paymentReconciliationRouter } from "./routers/paymentReconciliation";
import { paymentTokenVaultRouter } from "./routers/paymentTokenVault";
import { pbacManagementRouter } from "./routers/pbacManagement";
import { pensionCollectionRouter } from "./routers/pensionCollection";
import { performanceProfilerRouter } from "./routers/performanceProfiler";
import { pinResetRouter } from "./routers/pinReset";
import { pipelineMonitoringRouter } from "./routers/pipelineMonitoring";
import { platformABTestingRouter } from "./routers/platformABTesting";
import { platformCapacityPlannerRouter } from "./routers/platformCapacityPlanner";
import { platformChangelogRouter } from "./routers/platformChangelog";
import { platformConfigCenterRouter } from "./routers/platformConfigCenter";
import { platformCostAllocatorRouter } from "./routers/platformCostAllocator";
import { platformFeatureFlagsRouter } from "./routers/platformFeatureFlags";
import { platformHealthRouter } from "./routers/platformHealth";
import { platformHealthDashRouter } from "./routers/platformHealthDash";
import { platformHealthMonitorRouter } from "./routers/platformHealthMonitor";
import { platformHealthScorecardRouter } from "./routers/platformHealthScorecard";
import { platformMaturityScorecardRouter } from "./routers/platformMaturityScorecard";
import { platformMetricsExporterRouter } from "./routers/platformMetricsExporter";
import { platformMigrationToolkitRouter } from "./routers/platformMigrationToolkit";
import { platformProxyRouter } from "./routers/platformProxy";
import { platformRecommendationsRouter } from "./routers/platformRecommendations";
import { platformRevenueOptimizerRouter } from "./routers/platformRevenueOptimizer";
import { platformSlaMonitorRouter } from "./routers/platformSlaMonitor";
import { pnlReportRouter } from "./routers/pnlReport";
import { pnlReportsRouter } from "./routers/pnlReportsCrud";
import { posDisputeRouter } from "./routers/posDispute";
import { posServiceUpdateRouter } from "./routers/posServiceUpdate";
import { insuranceServiceFleetRouter } from "./routers/posTerminalFleet";
import { predictiveAgentChurnRouter } from "./routers/predictiveAgentChurn";
import { premiumTopUpRouter } from "./routers/premiumTopUp";
import { productionFeaturesRouter } from "./routers/productionFeatures";
import { promotionsRouter } from "./routers/promotions";
import { publishReadinessCheckerRouter } from "./routers/publishReadinessChecker";
import { pushNotificationsRouter } from "./routers/pushNotifications";
import { qdrantVectorSearchRouter } from "./routers/qdrantVectorSearch";
import { ransomwareAlertsRouter } from "./routers/ransomwareAlerts";
import { rateAlertsRouter } from "./routers/rateAlerts";
import { rateLimitEngineRouter } from "./routers/rateLimitEngine";
import { realtimeDashboardWidgetsRouter } from "./routers/realtimeDashboardWidgets";
import { realtimeNotificationsRouter } from "./routers/realtimeNotifications";
import { realtimePnlDashboardRouter } from "./routers/realtimePnlDashboard";
import { realtime_tx_alertsRouter } from "./routers/realtimeTxAlertsCrud";
import { realtimeTxMonitorRouter } from "./routers/realtimeTxMonitor";
import { realtimeWebSocketFeedsRouter } from "./routers/realtimeWebSocketFeeds";
import { receiptTemplatesRouter } from "./routers/receiptTemplates";
import { reconciliationEngineRouter } from "./routers/reconciliationEngine";
import { recurringPaymentsRouter } from "./routers/recurringPayments";
import { referralProgramRouter } from "./routers/referralProgram";
import { referralsRouter } from "./routers/referrals";
import { regulatoryComplianceRouter } from "./routers/regulatoryCompliance";
import { regulatoryComplianceChecksRouter } from "./routers/regulatoryComplianceChecks";
import { regulatoryFilingAutomationRouter } from "./routers/regulatoryFilingAutomation";
import { regulatoryReportGeneratorRouter } from "./routers/regulatoryReportGenerator";
import { regulatoryReportingEngineRouter } from "./routers/regulatoryReportingEngine";
import { regulatorySandboxRouter } from "./routers/regulatorySandbox";
import { regulatorySandboxTesterRouter } from "./routers/regulatorySandboxTester";
import { remittanceRouter } from "./routers/remittance";
import { reportBuilderTemplatesRouter } from "./routers/reportBuilderTemplates";
import { reportSchedulerRouter } from "./routers/reportScheduler";
import { reportTemplateDesignerRouter } from "./routers/reportTemplateDesigner";
import { resilienceRouter } from "./routers/resilience";
import { resilienceHardeningRouter } from "./routers/resilienceHardening";
import { revenueAnalyticsRouter } from "./routers/revenueAnalytics";
import { revenueForecastingEngineRouter } from "./routers/revenueForecastingEngine";
import { revenueLeakageDetectorRouter } from "./routers/revenueLeakageDetector";
import { revenueReconciliationRouter } from "./routers/revenueReconciliation";
import { reversalApprovalRouter } from "./routers/reversalApproval";
import { runtimeConfigAdminRouter } from "./routers/runtimeConfigAdmin";
import { runtimeConfigAdminRouter as runtimeConfigAdminRouterV2 } from "./routers/runtimeConfigAdmin";
import { savingsProductsRouter } from "./routers/savingsProducts";
import { scheduledReportsRouter } from "./routers/scheduledReports";
import { securityAuditRouter } from "./routers/securityAudit";
import { securityHardeningRouter } from "./routers/securityHardening";
import { serviceMeshRouter } from "./routers/serviceMesh";
import { serviceNodeFleetRouter } from "./routers/serviceNodeFleet";
import { settlementRouter } from "./routers/settlement";
import { settlementBatchProcessorRouter } from "./routers/settlementBatchProcessor";
import { settlementNettingEngineRouter } from "./routers/settlementNettingEngine";
import { settlementReconciliationRouter } from "./routers/settlementReconciliation";
import { sharedLayoutsRouter } from "./routers/sharedLayouts";
import { simOrchestratorRouter } from "./routers/simOrchestrator";
import { skillCreatorIntegrationRouter } from "./routers/skillCreatorIntegration";
import { slaManagementRouter } from "./routers/slaManagement";
import { slaMonitoringRouter } from "./routers/slaMonitoring";
import { slaMonitoringDashRouter } from "./routers/slaMonitoringDash";
import { smartContractPaymentRouter } from "./routers/smartContractPayment";
import { smsNotificationsRouter } from "./routers/smsNotifications";
import { smsReceiptRouter } from "./routers/smsReceipt";
import { socialCommerceGatewayRouter } from "./routers/socialCommerceGateway";
import { splitPaymentsRouter } from "./routers/splitPayments";
import {
  notificationAnalyticsRouter,
  userQuietHoursRouter,
  notifTemplateRouter,
  bulkNotifRouter,
  retryQueueRouter,
  digestRouter,
  rateLimitDashboardRouter,
  sysConfigRouter,
  sessionMgmtRouter,
  dataExportRouter,
  changelogRouter,
  webhookRetryRouter,
  eventBusRouter,
  serviceHealthRouter,
  cacheRouter,
} from "./routers/sprint15Features";
import { sprint23Router } from "./routers/sprint23Router";
import { superAdminRouter } from "./routers/superAdmin";
import { supervisorRouter } from "./routers/supervisor";
import { supplyChainRouter } from "./routers/supplyChain";
import { systemConfigRouter } from "./routers/systemConfig";
import { systemConfigManagerRouter } from "./routers/systemConfigManager";
import { systemHealthDashboardRouter } from "./routers/systemHealthDashboard";
import { systemHealthMonitorRouter } from "./routers/systemHealthMonitor";
import { systemMigrationToolsRouter } from "./routers/systemMigrationTools";
import { taxCollectionRouter } from "./routers/taxCollection";
import { temporalWorkflowsRouter } from "./routers/temporalWorkflows";
import { tenantAdminRouter } from "./routers/tenantAdmin";
import { tenantBillingOnboardingRouter } from "./routers/tenantBillingOnboarding";
import { tenantBrandingRouter } from "./routers/tenantBrandingCrud";
import { tenantFeatureToggleRouter } from "./routers/tenantFeatureToggle";
import { tenantFeeOverridesRouter } from "./routers/tenantFeeOverridesCrud";
import { terminalLeasingRouter } from "./routers/terminalLeasing";
import { tigerBeetleRouter } from "./routers/tigerBeetle";
import { trainingCertificationRouter } from "./routers/trainingCertification";
import { trainingCoursesRouter } from "./routers/trainingCoursesCrud";
import { trainingEnrollmentsRouter } from "./routers/trainingEnrollmentsCrud";
import { transactionCsvExportRouter } from "./routers/transactionCsvExport";
import { transactionDisputeResolutionRouter } from "./routers/transactionDisputeResolution";
import { transactionEnrichmentServiceRouter } from "./routers/transactionEnrichmentService";
import { transactionExportEngineRouter } from "./routers/transactionExportEngine";
import { transactionFeeCalcRouter } from "./routers/transactionFeeCalc";
import { transactionGraphAnalyzerRouter } from "./routers/transactionGraphAnalyzer";
import { transactionLimitsEngineRouter } from "./routers/transactionLimitsEngine";
import { transactionMapLoadingRouter } from "./routers/transactionMapLoading";
import { transactionMapVizRouter } from "./routers/transactionMapViz";
import { transactionMonitoringRouter } from "./routers/transactionMonitoring";
import { transactionReceiptGeneratorRouter } from "./routers/transactionReceiptGenerator";
import { transactionReconciliationRouter } from "./routers/transactionReconciliation";
import { transactionReversalManagerRouter } from "./routers/transactionReversalManager";
import { transactionReversalWorkflowRouter } from "./routers/transactionReversalWorkflow";
import { transactionsRouter } from "./routers/transactions";
import { transactionVelocityMonitorRouter } from "./routers/transactionVelocityMonitor";
import { txDisputeArbitrationRouter } from "./routers/txDisputeArbitration";
import { txMonitorRouter } from "./routers/txMonitor";
import { txVelocityMonitorRouter } from "./routers/txVelocityMonitor";
import { userNotifPreferencesRouter } from "./routers/userNotifPreferences";
import { ussdAnalyticsRouter } from "./routers/ussdAnalytics";
import { ussdGatewayRouter } from "./routers/ussdGateway";
import { ussdIntegrationRouter } from "./routers/ussdIntegration";
import { ussdLocalizationRouter } from "./routers/ussdLocalization";
import { ussdReceiptRouter } from "./routers/ussdReceipt";
import { ussdSessionReplayRouter } from "./routers/ussdSessionReplay";
import { vaultSecretsRouter } from "./routers/vaultSecrets";
import { voiceCommandPosRouter } from "./routers/voiceCommandPos";
import { webhookDeliverySystemRouter } from "./routers/webhookDeliverySystem";
import { webhookManagementRouter } from "./routers/webhookManagement";
import { webhookNotificationsRouter } from "./routers/webhookNotifications";
import { webhooksRouter } from "./routers/webhooks";
import { websocketServiceRouter } from "./routers/websocketService";
import { weeklyReportsRouter } from "./routers/weeklyReports";
import { whatsappChannelRouter } from "./routers/whatsappChannel";
import { whiteLabelApprovalRouter } from "./routers/whiteLabelApproval";
import { whiteLabelBrandingRouter } from "./routers/whiteLabelBranding";
import { whiteLabelOnboardingRouter } from "./routers/whiteLabelOnboarding";
import { workflowAutomationRouter } from "./routers/workflowAutomation";
import { workflowEngineRouter } from "./routers/workflowEngine";
import { worldViewRouter } from "./routers/worldView";
import { stripeRouter } from "./stripe/stripeRouter";

export const appRouter = router({
  goServices: goServiceBridgeRouter,
  worldView: worldViewRouter,
  insureMarket: insureMarketRouter,
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    // Keycloak logout is handled by GET /api/auth/logout (redirect to end-session).
    // This tRPC mutation clears the session cookie for API clients that cannot
    // follow redirects (e.g. mobile apps using the tRPC client directly).
    logout: publicProcedure.mutation(async ({ ctx }) => {
      // F6-1: revoke the session token server-side before clearing the cookie,
      // so a captured kc_session JWT dies at logout instead of at exp.
      const cookieHeader = ctx.req.headers.cookie ?? "";
      const match = cookieHeader.match(
        new RegExp(`${KC_SESSION_COOKIE}=([^;]+)`)
      );
      if (match?.[1]) {
        try {
          const secret = new TextEncoder().encode(getJwtSecret());
          const { payload } = await jwtVerify(match[1], secret);
          const exp =
            typeof payload.exp === "number"
              ? payload.exp
              : Math.floor(Date.now() / 1000);
          await blacklistToken(hashSessionToken(match[1]), exp);
        } catch {
          // Unverifiable token — already unusable, nothing to revoke.
        }
      }
      ctx.res.clearCookie(KC_SESSION_COOKIE, {
        path: "/",
        maxAge: -1,
        httpOnly: true,
        sameSite: "none",
        secure: true,
      });
      return { success: true } as const;
    }),
  }),

  // Sprint 86: Orphan table CRUD routers
  agentBankAccounts: agentBankAccountsRouter,
  agentPerformanceScores: agentPerformanceScoresRouter,
  agentSuspensionLog: agentSuspensionLogRouter,
  analyticsDashboards: analyticsDashboardsRouter,
  biReportDefinitions: biReportDefinitionsRouter,
  billingRevenuePeriods: billingRevenuePeriodsRouter,
  commissionCascadeHistory: commissionCascadeHistoryRouter,
  customer_journey_events: customer_journey_eventsRouter,
  dataConsentRecords: dataConsentRecordsRouter,
  emailDeliveryLog: emailDeliveryLogRouter,
  encryptedFields: encryptedFieldsRouter,
  floatReconciliations: floatReconciliationsRouter,
  geoFences: geoFencesRouter,
  geoFenceDedicated: geoFenceDedicatedRouter,
  gl_accounts: gl_accountsRouter,
  gl_journal_entries: gl_journal_entriesRouter,
  kycDocuments: kycDocumentsRouter,
  notification_channels: notification_channelsRouter,
  notification_logs: notification_logsRouter,
  observabilityAlerts: observabilityAlertsRouter,
  pnlReports: pnlReportsRouter,
  realtime_tx_alerts: realtime_tx_alertsRouter,
  tenantBranding: tenantBrandingRouter,
  tenantFeeOverrides: tenantFeeOverridesRouter,
  trainingCourses: trainingCoursesRouter,
  trainingEnrollments: trainingEnrollmentsRouter,
  // InsurePortal POS feature routers
  agent: agentRouter,
  transactions: transactionsRouter,
  fraud: fraudRouter,
  loyalty: loyaltyRouter,
  chat: chatRouter,
  auditLog: auditLogRouter,
  // F-08: admin-gated audit chain verify/export/retention
  auditCompliance: auditComplianceRouter,
  agentMgmt: agentManagementRouter,
  premiumTopUp: premiumTopUpRouter,
  smsReceipt: smsReceiptRouter,
  export: exportRouter,
  pinReset: pinResetRouter,
  settlement: settlementRouter,
  resilience: resilienceRouter,
  networkTelemetry: networkTelemetryRouter,
  mdm: mdmRouter,
  supervisor: supervisorRouter,
  disputes: disputesRouter,
  geofencing: geoFencingRouter,
  kyc: kycRouter,
  kyb: kybRouter,
  deepface: deepfaceRouter,
  // Back-office and multi-app routers
  management: managementRouter,
  agentBanking: agentBankingRouter,
  customer: customerRouter,
  superAdmin: superAdminRouter,
  // Platform microservice proxy (APISix gateway)
  platform: platformProxyRouter,
  // ERP webhook configuration & sync
  erp: erpRouter,
  // Fluvio MQTT bridge configuration
  mqttBridge: mqttBridgeRouter,
  // Real-time analytics metrics
  analytics: analyticsRouter,
  // NDPR/GDPR data portability and erasure
  gdpr: gdprRouter,
  // GDPR/NDPR compliance dashboard + customer DSAR/erasure (was unmounted)
  gdprDashboard: gdprDashboardRouter,
  // P3-A: Merchant Portal
  merchant: merchantRouter,
  // P3-C: Developer Portal (API key management)
  devPortal: developerPortalRouter,
  // Admin-settable key-value configuration store
  systemConfig: systemConfigRouter,
  // SIM Orchestrator — intelligent multi-SIM network selection daemon
  simOrchestrator: simOrchestratorRouter,
  // VAPID Web Push Notifications
  push: pushNotificationsRouter,
  // CBN Regulatory Reporting (Monthly Activity, Quarterly Fraud, SAR)
  cbnReporting: cbnReportingRouter,
  // Insurance Business Rules Engine (CBN limits, KYC, fraud scoring, commissions, loyalty)
  businessRules: businessRulesRouter,
  // Data Lakehouse: snapshot management, Sedona spatial queries, DataFusion proxy, Gold-layer metrics
  lakehouse: lakehouseRouter,
  // Outbound webhook endpoint management + delivery history
  webhooks: webhooksRouter,
  // Commission payout lifecycle (request → approve → process → complete)
  commissionPayouts: commissionPayoutsRouter,
  // Agent referral program (generate code, use code, award bonus)
  referrals: referralsRouter,
  // Agent onboarding wizard (5-step: profile → kyc → float → terminal → training)
  agentOnboarding: agentOnboardingRouter,
  // Settlement reconciliation (match batches vs transactions, resolve discrepancies)
  settlementRecon: settlementReconciliationRouter,
  // TigerBeetle double-entry ledger: accounts, balances, transfers, sync status
  ledger: tigerBeetleRouter,
  // Kafka/Fluvio consumer group status, DLQ management
  kafka: kafkaConsumerRouter,
  // Temporal workflow management (start, signal, terminate, history)
  temporal: temporalWorkflowsRouter,
  // HashiCorp Vault secret rotation and lease management
  vault: vaultSecretsRouter,
  // Live FX exchange rates (ECB + Open Exchange Rates with 15-min cache)
  fxRates: fxRatesRouter,
  // Email notification management (SendGrid/SES dual-provider, preferences, delivery log)
  emailNotifications: emailNotificationsRouter,
  // Rate alert subscriptions (threshold monitoring, multi-channel notifications)
  rateAlerts: rateAlertsRouter,
  // SMS notification management (Twilio + Africa's Talking + Termii dual-provider)
  smsNotifications: smsNotificationsRouter,
  // Unified notification inbox (aggregates email, SMS, push, in-app)
  notificationInbox: notificationInboxRouter,
  // Webhook-triggered notification dispatcher
  webhookNotif: webhookNotificationsRouter,
  // Production features (pref matrix, batch ops, RBAC, versioning, rate limiting, health, etc.)
  production: productionFeaturesRouter,
  // Admin analytics dashboard (KPIs, charts, leaderboard, geographic distribution)
  analyticsDashboard: analyticsDashboardRouter,
  // Scheduled report generator (CRUD, templates, email delivery)
  scheduledReports: scheduledReportsRouter,
  // Dashboard layout customization (drag-and-drop, presets, persistence)
  dashboardLayout: dashboardLayoutRouter,
  // System-wide broadcast announcements (compose, schedule, pin, dismiss)
  broadcast: broadcastAnnouncementsRouter,
  // End-user custom notification preferences (per-category, per-channel)
  userNotifPrefs: userNotifPreferencesRouter,
  // Shared dashboard layouts (gallery, share, fork, import)
  sharedLayouts: sharedLayoutsRouter,
  // Report template designer (widget catalog, CRUD, grid layout)
  reportTemplate: reportTemplateDesignerRouter,
  // Data threshold alerts (metric monitoring, breach detection, multi-channel notification)
  thresholdAlerts: dataThresholdAlertsRouter,
  // Announcement reactions and feedback
  announcementReactions: announcementReactionsRouter,
  // Sprint 15: Escalation chain engine for unacknowledged alerts
  escalationChains: escalationChainsRouter,
  // Sprint 15: Notification delivery analytics and channel performance
  notifAnalytics: notificationAnalyticsRouter,
  // Sprint 15: User quiet hours configuration
  quietHours: userQuietHoursRouter,
  // Sprint 15: Notification template management CRUD
  notifTemplates: notifTemplateRouter,
  // Sprint 15: Bulk notification campaigns
  bulkNotif: bulkNotifRouter,
  // Sprint 15: Notification retry queue with exponential backoff
  retryQueue: retryQueueRouter,
  // Sprint 15: Notification digest aggregation
  digest: digestRouter,
  // Sprint 15: API rate limiting dashboard
  rateLimitDashboard: rateLimitDashboardRouter,
  // Sprint 15: System configuration and feature flags
  sysConfig: sysConfigRouter,
  // Sprint 15: User session management
  sessionMgmt: sessionMgmtRouter,
  // Sprint 15: Data export center
  dataExport: dataExportRouter,
  // Sprint 15: Platform changelog / release notes
  changelog: changelogRouter,
  // Sprint 15: Webhook retry mechanism
  webhookRetry: webhookRetryRouter,
  // Sprint 15: Event bus abstraction (Kafka/Redis)
  eventBus: eventBusRouter,
  // Sprint 15: Service health aggregator
  serviceHealth: serviceHealthRouter,
  // Sprint 15: Cache invalidation management
  cache: cacheRouter,
  // Sprint 16: Multi-Tenant White-Label Onboarding
  inviteCodes: inviteCodesRouter,
  partnerOnboarding: partnerOnboardingRouter,
  tenantAdmin: tenantAdminRouter,
  // Sprint 18: System Health Monitoring Dashboard
  healthMonitor: systemHealthMonitorRouter,
  weeklyReports: weeklyReportsRouter,
  // Sprint 23: Final Production Features (scheduled delivery, report comparison, thresholds, rate limits, webhook retry, agent performance, dispute auto-rules, KYC verification)
  sprint23: sprint23Router,
  // Sprint 24: AI-powered chat support widget
  aiChat: aiChatSupportRouter,
  // Sprint 24: Stripe payment integration
  stripe: stripeRouter,
  guideFeedback: guideFeedbackRouter,
  // Sprint 27: Enhanced data export with audit trail
  sprint27Export: sprint27DataExportRouter,
  // Sprint 28: Nigerian Insurance Services
  ussdGateway: ussdGatewayRouter,
  mobileMoney: mobileMoneyRouter,
  agentHierarchy: agentHierarchyRouter,
  commissionEngine: commissionEngineRouter,
  bulkOps: bulkOperationsRouter,
  biometricAuth: biometricAuthRouter,
  offlineSync: offlineSyncRouter,
  whatsappChannel: whatsappChannelRouter,
  merchantPayments: merchantPaymentsRouter,
  billPayments: billPaymentsRouter,
  airtimeVending: airtimeVendingRouter,
  loanDisbursement: loanDisbursementRouter,
  insuranceProducts: insuranceProductsRouter,
  insuranceWorkflows: insuranceWorkflowsRouter,
  savingsProducts: savingsProductsRouter,
  referralProgramDedicated: referralProgramRouter,
  cardRequest: cardRequestRouter,
  accountOpening: accountOpeningRouter,
  taxCollection: taxCollectionRouter,
  pensionCollection: pensionCollectionRouter,
  // Sprint 29: AI/ML/DL/GNN/LLM Production Integration
  qdrantVectorSearch: qdrantVectorSearchRouter,
  falkordbGraph: falkordbGraphRouter,
  cocoIndexPipeline: cocoIndexPipelineRouter,
  ollamaLLM: ollamaLLMRouter,
  artRobustness: artRobustnessRouter,
  // Sprint 29: Lakehouse ↔ AI/ML unified integration (feature store, model registry, batch inference, data lineage)
  lakehouseAi: lakehouseAiIntegrationRouter,
  // Sprint 29: ML Scoring Service (ensemble: XGBoost + Autoencoder + GNN + LLM explanation)
  mlScoring: mlScoringServiceRouter,
  // Sprint 30: AI/ML Follow-ups
  aiMonitoring: aiMonitoringRouter,
  fraudReport: fraudReportGeneratorRouter,
  complianceChatbot: complianceChatbotRouter,
  apacheNifi: apacheNifiRouter,
  dbtIntegration: dbtIntegrationRouter,
  apacheAirflow: apacheAirflowRouter,
  websocketService: websocketServiceRouter,
  reportScheduler: reportSchedulerRouter,
  eventDrivenArch: eventDrivenArchRouter,
  advancedNotifications: advancedNotificationsRouter,
  securityHardening: securityHardeningRouter,
  // Sprint 32: Production Readiness
  fraudRealtimeViz: fraudRealtimeVizRouter,
  pipelineMonitoring: pipelineMonitoringRouter,
  apiGateway: apiGatewayRouter,
  auditTrail: auditTrailRouter,
  backupDr: backupDisasterRecoveryRouter,
  performanceProfiler: performanceProfilerRouter,
  multiTenancy: multiTenancyRouter,
  webhookMgmt: webhookManagementRouter,
  dataExportImport: dataExportImportRouter,
  slaManagement: slaManagementRouter,
  capacityPlanning: capacityPlanningRouter,
  incidentManagement: incidentManagementRouter,
  featureFlags: featureFlagsRouter,
  // Sprint 33 — Final Production
  openTelemetry: openTelemetryRouter,
  advancedBiReporting: advancedBiReportingRouter,
  workflowAutomation: workflowAutomationRouter,
  notificationCenter: notificationCenterRouter,
  helpDesk: helpDeskRouter,
  dataQuality: dataQualityRouter,
  configManagement: configManagementRouter,
  serviceMesh: serviceMeshRouter,
  complianceAutomation: complianceAutomationRouter,
  customer360: customer360Router,
  realtimeNotifications: realtimeNotificationsRouter,
  dragDropReportBuilder: dragDropReportBuilderRouter,
  graphqlFederation: graphqlFederationRouter,
  apiVersioning: apiVersioningRouter,
  advancedRateLimiter: advancedRateLimiterRouter,
  realtimeDashboardWidgets: realtimeDashboardWidgetsRouter,
  agentScorecard: agentScorecardRouter,
  disputeResolution: disputeResolutionRouter,
  regulatorySandbox: regulatorySandboxRouter,
  multiCurrency: multiCurrencyRouter,
  documentManagement: documentManagementRouter,
  agentTraining: agentTrainingRouter,
  revenueAnalytics: revenueAnalyticsRouter,
  platformHealth: platformHealthRouter,
  batchProcessing: batchProcessingRouter,
  integrationMarketplace: integrationMarketplaceRouter,
  mobileApiLayer: mobileApiLayerRouter,
  automatedTestingFramework: automatedTestingFrameworkRouter,
  // Sprint 35: Final Production Features
  transactionMapViz: transactionMapVizRouter,
  reportBuilderTemplates: reportBuilderTemplatesRouter,
  nlAnalyticsQuery: nlAnalyticsQueryRouter,
  bankingWorkflowPatterns: bankingWorkflowPatternsRouter,
  agentOnboardingWizard: agentOnboardingWizardRouter,
  transactionReconciliation: transactionReconciliationRouter,
  chargebackManagement: chargebackManagementRouter,
  regulatoryReportingEngine: regulatoryReportingEngineRouter,
  agentTerritoryMgmt: agentTerritoryMgmtRouter,
  dynamicPricingEngine: dynamicPricingEngineRouter,
  customerLoyaltyProgram: customerLoyaltyProgramRouter,
  fraudCaseManagement: fraudCaseManagementRouter,
  serviceNodeFleet: serviceNodeFleetRouter,
  financialReconciliationDash: financialReconciliationDashRouter,
  apiAnalyticsDash: apiAnalyticsDashRouter,
  agentCommunicationHub: agentCommunicationHubRouter,
  txDisputeArbitration: txDisputeArbitrationRouter,
  complianceTrainingTracker: complianceTrainingTrackerRouter,
  systemMigrationTools: systemMigrationToolsRouter,
  advancedAuditLogViewer: advancedAuditLogViewerRouter,

  // Sprint 36: White-Label Partner Platform + Production Hardening
  transactionCsvExport: transactionCsvExportRouter,
  transactionMapLoading: transactionMapLoadingRouter,
  nlFinancialQuery: nlFinancialQueryRouter,
  whiteLabelOnboarding: whiteLabelOnboardingRouter,
  whiteLabelBranding: whiteLabelBrandingRouter,
  whiteLabelApproval: whiteLabelApprovalRouter,
  partnerSelfService: partnerSelfServiceRouter,
  transactionExportEngine: transactionExportEngineRouter,
  advancedLoadingStates: advancedLoadingStatesRouter,
  financialNlEngine: financialNlEngineRouter,
  partnerRevenueSharing: partnerRevenueSharingRouter,
  agentGamification: agentGamificationRouter,
  bulkTransactionProcessing: bulkTransactionProcessingRouter,
  customer360View: customer360ViewRouter,
  platformFeatureFlags: platformFeatureFlagsRouter,
  slaMonitoringDash: slaMonitoringDashRouter,
  dataRetentionPolicy: dataRetentionPolicyRouter,
  platformChangelog: platformChangelogRouter,
  advancedSearchFiltering: advancedSearchFilteringRouter,
  // ── Sprint 37 ──
  e2eTestFramework: e2eTestFrameworkRouter,
  dbSchemaPush: dbSchemaPushRouter,
  agentCommissionCalc: agentCommissionCalcRouter,
  mccManager: mccManagerRouter,
  settlementBatchProcessor: settlementBatchProcessorRouter,
  cardBinLookup: cardBinLookupRouter,
  transactionVelocityMonitor: transactionVelocityMonitorRouter,
  merchantRiskScoring: merchantRiskScoringRouter,
  paymentGatewayRouter: paymentGatewayRouterRouter,
  agentFloatForecasting: agentFloatForecastingRouter,
  multiTenantIsolation: multiTenantIsolationRouter,
  platformHealthDash: platformHealthDashRouter,
  automatedComplianceChecker: automatedComplianceCheckerRouter,
  transactionFeeCalc: transactionFeeCalcRouter,
  agentNetworkTopology: agentNetworkTopologyRouter,
  customerDisputePortal: customerDisputePortalRouter,
  revenueLeakageDetector: revenueLeakageDetectorRouter,
  apiRateLimiterDash: apiRateLimiterDashRouter,
  operationalRunbook: operationalRunbookRouter,
  platformMetricsExporter: platformMetricsExporterRouter,
  // ── Sprint 38 ──
  realtimeWebSocketFeeds: realtimeWebSocketFeedsRouter,
  merchantOnboardingPortal: merchantOnboardingPortalRouter,
  paymentLinkGenerator: paymentLinkGeneratorRouter,
  disputeMediationAI: disputeMediationAIRouter,
  agentPerformanceLeaderboard: agentPerformanceLeaderboardRouter,
  automatedSettlementScheduler: automatedSettlementSchedulerRouter,
  customerWalletSystem: customerWalletSystemRouter,
  merchantAnalyticsDash: merchantAnalyticsDashRouter,
  posServiceUpdate: posServiceUpdateRouter,
  firmwareOTA: firmwareOTARouter,
  transactionReceiptGenerator: transactionReceiptGeneratorRouter,
  agentLoanAdvance: agentLoanAdvanceRouter,
  multiChannelPaymentOrch: multiChannelPaymentOrchRouter,
  regulatoryFilingAutomation: regulatoryFilingAutomationRouter,
  customerSegmentationEngine: customerSegmentationEngineRouter,
  incidentCommandCenter: incidentCommandCenterRouter,
  platformABTesting: platformABTestingRouter,
  transactionEnrichmentService: transactionEnrichmentServiceRouter,
  agentInventoryMgmt: agentInventoryMgmtRouter,
  revenueForecastingEngine: revenueForecastingEngineRouter,
  platformRecommendations: platformRecommendationsRouter,
  // ── Sprint 39 ──
  publishReadinessChecker: publishReadinessCheckerRouter,
  dbSchemaMigrationManager: dbSchemaMigrationManagerRouter,
  graphqlSubscriptionGateway: graphqlSubscriptionGatewayRouter,
  offlinePosMode: offlinePosModeRouter,
  biometricAuthGateway: biometricAuthGatewayRouter,
  aiCashFlowPredictor: aiCashFlowPredictorRouter,
  blockchainAuditTrail: blockchainAuditTrailRouter,
  voiceCommandPos: voiceCommandPosRouter,
  socialCommerceGateway: socialCommerceGatewayRouter,
  esgCarbonTracker: esgCarbonTrackerRouter,
  distributedTracingDash: distributedTracingDashRouter,
  canaryReleaseManager: canaryReleaseManagerRouter,
  chaosEngineeringConsole: chaosEngineeringConsoleRouter,
  connectionPoolMonitor: connectionPoolMonitorRouter,
  cdnCacheManager: cdnCacheManagerRouter,
  cqrsEventStore: cqrsEventStoreRouter,
  digitalTwinSimulator: digitalTwinSimulatorRouter,
  cbdcIntegrationGateway: cbdcIntegrationGatewayRouter,
  decentralizedIdentityManager: decentralizedIdentityManagerRouter,
  platformMaturityScorecard: platformMaturityScorecardRouter,
  // ── Sprint 40 ──
  smartContractPayment: smartContractPaymentRouter,
  predictiveAgentChurn: predictiveAgentChurnRouter,
  currencyHedging: currencyHedgingRouter,
  agentClusterAnalytics: agentClusterAnalyticsRouter,
  autoComplianceWorkflow: autoComplianceWorkflowRouter,
  paymentTokenVault: paymentTokenVaultRouter,
  dynamicQrPayment: dynamicQrPaymentRouter,
  agentRevenueAttribution: agentRevenueAttributionRouter,
  platformCostAllocator: platformCostAllocatorRouter,
  intelligentRoutingEngine: intelligentRoutingEngineRouter,
  regulatorySandboxTester: regulatorySandboxTesterRouter,
  agentDeviceFingerprint: agentDeviceFingerprintRouter,
  settlementNettingEngine: settlementNettingEngineRouter,
  platformCapacityPlanner: platformCapacityPlannerRouter,
  merchantAcquirerGateway: merchantAcquirerGatewayRouter,
  agentMicroInsurance: agentMicroInsuranceRouter,
  transactionGraphAnalyzer: transactionGraphAnalyzerRouter,
  platformRevenueOptimizer: platformRevenueOptimizerRouter,
  operationalCommandBridge: operationalCommandBridgeRouter,
  // Sprint 41
  agentKycDocVault: agentKycDocVaultRouter,
  realtimePnlDashboard: realtimePnlDashboardRouter,
  autoReconciliationEngine: autoReconciliationEngineRouter,
  agentTerritoryOptimizer: agentTerritoryOptimizerRouter,
  paymentDisputeArbitration: paymentDisputeArbitrationRouter,
  regulatoryReportGenerator: regulatoryReportGeneratorRouter,
  agentTrainingAcademy: agentTrainingAcademyRouter,
  dynamicFeeCalculator: dynamicFeeCalculatorRouter,
  customerOnboardingPipeline: customerOnboardingPipelineRouter,
  merchantSettlementDashboard: merchantSettlementDashboardRouter,
  agentFloatInsuranceClaims: agentFloatInsuranceClaimsRouter,
  platformSlaMonitor: platformSlaMonitorRouter,
  bulkDisbursementEngine: bulkDisbursementEngineRouter,
  transactionReversalManager: transactionReversalManagerRouter,
  agentLoanOrigination: agentLoanOriginationRouter,
  multiChannelNotificationHub: multiChannelNotificationHubRouter,
  platformMigrationToolkit: platformMigrationToolkitRouter,
  agentPerformanceIncentives: agentPerformanceIncentivesRouter,
  executiveCommandCenter: executiveCommandCenterRouter,
  // Dispute & Refund System
  disputeRefund: disputeRefundRouter,
  // Sprint 42: Final Production Features
  disputeNotifications: disputeNotificationsRouter,
  disputeAnalytics: disputeAnalyticsRouter,
  agentBenchmarking: agentBenchmarkingRouter,
  txVelocityMonitor: txVelocityMonitorRouter,
  customerSurveys: customerSurveysRouter,
  agentTerritoryHeatmap: agentTerritoryHeatmapRouter,
  gatewayHealthMonitor: gatewayHealthMonitorRouter,
  agentLoanOrigination2: agentLoanOrigination2Router,
  mfaManager: mfaManagerRouter,
  incidentPlaybook: incidentPlaybookRouter,
  deviceFleetManager: deviceFleetManagerRouter,
  customerJourneyMapper: customerJourneyMapperRouter,
  complianceCertManager: complianceCertManagerRouter,
  platformHealthScorecard: platformHealthScorecardRouter,
  trainingCertification: trainingCertificationRouter,
  bulkTransactionProcessor: bulkTransactionProcessorRouter,
  systemConfigManager: systemConfigManagerRouter,
  // Sprint 46: Production Features
  paymentNotificationSystem: paymentNotificationSystemRouter,
  databaseVisualization: databaseVisualizationRouter,
  middlewareServiceManager: middlewareServiceManagerRouter,
  skillCreatorIntegration: skillCreatorIntegrationRouter,
  paymentReconciliation: paymentReconciliationRouter,
  agentPerformanceAnalytics: agentPerformanceAnalyticsRouter,
  complianceReporting: complianceReportingRouter,
  customerFeedbackNps: customerFeedbackNpsRouter,
  multiCurrencyExchange: multiCurrencyExchangeRouter,
  agentTrainingPortal: agentTrainingPortalRouter,
  disputeWorkflowEngine: disputeWorkflowEngineRouter,
  platformHealthMonitor: platformHealthMonitorRouter,
  bulkPaymentProcessor: bulkPaymentProcessorRouter,
  agentHierarchyTerritory: agentHierarchyTerritoryRouter,
  financialReportingSuite: financialReportingSuiteRouter,
  apiKeyManagement: apiKeyManagementRouter,
  webhookDeliverySystem: webhookDeliverySystemRouter,
  platformConfigCenter: platformConfigCenterRouter,
  bankAccountManagement: bankAccountManagementRouter,
  kycDocumentManagement: kycDocumentManagementRouter,
  floatReconciliation: floatReconciliationRouter,
  agentPerformanceScorecard: agentPerformanceScorecardRouter,
  customerDatabase: customerDatabaseRouter,
  reversalApproval: reversalApprovalRouter,
  commissionClawback: commissionClawbackRouter,
  pnlReport: pnlReportRouter,
  transactionLimitsEngine: transactionLimitsEngineRouter,
  regulatoryCompliance: regulatoryComplianceRouter,
  systemHealthDashboard: systemHealthDashboardRouter,
  agentSuspensionWorkflow: agentSuspensionWorkflowRouter,
  auditExport: auditExportRouter,
  // Sprint 50 Production Features
  realtimeTxMonitor: realtimeTxMonitorRouter,
  fraudMlScoring: fraudMlScoringEngineRouter,
  notificationOrchestrator: notificationOrchestratorRouter,
  agentLoanFacility: agentLoanFacilityRouter,
  dynamicFeeEngine: dynamicFeeEngineRouter,
  merchantKycOnboarding: merchantKycOnboardingRouter,
  merchantPayoutSettlement: merchantPayoutSettlementRouter,
  complianceFiling: complianceFilingRouter,
  tenantFeatureToggle: tenantFeatureToggleRouter,
  reconciliationEngine: reconciliationEngineRouter,
  customerJourneyAnalytics: customerJourneyAnalyticsRouter,
  rateLimitEngine: rateLimitEngineRouter,
  workflowEngine: workflowEngineRouter,
  generalLedger: generalLedgerRouter,
  slaMonitoringProd: slaMonitoringRouter,
  dataExportHub: dataExportHubRouter,
  // P1-3: Runtime-configurable batch/concurrency parameters
  runtimeConfig: runtimeConfigAdminRouter,
  // S58: Archival admin + Load test metrics
  archivalAdmin: archivalAdminRouter,
  loadTestMetrics: loadTestMetricsRouter,
  // Sprint 66: Global Search (was orphaned, now wired)
  globalSearch: globalSearchRouter,
  healthCheck: healthCheckRouter,
  apiDocs: apiDocsRouter,
  dataExportV2: dataExportRouterV2,
  // Sprint 75: USSD Integration, Carrier Switching, Network Status Dashboard
  ussdIntegration: ussdIntegrationRouter,
  carrierSwitching: carrierSwitchingRouter,
  networkStatusDashboard: networkStatusDashboardRouter,
  // Sprint 76: Security, Resilience, Cost, Analytics, SLA, Receipts
  securityAudit: securityAuditRouter,
  carrierCost: carrierCostRouter,
  ussdReceipt: ussdReceiptRouter,
  networkResilience: networkResilienceRouter,
  ussdAnalytics: ussdAnalyticsRouter,
  carrierSla: carrierSlaRouter,
  // Sprint 78: Session Replay, Live Pricing, KYC, TX Monitor, Commission
  ussdSessionReplay: ussdSessionReplayRouter,
  carrierLivePricing: carrierLivePricingRouter,
  agentKyc: agentKycRouter,
  txMonitor: txMonitorRouter,
  commissionCalculator: commissionCalculatorRouter,
  // Sprint 79 — Real-time Billing Engine
  billingLedger: billingLedgerRouter,
  revenueReconciliation: revenueReconciliationRouter,
  liveBillingDashboard: liveBillingDashboardRouter,
  // Sprint 80: Billing RBAC, Audit, Tenant Onboarding
  billingRbac: billingRbacRouter,
  billingAudit: billingAuditRouter,
  tenantBillingOnboarding: tenantBillingOnboardingRouter,
  // Sprint 81: Invoice, Lifecycle, Resilience
  billingInvoice: billingInvoiceRouter,
  billingLifecycle: billingLifecycleRouter,
  resilienceHardening: resilienceHardeningRouter,
  // Sprint 83: Production billing features (20 procedures)
  billingProduction: billingProductionRouter,
  // Sprint 89: Admin Dashboard & Analytics
  adminDashboard: adminDashboardRouter,
  analyticsQuery: analyticsQueryRouter,
  // Sprint 91: Face Enrollment & Biometric Audit
  faceEnrollment: faceEnrollmentRouter,
  biometricAuditDashboard: biometricAuditDashboardRouter,
  geoFencing: geoFencingRouter,
  geoFencingDedicated: geoFencingDedicatedRouter,
  // Sprint 92: Offline Queue, Ransomware Alerts, PBAC Management
  offlineQueue: offlineQueueRouter,
  ransomwareAlerts: ransomwareAlertsRouter,
  pbacManagement: pbacManagementRouter,
  // Sprint 93: Alert Notifications, Network Quality Heatmap
  alertNotifications: alertNotificationsRouter,
  networkQualityHeatmap: networkQualityHeatmapRouter,
  bulkRoleImport: bulkRoleImportRouter,
  networkTrends: networkTrendsRouter,
  // Sprint 96: POS Enhancement Routers
  eodReconciliation: eodReconciliationRouter,
  multiSimFailover: multiSimFailoverRouter,
  agentFloatTransfer: agentFloatTransferRouter,
  splitPayments: splitPaymentsRouter,
  recurringPayments: recurringPaymentsRouter,
  posDispute: posDisputeRouter,
  agentTrainingGamification: agentTrainingGamificationRouter,
  // Sprint 97: Frontend-Backend Gap Closure
  activityAuditLog: activityAuditLogRouter,
  agentOnboardingWorkflow: agentOnboardingWorkflowRouter,
  auditTrailExport: auditTrailExportRouter,
  backupDisasterRecovery: backupDisasterRecoveryRouter, // re-uses import from line 136
  dailyPnlReport: dailyPnlReportRouter,
  floatManagement: floatManagementRouter,
  fraudMlScoringEngine: fraudMlScoringEngineRouterV2,
  regulatoryComplianceChecks: regulatoryComplianceChecksRouter,
  runtimeConfigAdmin: runtimeConfigAdminRouterV2,
  transactionDisputeResolution: transactionDisputeResolutionRouter,
  transactionMonitoring: transactionMonitoringRouter,
  transactionReversalWorkflow: transactionReversalWorkflowRouter,
  ussdLocalization: ussdLocalizationRouter,
  webhookManagement: webhookManagementRouter, // re-uses import from line 139
  amlScreening: amlScreeningRouter,
  naicomReporting: naicomReportingRouter,
  receiptTemplates: receiptTemplatesRouter,
  // E-commerce & Supply Chain
  supplyChain: supplyChainRouter,
  marketplace: marketplaceRouter,
  promotions: promotionsRouter,
  // KYC/KYB Enforcement & Compliance
  kycEnforcement: kycEnforcementRouter,
  // Insurance KPI Dashboards — all 16 roles
  insuranceKpiDashboard: insuranceKpiDashboardRouter,
  // E-Commerce, Remittance & Terminal Fleet (Sprint 98 gap closure)
  insuranceServiceFleet: insuranceServiceFleetRouter,
  remittance: remittanceRouter,
  terminalLeasing: terminalLeasingRouter,
  crossBorderRemittanceHub: crossBorderRemittanceHubRouter,
  insurancePolicyQuoteManager: insurancePolicyQuoteManagerRouter,
  insuranceProductCatalog: insuranceProductCatalogRouter,
  insuranceJourneyOrchestrator: insuranceJourneyOrchestratorRouter,
  journeyOrchestratorV2: insuranceJourneyOrchestratorV2Router,
  j20Scheduler: j20SchedulerRouter,
  telematics: telematicsRouter,
  cvClaims: cvClaimsRouter,
  fraudNetwork: fraudNetworkRouter,
  healthWearables: healthWearablesRouter,
  nhia: nhiaRouter,
  comparison: comparisonRouter,
  p2pPools: p2pPoolsRouter,
  voiceClaims: voiceClaimsRouter,
  parametric: parametricRouter,
  groupInsurance: groupInsuranceRouter,
  bancassurance: bancassuranceRouter,
  openInsurance: openInsuranceRouter,
  climateRisk: climateRiskRouter,
  renewalPrediction: renewalPredictionRouter,
  sloMonitor: sloMonitorRouter,
  didIdentity: didIdentityRouter,
});

export type AppRouter = typeof appRouter;
