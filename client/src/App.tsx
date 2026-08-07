import React, { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import { ThemeProvider } from "./contexts/ThemeContext";
import { usePosStore } from "./store/posStore";
import { useTerminalSocket } from "./hooks/useSocket";
import { useOfflineSync } from "./hooks/useOfflineSync";
import ErrorBoundary from "./components/ErrorBoundary";
import { PWAInstallBanner } from "./components/PWAInstallBanner";
import { GdprConsentBanner } from "./components/GdprConsentBanner";
import AgentLogin from "./pages/AgentLogin";
import InsurancePortal from "./pages/InsurancePortal";
import GlobalSearch from "./components/GlobalSearch";
import { LiveChatWidget } from "./components/LiveChatWidget";
import { ProactiveHelp } from "./components/ProactiveHelp";
import KeyboardShortcutsHelp, {
  useKeyboardShortcuts,
} from "./components/KeyboardShortcuts";
import { ErrorBoundaryRoute } from "./components/ErrorBoundaryRoute";
import AnnouncementBanner from "./components/AnnouncementBanner";
import { AccessibilityProvider } from "@/components/AccessibilityProvider";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { RoleOnboarding } from "./components/RoleOnboarding";
import { KpiLiveRegion } from "./components/KpiLiveRegion";
import { SkeletonDashboard } from "./components/SkeletonDashboard";
import InsurancePolicyQuoteManager from "./pages/InsurancePolicyQuoteManager";
// Sprint 28: Nigerian Insurance Features
// Sprint 29: AI/ML/DL/GNN Integrations
// Sprint 30: AI/ML Follow-ups
// Sprint 31: Data Pipelines, Security, Production Features
// Sprint 32: Production Infrastructure & Operations
// Sprint 33: Final Production
// Sprint 34: Final Comprehensive Production
// Sprint 35: Advanced Operations
// Sprint 36: White-Label Partner Platform
// Sprint 37: Production Hardening & Advanced Platform
// Sprint 38: Advanced Platform Capabilities & Enhancements

// Sprint 39: Platform Maturity & Infrastructure Hardening
// Sprint 40: Enterprise Scaling & Operational Excellence
// Sprint 41: Production Finalization & Domain Completeness
// Sprint 42: Final Production Features
// DataRetentionPolicy already imported above
// RevenueLeakageDetector already imported above
// SystemConfigManager already imported above
// Sprint 51: Production-grade feature pages
// Sprint 58: Real-Time Progress, Archival Admin, Load Test Dashboard
// Sprint 78 imports

// ─── Lazy-loaded page components (code splitting for dev performance) ─────
// 418 pages loaded on-demand via React.lazy()
const FraudDashboard = lazy(() => import("./pages/FraudDashboard"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));
const SupervisorDashboard = lazy(() => import("./pages/SupervisorDashboard"));
// ─── Insurance Role Dashboards ───────────────────────────────────────────────
const UnderwriterDashboard = lazy(() => import("./pages/UnderwriterDashboard"));
const ActuaryDashboard = lazy(() => import("./pages/ActuaryDashboard"));
const ClaimsDashboard = lazy(() => import("./pages/ClaimsDashboard"));
const BrokerDashboard = lazy(() => import("./pages/BrokerDashboard"));
const PolicyholderDashboard = lazy(() => import("./pages/PolicyholderDashboard"));
const ComplianceDashboard = lazy(() => import("./pages/ComplianceDashboard"));
const RegulatorDashboard = lazy(() => import("./pages/RegulatorDashboard"));
const ReinsurerDashboard = lazy(() => import("./pages/ReinsurerDashboard"));
const BillingAdminDashboard = lazy(() => import("./pages/BillingAdminDashboard"));
const BeneficiaryDashboard = lazy(() => import("./pages/BeneficiaryDashboard"));
const Ifrs17Dashboard = lazy(() => import("./pages/Ifrs17Dashboard"));

const ManagementPortal = lazy(() => import("./pages/ManagementPortal"));
const AgentPortal = lazy(() => import("./pages/AgentPortal"));
const CustomerPortal = lazy(() => import("./pages/CustomerPortal"));
const SuperAdminPortal = lazy(() => import("./pages/SuperAdminPortal"));
const PlatformHub = lazy(() => import("./pages/PlatformHub"));
const AnalyticsDashboard = lazy(() => import("./pages/AnalyticsDashboard"));
const InsuranceAgentMerchantPortal = lazy(() => import("./pages/InsuranceAgentMerchantPortal"));
const DeveloperPortal = lazy(() => import("./pages/DeveloperPortal"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const SystemHealth = lazy(() => import("./pages/SystemHealth"));
const SystemHealthDashboard = lazy(
  () => import("./pages/SystemHealthDashboard")
);
const LakehouseAnalytics = lazy(() => import("./pages/LakehouseAnalytics"));
const WebhookManager = lazy(() => import("./pages/WebhookManager"));
const CommissionPayouts = lazy(() => import("./pages/CommissionPayouts"));
const AgentOnboarding = lazy(() => import("./pages/AgentOnboarding"));
const SettlementReconciliation = lazy(
  () => import("./pages/SettlementReconciliation")
);
const ReferralProgram = lazy(() => import("./pages/ReferralProgram"));
const AuditLogViewer = lazy(() => import("./pages/AuditLogViewer"));
const InfrastructureDashboard = lazy(
  () => import("./pages/InfrastructureDashboard")
);
const LoyaltySystem = lazy(() => import("./pages/LoyaltySystem"));
const LiveChatSupport = lazy(() => import("./pages/LiveChatSupport"));
const AgentPerformance = lazy(() => import("./pages/AgentPerformance"));
const CustomerWallet = lazy(() => import("./pages/CustomerWallet"));
const NotificationPreferences = lazy(
  () => import("./pages/NotificationPreferences")
);
const MultiCurrency = lazy(() => import("./pages/MultiCurrency"));
const ComplianceScheduling = lazy(() => import("./pages/ComplianceScheduling"));
const AuditExport = lazy(() => import("./pages/AuditExport"));
const WebhookDeliveryViewer = lazy(
  () => import("./pages/WebhookDeliveryViewer")
);
const GeofenceZoneEditor = lazy(() => import("./pages/GeofenceZoneEditor"));
const ApiKeyManagement = lazy(() => import("./pages/ApiKeyManagement"));
const KycWorkflow = lazy(() => import("./pages/KycWorkflow"));
const OnboardingWizard = lazy(() => import("./pages/OnboardingWizard"));
const CommissionConfig = lazy(() => import("./pages/CommissionConfig"));
const RateAlerts = lazy(() => import("./pages/RateAlerts"));
const NotificationInbox = lazy(() => import("./pages/NotificationInbox"));
const NotificationPreferenceMatrix = lazy(
  () => import("./pages/NotificationPreferenceMatrix")
);
const WebhookConfig = lazy(() => import("./pages/WebhookConfig"));
const BatchOperations = lazy(() => import("./pages/BatchOperations"));
const AdminAnalyticsDashboard = lazy(
  () => import("./pages/AdminAnalyticsDashboard")
);
const BroadcastManager = lazy(() => import("./pages/BroadcastManager"));
const ScheduledReports = lazy(() => import("./pages/ScheduledReports"));
const UserNotifSettings = lazy(() => import("./pages/UserNotifSettings"));
const DataThresholdAlerts = lazy(() => import("./pages/DataThresholdAlerts"));
const SharedLayoutGallery = lazy(() => import("./pages/SharedLayoutGallery"));
const ReportTemplateDesigner = lazy(
  () => import("./pages/ReportTemplateDesigner")
);
const EscalationChains = lazy(() => import("./pages/EscalationChains"));
const NotificationAnalytics = lazy(
  () => import("./pages/NotificationAnalytics")
);
const UserQuietHours = lazy(() => import("./pages/UserQuietHours"));
const NotificationTemplateManager = lazy(
  () => import("./pages/NotificationTemplateManager")
);
const SystemConfigManager = lazy(() => import("./pages/SystemConfigManager"));
const PaymentNotificationSystem = lazy(
  () => import("./pages/PaymentNotificationSystem")
);
const DatabaseVisualization = lazy(
  () => import("./pages/DatabaseVisualization")
);
const MiddlewareServiceManager = lazy(
  () => import("./pages/MiddlewareServiceManager")
);
const SkillCreatorIntegration = lazy(
  () => import("./pages/SkillCreatorIntegration")
);
const PaymentReconciliation = lazy(
  () => import("./pages/PaymentReconciliation")
);
const AgentPerformanceAnalytics = lazy(
  () => import("./pages/AgentPerformanceAnalytics")
);
const ComplianceReporting = lazy(() => import("./pages/ComplianceReporting"));
const CustomerFeedbackNps = lazy(() => import("./pages/CustomerFeedbackNps"));
const MultiCurrencyExchange = lazy(
  () => import("./pages/MultiCurrencyExchange")
);
const DisputeWorkflowEngine = lazy(
  () => import("./pages/DisputeWorkflowEngine")
);
const BulkPaymentProcessor = lazy(() => import("./pages/BulkPaymentProcessor"));
const AgentHierarchyTerritory = lazy(
  () => import("./pages/AgentHierarchyTerritory")
);
const FinancialReportingSuite = lazy(
  () => import("./pages/FinancialReportingSuite")
);
const WebhookDeliverySystem = lazy(
  () => import("./pages/WebhookDeliverySystem")
);
const PlatformConfigCenter = lazy(() => import("./pages/PlatformConfigCenter"));
const BankAccountManagementPage = lazy(
  () => import("./pages/BankAccountManagementPage")
);
const KycDocumentManagementPage = lazy(
  () => import("./pages/KycDocumentManagementPage")
);
const FloatReconciliationPage = lazy(
  () => import("./pages/FloatReconciliationPage")
);
const CustomerDatabasePage = lazy(() => import("./pages/CustomerDatabasePage"));
const ReversalApprovalPage = lazy(() => import("./pages/ReversalApprovalPage"));
const CommissionClawbackPage = lazy(
  () => import("./pages/CommissionClawbackPage")
);
const PnlReportPage = lazy(() => import("./pages/PnlReportPage"));
const TransactionLimitsEnginePage = lazy(
  () => import("./pages/TransactionLimitsEnginePage")
);
const RegulatoryCompliancePage = lazy(
  () => import("./pages/RegulatoryCompliancePage")
);
const SystemHealthDashboardPage = lazy(
  () => import("./pages/SystemHealthDashboardPage")
);
const AgentSuspensionWorkflowPage = lazy(
  () => import("./pages/AgentSuspensionWorkflowPage")
);
const SessionManager = lazy(() => import("./pages/SessionManager"));
const DataExportCenter = lazy(() => import("./pages/DataExportCenter"));
const PlatformChangelog = lazy(() => import("./pages/PlatformChangelog"));
const BulkNotifSender = lazy(() => import("./pages/BulkNotifSender"));
const RetryQueueViewer = lazy(() => import("./pages/RetryQueueViewer"));
const RateLimitDashboard = lazy(() => import("./pages/RateLimitDashboard"));
const ServiceHealthAggregator = lazy(
  () => import("./pages/ServiceHealthAggregator")
);
const CacheManagement = lazy(() => import("./pages/CacheManagement"));
const PartnerOnboarding = lazy(() => import("./pages/PartnerOnboarding"));
const TenantAdminDashboard = lazy(() => import("./pages/TenantAdminDashboard"));
const InviteCodeManager = lazy(() => import("./pages/InviteCodeManager"));
const GdprDashboard = lazy(() => import("./pages/GdprDashboard"));
const CbnReportingDashboard = lazy(
  () => import("./pages/CbnReportingDashboard")
);
const TigerBeetleLedger = lazy(() => import("./pages/TigerBeetleLedger"));
const TemporalWorkflowMonitor = lazy(
  () => import("./pages/TemporalWorkflowMonitor")
);
const VaultSecretsManager = lazy(() => import("./pages/VaultSecretsManager"));
const ResilienceMonitor = lazy(() => import("./pages/ResilienceMonitor"));
const SimOrchestratorDashboard = lazy(
  () => import("./pages/SimOrchestratorDashboard")
);
const MqttBridgeDashboard = lazy(() => import("./pages/MqttBridgeDashboard"));
const PushNotificationConfig = lazy(
  () => import("./pages/PushNotificationConfig")
);
const AgentManagementDashboard = lazy(
  () => import("./pages/AgentManagementDashboard")
);
const BusinessRulesDashboard = lazy(
  () => import("./pages/BusinessRulesDashboard")
);
const AnnouncementReactions = lazy(
  () => import("./pages/AnnouncementReactions")
);
const WeeklyReports = lazy(() => import("./pages/WeeklyReports"));
const ReportComparison = lazy(() => import("./pages/ReportComparison"));
const ThresholdManager = lazy(() => import("./pages/ThresholdManager"));
const EndpointRateLimits = lazy(() => import("./pages/EndpointRateLimits"));
const WebhookDeliveryMonitor = lazy(
  () => import("./pages/WebhookDeliveryMonitor")
);
const AgentPerformanceScoring = lazy(
  () => import("./pages/AgentPerformanceScoring")
);
const DisputeAutoRules = lazy(() => import("./pages/DisputeAutoRules"));
const KycVerificationWorkflow = lazy(
  () => import("./pages/KycVerificationWorkflow")
);
const ProductionReadinessChecklist = lazy(
  () => import("./pages/ProductionReadinessChecklist")
);
const ScheduledEmailDelivery = lazy(
  () => import("./pages/ScheduledEmailDelivery")
);
const GlobalSearchPage = lazy(() => import("./pages/GlobalSearchPage"));
const UserGuide = lazy(() => import("./pages/UserGuide"));
const Payments = lazy(() => import("./pages/Payments"));
const PaymentSuccess = lazy(() => import("./pages/PaymentSuccess"));
const PaymentCancel = lazy(() => import("./pages/PaymentCancel"));
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboard"));
const AdminUserManagement = lazy(() => import("./pages/AdminUserManagement"));
const AdminSystemHealth = lazy(() => import("./pages/AdminSystemHealth"));
const AdminLivenessDeviceAnalytics = lazy(
  () => import("./pages/AdminLivenessDeviceAnalytics")
);
const TransactionAnalytics = lazy(() => import("./pages/TransactionAnalytics"));
const OfflineQueueDashboard = lazy(
  () => import("./pages/OfflineQueueDashboard")
);
const RansomwareAlertDashboard = lazy(
  () => import("./pages/RansomwareAlertDashboard")
);
const PBACManagement = lazy(() => import("./pages/PBACManagement"));
const AlertNotificationPreferences = lazy(
  () => import("./pages/AlertNotificationPreferences")
);
const NetworkQualityHeatmap = lazy(
  () => import("./pages/NetworkQualityHeatmap")
);
const VideoTutorials = lazy(() => import("./pages/VideoTutorials"));
const FeedbackAnalytics = lazy(() => import("./pages/FeedbackAnalytics"));
const ApiDocs = lazy(() => import("./pages/ApiDocs"));
const SystemStatus = lazy(() => import("./pages/SystemStatus"));
const AuditTrailPage = lazy(() => import("./pages/AuditTrailPage"));
const UssdGateway = lazy(() => import("./pages/UssdGateway"));
const MobileMoneyPage = lazy(() => import("./pages/MobileMoneyPage"));
const AgentHierarchyPage = lazy(() => import("./pages/AgentHierarchyPage"));
const CommissionEnginePage = lazy(() => import("./pages/CommissionEnginePage"));
const BulkOperationsPage = lazy(() => import("./pages/BulkOperationsPage"));
const GeoFencingPage = lazy(() => import("./pages/GeoFencingPage"));
const BiometricAuthPage = lazy(() => import("./pages/BiometricAuthPage"));
const OfflineSyncPage = lazy(() => import("./pages/OfflineSyncPage"));
const WhatsAppChannelPage = lazy(() => import("./pages/WhatsAppChannelPage"));
const InsuranceMerchantPayments = lazy(() => import("./pages/InsuranceMerchantPayments"));
const BillPaymentsPage = lazy(() => import("./pages/BillPaymentsPage"));
const AirtimeVendingPage = lazy(() => import("./pages/AirtimeVendingPage"));
const LoanDisbursementPage = lazy(() => import("./pages/LoanDisbursementPage"));
const InsuranceProductsPage = lazy(
  () => import("./pages/InsuranceProductsPage")
);
const SavingsProductsPage = lazy(() => import("./pages/SavingsProductsPage"));
const ReferralProgramPage = lazy(() => import("./pages/ReferralProgramPage"));
const CardRequestPage = lazy(() => import("./pages/CardRequestPage"));
const AccountOpeningPage = lazy(() => import("./pages/AccountOpeningPage"));
const TaxCollectionPage = lazy(() => import("./pages/TaxCollectionPage"));
const PensionCollectionPage = lazy(
  () => import("./pages/PensionCollectionPage")
);
const QdrantVectorSearchPage = lazy(
  () => import("./pages/QdrantVectorSearchPage")
);
const FalkorDBGraphPage = lazy(() => import("./pages/FalkorDBGraphPage"));
const CocoIndexPipelinePage = lazy(
  () => import("./pages/CocoIndexPipelinePage")
);
const OllamaLLMPage = lazy(() => import("./pages/OllamaLLMPage"));
const ARTRobustnessPage = lazy(() => import("./pages/ARTRobustnessPage"));
const LakehouseAiDashboard = lazy(() => import("./pages/LakehouseAiDashboard"));
const MLScoringDashboard = lazy(() => import("./pages/MLScoringDashboard"));
const AIMonitoringDashboard = lazy(
  () => import("./pages/AIMonitoringDashboard")
);
const FraudReportPage = lazy(() => import("./pages/FraudReportPage"));
const ComplianceChatbotPage = lazy(
  () => import("./pages/ComplianceChatbotPage")
);
const ApacheNifiPage = lazy(() => import("./pages/ApacheNifiPage"));
const DbtIntegrationPage = lazy(() => import("./pages/DbtIntegrationPage"));
const ApacheAirflowPage = lazy(() => import("./pages/ApacheAirflowPage"));
const WebSocketServicePage = lazy(() => import("./pages/WebSocketServicePage"));
const ReportSchedulerPage = lazy(() => import("./pages/ReportSchedulerPage"));
const EventDrivenArchPage = lazy(() => import("./pages/EventDrivenArchPage"));
const AdvancedNotificationsPage = lazy(
  () => import("./pages/AdvancedNotificationsPage")
);
const SecurityDashboardPage = lazy(
  () => import("./pages/SecurityDashboardPage")
);
const FraudRealtimeVizPage = lazy(() => import("./pages/FraudRealtimeVizPage"));
const PipelineMonitoringPage = lazy(
  () => import("./pages/PipelineMonitoringPage")
);
const ApiGatewayPage = lazy(() => import("./pages/ApiGatewayPage"));
const BackupDRPage = lazy(() => import("./pages/BackupDRPage"));
const PerformanceProfilerPage = lazy(
  () => import("./pages/PerformanceProfilerPage")
);
const MultiTenancyPage = lazy(() => import("./pages/MultiTenancyPage"));
const WebhookManagementPage = lazy(
  () => import("./pages/WebhookManagementPage")
);
const DataExportImportPage = lazy(() => import("./pages/DataExportImportPage"));
const SlaManagementPage = lazy(() => import("./pages/SlaManagementPage"));
const CapacityPlanningPage = lazy(() => import("./pages/CapacityPlanningPage"));
const IncidentManagementPage = lazy(
  () => import("./pages/IncidentManagementPage")
);
const FeatureFlagsPage = lazy(() => import("./pages/FeatureFlagsPage"));
const OpenTelemetryPage = lazy(() => import("./pages/OpenTelemetryPage"));
const AdvancedBiReportingPage = lazy(
  () => import("./pages/AdvancedBiReportingPage")
);
const WorkflowAutomationPage = lazy(
  () => import("./pages/WorkflowAutomationPage")
);
const NotificationCenterPage = lazy(
  () => import("./pages/NotificationCenterPage")
);
const HelpDeskPage = lazy(() => import("./pages/HelpDeskPage"));
const DataQualityPage = lazy(() => import("./pages/DataQualityPage"));
const ConfigManagementPage = lazy(() => import("./pages/ConfigManagementPage"));
const ServiceMeshPage = lazy(() => import("./pages/ServiceMeshPage"));
const ComplianceAutomationPage = lazy(
  () => import("./pages/ComplianceAutomationPage")
);
const Customer360Page = lazy(() => import("./pages/Customer360Page"));
const RealtimeNotificationsPage = lazy(
  () => import("./pages/RealtimeNotificationsPage")
);
const DragDropReportBuilderPage = lazy(
  () => import("./pages/DragDropReportBuilderPage")
);
const GraphqlFederationPage = lazy(
  () => import("./pages/GraphqlFederationPage")
);
const ApiVersioningPage = lazy(() => import("./pages/ApiVersioningPage"));
const AdvancedRateLimiterPage = lazy(
  () => import("./pages/AdvancedRateLimiterPage")
);
const RealtimeDashboardWidgetsPage = lazy(
  () => import("./pages/RealtimeDashboardWidgetsPage")
);
const AgentScorecardPage = lazy(() => import("./pages/AgentScorecardPage"));
const DisputeResolutionPage = lazy(
  () => import("./pages/DisputeResolutionPage")
);
const RegulatorySandboxPage = lazy(
  () => import("./pages/RegulatorySandboxPage")
);
const MultiCurrencyPage = lazy(() => import("./pages/MultiCurrencyPage"));
const DocumentManagementPage = lazy(
  () => import("./pages/DocumentManagementPage")
);
const AgentTrainingPage = lazy(() => import("./pages/AgentTrainingPage"));
const RevenueAnalyticsPage = lazy(() => import("./pages/RevenueAnalyticsPage"));
const PlatformHealthPage = lazy(() => import("./pages/PlatformHealthPage"));
const BatchProcessingPage = lazy(() => import("./pages/BatchProcessingPage"));
const IntegrationMarketplacePage = lazy(
  () => import("./pages/IntegrationMarketplacePage")
);
const WorldViewPage = lazy(() => import("./pages/WorldViewPage"));
const InsureMarketPage = lazy(() => import("./pages/InsureMarketPage"));
const MobileApiLayerPage = lazy(() => import("./pages/MobileApiLayerPage"));
const AutomatedTestingFrameworkPage = lazy(
  () => import("./pages/AutomatedTestingFrameworkPage")
);
const TransactionMapVizPage = lazy(
  () => import("./pages/TransactionMapVizPage")
);
const ReportBuilderTemplatesPage = lazy(
  () => import("./pages/ReportBuilderTemplatesPage")
);
const NLAnalyticsQueryPage = lazy(() => import("./pages/NLAnalyticsQueryPage"));
const BankingWorkflowPatternsPage = lazy(
  () => import("./pages/BankingWorkflowPatternsPage")
);
const AgentOnboardingWizardPage = lazy(
  () => import("./pages/AgentOnboardingWizardPage")
);
const TransactionReconciliationPage = lazy(
  () => import("./pages/TransactionReconciliationPage")
);
const ChargebackManagementPage = lazy(
  () => import("./pages/ChargebackManagementPage")
);
const RegulatoryReportingPage = lazy(
  () => import("./pages/RegulatoryReportingPage")
);
const TerritoryManagementPage = lazy(
  () => import("./pages/TerritoryManagementPage")
);
const DynamicPricingPage = lazy(() => import("./pages/DynamicPricingPage"));
const LoyaltyProgramPage = lazy(() => import("./pages/LoyaltyProgramPage"));
const FraudCaseManagementPage = lazy(
  () => import("./pages/FraudCaseManagementPage")
);
const ServiceFleetPage = lazy(() => import("./pages/ServiceFleetPage"));
const FinancialReconciliationPage = lazy(
  () => import("./pages/FinancialReconciliationPage")
);
const ApiAnalyticsPage = lazy(() => import("./pages/ApiAnalyticsPage"));
const AgentCommunicationHubPage = lazy(
  () => import("./pages/AgentCommunicationHubPage")
);
const DisputeArbitrationPage = lazy(
  () => import("./pages/DisputeArbitrationPage")
);
const ComplianceTrainingPage = lazy(
  () => import("./pages/ComplianceTrainingPage")
);
const MigrationToolsPage = lazy(() => import("./pages/MigrationToolsPage"));
const AuditLogViewerPage = lazy(() => import("./pages/AuditLogViewerPage"));
const TransactionCsvExport = lazy(() => import("./pages/TransactionCsvExport"));
const TransactionMapLoading = lazy(
  () => import("./pages/TransactionMapLoading")
);
const NlFinancialQuery = lazy(() => import("./pages/NlFinancialQuery"));
const WhiteLabelOnboarding = lazy(() => import("./pages/WhiteLabelOnboarding"));
const WhiteLabelBranding = lazy(() => import("./pages/WhiteLabelBranding"));
const WhiteLabelApproval = lazy(() => import("./pages/WhiteLabelApproval"));
const PartnerSelfService = lazy(() => import("./pages/PartnerSelfService"));
const TransactionExportEngine = lazy(
  () => import("./pages/TransactionExportEngine")
);
const AdvancedLoadingStates = lazy(
  () => import("./pages/AdvancedLoadingStates")
);
const FinancialNlEngine = lazy(() => import("./pages/FinancialNlEngine"));
const PartnerRevenueSharing = lazy(
  () => import("./pages/PartnerRevenueSharing")
);
const AgentGamification = lazy(() => import("./pages/AgentGamification"));
const BulkTransactionProcessing = lazy(
  () => import("./pages/BulkTransactionProcessing")
);
const Customer360View = lazy(() => import("./pages/Customer360View"));
const WebhookMgmtConsole = lazy(() => import("./pages/WebhookMgmtConsole"));
const PlatformFeatureFlags = lazy(() => import("./pages/PlatformFeatureFlags"));
const SlaMonitoringDash = lazy(() => import("./pages/SlaMonitoringDash"));
const DataRetentionPolicy = lazy(() => import("./pages/DataRetentionPolicy"));
const PlatformChangelogPage = lazy(
  () => import("./pages/PlatformChangelogPage")
);
const AdvancedSearchFiltering = lazy(
  () => import("./pages/AdvancedSearchFiltering")
);
const E2ETestFramework = lazy(() => import("./pages/E2ETestFramework"));
const DbSchemaPush = lazy(() => import("./pages/DbSchemaPush"));
const AgentCommissionCalc = lazy(() => import("./pages/AgentCommissionCalc"));
const MccManager = lazy(() => import("./pages/MccManager"));
const SettlementBatchProcessor = lazy(
  () => import("./pages/SettlementBatchProcessor")
);
const CardBinLookup = lazy(() => import("./pages/CardBinLookup"));
const TransactionVelocityMonitor = lazy(
  () => import("./pages/TransactionVelocityMonitor")
);
const InsuranceMerchantRiskScoring = lazy(() => import("./pages/InsuranceMerchantRiskScoring"));
const PaymentGatewayRouter = lazy(() => import("./pages/PaymentGatewayRouter"));
const AgentFloatForecasting = lazy(
  () => import("./pages/AgentFloatForecasting")
);
const MultiTenantIsolation = lazy(() => import("./pages/MultiTenantIsolation"));
const PlatformHealthDash = lazy(() => import("./pages/PlatformHealthDash"));
const AutomatedComplianceChecker = lazy(
  () => import("./pages/AutomatedComplianceChecker")
);
const TransactionFeeCalc = lazy(() => import("./pages/TransactionFeeCalc"));
const AgentNetworkTopology = lazy(() => import("./pages/AgentNetworkTopology"));
const CustomerDisputePortal = lazy(
  () => import("./pages/CustomerDisputePortal")
);
const RevenueLeakageDetector = lazy(
  () => import("./pages/RevenueLeakageDetector")
);
const ApiRateLimiterDash = lazy(() => import("./pages/ApiRateLimiterDash"));
const OperationalRunbook = lazy(() => import("./pages/OperationalRunbook"));
const PlatformMetricsExporter = lazy(
  () => import("./pages/PlatformMetricsExporter")
);
const RealtimeWebSocketFeeds = lazy(
  () => import("./pages/RealtimeWebSocketFeeds")
);
const InsuranceMerchantOnboarding = lazy(
  () => import("./pages/InsuranceMerchantOnboarding")
);
const PaymentLinkGenerator = lazy(() => import("./pages/PaymentLinkGenerator"));
const DisputeMediationAI = lazy(() => import("./pages/DisputeMediationAI"));
const AgentPerformanceLeaderboard = lazy(
  () => import("./pages/AgentPerformanceLeaderboard")
);
const AutomatedSettlementScheduler = lazy(
  () => import("./pages/AutomatedSettlementScheduler")
);
const CustomerWalletSystem = lazy(() => import("./pages/CustomerWalletSystem"));
const InsuranceMerchantAnalytics = lazy(
  () => import("./pages/InsuranceMerchantAnalytics")
);
const POSServiceUpdate = lazy(() => import("./pages/POSServiceUpdate"));
const TransactionReceiptGenerator = lazy(
  () => import("./pages/TransactionReceiptGenerator")
);
const AgentLoanAdvance = lazy(() => import("./pages/AgentLoanAdvance"));
const MultiChannelPaymentOrch = lazy(
  () => import("./pages/MultiChannelPaymentOrch")
);
const RegulatoryFilingAutomation = lazy(
  () => import("./pages/RegulatoryFilingAutomation")
);
const CustomerSegmentationEngine = lazy(
  () => import("./pages/CustomerSegmentationEngine")
);
const IncidentCommandCenter = lazy(
  () => import("./pages/IncidentCommandCenter")
);
const PlatformABTesting = lazy(() => import("./pages/PlatformABTesting"));
const TransactionEnrichmentService = lazy(
  () => import("./pages/TransactionEnrichmentService")
);
const AgentInventoryMgmt = lazy(() => import("./pages/AgentInventoryMgmt"));
const RevenueForecastingEngine = lazy(
  () => import("./pages/RevenueForecastingEngine")
);
const PlatformRecommendations = lazy(
  () => import("./pages/PlatformRecommendations")
);
const PublishReadinessChecker = lazy(
  () => import("./pages/PublishReadinessChecker")
);
const DbSchemaMigrationManager = lazy(
  () => import("./pages/DbSchemaMigrationManager")
);
const GraphqlSubscriptionGateway = lazy(
  () => import("./pages/GraphqlSubscriptionGateway")
);
const OfflinePosMode = lazy(() => import("./pages/OfflinePosMode"));
const AiCashFlowPredictor = lazy(() => import("./pages/AiCashFlowPredictor"));
const BlockchainAuditTrail = lazy(() => import("./pages/BlockchainAuditTrail"));
const VoiceCommandPos = lazy(() => import("./pages/VoiceCommandPos"));
const SocialCommerceGateway = lazy(
  () => import("./pages/SocialCommerceGateway")
);
const EsgCarbonTracker = lazy(() => import("./pages/EsgCarbonTracker"));
const DistributedTracingDash = lazy(
  () => import("./pages/DistributedTracingDash")
);
const CanaryReleaseManager = lazy(() => import("./pages/CanaryReleaseManager"));
const ChaosEngineeringConsole = lazy(
  () => import("./pages/ChaosEngineeringConsole")
);
const ConnectionPoolMonitor = lazy(
  () => import("./pages/ConnectionPoolMonitor")
);
const CdnCacheManager = lazy(() => import("./pages/CdnCacheManager"));
const CqrsEventStore = lazy(() => import("./pages/CqrsEventStore"));
const DigitalTwinSimulator = lazy(() => import("./pages/DigitalTwinSimulator"));
const CbdcIntegrationGateway = lazy(
  () => import("./pages/CbdcIntegrationGateway")
);
const DecentralizedIdentityManager = lazy(
  () => import("./pages/DecentralizedIdentityManager")
);
const PlatformMaturityScorecard = lazy(
  () => import("./pages/PlatformMaturityScorecard")
);
const SmartContractPayment = lazy(() => import("./pages/SmartContractPayment"));
const PredictiveAgentChurn = lazy(() => import("./pages/PredictiveAgentChurn"));
const CurrencyHedging = lazy(() => import("./pages/CurrencyHedging"));
const AgentClusterAnalytics = lazy(
  () => import("./pages/AgentClusterAnalytics")
);
const AutoComplianceWorkflow = lazy(
  () => import("./pages/AutoComplianceWorkflow")
);
const PaymentTokenVault = lazy(() => import("./pages/PaymentTokenVault"));
const DynamicQrPayment = lazy(() => import("./pages/DynamicQrPayment"));
const AgentRevenueAttribution = lazy(
  () => import("./pages/AgentRevenueAttribution")
);
const PlatformCostAllocator = lazy(
  () => import("./pages/PlatformCostAllocator")
);
const IntelligentRoutingEngine = lazy(
  () => import("./pages/IntelligentRoutingEngine")
);
const RegulatorySandboxTester = lazy(
  () => import("./pages/RegulatorySandboxTester")
);
const AgentDeviceFingerprint = lazy(
  () => import("./pages/AgentDeviceFingerprint")
);
const SettlementNettingEngine = lazy(
  () => import("./pages/SettlementNettingEngine")
);
const PlatformCapacityPlanner = lazy(
  () => import("./pages/PlatformCapacityPlanner")
);
const InsurancePremiumAcquirerGateway = lazy(
  () => import("./pages/InsurancePremiumAcquirerGateway")
);
const AgentMicroInsurance = lazy(() => import("./pages/AgentMicroInsurance"));
const TransactionGraphAnalyzer = lazy(
  () => import("./pages/TransactionGraphAnalyzer")
);
const PlatformRevenueOptimizer = lazy(
  () => import("./pages/PlatformRevenueOptimizer")
);
const OperationalCommandBridge = lazy(
  () => import("./pages/OperationalCommandBridge")
);
const AgentKycDocVault = lazy(() => import("./pages/AgentKycDocVault"));
const RealtimePnlDashboard = lazy(() => import("./pages/RealtimePnlDashboard"));
const AutoReconciliationEngine = lazy(
  () => import("./pages/AutoReconciliationEngine")
);
const AgentTerritoryOptimizer = lazy(
  () => import("./pages/AgentTerritoryOptimizer")
);
const RegulatoryReportGenerator = lazy(
  () => import("./pages/RegulatoryReportGenerator")
);
const AgentTrainingAcademy = lazy(() => import("./pages/AgentTrainingAcademy"));
const DynamicFeeCalculator = lazy(() => import("./pages/DynamicFeeCalculator"));
const CustomerOnboardingPipeline = lazy(
  () => import("./pages/CustomerOnboardingPipeline")
);
const InsuranceMerchantSettlementDash = lazy(
  () => import("./pages/InsuranceMerchantSettlementDash")
);
const AgentFloatInsuranceClaims = lazy(
  () => import("./pages/AgentFloatInsuranceClaims")
);
const PlatformSlaMonitor = lazy(() => import("./pages/PlatformSlaMonitor"));
const BulkDisbursementEngine = lazy(
  () => import("./pages/BulkDisbursementEngine")
);
const TransactionReversalManager = lazy(
  () => import("./pages/TransactionReversalManager")
);
const AgentLoanOrigination = lazy(() => import("./pages/AgentLoanOrigination"));
const MultiChannelNotificationHub = lazy(
  () => import("./pages/MultiChannelNotificationHub")
);
const PlatformMigrationToolkit = lazy(
  () => import("./pages/PlatformMigrationToolkit")
);
const AgentPerformanceIncentives = lazy(
  () => import("./pages/AgentPerformanceIncentives")
);
const ExecutiveCommandCenter = lazy(
  () => import("./pages/ExecutiveCommandCenter")
);
const DisputeNotifications = lazy(() => import("./pages/DisputeNotifications"));
const DisputeAnalyticsDashboard = lazy(
  () => import("./pages/DisputeAnalyticsDashboard")
);
const AgentBenchmarking = lazy(() => import("./pages/AgentBenchmarking"));
const TxVelocityMonitor = lazy(() => import("./pages/TxVelocityMonitor"));
const CustomerSurveys = lazy(() => import("./pages/CustomerSurveys"));
const AgentTerritoryHeatmap = lazy(
  () => import("./pages/AgentTerritoryHeatmap")
);
const ReportScheduler = lazy(() => import("./pages/ReportScheduler"));
const GatewayHealthMonitor = lazy(() => import("./pages/GatewayHealthMonitor"));
const AgentLoanOriginationV2 = lazy(
  () => import("./pages/AgentLoanOriginationV2")
);
const MfaManager = lazy(() => import("./pages/MfaManager"));
const IncidentPlaybook = lazy(() => import("./pages/IncidentPlaybook"));
const DeviceFleetManager = lazy(() => import("./pages/DeviceFleetManager"));
const CustomerJourneyMapper = lazy(
  () => import("./pages/CustomerJourneyMapper")
);
const ComplianceCertManager = lazy(
  () => import("./pages/ComplianceCertManager")
);
const PlatformHealthScorecard = lazy(
  () => import("./pages/PlatformHealthScorecard")
);
const TrainingCertification = lazy(
  () => import("./pages/TrainingCertification")
);
const BulkTransactionProcessor = lazy(
  () => import("./pages/BulkTransactionProcessor")
);
const RealtimeTxMonitorPage = lazy(
  () => import("./pages/RealtimeTxMonitorPage")
);
const FraudMlScoringPage = lazy(() => import("./pages/FraudMlScoringPage"));
const NotificationOrchestratorPage = lazy(
  () => import("./pages/NotificationOrchestratorPage")
);
const AgentLoanFacilityPage = lazy(
  () => import("./pages/AgentLoanFacilityPage")
);
const DynamicFeeEnginePage = lazy(() => import("./pages/DynamicFeeEnginePage"));
const InsuranceMerchantKycOnboarding = lazy(
  () => import("./pages/InsuranceMerchantKycOnboarding")
);
const InsuranceMerchantPayoutSettlement = lazy(
  () => import("./pages/InsuranceMerchantPayoutSettlement")
);
const ComplianceFilingPage = lazy(() => import("./pages/ComplianceFilingPage"));
const TenantFeatureTogglePage = lazy(
  () => import("./pages/TenantFeatureTogglePage")
);
const ReconciliationEnginePage = lazy(
  () => import("./pages/ReconciliationEnginePage")
);
const CustomerJourneyAnalyticsPage = lazy(
  () => import("./pages/CustomerJourneyAnalyticsPage")
);
const BackupDisasterRecoveryPage = lazy(
  () => import("./pages/BackupDisasterRecoveryPage")
);
const WorkflowEnginePage = lazy(() => import("./pages/WorkflowEnginePage"));
const GeneralLedgerPage = lazy(() => import("./pages/GeneralLedgerPage"));
const DataExportHubPage = lazy(() => import("./pages/DataExportHubPage"));
const SlaMonitoringPage = lazy(() => import("./pages/SlaMonitoringPage"));
const RateLimitEnginePage = lazy(() => import("./pages/RateLimitEnginePage"));
const AgentGamificationPage = lazy(
  () => import("./pages/AgentGamificationPage")
);
const ExecutiveCommandCenterPage = lazy(
  () => import("./pages/ExecutiveCommandCenterPage")
);
const ActivityAuditLogPage = lazy(() => import("./pages/ActivityAuditLogPage"));
const SystemSettingsPage = lazy(() => import("./pages/SystemSettingsPage"));
const AgentPerformanceLeaderboardPage = lazy(
  () => import("./pages/AgentPerformanceLeaderboardPage")
);
const FloatManagementPage = lazy(() => import("./pages/FloatManagementPage"));
const ArchivalAdmin = lazy(() => import("./pages/ArchivalAdmin"));
const LoadTestDashboard = lazy(() => import("./pages/LoadTestDashboard"));
const LoadTestComparison = lazy(() => import("./pages/LoadTestComparison"));
const AdminSupportInbox = lazy(() => import("./pages/AdminSupportInbox"));
const NetworkStatusDashboard = lazy(
  () => import("./pages/NetworkStatusDashboard")
);
const SecurityAuditDashboard = lazy(
  () => import("./pages/SecurityAuditDashboard")
);
const CarrierCostDashboard = lazy(() => import("./pages/CarrierCostDashboard"));
const CarrierSlaDashboard = lazy(() => import("./pages/CarrierSlaDashboard"));
const UssdAnalyticsDashboard = lazy(
  () => import("./pages/UssdAnalyticsDashboard")
);
const UssdLocalizationPage = lazy(() => import("./pages/UssdLocalizationPage"));
const NetworkDiagnosticPage = lazy(
  () => import("./pages/NetworkDiagnosticPage")
);
const ConnectionQualityPage = lazy(
  () => import("./pages/ConnectionQualityPage")
);
const UssdSessionReplayPage = lazy(
  () => import("./pages/UssdSessionReplayPage")
);
const AgentKycPage = lazy(() => import("./pages/AgentKycPage"));
const TxMonitorPage = lazy(() => import("./pages/TxMonitorPage"));
const CommissionCalculatorPage = lazy(
  () => import("./pages/CommissionCalculatorPage")
);
const CarrierLivePricingPage = lazy(
  () => import("./pages/CarrierLivePricingPage")
);
const AgentGeoFencingPage = lazy(() => import("./pages/AgentGeoFencingPage"));
const AgentOnboardingWorkflowPage = lazy(
  () => import("./pages/AgentOnboardingWorkflowPage")
);
const AuditExportPage = lazy(() => import("./pages/AuditExportPage"));
const AuditTrailExportPage = lazy(() => import("./pages/AuditTrailExportPage"));
const DailyPnlReportPage = lazy(() => import("./pages/DailyPnlReportPage"));
const TransactionDisputeResolutionPage = lazy(
  () => import("./pages/TransactionDisputeResolutionPage")
);
const TransactionReversalWorkflowPage = lazy(
  () => import("./pages/TransactionReversalWorkflowPage")
);
const BillingDashboardPage = lazy(() => import("./pages/BillingDashboardPage"));
const RealTimeDashboard = lazy(() => import("./pages/RealTimeDashboard"));
const InvoiceManagementPage = lazy(
  () => import("./pages/InvoiceManagementPage")
);
const TenantBillingOnboardingPage = lazy(
  () => import("./pages/TenantBillingOnboardingPage")
);
const TenantBillingPortalPage = lazy(
  () => import("./pages/TenantBillingPortalPage")
);
const BillingAnalyticsDashboardPage = lazy(
  () => import("./pages/BillingAnalyticsDashboardPage")
);

// Sprint 98: Missing page lazy imports
const AgentPerformanceScorecardPage = lazy(() => import("./pages/AgentPerformanceScorecardPage"));
const AgentTrainingPortal = lazy(() => import("./pages/AgentTrainingPortal"));
const BiometricAuthGateway = lazy(() => import("./pages/BiometricAuthGateway"));
const ComplianceTrainingTracker = lazy(() => import("./pages/ComplianceTrainingTracker"));
const ComponentShowcase = lazy(() => import("./pages/ComponentShowcase"));
const CrossBorderRemittanceHub = lazy(() => import("./pages/CrossBorderRemittanceHub"));
const InsurancePolicyCheckout = lazy(() => import("./pages/InsurancePolicyCheckout"));
const InsuranceInsuranceAgentMerchantPortal = lazy(() => import("./pages/InsuranceInsuranceAgentMerchantPortal"));
const InsurancePolicyOrderManagement = lazy(() => import("./pages/InsurancePolicyOrderManagement"));
const InsuranceProductCatalog = lazy(() => import("./pages/InsuranceProductCatalog"));
const Home = lazy(() => import("./pages/Home"));
const NotFound = lazy(() => import("./pages/NotFound"));
const POSFirmwareOTA = lazy(() => import("./pages/POSFirmwareOTA"));
const PaymentDisputeArbitration = lazy(() => import("./pages/PaymentDisputeArbitration"));
const PlatformHealthMonitor = lazy(() => import("./pages/PlatformHealthMonitor"));
const RemittancePage = lazy(() => import("./pages/RemittancePage"));
const TerminalFleetPage = lazy(() => import("./pages/TerminalFleetPage"));

// ─── Auth guard wrapper ───────────────────────────────────────────────────────
// Admin dashboard paths bypass POS agent login — they use DashboardLayout's own
// Keycloak/OAuth auth instead. Any route that wraps its page in <DashboardLayout>
// should be listed here so agents don't need a PIN to reach the admin panel.
const ADMIN_DASHBOARD_PREFIXES = [
  "/agent-float",
  "/settlement-batch",
  "/transaction-map",
  "/report-builder",
  "/nl-analytics",
  "/banking-workflow",
  "/agent-onboarding-wizard",
  "/transaction-reconciliation",
  "/chargeback-management",
  "/regulatory-reporting",
  "/agent-territory",
  "/dynamic-pricing",
  "/customer-loyalty",
  "/fraud-case",
  "/insurance-service-fleet",
  "/financial-reconciliation",
  "/api-analytics",
  "/agent-communication",
  "/tx-dispute",
  "/compliance-training",
  "/system-migration",
  "/advanced-audit",
  "/agent-scorecard",
  "/dispute-resolution",
  "/graphql-federation",
  "/api-versioning",
  "/rate-limiting",
  "/realtime-dashboard",
  "/regulatory-sandbox",
  "/multi-currency",
  "/document-management",
  "/agent-training",
  "/revenue-analytics",
  "/platform-health",
  "/batch-processing",
  "/integration-marketplace",
  "/mobile-api",
  "/automated-testing",
  "/notification-center",
  "/report-builder-drag",
  "/partner-onboarding",
  "/partner-data",
  "/partner-approval",
  "/partner-branding",
  "/partner-self-service",
  "/transaction-export",
  "/financial-nl",
  "/partner-revenue",
  "/agent-gamification",
  "/bulk-transaction",
  "/customer-360",
  "/webhook-mgmt",
  "/feature-flags",
  "/sla-monitoring",
  "/data-retention",
  "/platform-changelog",
  "/advanced-search",
  "/e2e-test",
  "/db-schema",
  "/graphql-subscription",
  "/offline-pos",
  "/biometric-auth",
  "/ai-cash-flow",
  "/blockchain-audit",
  "/voice-command",
  "/social-commerce",
  "/esg-carbon",
  "/distributed-tracing",
  "/canary-release",
  "/chaos-engineering",
  "/connection-pool",
  "/cdn-cache",
  "/cqrs-event",
  "/digital-twin",
  "/cbdc-integration",
  "/decentralized-identity",
  "/platform-maturity",
  "/smart-contract-payment",
  "/predictive-agent-churn",
  "/currency-hedging",
  "/agent-cluster-analytics",
  "/auto-compliance-workflow",
  "/payment-token-vault",
  "/dynamic-qr-payment",
  "/agent-revenue-attribution",
  "/platform-cost-allocator",
  "/intelligent-routing",
  "/regulatory-sandbox-tester",
  "/agent-device-fingerprint",
  "/settlement-netting",
  "/capacity-planner",
  "/merchant-acquirer",
  "/agent-micro-insurance",
  "/transaction-graph",
  "/revenue-optimizer",
  "/cross-border-remittance",
  "/operational-command-bridge",
  "/agent-kyc-vault",
  "/realtime-pnl",
  "/auto-reconciliation",
  "/territory-optimizer",
  "/dispute-arbitration",
  "/regulatory-reports",
  "/training-academy",
  "/fee-calculator",
  "/customer-onboarding",
  "/merchant-settlement",
  "/insurance-claims",
  "/sla-monitor",
  "/bulk-disbursement",
  "/reversal-manager",
  "/loan-origination",
  "/notification-hub",
  "/compliance-training",
  "/migration-toolkit",
  "/performance-incentives",
  "/executive-command",
  "/realtime-websocket",
  "/merchant-onboarding",
  "/payment-link",
  "/dispute-mediation",
  "/agent-leaderboard",
  "/settlement-scheduler",
  "/customer-wallet",
  "/merchant-analytics",
  "/pos-firmware",
  "/transaction-receipt",
  "/agent-loan",
  "/payment-orchestrator",
  "/regulatory-filing",
  "/customer-segmentation",
  "/incident-command",
  "/ab-testing",
  "/transaction-enrichment",
  "/agent-inventory",
  "/revenue-forecasting",
  "/platform-recommendations",
  "/agent-commission",
  "/mcc-manager",
  "/card-bin",
  "/transaction-velocity",
  "/merchant-risk",
  "/payment-gateway-router",
  "/multi-tenant",
  "/compliance-checker",
  "/fee-calculator",
  "/agent-network",
  "/customer-dispute-portal",
  "/revenue-leakage",
  "/api-rate-limiter",
  "/operational-runbook",
  "/metrics-exporter",
  "/management",
  "/super-admin",
  "/merchant",
  "/developer",
  "/infrastructure",
  "/system-health",
  "/lakehouse",
  "/webhooks",
  "/commission-payouts",
  "/settlement-reconciliation",
  "/referral-program",
  "/admin",
  "/loyalty",
  "/live-chat",
  "/privacy",
  "/dispute-auto-rules",
  // Sprint 42
  "/dispute-notifications",
  "/dispute-analytics-dashboard",
  "/agent-benchmarking",
  "/tx-velocity-monitor",
  "/customer-surveys",
  "/agent-territory-heatmap",
  "/report-scheduler",
  "/gateway-health-monitor",
  "/agent-loan-origination-v2",
  "/mfa-manager",
  "/data-retention-policy",
  "/incident-playbook",
  "/device-fleet-manager",
  "/revenue-leakage-detector",
  "/customer-journey-mapper",
  "/compliance-cert-manager",
  "/platform-health-scorecard",
  "/training-certification",
  "/bulk-transaction-processor",
  "/system-config-manager",
  // Sprint 51: Production-grade feature routes
  "/realtime-tx-monitor",
  "/fraud-ml-scoring",
  "/notification-orchestrator",
  "/agent-loan-facility",
  "/dynamic-fee-engine",
  "/merchant-kyc-onboarding",
  "/merchant-payout-settlement",
  "/compliance-filing",
  "/tenant-feature-toggle",
  "/reconciliation-engine",
  "/customer-journey-analytics",
  "/backup-disaster-recovery",
  "/workflow-engine",
  "/general-ledger",
  "/data-export-hub",
  "/sla-monitoring-v2",
  "/rate-limit-engine",
  "/agent-gamification-v2",
  // Sprint 48-49: Commission, hierarchy, and remaining dashboard routes
  "/commission-engine",
  "/agent-hierarchy",
  "/commission-clawback",
  "/commission-config",
  "/pnl-reports",
  "/reversal-approval",
  "/audit-export",
  "/geo-fencing",
  "/bank-accounts",
  "/float-reconciliation",
  "/agent-performance-scoring",
  "/customer-database",
  "/transaction-limits",
  "/regulatory-compliance",
  "/agent-suspension",
  "/kyc-documents",
  "/agent-onboarding",
  // Additional dashboard routes
  "/account-opening",
  "/advanced-bi-reporting",
  "/advanced-loading-states",
  "/advanced-notifications",
  "/advanced-rate-limiter",
  "/agent-management",
  "/agent-performance",
  "/agent-performance-analytics",
  "/agent-performance-leaderboard",
  "/agent-hierarchy-territory",
  "/ai-monitoring",
  "/airtime-vending",
  "/announcement-reactions",
  "/apache-airflow",
  "/apache-nifi",
  "/api-docs",
  "/api-gateway",
  "/api-key-management",
  "/api-keys",
  "/art-robustness",
  "/audit-log-viewer",
  "/audit-trail",
  "/automated-compliance-checker",
  "/automated-settlement-scheduler",
  "/backup-dr",
  "/batch-operations",
  "/bill-payments",
  "/broadcast-manager",
  "/bulk-notifications",
  "/bulk-operations",
  "/bulk-payments",
  "/business-rules",
  "/cache-management",
  "/capacity-planning",
  "/card-requests",
  "/cbdc-gateway",
  "/cbn-reporting",
  "/changelog",
  "/cocoindex-pipeline",
  "/compliance-automation",
  "/compliance-chatbot",
  "/compliance-reporting",
  "/compliance-scheduling",
  "/config-management",
  "/customer-feedback",
  "/dashboard-widgets",
  "/data-export",
  "/data-export-import",
  "/data-quality",
  "/database-visualization",
  "/dbt-integration",
  "/did-manager",
  "/dispute-workflow",
  "/endpoint-rate-limits",
  "/escalation-chains",
  "/event-driven-arch",
  "/falkordb-graph",
  "/feedback-analytics",
  "/financial-reporting",
  "/fraud-realtime-viz",
  "/fraud-reports",
  "/gdpr",
  "/geofence-editor",
  "/global-search",
  "/help-desk",
  "/incident-management",
  "/insurance-products",
  "/kyc-verification",
  "/kyc-workflow",
  "/loan-disbursement",
  "/maturity-scorecard",
  "/middleware-manager",
  "/migration-tools",
  "/ml-scoring",
  "/mobile-money",
  "/mqtt-bridge",
  "/multi-channel-payment-orch",
  "/multi-tenancy",
  "/nl-financial-query",
  "/notification-analytics",
  "/notification-inbox",
  "/notification-preference-matrix",
  "/notification-preferences",
  "/notification-settings",
  "/notification-templates",
  "/offline-sync",
  "/ollama-llm",
  "/onboarding-wizard",
  "/open-telemetry",
  "/partner/onboard",
  "/payment-notifications",
  "/payment-reconciliation",
  "/payments",
  "/pension-collection",
  "/performance-profiler",
  "/pipeline-monitoring",
  "/platform-ab-testing",
  "/platform-analytics",
  "/platform-config",
  "/platform-feature-flags",
  "/platform-metrics-exporter",
  "/production-readiness",
  "/publish-readiness",
  "/push-notifications",
  "/qdrant-vector-search",
  "/quiet-hours",
  "/rate-alerts",
  "/rate-limit-dashboard",
  "/realtime-notifications",
  "/remittance",
  "/report-comparison",
  "/report-designer",
  "/resilience",
  "/retry-queue",
  "/savings-products",
  "/scheduled-email-delivery",
  "/scheduled-reports",
  "/security-dashboard",
  "/service-health",
  "/service-mesh",
  "/session-manager",
  "/shared-layouts",
  "/sim-orchestrator",
  "/skill-creator",
  "/sla-management",
  "/system-config",
  "/system-status",
  "/tax-collection",
  "/temporal",
  "/terminal-fleet",
  "/territory-management",
  "/threshold-alerts",
  "/threshold-manager",
  "/tigerbeetle",
  "/transaction-csv-export",
  "/transaction-fee-calc",
  "/user-guide",
  "/ussd-gateway",
  "/vault",
  "/video-tutorials",
  "/webhook-config",
  "/webhook-deliveries",
  "/webhook-delivery",
  "/webhook-delivery-monitor",
  "/webhook-management",
  "/websocket-service",
  "/weekly-reports",
  "/whatsapp-channel",
  "/white-label-approval",
  "/white-label-branding",
  "/white-label-onboarding",
  "/workflow-automation",
  "/hub",
  "/supervisor",
  "/agent",
  "/customer",
  "/admin-support-inbox",
  "/network-status",
  // Sprint 77
  "/carrier-costs",
  "/carrier-sla",
  "/ussd-analytics",
  "/ussd-localization",
  "/network-diagnostic",
  "/connection-quality",
  "/agent-geo-fencing",
  "/agent-onboarding-workflow",
  "/audit-export-page",
  "/audit-trail-export",
  "/daily-pnl-report",
  "/tx-dispute-resolution",
  "/tx-reversal-workflow",
  "/security-audit",
];
function isAdminDashboardPath(path: string): boolean {
  return ADMIN_DASHBOARD_PREFIXES.some(prefix => path.startsWith(prefix));
}

function AuthenticatedApp() {
  const isLoggedIn = usePosStore(s => s.isLoggedIn);
  const agentId = usePosStore(s => s.agent?.agentId);
  const [location] = useLocation();
  // Always mount terminal socket (tracks online status + receives fraud alerts)
  useTerminalSocket(agentId);
  // Sync offline queue when back online
  useOfflineSync();

  // Admin dashboard routes bypass POS agent login — DashboardLayout handles its own auth
  if (!isLoggedIn && !isAdminDashboardPath(location)) {
    return <AgentLogin />;
  }

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
        </div>
      }
    >
      <Switch>
        {/* Core POS routes */}
        <Route path="/hub" component={PlatformHub} />
        <Route path="/" component={InsurancePortal} />
        <Route path="/admin/fraud" component={FraudDashboard} />
        <Route path="/admin/analytics" component={AnalyticsDashboard} />
        <Route path="/admin" component={AdminPanel} />
        <Route path="/supervisor" component={SupervisorDashboard} />
        {/* Platform portal routes */}
        <Route path="/management" component={ManagementPortal} />
        <Route path="/management/:section" component={ManagementPortal} />
        <Route path="/agent" component={AgentPortal} />
        <Route path="/customer" component={CustomerPortal} />
        <Route path="/super-admin" component={SuperAdminPortal} />
        <Route path="/super-admin/:section" component={SuperAdminPortal} />
        {/* Merchant & Developer portals */}
        <Route path="/merchant" component={InsuranceAgentMerchantPortal} />
        <Route path="/merchant/:section" component={InsuranceAgentMerchantPortal} />
        <Route path="/developer" component={DeveloperPortal} />
        <Route path="/developer/:section" component={DeveloperPortal} />
        {/* Legal */}
        <Route path="/privacy" component={PrivacyPolicy} />
        {/* Infrastructure monitoring */}
        <Route path="/system-health" component={SystemHealth} />
        <Route
          path="/system-health-monitor"
          component={SystemHealthDashboard}
        />
        {/* Data Lakehouse Analytics */}
        <Route path="/lakehouse" component={LakehouseAnalytics} />
        {/* Operations & Finance */}
        <Route path="/webhooks" component={WebhookManager} />
        <Route path="/commission-payouts" component={CommissionPayouts} />
        <Route path="/agent-onboarding" component={AgentOnboarding} />
        <Route
          path="/settlement-reconciliation"
          component={SettlementReconciliation}
        />
        <Route path="/referral-program" component={ReferralProgram} />
        {/* Audit & Compliance */}
        <Route path="/admin/audit" component={AuditLogViewer} />
        {/* Infrastructure: TigerBeetle, Kafka, Temporal, Vault */}
        <Route path="/infrastructure" component={InfrastructureDashboard} />
        {/* Loyalty & Live Chat */}
        <Route path="/loyalty">{() => <LoyaltySystem />}</Route>
        <Route path="/live-chat">{() => <LiveChatSupport />}</Route>
        {/* Agent Performance, Wallet, Notifications, Multi-Currency */}
        <Route path="/agent-performance" component={AgentPerformance} />
        <Route path="/customer-wallet" component={CustomerWallet} />
        <Route
          path="/notification-preferences"
          component={NotificationPreferences}
        />
        <Route path="/multi-currency" component={MultiCurrency} />
        {/* Compliance, Audit Export, Webhook Delivery, Geofence Editor */}
        <Route path="/compliance-scheduling" component={ComplianceScheduling} />
        <Route path="/audit-export" component={AuditExport} />
        <Route path="/webhook-deliveries" component={WebhookDeliveryViewer} />
        <Route path="/geofence-editor" component={GeofenceZoneEditor} />
        {/* API Keys, KYC, Onboarding, Commission */}
        <Route path="/api-keys" component={ApiKeyManagement} />
        <Route path="/kyc-workflow" component={KycWorkflow} />
        <Route path="/onboarding-wizard" component={OnboardingWizard} />
        <Route path="/commission-config" component={CommissionConfig} />
        {/* Rate Alert Subscriptions */}
        <Route path="/rate-alerts" component={RateAlerts} />
        <Route path="/notification-inbox" component={NotificationInbox} />
        <Route
          path="/notification-preference-matrix"
          component={NotificationPreferenceMatrix}
        />
        <Route path="/webhook-config" component={WebhookConfig} />
        <Route path="/batch-operations" component={BatchOperations} />
        {/* Platform Analytics Dashboard */}
        <Route path="/platform-analytics" component={AdminAnalyticsDashboard} />
        {/* Broadcast, Scheduled Reports, User Notification Settings */}
        <Route path="/broadcast-manager" component={BroadcastManager} />
        <Route path="/scheduled-reports" component={ScheduledReports} />
        <Route path="/notification-settings" component={UserNotifSettings} />
        {/* Data Threshold Alerts, Shared Layouts, Report Template Designer */}
        <Route path="/threshold-alerts" component={DataThresholdAlerts} />
        <Route path="/shared-layouts" component={SharedLayoutGallery} />
        <Route path="/report-designer" component={ReportTemplateDesigner} />
        {/* Sprint 16: Multi-Tenant White-Label */}
        <Route path="/partner/onboard" component={PartnerOnboarding} />
        <Route path="/admin/tenant" component={TenantAdminDashboard} />
        <Route path="/admin/invite-codes" component={InviteCodeManager} />
        {/* Sprint 15 routes */}
        <Route path="/escalation-chains" component={EscalationChains} />
        <Route
          path="/notification-analytics"
          component={NotificationAnalytics}
        />
        <Route path="/quiet-hours" component={UserQuietHours} />
        <Route
          path="/notification-templates"
          component={NotificationTemplateManager}
        />
        <Route path="/system-config" component={SystemConfigManager} />
        <Route path="/session-manager" component={SessionManager} />
        <Route path="/data-export" component={DataExportCenter} />
        <Route path="/changelog" component={PlatformChangelog} />
        <Route path="/bulk-notifications" component={BulkNotifSender} />
        <Route path="/retry-queue" component={RetryQueueViewer} />
        <Route path="/rate-limit-dashboard" component={RateLimitDashboard} />
        <Route path="/service-health" component={ServiceHealthAggregator} />
        <Route path="/cache-management" component={CacheManagement} />
        {/* Sprint 19: Full CRUD pages for all routers */}
        <Route path="/gdpr" component={GdprDashboard} />
        <Route path="/cbn-reporting" component={CbnReportingDashboard} />
        <Route path="/tigerbeetle" component={TigerBeetleLedger} />
        <Route path="/temporal" component={TemporalWorkflowMonitor} />
        <Route path="/vault" component={VaultSecretsManager} />
        <Route path="/resilience" component={ResilienceMonitor} />
        <Route path="/sim-orchestrator" component={SimOrchestratorDashboard} />
        <Route path="/mqtt-bridge" component={MqttBridgeDashboard} />
        <Route path="/push-notifications" component={PushNotificationConfig} />
        <Route path="/agent-management" component={AgentManagementDashboard} />
        <Route path="/business-rules" component={BusinessRulesDashboard} />
        <Route
          path="/announcement-reactions"
          component={AnnouncementReactions}
        />
        <Route path="/weekly-reports" component={WeeklyReports} />
        {/* Sprint 23: Final Production Features */}
        <Route path="/report-comparison" component={ReportComparison} />
        <Route path="/threshold-manager" component={ThresholdManager} />
        <Route path="/endpoint-rate-limits" component={EndpointRateLimits} />
        <Route
          path="/webhook-delivery-monitor"
          component={WebhookDeliveryMonitor}
        />
        <Route
          path="/agent-performance-scoring"
          component={AgentPerformanceScoring}
        />
        <Route path="/dispute-auto-rules" component={DisputeAutoRules} />
        <Route path="/kyc-verification" component={KycVerificationWorkflow} />
        <Route
          path="/production-readiness"
          component={ProductionReadinessChecklist}
        />
        <Route
          path="/scheduled-email-delivery"
          component={ScheduledEmailDelivery}
        />
        <Route path="/global-search" component={GlobalSearchPage} />
        {/* Sprint 24: User Guide */}
        <Route path="/user-guide" component={UserGuide} />
        <Route path="/video-tutorials" component={VideoTutorials} />
        <Route path="/payments" component={Payments} />
        <Route path="/payment-success" component={PaymentSuccess} />
        <Route path="/payment-cancel" component={PaymentCancel} />
        <Route path="/feedback-analytics" component={FeedbackAnalytics} />
        {/* Sprint 27: API Docs & System Status */}
        <Route path="/api-docs" component={ApiDocs} />
        <Route path="/system-status" component={SystemStatus} />
        <Route path="/audit-trail" component={AuditTrailPage} />
        {/* Sprint 28: Nigerian Insurance Features */}
        <Route path="/ussd-gateway" component={UssdGateway} />
        <Route path="/mobile-money" component={MobileMoneyPage} />
        <Route path="/agent-hierarchy" component={AgentHierarchyPage} />
        <Route path="/commission-engine" component={CommissionEnginePage} />
        <Route path="/bulk-operations" component={BulkOperationsPage} />
        <Route path="/geo-fencing" component={GeoFencingPage} />
        <Route path="/biometric-auth" component={BiometricAuthPage} />
        <Route path="/offline-sync" component={OfflineSyncPage} />
        <Route path="/whatsapp-channel" component={WhatsAppChannelPage} />
        <Route path="/merchant-payments" component={InsuranceMerchantPayments} />
        <Route path="/bill-payments" component={BillPaymentsPage} />
        <Route path="/airtime-vending" component={AirtimeVendingPage} />
        <Route path="/loan-disbursement" component={LoanDisbursementPage} />
        <Route path="/insurance-products" component={InsuranceProductsPage} />
        <Route path="/savings-products" component={SavingsProductsPage} />
        <Route path="/referral-program-v2" component={ReferralProgramPage} />
        <Route path="/card-requests" component={CardRequestPage} />
        <Route path="/account-opening" component={AccountOpeningPage} />
        <Route path="/tax-collection" component={TaxCollectionPage} />
        <Route path="/pension-collection" component={PensionCollectionPage} />
        {/* Sprint 29: AI/ML/DL/GNN Integrations */}
        <Route
          path="/qdrant-vector-search"
          component={QdrantVectorSearchPage}
        />
        <Route path="/falkordb-graph" component={FalkorDBGraphPage} />
        <Route path="/cocoindex-pipeline" component={CocoIndexPipelinePage} />
        <Route path="/ollama-llm" component={OllamaLLMPage} />
        <Route path="/art-robustness" component={ARTRobustnessPage} />
        <Route path="/lakehouse-ai" component={LakehouseAiDashboard} />
        <Route path="/ml-scoring" component={MLScoringDashboard} />
        {/* Sprint 30: AI/ML Follow-ups */}
        <Route path="/ai-monitoring" component={AIMonitoringDashboard} />
        <Route path="/fraud-reports" component={FraudReportPage} />
        <Route path="/compliance-chatbot" component={ComplianceChatbotPage} />
        {/* Sprint 31: Data Pipelines, Security, Production Features */}
        <Route path="/apache-nifi" component={ApacheNifiPage} />
        <Route path="/dbt-integration" component={DbtIntegrationPage} />
        <Route path="/apache-airflow" component={ApacheAirflowPage} />
        <Route path="/websocket-service" component={WebSocketServicePage} />
        <Route path="/report-scheduler" component={ReportSchedulerPage} />
        <Route path="/event-driven-arch" component={EventDrivenArchPage} />
        <Route
          path="/advanced-notifications"
          component={AdvancedNotificationsPage}
        />
        <Route path="/security-dashboard" component={SecurityDashboardPage} />
        {/* Sprint 32: Production Infrastructure */}
        <Route path="/fraud-realtime-viz" component={FraudRealtimeVizPage} />
        <Route path="/pipeline-monitoring" component={PipelineMonitoringPage} />
        <Route path="/api-gateway" component={ApiGatewayPage} />
        <Route path="/backup-dr" component={BackupDRPage} />
        <Route
          path="/performance-profiler"
          component={PerformanceProfilerPage}
        />
        <Route path="/multi-tenancy" component={MultiTenancyPage} />
        <Route path="/webhook-management" component={WebhookManagementPage} />
        <Route path="/data-export-import" component={DataExportImportPage} />
        <Route path="/sla-management" component={SlaManagementPage} />
        <Route path="/capacity-planning" component={CapacityPlanningPage} />
        <Route path="/incident-management" component={IncidentManagementPage} />
        <Route path="/feature-flags" component={FeatureFlagsPage} />
        {/* Sprint 33: Final Production */}
        <Route path="/open-telemetry" component={OpenTelemetryPage} />
        <Route
          path="/advanced-bi-reporting"
          component={AdvancedBiReportingPage}
        />
        <Route path="/workflow-automation" component={WorkflowAutomationPage} />
        <Route path="/notification-center" component={NotificationCenterPage} />
        <Route path="/help-desk" component={HelpDeskPage} />
        <Route path="/data-quality" component={DataQualityPage} />
        <Route path="/config-management" component={ConfigManagementPage} />
        <Route path="/service-mesh" component={ServiceMeshPage} />
        <Route
          path="/compliance-automation"
          component={ComplianceAutomationPage}
        />
        <Route path="/customer-360" component={Customer360Page} />
        {/* Sprint 34: Final Comprehensive Production */}
        <Route
          path="/realtime-notifications"
          component={RealtimeNotificationsPage}
        />
        <Route path="/report-builder" component={DragDropReportBuilderPage} />
        <Route path="/graphql-federation" component={GraphqlFederationPage} />
        <Route path="/api-versioning" component={ApiVersioningPage} />
        <Route
          path="/advanced-rate-limiter"
          component={AdvancedRateLimiterPage}
        />
        <Route
          path="/dashboard-widgets"
          component={RealtimeDashboardWidgetsPage}
        />
        <Route path="/agent-scorecard" component={AgentScorecardPage} />
        <Route path="/dispute-resolution" component={DisputeResolutionPage} />
        <Route path="/regulatory-sandbox" component={RegulatorySandboxPage} />
        <Route path="/multi-currency-engine" component={MultiCurrencyPage} />
        <Route path="/document-management" component={DocumentManagementPage} />
        <Route path="/agent-training" component={AgentTrainingPage} />
        <Route path="/revenue-analytics" component={RevenueAnalyticsPage} />
        <Route path="/platform-health" component={PlatformHealthPage} />
        <Route path="/batch-processing" component={BatchProcessingPage} />
        <Route
          path="/integration-marketplace"
          component={IntegrationMarketplacePage}
        />
        <Route path="/mobile-api" component={MobileApiLayerPage} />
        <Route
          path="/automated-testing"
          component={AutomatedTestingFrameworkPage}
        />
        {/* Sprint 35: Advanced Operations */}
        <Route path="/transaction-map-viz" component={TransactionMapVizPage} />
        <Route
          path="/report-builder-templates"
          component={ReportBuilderTemplatesPage}
        />
        <Route path="/nl-analytics-query" component={NLAnalyticsQueryPage} />
        <Route
          path="/banking-workflows"
          component={BankingWorkflowPatternsPage}
        />
        <Route
          path="/agent-onboarding-wizard"
          component={AgentOnboardingWizardPage}
        />
        <Route
          path="/transaction-reconciliation"
          component={TransactionReconciliationPage}
        />
        <Route
          path="/chargeback-management"
          component={ChargebackManagementPage}
        />
        <Route
          path="/regulatory-reporting"
          component={RegulatoryReportingPage}
        />
        <Route
          path="/territory-management"
          component={TerritoryManagementPage}
        />
        <Route path="/dynamic-pricing" component={DynamicPricingPage} />
        <Route path="/loyalty-program" component={LoyaltyProgramPage} />
        <Route
          path="/fraud-case-management"
          component={FraudCaseManagementPage}
        />
        <Route path="/terminal-fleet" component={ServiceFleetPage} />
        <Route
          path="/financial-reconciliation"
          component={FinancialReconciliationPage}
        />
        <Route path="/api-analytics" component={ApiAnalyticsPage} />
        <Route
          path="/agent-communication-hub"
          component={AgentCommunicationHubPage}
        />
        <Route path="/dispute-arbitration" component={DisputeArbitrationPage} />
        <Route path="/compliance-training" component={ComplianceTrainingPage} />
        <Route path="/migration-tools" component={MigrationToolsPage} />
        <Route path="/audit-log-viewer" component={AuditLogViewerPage} />
        {/* Sprint 36: White-Label Partner Platform */}
        <Route
          path="/transaction-csv-export"
          component={TransactionCsvExport}
        />
        <Route
          path="/transaction-map-loading"
          component={TransactionMapLoading}
        />
        <Route path="/nl-financial-query" component={NlFinancialQuery} />
        <Route
          path="/white-label-onboarding"
          component={WhiteLabelOnboarding}
        />
        <Route path="/white-label-branding" component={WhiteLabelBranding} />
        <Route path="/white-label-approval" component={WhiteLabelApproval} />
        <Route path="/partner-self-service" component={PartnerSelfService} />
        <Route
          path="/transaction-export-engine"
          component={TransactionExportEngine}
        />
        <Route
          path="/advanced-loading-states"
          component={AdvancedLoadingStates}
        />
        <Route path="/financial-nl-engine" component={FinancialNlEngine} />
        <Route
          path="/partner-revenue-sharing"
          component={PartnerRevenueSharing}
        />
        <Route path="/agent-gamification" component={AgentGamification} />
        <Route
          path="/bulk-transaction-processing"
          component={BulkTransactionProcessing}
        />
        <Route path="/customer-360-view" component={Customer360View} />
        <Route path="/webhook-mgmt-console" component={WebhookMgmtConsole} />
        <Route
          path="/platform-feature-flags"
          component={PlatformFeatureFlags}
        />
        <Route path="/sla-monitoring" component={SlaMonitoringDash} />
        <Route path="/data-retention-policy" component={DataRetentionPolicy} />
        <Route path="/platform-changelog" component={PlatformChangelogPage} />
        <Route path="/advanced-search" component={AdvancedSearchFiltering} />
        {/* Sprint 37: Production Hardening & Advanced Platform */}
        <Route path="/e2e-test-framework" component={E2ETestFramework} />
        <Route path="/db-schema-push" component={DbSchemaPush} />
        <Route path="/agent-commission-calc" component={AgentCommissionCalc} />
        <Route path="/mcc-manager" component={MccManager} />
        <Route
          path="/settlement-batch-processor"
          component={SettlementBatchProcessor}
        />
        <Route path="/card-bin-lookup" component={CardBinLookup} />
        <Route
          path="/transaction-velocity-monitor"
          component={TransactionVelocityMonitor}
        />
        <Route path="/merchant-risk-scoring" component={InsuranceMerchantRiskScoring} />
        <Route
          path="/payment-gateway-router"
          component={PaymentGatewayRouter}
        />
        <Route
          path="/agent-float-forecasting"
          component={AgentFloatForecasting}
        />
        <Route
          path="/multi-tenant-isolation"
          component={MultiTenantIsolation}
        />
        <Route path="/platform-health-dash" component={PlatformHealthDash} />
        <Route
          path="/automated-compliance-checker"
          component={AutomatedComplianceChecker}
        />
        <Route path="/transaction-fee-calc" component={TransactionFeeCalc} />
        <Route
          path="/agent-network-topology"
          component={AgentNetworkTopology}
        />
        <Route
          path="/customer-dispute-portal"
          component={CustomerDisputePortal}
        />
        <Route
          path="/revenue-leakage-detector"
          component={RevenueLeakageDetector}
        />
        <Route path="/api-rate-limiter-dash" component={ApiRateLimiterDash} />
        <Route path="/operational-runbook" component={OperationalRunbook} />
        <Route
          path="/platform-metrics-exporter"
          component={PlatformMetricsExporter}
        />
        {/* Sprint 38: Advanced Platform Capabilities */}
        <Route
          path="/realtime-websocket-feeds"
          component={RealtimeWebSocketFeeds}
        />
        <Route
          path="/merchant-onboarding-portal"
          component={InsuranceMerchantOnboarding}
        />
        <Route
          path="/payment-link-generator"
          component={PaymentLinkGenerator}
        />
        <Route path="/dispute-mediation-ai" component={DisputeMediationAI} />
        <Route
          path="/agent-performance-leaderboard"
          component={AgentPerformanceLeaderboard}
        />
        <Route
          path="/automated-settlement-scheduler"
          component={AutomatedSettlementScheduler}
        />
        <Route
          path="/customer-wallet-system"
          component={CustomerWalletSystem}
        />
        <Route
          path="/merchant-analytics-dash"
          component={InsuranceMerchantAnalytics}
        />
        <Route path="/pos-service-update" component={POSServiceUpdate} />
        <Route
          path="/transaction-receipt-generator"
          component={TransactionReceiptGenerator}
        />
        <Route path="/agent-loan-advance" component={AgentLoanAdvance} />
        <Route
          path="/multi-channel-payment-orch"
          component={MultiChannelPaymentOrch}
        />
        <Route
          path="/regulatory-filing-automation"
          component={RegulatoryFilingAutomation}
        />
        <Route
          path="/customer-segmentation-engine"
          component={CustomerSegmentationEngine}
        />
        <Route
          path="/incident-command-center"
          component={IncidentCommandCenter}
        />
        <Route path="/platform-ab-testing" component={PlatformABTesting} />
        <Route
          path="/transaction-enrichment-service"
          component={TransactionEnrichmentService}
        />
        <Route path="/agent-inventory-mgmt" component={AgentInventoryMgmt} />
        <Route
          path="/revenue-forecasting-engine"
          component={RevenueForecastingEngine}
        />
        <Route
          path="/platform-recommendations"
          component={PlatformRecommendations}
        />
        {/* Sprint 39: Platform Maturity & Infrastructure */}
        <Route path="/publish-readiness" component={PublishReadinessChecker} />
        <Route
          path="/db-schema-migration"
          component={DbSchemaMigrationManager}
        />
        <Route
          path="/graphql-subscriptions"
          component={GraphqlSubscriptionGateway}
        />
        <Route path="/offline-pos-mode" component={OfflinePosMode} />
        <Route path="/ai-cash-flow" component={AiCashFlowPredictor} />
        <Route path="/blockchain-audit" component={BlockchainAuditTrail} />
        <Route path="/voice-command-pos" component={VoiceCommandPos} />
        <Route path="/social-commerce" component={SocialCommerceGateway} />
        <Route path="/esg-carbon-tracker" component={EsgCarbonTracker} />
        <Route path="/distributed-tracing" component={DistributedTracingDash} />
        <Route path="/canary-releases" component={CanaryReleaseManager} />
        <Route path="/chaos-engineering" component={ChaosEngineeringConsole} />
        <Route path="/connection-pools" component={ConnectionPoolMonitor} />
        <Route path="/cdn-cache" component={CdnCacheManager} />
        <Route path="/cqrs-events" component={CqrsEventStore} />
        <Route path="/digital-twin" component={DigitalTwinSimulator} />
        <Route path="/cbdc-gateway" component={CbdcIntegrationGateway} />
        <Route path="/did-manager" component={DecentralizedIdentityManager} />
        <Route
          path="/maturity-scorecard"
          component={PlatformMaturityScorecard}
        />
        {/* Sprint 40 Routes */}
        <Route
          path="/smart-contract-payment"
          component={SmartContractPayment}
        />
        <Route
          path="/predictive-agent-churn"
          component={PredictiveAgentChurn}
        />
        <Route path="/currency-hedging" component={CurrencyHedging} />
        <Route
          path="/agent-cluster-analytics"
          component={AgentClusterAnalytics}
        />
        <Route
          path="/auto-compliance-workflow"
          component={AutoComplianceWorkflow}
        />
        <Route path="/payment-token-vault" component={PaymentTokenVault} />
        <Route path="/dynamic-qr-payment" component={DynamicQrPayment} />
        <Route
          path="/agent-revenue-attribution"
          component={AgentRevenueAttribution}
        />
        <Route
          path="/platform-cost-allocator"
          component={PlatformCostAllocator}
        />
        <Route
          path="/intelligent-routing"
          component={IntelligentRoutingEngine}
        />
        <Route
          path="/regulatory-sandbox-tester"
          component={RegulatorySandboxTester}
        />
        <Route
          path="/agent-device-fingerprint"
          component={AgentDeviceFingerprint}
        />
        <Route path="/settlement-netting" component={SettlementNettingEngine} />
        <Route path="/capacity-planner" component={PlatformCapacityPlanner} />
        <Route path="/merchant-acquirer" component={InsurancePremiumAcquirerGateway} />
        <Route path="/agent-micro-insurance" component={AgentMicroInsurance} />
        <Route path="/transaction-graph" component={TransactionGraphAnalyzer} />
        <Route path="/revenue-optimizer" component={PlatformRevenueOptimizer} />
        <Route
          path="/operational-command-bridge"
          component={OperationalCommandBridge}
        />
        {/* Sprint 41 Routes */}
        <Route path="/agent-kyc-vault" component={AgentKycDocVault} />
        <Route path="/realtime-pnl" component={RealtimePnlDashboard} />
        <Route
          path="/auto-reconciliation"
          component={AutoReconciliationEngine}
        />
        <Route
          path="/territory-optimizer"
          component={AgentTerritoryOptimizer}
        />
        <Route
          path="/regulatory-reports"
          component={RegulatoryReportGenerator}
        />
        <Route path="/training-academy" component={AgentTrainingAcademy} />
        <Route path="/fee-calculator" component={DynamicFeeCalculator} />
        <Route
          path="/customer-onboarding"
          component={CustomerOnboardingPipeline}
        />
        <Route
          path="/merchant-settlement"
          component={InsuranceMerchantSettlementDash}
        />
        <Route path="/insurance-claims" component={AgentFloatInsuranceClaims} />
        <Route path="/sla-monitor" component={PlatformSlaMonitor} />
        <Route path="/bulk-disbursement" component={BulkDisbursementEngine} />
        <Route
          path="/reversal-manager"
          component={TransactionReversalManager}
        />
        <Route path="/loan-origination" component={AgentLoanOrigination} />
        <Route
          path="/notification-hub"
          component={MultiChannelNotificationHub}
        />
        <Route path="/migration-toolkit" component={PlatformMigrationToolkit} />
        <Route
          path="/performance-incentives"
          component={AgentPerformanceIncentives}
        />
        <Route path="/executive-command" component={ExecutiveCommandCenter} />
        {/* Sprint 42 Routes */}
        <Route path="/dispute-notifications" component={DisputeNotifications} />
        <Route
          path="/dispute-analytics-dashboard"
          component={DisputeAnalyticsDashboard}
        />
        <Route path="/agent-benchmarking" component={AgentBenchmarking} />
        <Route path="/tx-velocity-monitor" component={TxVelocityMonitor} />
        <Route path="/customer-surveys" component={CustomerSurveys} />
        <Route
          path="/agent-territory-heatmap"
          component={AgentTerritoryHeatmap}
        />
        <Route
          path="/gateway-health-monitor"
          component={GatewayHealthMonitor}
        />
        <Route
          path="/agent-loan-origination-v2"
          component={AgentLoanOriginationV2}
        />
        <Route path="/mfa-manager" component={MfaManager} />
        <Route path="/incident-playbook" component={IncidentPlaybook} />
        <Route path="/device-fleet-manager" component={DeviceFleetManager} />
        <Route
          path="/customer-journey-mapper"
          component={CustomerJourneyMapper}
        />
        <Route
          path="/compliance-cert-manager"
          component={ComplianceCertManager}
        />
        <Route
          path="/platform-health-scorecard"
          component={PlatformHealthScorecard}
        />
        <Route
          path="/training-certification"
          component={TrainingCertification}
        />
        <Route
          path="/bulk-transaction-processor"
          component={BulkTransactionProcessor}
        />
        <Route path="/system-config-manager" component={SystemConfigManager} />
        {/* Sprint 46: Production Features */}
        <Route
          path="/payment-notifications"
          component={PaymentNotificationSystem}
        />
        <Route
          path="/database-visualization"
          component={DatabaseVisualization}
        />
        <Route
          path="/middleware-manager"
          component={MiddlewareServiceManager}
        />
        <Route path="/skill-creator" component={SkillCreatorIntegration} />
        <Route
          path="/payment-reconciliation"
          component={PaymentReconciliation}
        />
        <Route
          path="/agent-performance-analytics"
          component={AgentPerformanceAnalytics}
        />
        <Route path="/compliance-reporting" component={ComplianceReporting} />
        <Route path="/customer-feedback" component={CustomerFeedbackNps} />
        <Route
          path="/multi-currency-exchange"
          component={MultiCurrencyExchange}
        />
        <Route path="/dispute-workflow" component={DisputeWorkflowEngine} />
        <Route path="/bulk-payments" component={BulkPaymentProcessor} />
        <Route
          path="/agent-hierarchy-territory"
          component={AgentHierarchyTerritory}
        />
        <Route
          path="/financial-reporting"
          component={FinancialReportingSuite}
        />
        <Route path="/api-key-management" component={ApiKeyManagement} />
        <Route path="/webhook-delivery" component={WebhookDeliverySystem} />
        <Route path="/platform-config" component={PlatformConfigCenter} />
        <Route path="/bank-accounts" component={BankAccountManagementPage} />
        <Route path="/kyc-documents" component={KycDocumentManagementPage} />
        <Route
          path="/float-reconciliation"
          component={FloatReconciliationPage}
        />
        <Route path="/customer-database" component={CustomerDatabasePage} />
        <Route path="/reversal-approval" component={ReversalApprovalPage} />
        <Route path="/commission-clawback" component={CommissionClawbackPage} />
        <Route path="/pnl-reports" component={PnlReportPage} />
        <Route
          path="/transaction-limits"
          component={TransactionLimitsEnginePage}
        />
        <Route
          path="/regulatory-compliance"
          component={RegulatoryCompliancePage}
        />
        <Route
          path="/system-health-dashboard"
          component={SystemHealthDashboardPage}
        />
        <Route
          path="/agent-suspension"
          component={AgentSuspensionWorkflowPage}
        />
        {/* Sprint 51: Production-grade feature routes */}
        <Route path="/realtime-tx-monitor" component={RealtimeTxMonitorPage} />
        <Route path="/fraud-ml-scoring" component={FraudMlScoringPage} />
        <Route
          path="/notification-orchestrator"
          component={NotificationOrchestratorPage}
        />
        <Route path="/agent-loan-facility" component={AgentLoanFacilityPage} />
        <Route path="/dynamic-fee-engine" component={DynamicFeeEnginePage} />
        <Route
          path="/merchant-kyc-onboarding"
          component={InsuranceMerchantKycOnboarding}
        />
        <Route
          path="/merchant-payout-settlement"
          component={InsuranceMerchantPayoutSettlement}
        />
        <Route path="/compliance-filing" component={ComplianceFilingPage} />
        <Route
          path="/tenant-feature-toggle"
          component={TenantFeatureTogglePage}
        />
        <Route
          path="/reconciliation-engine"
          component={ReconciliationEnginePage}
        />
        <Route
          path="/customer-journey-analytics"
          component={CustomerJourneyAnalyticsPage}
        />
        <Route
          path="/backup-disaster-recovery"
          component={BackupDisasterRecoveryPage}
        />
        <Route path="/workflow-engine" component={WorkflowEnginePage} />
        <Route path="/general-ledger" component={GeneralLedgerPage} />
        <Route path="/data-export-hub" component={DataExportHubPage} />
        <Route path="/sla-monitoring-v2" component={SlaMonitoringPage} />
        <Route path="/rate-limit-engine" component={RateLimitEnginePage} />
        <Route
          path="/agent-gamification-v2"
          component={AgentGamificationPage}
        />
        <Route
          path="/executive-command-center"
          component={ExecutiveCommandCenterPage}
        />
        <Route path="/activity-audit-log" component={ActivityAuditLogPage} />
        <Route path="/system-settings" component={SystemSettingsPage} />
        <Route
          path="/agent-leaderboard"
          component={AgentPerformanceLeaderboardPage}
        />
        <Route path="/float-management" component={FloatManagementPage} />
        {/* Sprint 58: Archival Admin + Load Test Dashboard */}
        <Route path="/archival-admin" component={ArchivalAdmin} />
        <Route path="/load-test-dashboard" component={LoadTestDashboard} />
        <Route path="/load-test-comparison" component={LoadTestComparison} />
        <Route path="/admin-support-inbox">{() => <AdminSupportInbox />}</Route>
        <Route path="/network-status" component={NetworkStatusDashboard} />
        <Route path="/security-audit" component={SecurityAuditDashboard} />
        <Route path="/carrier-costs" component={CarrierCostDashboard} />
        <Route path="/carrier-sla" component={CarrierSlaDashboard} />
        <Route path="/ussd-analytics" component={UssdAnalyticsDashboard} />
        <Route path="/ussd-localization" component={UssdLocalizationPage} />
        <Route path="/network-diagnostic" component={NetworkDiagnosticPage} />
        <Route path="/connection-quality" component={ConnectionQualityPage} />
        {/* Sprint 78 routes */}
        <Route path="/ussd-session-replay" component={UssdSessionReplayPage} />
        <Route path="/agent-kyc" component={AgentKycPage} />
        <Route path="/tx-monitor" component={TxMonitorPage} />
        <Route
          path="/commission-calculator"
          component={CommissionCalculatorPage}
        />
        <Route
          path="/carrier-live-pricing"
          component={CarrierLivePricingPage}
        />
        <Route path="/agent-geo-fencing" component={AgentGeoFencingPage} />
        <Route
          path="/agent-onboarding-workflow"
          component={AgentOnboardingWorkflowPage}
        />
        <Route path="/audit-export-page" component={AuditExportPage} />
        <Route path="/audit-trail-export" component={AuditTrailExportPage} />
        <Route path="/daily-pnl-report" component={DailyPnlReportPage} />
        <Route
          path="/tx-dispute-resolution"
          component={TransactionDisputeResolutionPage}
        />
        <Route path="/real-time-dashboard" component={RealTimeDashboard} />
        <Route
          path="/tx-reversal-workflow"
          component={TransactionReversalWorkflowPage}
        />
        <Route path="/billing-dashboard" component={BillingDashboardPage} />
        <Route path="/invoice-management" component={InvoiceManagementPage} />
        <Route
          path="/tenant-billing-onboarding"
          component={TenantBillingOnboardingPage}
        />
        <Route path="/billing/portal" component={TenantBillingPortalPage} />
        <Route
          path="/billing/analytics"
          component={BillingAnalyticsDashboardPage}
        />
        {/* Sprint 89: Admin Dashboard & Analytics */}
        <Route path="/admin-dashboard" component={AdminDashboardPage} />
        <Route path="/admin/users" component={AdminUserManagement} />
        <Route path="/admin/health" component={AdminSystemHealth} />
        <Route
          path="/admin/liveness-devices"
          component={AdminLivenessDeviceAnalytics}
        />
        <Route path="/transaction-analytics" component={TransactionAnalytics} />
        {/* Sprint 92: Offline Queue, Security Alerts, PBAC Management */}
        <Route path="/offline-queue" component={OfflineQueueDashboard} />
        <Route path="/security-alerts" component={RansomwareAlertDashboard} />
        <Route path="/pbac-management" component={PBACManagement} />
        {/* Sprint 93: Alert Preferences, Network Heatmap */}
        <Route
          path="/alert-preferences"
          component={AlertNotificationPreferences}
        />
        <Route path="/network-heatmap" component={NetworkQualityHeatmap} />
        <Route path="/worldview">
          <Suspense fallback={<SkeletonDashboard />}><WorldViewPage /></Suspense>
        </Route>
        <Route path="/insure-market">
          <Suspense fallback={<SkeletonDashboard />}><InsureMarketPage /></Suspense>
        </Route>
        {/* ─── Insurance Role Dashboards ─────────────────────────────────── */}
        <Route path="/underwriter-dashboard">
          <Suspense fallback={<SkeletonDashboard />}><UnderwriterDashboard /></Suspense>
        </Route>
        <Route path="/actuary-dashboard">
          <Suspense fallback={<SkeletonDashboard />}><ActuaryDashboard /></Suspense>
        </Route>
        <Route path="/claims-dashboard">
          <Suspense fallback={<SkeletonDashboard />}><ClaimsDashboard /></Suspense>
        </Route>
        <Route path="/broker-dashboard">
          <Suspense fallback={<SkeletonDashboard />}><BrokerDashboard /></Suspense>
        </Route>
        <Route path="/policyholder-dashboard">
          <Suspense fallback={<SkeletonDashboard />}><PolicyholderDashboard /></Suspense>
        </Route>
        <Route path="/compliance-dashboard">
          <Suspense fallback={<SkeletonDashboard />}><ComplianceDashboard /></Suspense>
        </Route>
        <Route path="/regulator-dashboard">
          <Suspense fallback={<SkeletonDashboard />}><RegulatorDashboard /></Suspense>
        </Route>
        <Route path="/reinsurer-dashboard">
          <Suspense fallback={<SkeletonDashboard />}><ReinsurerDashboard /></Suspense>
        </Route>
        <Route path="/billing-admin-dashboard">
          <Suspense fallback={<SkeletonDashboard />}><BillingAdminDashboard /></Suspense>
        </Route>
        <Route path="/beneficiary-dashboard">
          <Suspense fallback={<SkeletonDashboard />}><BeneficiaryDashboard /></Suspense>
        </Route>
        <Route path="/ifrs17-dashboard">
          <Suspense fallback={<SkeletonDashboard />}><Ifrs17Dashboard /></Suspense>
        </Route>
        {/* Sprint 98: Missing page routes */}
        <Route path="/">
          <Suspense fallback={<SkeletonDashboard />}><Home /></Suspense>
        </Route>
        <Route path="/agent-performance-scorecard">
          <Suspense fallback={<SkeletonDashboard />}><AgentPerformanceScorecardPage /></Suspense>
        </Route>
        <Route path="/agent-training-portal">
          <Suspense fallback={<SkeletonDashboard />}><AgentTrainingPortal /></Suspense>
        </Route>
        <Route path="/biometric-auth">
          <Suspense fallback={<SkeletonDashboard />}><BiometricAuthGateway /></Suspense>
        </Route>
        <Route path="/compliance-training">
          <Suspense fallback={<SkeletonDashboard />}><ComplianceTrainingTracker /></Suspense>
        </Route>
        <Route path="/component-showcase">
          <Suspense fallback={<SkeletonDashboard />}><ComponentShowcase /></Suspense>
        </Route>
        <Route path="/cross-border-remittance">
          <Suspense fallback={<SkeletonDashboard />}><CrossBorderRemittanceHub /></Suspense>
        </Route>
        <Route path="/insurance/policy-checkout">
          <Suspense fallback={<SkeletonDashboard />}><InsurancePolicyCheckout /></Suspense>
        </Route>
        <Route path="/insurance/merchant-portal">
          <Suspense fallback={<SkeletonDashboard />}><InsuranceAgentMerchantPortal /></Suspense>
        </Route>
        <Route path="/insurance/policy-orders">
          <Suspense fallback={<SkeletonDashboard />}><InsurancePolicyOrderManagement /></Suspense>
        </Route>
        <Route path="/insurance/product-catalog">
          <Suspense fallback={<SkeletonDashboard />}><InsuranceProductCatalog /></Suspense>
        </Route>
        <Route path="/insurance/policy-quotes">
          <Suspense fallback={<SkeletonDashboard />}><InsurancePolicyQuoteManager /></Suspense>
        </Route>
        <Route path="/pos-firmware-ota">
          <Suspense fallback={<SkeletonDashboard />}><POSFirmwareOTA /></Suspense>
        </Route>
        <Route path="/payment-dispute-arbitration">
          <Suspense fallback={<SkeletonDashboard />}><PaymentDisputeArbitration /></Suspense>
        </Route>
        <Route path="/platform-health">
          <Suspense fallback={<SkeletonDashboard />}><PlatformHealthMonitor /></Suspense>
        </Route>
        <Route path="/remittance">
          <Suspense fallback={<SkeletonDashboard />}><RemittancePage /></Suspense>
        </Route>
        <Route path="/terminal-fleet">
          <Suspense fallback={<SkeletonDashboard />}><TerminalFleetPage /></Suspense>
        </Route>
        <Route>
          <Suspense fallback={<SkeletonDashboard />}><NotFound /></Suspense>
        </Route>
        {/* Fallback — InsurancePortal handles named screens */}
        <Route path="/:screen" component={InsurancePortal} />
      </Switch>
    </Suspense>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────
export default function App() {
  const { shortcuts, helpOpen, setHelpOpen } = useKeyboardShortcuts();
const InsuranceJourneyDashboard = lazy(() => import("./pages/InsuranceJourneyDashboard"));
const WorkflowMonitorDashboard = lazy(() => import("./pages/WorkflowMonitorDashboard"));
const InnovationHub = lazy(() => import("./pages/InnovationHub"));

  return (
    <ErrorBoundary>
      <AccessibilityProvider>
        <ThemeProvider defaultTheme="dark">
          <TooltipProvider>
            <Toaster richColors position="top-center" />
            <AnnouncementBanner />
            <ErrorBoundaryRoute>
              <AuthenticatedApp />
            </ErrorBoundaryRoute>
            <GlobalSearch />
            <KeyboardShortcutsHelp
              open={helpOpen}
              onClose={() => setHelpOpen(false)}
              shortcuts={shortcuts}
            />
            <PWAInstallBanner />
        <OfflineIndicator />
        <RoleOnboarding />
        <KpiLiveRegion />
            <GdprConsentBanner />
            <LiveChatWidget />
            <ProactiveHelp />
          </TooltipProvider>
        </ThemeProvider>
      </AccessibilityProvider>
    </ErrorBoundary>
  );        <Route path="/insurance/journeys">
          <Suspense fallback={<SkeletonDashboard />
              <Route path="/insurance/monitor" element={<WorkflowMonitorDashboard />} />
              <Route path="/insurance/innovations" element={<InnovationHub />} />
              <Route path="/insurance/parametric" element={<InnovationHub />} />
              <Route path="/insurance/cv-claims" element={<InnovationHub />} />
              <Route path="/insurance/fraud-network" element={<InnovationHub />} />
              <Route path="/insurance/telematics" element={<InnovationHub />} />
              <Route path="/insurance/embedded" element={<InnovationHub />} />
              <Route path="/insurance/voice-claims" element={<InnovationHub />} />
              <Route path="/insurance/p2p-pools" element={<InnovationHub />} />
              <Route path="/insurance/wellness" element={<InnovationHub />} />
              <Route path="/insurance/nhia" element={<InnovationHub />} />
              <Route path="/insurance/comparison" element={<InnovationHub />} />
              <Route path="/insurance/bancassurance" element={<InnovationHub />} />
              <Route path="/insurance/open-insurance" element={<InnovationHub />} />
              <Route path="/insurance/climate-risk" element={<InnovationHub />} />
              <Route path="/insurance/sandbox" element={<InnovationHub />} />
              <Route path="/insurance/reinsurance-marketplace" element={<InnovationHub />} />
              <Route path="/insurance/did-identity" element={<InnovationHub />} />
              <Route path="/insurance/ai-underwriting" element={<InnovationHub />} />
              <Route path="/insurance/carbon-credit" element={<InnovationHub />} />
              <Route path="/insurance/predictive-renewal" element={<InnovationHub />} />
              <Route path="/insurance/slo-monitor" element={<InnovationHub />} />}><InsuranceJourneyDashboard /></Suspense>
        </Route>

}
