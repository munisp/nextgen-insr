// SOC 2 CC6.1 COMPLIANCE NOTE:
// All tRPC procedures in this router use protectedProcedure (Keycloak JWT auth)
// or adminProcedure (admin-only). Financial mutations additionally use
// financialProcedure (Permify RBAC) from server/_core/permifyMiddleware.ts.
// Unauthenticated access to any procedure results in HTTP 401 UNAUTHORIZED.
import { KC_SESSION_COOKIE } from "./_core/keycloakAuth";
import { insuranceJourneyOrchestratorRouter } from "./routers/insuranceJourneyOrchestrator";
import { insuranceJourneyOrchestratorV2Router } from "./routers/insuranceJourneyOrchestratorV2";
import { j20SchedulerRouter } from "./routers/j20SchedulerRouter";
import {
  telematicsRouter, cvClaimsRouter, fraudNetworkRouter, healthWearablesRouter,
  nhiaRouter, comparisonRouter, p2pPoolsRouter, voiceClaimsRouter,
  parametricRouter, groupInsuranceRouter, bancassuranceRouter, openInsuranceRouter,
  climateRiskRouter, renewalPredictionRouter, sloMonitorRouter, didIdentityRouter,
} from "./routers/innovationRouters";
import { insurancePolicyQuoteManagerRouter } from "./routers/insurancePolicyQuoteManager";
import { insuranceProductCatalogRouter } from "./routers/insuranceProductCatalog";
// Sprint 98: Missing router imports
// Insurance policy purchase orders
import { insuranceServiceFleetRouter } from "./routers/posTerminalFleet";
import { remittanceRouter } from "./routers/remittance";
import { terminalLeasingRouter } from "./routers/terminalLeasing";
import { crossBorderRemittanceHubRouter } from "./routers/crossBorderRemittanceHub";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { agentRouter } from "./routers/agent";
import { goServiceBridgeRouter } from "./routers/goServiceBridge";
import { transactionsRouter } from "./routers/transactions";
import { fraudRouter } from "./routers/fraud";
import { loyaltyRouter } from "./routers/loyalty";
import { chatRouter } from "./routers/chat";
import { auditLogRouter } from "./routers/auditLog";
import { agentManagementRouter } from "./routers/agentManagement";
import { premiumTopUpRouter } from "./routers/premiumTopUp";
import { smsReceiptRouter } from "./routers/smsReceipt";
import { exportRouter } from "./routers/export";
import { pinResetRouter } from "./routers/pinReset";
import { settlementRouter } from "./routers/settlement";
import { resilienceRouter } from "./routers/resilience";
import { mdmRouter } from "./routers/mdm";
import { supervisorRouter } from "./routers/supervisor";
import { disputesRouter } from "./routers/disputes";
import { kycRouter } from "./routers/kyc";
import { managementRouter } from "./routers/management";
import { agentBankingRouter } from "./routers/agentBanking";
import { customerRouter } from "./routers/customer";
import { superAdminRouter } from "./routers/superAdmin";
import { platformProxyRouter } from "./routers/platformProxy";
import { erpRouter } from "./routers/erp";
import { mqttBridgeRouter } from "./routers/mqttBridge";
import { analyticsRouter } from "./routers/analytics";
import { gdprRouter } from "./routers/gdpr";
import { merchantRouter } from "./routers/merchant";
import { developerPortalRouter } from "./routers/developerPortal";
import { systemConfigRouter } from "./routers/systemConfig";
import { simOrchestratorRouter } from "./routers/simOrchestrator";
import { pushNotificationsRouter } from "./routers/pushNotifications";
import { cbnReportingRouter } from "./routers/cbnReporting";
import { businessRulesRouter } from "./routers/businessRules";
import { lakehouseRouter } from "./routers/lakehouse";
import { webhooksRouter } from "./routers/webhooks";
import { commissionPayoutsRouter } from "./routers/commissionPayouts";
import { referralsRouter } from "./routers/referrals";
import { agentOnboardingRouter } from "./routers/agentOnboarding";
import { settlementReconciliationRouter } from "./routers/settlementReconciliation";
import { tigerBeetleRouter } from "./routers/tigerBeetle";
import { kafkaConsumerRouter } from "./routers/kafkaConsumer";
import { temporalWorkflowsRouter } from "./routers/temporalWorkflows";
import { vaultSecretsRouter } from "./routers/vaultSecrets";
import { fxRatesRouter } from "./routers/fxRates";
import { emailNotificationsRouter } from "./routers/emailNotifications";
import { rateAlertsRouter } from "./routers/rateAlerts";
import { smsNotificationsRouter } from "./routers/smsNotifications";
import { notificationInboxRouter } from "./routers/notificationInbox";
import { webhookNotificationsRouter } from "./routers/webhookNotifications";
import { productionFeaturesRouter } from "./routers/productionFeatures";
import { analyticsDashboardRouter } from "./routers/analyticsDashboard";
import { scheduledReportsRouter } from "./routers/scheduledReports";
import { dashboardLayoutRouter } from "./routers/dashboardLayout";
import { broadcastAnnouncementsRouter } from "./routers/broadcastAnnouncements";
import { userNotifPreferencesRouter } from "./routers/userNotifPreferences";
import { sharedLayoutsRouter } from "./routers/sharedLayouts";
import { reportTemplateDesignerRouter } from "./routers/reportTemplateDesigner";
import { dataThresholdAlertsRouter } from "./routers/dataThresholdAlerts";
import { announcementReactionsRouter } from "./routers/announcementReactions";
import { escalationChainsRouter } from "./routers/escalationChains";
import { inviteCodesRouter } from "./routers/inviteCodes";
import { partnerOnboardingRouter } from "./routers/partnerOnboarding";
import { tenantAdminRouter } from "./routers/tenantAdmin";
import { systemHealthMonitorRouter } from "./routers/systemHealthMonitor";
import { weeklyReportsRouter } from "./routers/weeklyReports";
import { sprint23Router } from "./routers/sprint23Router";
import { aiChatSupportRouter } from "./routers/aiChatSupport";
import { stripeRouter } from "./stripe/stripeRouter";
import { guideFeedbackRouter } from "./routers/guideFeedback";
import { dataExportRouter as sprint27DataExportRouter } from "./routers/dataExportRouter";
import { ussdGatewayRouter } from "./routers/ussdGateway";
import { mobileMoneyRouter } from "./routers/mobileMoney";
import { agentHierarchyRouter } from "./routers/agentHierarchy";
import { commissionEngineRouter } from "./routers/commissionEngine";
import { bulkOperationsRouter } from "./routers/bulkOperations";
import { realtimeTxMonitorRouter } from "./routers/realtimeTxMonitor";
import { fraudMlScoringEngineRouter } from "./routers/fraudMlScoringEngine";
import { notificationOrchestratorRouter } from "./routers/notificationOrchestrator";
import { agentLoanFacilityRouter } from "./routers/agentLoanFacility";
import { dynamicFeeEngineRouter } from "./routers/dynamicFeeEngine";
import { merchantKycOnboardingRouter } from "./routers/merchantKycOnboarding";
import { merchantPayoutSettlementRouter } from "./routers/merchantPayoutSettlement";
import { complianceFilingRouter } from "./routers/complianceFiling";
import { tenantFeatureToggleRouter } from "./routers/tenantFeatureToggle";
import { reconciliationEngineRouter } from "./routers/reconciliationEngine";
import { customerJourneyAnalyticsRouter } from "./routers/customerJourneyAnalytics";
import { rateLimitEngineRouter } from "./routers/rateLimitEngine";
import { workflowEngineRouter } from "./routers/workflowEngine";
import { generalLedgerRouter } from "./routers/generalLedger";
import { slaMonitoringRouter } from "./routers/slaMonitoring";
import { dataExportHubRouter } from "./routers/dataExportHub";
import { biometricAuthRouter } from "./routers/biometricAuth";
import { offlineSyncRouter } from "./routers/offlineSync";
import { whatsappChannelRouter } from "./routers/whatsappChannel";
import { merchantPaymentsRouter } from "./routers/merchantPayments";
import { billPaymentsRouter } from "./routers/billPayments";
import { airtimeVendingRouter } from "./routers/airtimeVending";
import { loanDisbursementRouter } from "./routers/loanDisbursement";
import { insuranceProductsRouter } from "./routers/insuranceProducts";
import { savingsProductsRouter } from "./routers/savingsProducts";
import { referralProgramRouter } from "./routers/referralProgram";
import { cardRequestRouter } from "./routers/cardRequest";
import { accountOpeningRouter } from "./routers/accountOpening";
import { taxCollectionRouter } from "./routers/taxCollection";
import { pensionCollectionRouter } from "./routers/pensionCollection";
import { qdrantVectorSearchRouter } from "./routers/qdrantVectorSearch";
import { falkordbGraphRouter } from "./routers/falkordbGraph";
import { cocoIndexPipelineRouter } from "./routers/cocoIndexPipeline";
import { ollamaLLMRouter } from "./routers/ollamaLLM";
import { artRobustnessRouter } from "./routers/artRobustness";
import { lakehouseAiIntegrationRouter } from "./routers/lakehouseAiIntegration";
import { mlScoringServiceRouter } from "./routers/mlScoringService";
import { aiMonitoringRouter } from "./routers/aiMonitoring";
import { fraudReportGeneratorRouter } from "./routers/fraudReportGenerator";
import { complianceChatbotRouter } from "./routers/complianceChatbot";
import { apacheNifiRouter } from "./routers/apacheNifi";
import { dbtIntegrationRouter } from "./routers/dbtIntegration";
import { apacheAirflowRouter } from "./routers/apacheAirflow";
import { websocketServiceRouter } from "./routers/websocketService";
import { reportSchedulerRouter } from "./routers/reportScheduler";
import { eventDrivenArchRouter } from "./routers/eventDrivenArch";
import { advancedNotificationsRouter } from "./routers/advancedNotifications";
import { securityHardeningRouter } from "./routers/securityHardening";
import { fraudRealtimeVizRouter } from "./routers/fraudRealtimeViz";
import { pipelineMonitoringRouter } from "./routers/pipelineMonitoring";
import { apiGatewayRouter } from "./routers/apiGateway";
import { auditTrailRouter } from "./routers/auditTrail";
import { backupDisasterRecoveryRouter } from "./routers/backupDisasterRecovery";
import { performanceProfilerRouter } from "./routers/performanceProfiler";
import { multiTenancyRouter } from "./routers/multiTenancy";
import { webhookManagementRouter } from "./routers/webhookManagement";
import { dataExportImportRouter } from "./routers/dataExportImport";
import { slaManagementRouter } from "./routers/slaManagement";
import { capacityPlanningRouter } from "./routers/capacityPlanning";
import { incidentManagementRouter } from "./routers/incidentManagement";
import { featureFlagsRouter } from "./routers/featureFlags";
import { openTelemetryRouter } from "./routers/openTelemetry";
import { advancedBiReportingRouter } from "./routers/advancedBiReporting";
import { workflowAutomationRouter } from "./routers/workflowAutomation";
import { notificationCenterRouter } from "./routers/notificationCenter";
import { helpDeskRouter } from "./routers/helpDesk";
import { dataQualityRouter } from "./routers/dataQuality";
import { configManagementRouter } from "./routers/configManagement";
import { serviceMeshRouter } from "./routers/serviceMesh";
import { complianceAutomationRouter } from "./routers/complianceAutomation";
import { customer360Router } from "./routers/customer360";
import { realtimeNotificationsRouter } from "./routers/realtimeNotifications";
import { dragDropReportBuilderRouter } from "./routers/dragDropReportBuilder";
import { graphqlFederationRouter } from "./routers/graphqlFederation";
import { apiVersioningRouter } from "./routers/apiVersioning";
import { advancedRateLimiterRouter } from "./routers/advancedRateLimiter";
import { realtimeDashboardWidgetsRouter } from "./routers/realtimeDashboardWidgets";
import { agentScorecardRouter } from "./routers/agentScorecard";
import { disputeResolutionRouter } from "./routers/disputeResolution";
import { regulatorySandboxRouter } from "./routers/regulatorySandbox";
import { multiCurrencyRouter } from "./routers/multiCurrency";
import { documentManagementRouter } from "./routers/documentManagement";
import { agentTrainingRouter } from "./routers/agentTraining";
import { revenueAnalyticsRouter } from "./routers/revenueAnalytics";
import { platformHealthRouter } from "./routers/platformHealth";
import { batchProcessingRouter } from "./routers/batchProcessing";
import { integrationMarketplaceRouter } from "./routers/integrationMarketplace";
import { mobileApiLayerRouter } from "./routers/mobileApiLayer";
import { automatedTestingFrameworkRouter } from "./routers/automatedTestingFramework";
// Sprint 35: Final Production Features
import { transactionMapVizRouter } from "./routers/transactionMapViz";
import { reportBuilderTemplatesRouter } from "./routers/reportBuilderTemplates";
import { nlAnalyticsQueryRouter } from "./routers/nlAnalyticsQuery";
import { bankingWorkflowPatternsRouter } from "./routers/bankingWorkflowPatterns";
import { agentOnboardingWizardRouter } from "./routers/agentOnboardingWizard";
import { transactionReconciliationRouter } from "./routers/transactionReconciliation";
import { chargebackManagementRouter } from "./routers/chargebackManagement";
import { regulatoryReportingEngineRouter } from "./routers/regulatoryReportingEngine";
import { agentTerritoryMgmtRouter } from "./routers/agentTerritoryMgmt";
import { dynamicPricingEngineRouter } from "./routers/dynamicPricingEngine";
import { customerLoyaltyProgramRouter } from "./routers/customerLoyaltyProgram";
import { fraudCaseManagementRouter } from "./routers/fraudCaseManagement";
import { serviceNodeFleetRouter } from "./routers/serviceNodeFleet";
import { financialReconciliationDashRouter } from "./routers/financialReconciliationDash";
import { apiAnalyticsDashRouter } from "./routers/apiAnalyticsDash";
import { agentCommunicationHubRouter } from "./routers/agentCommunicationHub";
import { txDisputeArbitrationRouter } from "./routers/txDisputeArbitration";
import { complianceTrainingTrackerRouter } from "./routers/complianceTrainingTracker";
import { systemMigrationToolsRouter } from "./routers/systemMigrationTools";
import { advancedAuditLogViewerRouter } from "./routers/advancedAuditLogViewer";
// Sprint 36: White-Label Partner Platform + Production Hardening
import { transactionCsvExportRouter } from "./routers/transactionCsvExport";
import { transactionMapLoadingRouter } from "./routers/transactionMapLoading";
import { nlFinancialQueryRouter } from "./routers/nlFinancialQuery";
import { whiteLabelOnboardingRouter } from "./routers/whiteLabelOnboarding";
import { whiteLabelBrandingRouter } from "./routers/whiteLabelBranding";
import { whiteLabelApprovalRouter } from "./routers/whiteLabelApproval";
import { partnerSelfServiceRouter } from "./routers/partnerSelfService";
import { transactionExportEngineRouter } from "./routers/transactionExportEngine";
import { advancedLoadingStatesRouter } from "./routers/advancedLoadingStates";
import { financialNlEngineRouter } from "./routers/financialNlEngine";
import { partnerRevenueSharingRouter } from "./routers/partnerRevenueSharing";
import { agentGamificationRouter } from "./routers/agentGamification";
import { bulkTransactionProcessingRouter } from "./routers/bulkTransactionProcessing";
import { customer360ViewRouter } from "./routers/customer360View";
import { platformFeatureFlagsRouter } from "./routers/platformFeatureFlags";
import { slaMonitoringDashRouter } from "./routers/slaMonitoringDash";
import { dataRetentionPolicyRouter } from "./routers/dataRetentionPolicy";
import { platformChangelogRouter } from "./routers/platformChangelog";
import { advancedSearchFilteringRouter } from "./routers/advancedSearchFiltering";
// ── Sprint 37 Imports ──
import { e2eTestFrameworkRouter } from "./routers/e2eTestFramework";
import { dbSchemaPushRouter } from "./routers/dbSchemaPush";
import { agentCommissionCalcRouter } from "./routers/agentCommissionCalc";
import { mccManagerRouter } from "./routers/mccManager";
import { settlementBatchProcessorRouter } from "./routers/settlementBatchProcessor";
import { cardBinLookupRouter } from "./routers/cardBinLookup";
import { transactionVelocityMonitorRouter } from "./routers/transactionVelocityMonitor";
import { merchantRiskScoringRouter } from "./routers/merchantRiskScoring";
import { paymentGatewayRouterRouter } from "./routers/paymentGatewayRouter";
import { agentFloatForecastingRouter } from "./routers/agentFloatForecasting";
import { multiTenantIsolationRouter } from "./routers/multiTenantIsolation";
import { platformHealthDashRouter } from "./routers/platformHealthDash";
import { automatedComplianceCheckerRouter } from "./routers/automatedComplianceChecker";
import { transactionFeeCalcRouter } from "./routers/transactionFeeCalc";
import { agentNetworkTopologyRouter } from "./routers/agentNetworkTopology";
import { customerDisputePortalRouter } from "./routers/customerDisputePortal";
import { revenueLeakageDetectorRouter } from "./routers/revenueLeakageDetector";
import { apiRateLimiterDashRouter } from "./routers/apiRateLimiterDash";
import { operationalRunbookRouter } from "./routers/operationalRunbook";
import { platformMetricsExporterRouter } from "./routers/platformMetricsExporter";
// ── Sprint 39 Imports ──
import { publishReadinessCheckerRouter } from "./routers/publishReadinessChecker";
import { dbSchemaMigrationManagerRouter } from "./routers/dbSchemaMigrationManager";
import { graphqlSubscriptionGatewayRouter } from "./routers/graphqlSubscriptionGateway";
import { offlinePosModeRouter } from "./routers/offlinePosMode";
import { biometricAuthGatewayRouter } from "./routers/biometricAuthGateway";
import { aiCashFlowPredictorRouter } from "./routers/aiCashFlowPredictor";
import { blockchainAuditTrailRouter } from "./routers/blockchainAuditTrail";
import { voiceCommandPosRouter } from "./routers/voiceCommandPos";
import { socialCommerceGatewayRouter } from "./routers/socialCommerceGateway";
import { esgCarbonTrackerRouter } from "./routers/esgCarbonTracker";
import { distributedTracingDashRouter } from "./routers/distributedTracingDash";
import { canaryReleaseManagerRouter } from "./routers/canaryReleaseManager";
import { chaosEngineeringConsoleRouter } from "./routers/chaosEngineeringConsole";
import { connectionPoolMonitorRouter } from "./routers/connectionPoolMonitor";
import { cdnCacheManagerRouter } from "./routers/cdnCacheManager";
import { cqrsEventStoreRouter } from "./routers/cqrsEventStore";
import { digitalTwinSimulatorRouter } from "./routers/digitalTwinSimulator";
import { cbdcIntegrationGatewayRouter } from "./routers/cbdcIntegrationGateway";
import { decentralizedIdentityManagerRouter } from "./routers/decentralizedIdentityManager";
import { platformMaturityScorecardRouter } from "./routers/platformMaturityScorecard";
// ── Sprint 40: Enterprise Scaling & Operational Excellence ──
import { smartContractPaymentRouter } from "./routers/smartContractPayment";
import { predictiveAgentChurnRouter } from "./routers/predictiveAgentChurn";
import { currencyHedgingRouter } from "./routers/currencyHedging";
import { agentClusterAnalyticsRouter } from "./routers/agentClusterAnalytics";
import { autoComplianceWorkflowRouter } from "./routers/autoComplianceWorkflow";
import { paymentTokenVaultRouter } from "./routers/paymentTokenVault";
import { dynamicQrPaymentRouter } from "./routers/dynamicQrPayment";
import { agentRevenueAttributionRouter } from "./routers/agentRevenueAttribution";
import { platformCostAllocatorRouter } from "./routers/platformCostAllocator";
import { intelligentRoutingEngineRouter } from "./routers/intelligentRoutingEngine";
import { regulatorySandboxTesterRouter } from "./routers/regulatorySandboxTester";
import { agentDeviceFingerprintRouter } from "./routers/agentDeviceFingerprint";
import { settlementNettingEngineRouter } from "./routers/settlementNettingEngine";
import { platformCapacityPlannerRouter } from "./routers/platformCapacityPlanner";
import { merchantAcquirerGatewayRouter } from "./routers/merchantAcquirerGateway";
import { agentMicroInsuranceRouter } from "./routers/agentMicroInsurance";
import { transactionGraphAnalyzerRouter } from "./routers/transactionGraphAnalyzer";
import { platformRevenueOptimizerRouter } from "./routers/platformRevenueOptimizer";
import { operationalCommandBridgeRouter } from "./routers/operationalCommandBridge";
// ── Sprint 41 Imports ──
import { agentKycDocVaultRouter } from "./routers/agentKycDocVault";
import { realtimePnlDashboardRouter } from "./routers/realtimePnlDashboard";
import { autoReconciliationEngineRouter } from "./routers/autoReconciliationEngine";
import { agentTerritoryOptimizerRouter } from "./routers/agentTerritoryOptimizer";
import { paymentDisputeArbitrationRouter } from "./routers/paymentDisputeArbitration";
import { regulatoryReportGeneratorRouter } from "./routers/regulatoryReportGenerator";
import { agentTrainingAcademyRouter } from "./routers/agentTrainingAcademy";
import { dynamicFeeCalculatorRouter } from "./routers/dynamicFeeCalculator";
import { customerOnboardingPipelineRouter } from "./routers/customerOnboardingPipeline";
import { merchantSettlementDashboardRouter } from "./routers/merchantSettlementDashboard";
import { agentFloatInsuranceClaimsRouter } from "./routers/agentFloatInsuranceClaims";
import { platformSlaMonitorRouter } from "./routers/platformSlaMonitor";
import { bulkDisbursementEngineRouter } from "./routers/bulkDisbursementEngine";
import { transactionReversalManagerRouter } from "./routers/transactionReversalManager";
import { agentLoanOriginationRouter } from "./routers/agentLoanOrigination";
import { multiChannelNotificationHubRouter } from "./routers/multiChannelNotificationHub";
import { platformMigrationToolkitRouter } from "./routers/platformMigrationToolkit";
import { agentPerformanceIncentivesRouter } from "./routers/agentPerformanceIncentives";
import { executiveCommandCenterRouter } from "./routers/executiveCommandCenter";
// ── Sprint 38 Imports ──
import { realtimeWebSocketFeedsRouter } from "./routers/realtimeWebSocketFeeds";
import { merchantOnboardingPortalRouter } from "./routers/merchantOnboardingPortal";
import { paymentLinkGeneratorRouter } from "./routers/paymentLinkGenerator";
import { disputeMediationAIRouter } from "./routers/disputeMediationAI";
import { disputeRefundRouter } from "./routers/disputeRefund";
// Sprint 42: Final Production Features
import { disputeNotificationsRouter } from "./routers/disputeNotifications";
import { disputeAnalyticsRouter } from "./routers/disputeAnalytics";
import { agentBenchmarkingRouter } from "./routers/agentBenchmarking";
import { txVelocityMonitorRouter } from "./routers/txVelocityMonitor";
import { customerSurveysRouter } from "./routers/customerSurveys";
import { agentTerritoryHeatmapRouter } from "./routers/agentTerritoryHeatmap";
import { gatewayHealthMonitorRouter } from "./routers/gatewayHealthMonitor";
import { agentLoanOrigination2Router } from "./routers/agentLoanOrigination2";
import { mfaManagerRouter } from "./routers/mfaManager";
import { incidentPlaybookRouter } from "./routers/incidentPlaybook";
import { deviceFleetManagerRouter } from "./routers/deviceFleetManager";
import { customerJourneyMapperRouter } from "./routers/customerJourneyMapper";
import { complianceCertManagerRouter } from "./routers/complianceCertManager";
import { platformHealthScorecardRouter } from "./routers/platformHealthScorecard";
import { trainingCertificationRouter } from "./routers/trainingCertification";
import { bulkTransactionProcessorRouter } from "./routers/bulkTransactionProcessor";
import { systemConfigManagerRouter } from "./routers/systemConfigManager";
import { agentPerformanceLeaderboardRouter } from "./routers/agentPerformanceLeaderboard";
import { automatedSettlementSchedulerRouter } from "./routers/automatedSettlementScheduler";
import { customerWalletSystemRouter } from "./routers/customerWalletSystem";
import { merchantAnalyticsDashRouter } from "./routers/merchantAnalyticsDash";
import { posServiceUpdateRouter } from "./routers/posServiceUpdate";
import { firmwareOTARouter } from "./routers/firmwareOTA";
import { transactionReceiptGeneratorRouter } from "./routers/transactionReceiptGenerator";
import { agentLoanAdvanceRouter } from "./routers/agentLoanAdvance";
import { multiChannelPaymentOrchRouter } from "./routers/multiChannelPaymentOrch";
import { regulatoryFilingAutomationRouter } from "./routers/regulatoryFilingAutomation";
import { customerSegmentationEngineRouter } from "./routers/customerSegmentationEngine";
import { incidentCommandCenterRouter } from "./routers/incidentCommandCenter";
import { platformABTestingRouter } from "./routers/platformABTesting";
import { transactionEnrichmentServiceRouter } from "./routers/transactionEnrichmentService";
import { agentInventoryMgmtRouter } from "./routers/agentInventoryMgmt";
import { revenueForecastingEngineRouter } from "./routers/revenueForecastingEngine";
import { platformRecommendationsRouter } from "./routers/platformRecommendations";
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
import { paymentNotificationSystemRouter } from "./routers/paymentNotificationSystem";
import { databaseVisualizationRouter } from "./routers/databaseVisualization";
import { middlewareServiceManagerRouter } from "./routers/middlewareServiceManager";
import { skillCreatorIntegrationRouter } from "./routers/skillCreatorIntegration";
import { paymentReconciliationRouter } from "./routers/paymentReconciliation";
import { agentPerformanceAnalyticsRouter } from "./routers/agentPerformanceAnalytics";
import { complianceReportingRouter } from "./routers/complianceReporting";
import { customerFeedbackNpsRouter } from "./routers/customerFeedbackNps";
import { multiCurrencyExchangeRouter } from "./routers/multiCurrencyExchange";
import { agentTrainingPortalRouter } from "./routers/agentTrainingPortal";
import { disputeWorkflowEngineRouter } from "./routers/disputeWorkflowEngine";
import { platformHealthMonitorRouter } from "./routers/platformHealthMonitor";
import { bulkPaymentProcessorRouter } from "./routers/bulkPaymentProcessor";
import { agentHierarchyTerritoryRouter } from "./routers/agentHierarchyTerritory";
import { financialReportingSuiteRouter } from "./routers/financialReportingSuite";
import { apiKeyManagementRouter } from "./routers/apiKeyManagement";
import { webhookDeliverySystemRouter } from "./routers/webhookDeliverySystem";
import { platformConfigCenterRouter } from "./routers/platformConfigCenter";
import { bankAccountManagementRouter } from "./routers/bankAccountManagement";
import { kycDocumentManagementRouter } from "./routers/kycDocumentManagement";
import { floatReconciliationRouter } from "./routers/floatReconciliation";
import { agentPerformanceScorecardRouter } from "./routers/agentPerformanceScorecard";
import { customerDatabaseRouter } from "./routers/customerDatabase";
import { reversalApprovalRouter } from "./routers/reversalApproval";
import { commissionClawbackRouter } from "./routers/commissionClawback";
import { pnlReportRouter } from "./routers/pnlReport";
import { transactionLimitsEngineRouter } from "./routers/transactionLimitsEngine";
import { regulatoryComplianceRouter } from "./routers/regulatoryCompliance";
import { systemHealthDashboardRouter } from "./routers/systemHealthDashboard";
import { runtimeConfigAdminRouter } from "./routers/runtimeConfigAdmin";
import { archivalAdminRouter } from "./routers/archivalAdmin";
import { globalSearchRouter } from "./routers/globalSearch";
import { healthCheckRouter } from "./routers/healthCheck";
import { apiDocsRouter } from "./routers/apiDocs";
import { dataExportRouter as dataExportRouterV2 } from "./routers/dataExport";
import { loadTestMetricsRouter } from "./routers/loadTestMetrics";
import { agentSuspensionWorkflowRouter } from "./routers/agentSuspensionWorkflow";
import { auditExportRouter } from "./routers/auditExport";
// F-08: tamper-evident audit chain verification/export + GDPR/NDPR dashboard
import { auditComplianceRouter } from "./routers/auditCompliance";
import { gdprDashboardRouter } from "./routers/gdprDashboard";
import { networkTelemetryRouter } from "./routers/networkTelemetry";
// Sprint 75: USSD Integration, Carrier Switching, Network Status Dashboard
import { ussdIntegrationRouter } from "./routers/ussdIntegration";
import { carrierSwitchingRouter } from "./routers/carrierSwitching";
import { networkStatusDashboardRouter } from "./routers/networkStatusDashboard";
// Sprint 76: Security, Resilience, Cost, Analytics, SLA, Receipts
import { securityAuditRouter } from "./routers/securityAudit";
import { carrierCostRouter } from "./routers/carrierCost";
import { ussdReceiptRouter } from "./routers/ussdReceipt";
import { networkResilienceRouter } from "./routers/networkResilience";
import { ussdAnalyticsRouter } from "./routers/ussdAnalytics";
import { carrierSlaRouter } from "./routers/carrierSla";
// Sprint 78: Session Replay, Live Pricing, KYC, TX Monitor, Commission
import { ussdSessionReplayRouter } from "./routers/ussdSessionReplay";
import { carrierLivePricingRouter } from "./routers/carrierLivePricing";
import { agentKycRouter } from "./routers/agentKyc";
import { txMonitorRouter } from "./routers/txMonitor";
import { commissionCalculatorRouter } from "./routers/commissionCalculator";
// Sprint 79 — Real-time Billing Engine
import { billingLedgerRouter } from "./routers/billingLedger";
import { revenueReconciliationRouter } from "./routers/revenueReconciliation";
import { liveBillingDashboardRouter } from "./routers/liveBillingDashboard";
// Sprint 80: Billing RBAC, Audit, Tenant Onboarding
import { billingRbacRouter } from "./routers/billingRbac";
import { billingAuditRouter } from "./routers/billingAudit";
import { tenantBillingOnboardingRouter } from "./routers/tenantBillingOnboarding";
import { billingInvoiceRouter } from "./routers/billingInvoice";
import { billingLifecycleRouter } from "./routers/billingLifecycle";
import { resilienceHardeningRouter } from "./routers/resilienceHardening";
import { billingProductionRouter } from "./routers/billingProduction";
import { agentBankAccountsRouter } from "./routers/agentBankAccountsCrud";
import { agentPerformanceScoresRouter } from "./routers/agentPerformanceScoresCrud";
import { agentSuspensionLogRouter } from "./routers/agentSuspensionLogCrud";
import { analyticsDashboardsRouter } from "./routers/analyticsDashboardsCrud";
import { biReportDefinitionsRouter } from "./routers/biReportDefinitionsCrud";
import { billingRevenuePeriodsRouter } from "./routers/billingRevenuePeriodsCrud";
import { commissionCascadeHistoryRouter } from "./routers/commissionCascadeHistoryCrud";
import { customer_journey_eventsRouter } from "./routers/customerJourneyEventsCrud";
import { dataConsentRecordsRouter } from "./routers/dataConsentRecordsCrud";
import { emailDeliveryLogRouter } from "./routers/emailDeliveryLogCrud";
import { encryptedFieldsRouter } from "./routers/encryptedFieldsCrud";
import { floatReconciliationsRouter } from "./routers/floatReconciliationsCrud";
import { geoFencesRouter } from "./routers/geoFencesCrud";
import { gl_accountsRouter } from "./routers/glAccountsCrud";
import { gl_journal_entriesRouter } from "./routers/glJournalEntriesCrud";
import { kycDocumentsRouter } from "./routers/kycDocumentsCrud";
import { notification_channelsRouter } from "./routers/notificationChannelsCrud";
import { notification_logsRouter } from "./routers/notificationLogsCrud";
import { observabilityAlertsRouter } from "./routers/observabilityAlertsCrud";
import { pnlReportsRouter } from "./routers/pnlReportsCrud";
import { realtime_tx_alertsRouter } from "./routers/realtimeTxAlertsCrud";
import { tenantBrandingRouter } from "./routers/tenantBrandingCrud";
import { tenantFeeOverridesRouter } from "./routers/tenantFeeOverridesCrud";
import { trainingCoursesRouter } from "./routers/trainingCoursesCrud";
import { trainingEnrollmentsRouter } from "./routers/trainingEnrollmentsCrud";
import { adminDashboardRouter } from "./routers/adminDashboard";
import { amlScreeningRouter } from "./routers/amlScreening";
import { receiptTemplatesRouter } from "./routers/receiptTemplates";
import { analyticsQueryRouter } from "./routers/analyticsQuery";
import { faceEnrollmentRouter } from "./routers/faceEnrollment";
import { biometricAuditDashboardRouter } from "./routers/biometricAuditDashboard";
import { offlineQueueRouter } from "./routers/offlineQueue";
import { geoFencingRouter } from "./routers/geoFencing";
import { geoFencingDedicatedRouter } from "./routers/geoFencingDedicated";
import { ransomwareAlertsRouter } from "./routers/ransomwareAlerts";
import { pbacManagementRouter } from "./routers/pbacManagement";
import { alertNotificationsRouter } from "./routers/alertNotifications";
import { networkQualityHeatmapRouter } from "./routers/networkQualityHeatmap";
import { bulkRoleImportRouter } from "./routers/bulkRoleImport";
import { networkTrendsRouter } from "./routers/networkTrends";
import { kybRouter } from "./routers/kyb";
import { deepfaceRouter } from "./routers/deepface";
// Sprint 96: POS Enhancement Routers
import { eodReconciliationRouter } from "./routers/eodReconciliation";
import { multiSimFailoverRouter } from "./routers/multiSimFailover";
import { agentFloatTransferRouter } from "./routers/agentFloatTransfer";
import { splitPaymentsRouter } from "./routers/splitPayments";
import { recurringPaymentsRouter } from "./routers/recurringPayments";
import { posDisputeRouter } from "./routers/posDispute";
import { agentTrainingGamificationRouter } from "./routers/agentTrainingGamification";
// Sprint 97: Frontend-Backend Gap Closure
import { activityAuditLogRouter } from "./routers/activityAuditLog";
import { agentOnboardingWorkflowRouter } from "./routers/agentOnboardingWorkflow";
import { auditTrailExportRouter } from "./routers/auditTrailExport";
import { dailyPnlReportRouter } from "./routers/dailyPnlReport";
import { floatManagementRouter } from "./routers/floatManagement";
import { fraudMlScoringEngineRouter as fraudMlScoringEngineRouterV2 } from "./routers/fraudMlScoringEngine";
import { regulatoryComplianceChecksRouter } from "./routers/regulatoryComplianceChecks";
import { runtimeConfigAdminRouter as runtimeConfigAdminRouterV2 } from "./routers/runtimeConfigAdmin";
import { transactionDisputeResolutionRouter } from "./routers/transactionDisputeResolution";
import { transactionMonitoringRouter } from "./routers/transactionMonitoring";
import { transactionReversalWorkflowRouter } from "./routers/transactionReversalWorkflow";
import { ussdLocalizationRouter } from "./routers/ussdLocalization";
import { geoFenceDedicatedRouter } from "./routers/geoFenceDedicated";
import { supplyChainRouter } from "./routers/supplyChain";
import { marketplaceRouter } from "./routers/marketplace";
import { promotionsRouter } from "./routers/promotions";
// ── KYC/KYB Enforcement & Compliance Services ──
import { kycEnforcementRouter } from "./routers/kycEnforcement";
// ── Insurance Domain Workflows (Sprint 98) ──
import { insuranceWorkflowsRouter } from "./routers/insuranceWorkflows";
// ── Insurance KPI Dashboards (all 16 roles) ──
import { insuranceKpiDashboardRouter } from "./routers/insuranceKpiDashboard";
import { naicomReportingRouter } from "./routers/naicomReporting";
import { worldViewRouter } from "./routers/worldView";
import { insureMarketRouter } from "./routers/insureMarket";

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
    logout: publicProcedure.mutation(({ ctx }) => {
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
