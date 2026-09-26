import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { RoleProvider } from "./contexts/RoleContext";
import UnifiedLayout from "./components/UnifiedLayout";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Policies from "./pages/Policies";
import Claims from "./pages/Claims";
import Payments from "./pages/Payments";
import Profile from "./pages/Profile";
import Referrals from "./pages/Referrals";
import Reviews from "./pages/Reviews";
import KYCStatus from "./pages/KYCStatus";
import BlockchainStatus from "./pages/BlockchainStatus";
import FraudAlerts from "./pages/FraudAlerts";
import Analytics from "./pages/Analytics";
import Communication from "./pages/Communication";
import UserManagement from "./pages/UserManagement";
import SystemSettings from "./pages/SystemSettings";
import RiskAssessment from "./pages/RiskAssessment";
import PolicyApproval from "./pages/PolicyApproval";
import CustomerManagement from "./pages/CustomerManagement";
import Commission from "./pages/Commission";
import AuditLogs from "./pages/AuditLogs";
import InsuranceProducts from "./pages/InsuranceProducts";
import InsuranceApplication from "./pages/InsuranceApplication";
import MyApplications from "./pages/MyApplications";
import Auth from "./pages/Auth";
import AIAdvisor from "./pages/AIAdvisor";
import AIClaimsAdjudication from "./pages/AIClaimsAdjudication";
import DynamicPricing from "./pages/DynamicPricing";
import ComplianceMonitoring from "./pages/ComplianceMonitoring";
import Onboarding from "./pages/Onboarding";
import PolicyComparison from "./pages/PolicyComparison";
import FamilyPolicies from "./pages/FamilyPolicies";
import WhatsAppIntegration from "./pages/WhatsAppIntegration";
import DocumentScanner from "./pages/DocumentScanner";
import ExecutiveDashboard from "./pages/ExecutiveDashboard";
import Telematics from "./pages/Telematics";
import GeospatialMap from "./pages/GeospatialMap";
import AdminPolicyCreation from "./pages/AdminPolicyCreation";
import AgriculturalUnderwriting from "./pages/AgriculturalUnderwriting";
import BrokerAPIManagement from "./pages/BrokerAPIManagement";
import Gamification from "./pages/Gamification";
import TwoFactorAuth from "./pages/TwoFactorAuth";
import InsuranceMarketplace from "./pages/InsuranceMarketplace";
import Chatbot from "./pages/Chatbot";
import ReferralProgram from "./pages/ReferralProgram";
import AgentPerformance from "./pages/AgentPerformance";
import KnowledgeGraphExplorer from "./pages/KnowledgeGraphExplorer";
import AIKnowledgeAssistant from "./pages/AIKnowledgeAssistant";
import FraudNetworkVisualization from "./pages/FraudNetworkVisualization";
import MCMCRiskModeling from "./pages/MCMCRiskModeling";
import VoiceAssistant from "./pages/VoiceAssistant";
import ChurnPrediction from "./pages/ChurnPrediction";
import LoyaltyProgram from "./pages/LoyaltyProgram";
import InsuranceLiteracyHub from "./pages/InsuranceLiteracyHub";
import SmartClaimRouting from "./pages/SmartClaimRouting";
import ProductRecommendationQuiz from "./pages/ProductRecommendationQuiz";
import PremiumCalculator from "./pages/PremiumCalculator";
import InsuranceScore from "./pages/InsuranceScore";
import ClaimsTimeline from "./pages/ClaimsTimeline";
import EmergencySOS from "./pages/EmergencySOS";
import DigitalWallet from "./pages/DigitalWallet";
import PremiumRateManagement from "./pages/PremiumRateManagement";
import ERPNextIntegration from "./pages/ERPNextIntegration";
import TelcoCreditScoring from "./pages/TelcoCreditScoring";
import Microinsurance from "./pages/Microinsurance";
import ModelSecurityDashboard from "./pages/ModelSecurityDashboard";
import ClaimsEvidence from "./pages/ClaimsEvidence";
import PolicyRenewal from "./pages/PolicyRenewal";
import FamilyCoverage from "./pages/FamilyCoverage";
import ClaimsTracker from "./pages/ClaimsTracker";
import HealthWellness from "./pages/HealthWellness";
import EmbeddedInsurance from "./pages/EmbeddedInsurance";
import SavingsInvestment from "./pages/SavingsInvestment";
import P2PInsurance from "./pages/P2PInsurance";
import ParametricInsurance from "./pages/ParametricInsurance";
import Bancassurance from "./pages/Bancassurance";
import GigEconomy from "./pages/GigEconomy";
import SMEBusiness from "./pages/SMEBusiness";
import LoyaltyRewards from "./pages/LoyaltyRewards";
import FinancialWellness from "./pages/FinancialWellness";
import ReinsuranceManagement from "./pages/ReinsuranceManagement";
import OperationalReports from "./pages/OperationalReports";
import NAICOMCompliance from "./pages/NAICOMCompliance";
import AuditTrailSystem from "./pages/AuditTrailSystem";
import ClaimsAdjudicationEngine from "./pages/ClaimsAdjudicationEngine";
import PolicyRenewalAutomation from "./pages/PolicyRenewalAutomation";
import AgentCommissionManagement from "./pages/AgentCommissionManagement";
import BatchProcessingEngine from "./pages/BatchProcessingEngine";
import Customer360View from "./pages/Customer360View";
import DocumentManagementSystem from "./pages/DocumentManagementSystem";
import CustomerFeedbackLoop from "./pages/CustomerFeedbackLoop";
import MultiCurrencySupport from "./pages/MultiCurrencySupport";
import NigerianBankIntegrations from "./pages/NigerianBankIntegrations";
import ReconciliationEngine from "./pages/ReconciliationEngine";
import DisasterRecoveryModule from "./pages/DisasterRecoveryModule";
import ABTestingFramework from "./pages/ABTestingFramework";
import PerformanceMonitoringDashboard from "./pages/PerformanceMonitoringDashboard";
import InsuranceRadar from "./pages/InsuranceRadar";
import PostgreSQLScaling from "./pages/PostgreSQLScaling";
import USSDGateway from "./pages/USSDGateway";
import NMIDIntegration from "./pages/NMIDIntegration";
import ActuarialModule from "./pages/ActuarialModule";
import AgentPortal from "./pages/AgentPortal";
import BancassurancePortal from "./pages/BancassurancePortal";
import GroupLifeAdmin from "./pages/GroupLifeAdmin";
import PFAIntegration from "./pages/PFAIntegration";
import AgriculturalInsuranceSuite from "./pages/AgriculturalInsuranceSuite";
import EmbeddedDistributionPlatform from "./pages/EmbeddedDistributionPlatform";
import DigitalConsumerProducts from "./pages/DigitalConsumerProducts";
import TakafulProductsSuite from "./pages/TakafulProductsSuite";
import NIIRACompulsoryInsurance from "./pages/NIIRACompulsoryInsurance";
import InsuranceTechInnovations from "./pages/InsuranceTechInnovations";
import AdminConfigCenter from "./pages/AdminConfigCenter";
import IFRS17Dashboard from "./pages/IFRS17Dashboard";
// Q-wave Q6 member innovation surfaces (2026-09-25)
import ParametricCoverage from "./pages/ParametricCoverage";
import PoolMembership from "./pages/PoolMembership";
import DrivingScore from "./pages/DrivingScore";
import UsageCoverActivation from "./pages/UsageCoverActivation";
import WellnessFeed from "./pages/WellnessFeed";
import PhotoReimbursement from "./pages/PhotoReimbursement";
import FreemiumUpgrade from "./pages/FreemiumUpgrade";
import InstallPrompt from "./components/InstallPrompt";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/auth" component={Auth} />
      {/* Public routes - accessible without login */}
      <Route path="/recommendation-quiz">
        <div className="min-h-screen bg-gray-50">
          <nav className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4">
            <div className="container mx-auto flex justify-between items-center">
              <Link href="/" className="flex items-center gap-2 text-xl font-bold">
                <Shield className="h-6 w-6" />
                InsurePortal
              </Link>
              <Link href="/auth">
                <Button variant="secondary" size="sm">Login / Sign Up</Button>
              </Link>
            </div>
          </nav>
          <div className="container mx-auto p-6">
            <ProductRecommendationQuiz />
          </div>
        </div>
      </Route>
      <Route path="/premium-calculator">
        <div className="min-h-screen bg-gray-50">
          <nav className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4">
            <div className="container mx-auto flex justify-between items-center">
              <Link href="/" className="flex items-center gap-2 text-xl font-bold">
                <Shield className="h-6 w-6" />
                InsurePortal
              </Link>
              <Link href="/auth">
                <Button variant="secondary" size="sm">Login / Sign Up</Button>
              </Link>
            </div>
          </nav>
          <div className="container mx-auto p-6">
            <PremiumCalculator />
          </div>
        </div>
      </Route>
      <Route path="/dashboard">
        <UnifiedLayout>
          <Dashboard />
        </UnifiedLayout>
      </Route>
      <Route path="/policies">
        <UnifiedLayout>
          <Policies />
        </UnifiedLayout>
      </Route>
      <Route path="/claims">
        <UnifiedLayout>
          <Claims />
        </UnifiedLayout>
      </Route>
      <Route path="/payments">
        <UnifiedLayout>
          <Payments />
        </UnifiedLayout>
      </Route>
      <Route path="/profile">
        <UnifiedLayout>
          <Profile />
        </UnifiedLayout>
      </Route>
      <Route path="/referrals">
        <UnifiedLayout>
          <Referrals />
        </UnifiedLayout>
      </Route>
      <Route path="/reviews">
        <UnifiedLayout>
          <Reviews />
        </UnifiedLayout>
      </Route>
      <Route path="/kyc">
        <UnifiedLayout>
          <KYCStatus />
        </UnifiedLayout>
      </Route>
      <Route path="/blockchain">
        <UnifiedLayout>
          <BlockchainStatus />
        </UnifiedLayout>
      </Route>
      <Route path="/fraud-alerts">
        <UnifiedLayout>
          <FraudAlerts />
        </UnifiedLayout>
      </Route>
      <Route path="/analytics">
        <UnifiedLayout>
          <Analytics />
        </UnifiedLayout>
      </Route>
      <Route path="/communication">
        <UnifiedLayout>
          <Communication />
        </UnifiedLayout>
      </Route>
      <Route path="/users">
        <UnifiedLayout>
          <UserManagement />
        </UnifiedLayout>
      </Route>
      <Route path="/settings">
        <UnifiedLayout>
          <SystemSettings />
        </UnifiedLayout>
      </Route>
      <Route path="/risk-assessment">
        <UnifiedLayout>
          <RiskAssessment />
        </UnifiedLayout>
      </Route>
      <Route path="/policy-approval">
        <UnifiedLayout>
          <PolicyApproval />
        </UnifiedLayout>
      </Route>
      <Route path="/customers">
        <UnifiedLayout>
          <CustomerManagement />
        </UnifiedLayout>
      </Route>
      <Route path="/commission">
        <UnifiedLayout>
          <Commission />
        </UnifiedLayout>
      </Route>
            <Route path="/audit-logs">
              <UnifiedLayout>
                <AuditLogs />
              </UnifiedLayout>
            </Route>
            <Route path="/products">
              <UnifiedLayout>
                <InsuranceProducts />
              </UnifiedLayout>
            </Route>
            <Route path="/apply">
              <UnifiedLayout>
                <InsuranceApplication />
              </UnifiedLayout>
            </Route>
                        <Route path="/applications">
                          <UnifiedLayout>
                            <MyApplications />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/ai-advisor">
                          <UnifiedLayout>
                            <AIAdvisor />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/ai-claims">
                          <UnifiedLayout>
                            <AIClaimsAdjudication />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/dynamic-pricing">
                          <UnifiedLayout>
                            <DynamicPricing />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/compliance">
                          <UnifiedLayout>
                            <ComplianceMonitoring />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/onboarding">
                          <UnifiedLayout>
                            <Onboarding />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/policy-comparison">
                          <UnifiedLayout>
                            <PolicyComparison />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/family-policies">
                          <UnifiedLayout>
                            <FamilyPolicies />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/whatsapp">
                          <UnifiedLayout>
                            <WhatsAppIntegration />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/document-scanner">
                          <UnifiedLayout>
                            <DocumentScanner />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/executive-dashboard">
                          <UnifiedLayout>
                            <ExecutiveDashboard />
                          </UnifiedLayout>
                        </Route>
                                                <Route path="/telematics">
                                                  <UnifiedLayout>
                                                    <Telematics />
                                                  </UnifiedLayout>
                                                </Route>
                                                <Route path="/geospatial">
                                                  <UnifiedLayout>
                                                    <GeospatialMap />
                                                  </UnifiedLayout>
                                                </Route>
                                                <Route path="/admin-policy-creation">
                                                  <UnifiedLayout>
                                                    <AdminPolicyCreation />
                                                  </UnifiedLayout>
                                                </Route>
                                                                                                <Route path="/agricultural-underwriting">
                                                                                                  <UnifiedLayout>
                                                                                                    <AgriculturalUnderwriting />
                                                                                                  </UnifiedLayout>
                                                                                                </Route>
                                                                                                                                                                                                <Route path="/broker-api">
                                                                                                                                                                                                  <UnifiedLayout>
                                                                                                                                                                                                    <BrokerAPIManagement />
                                                                                                                                                                                                  </UnifiedLayout>
                                                                                                                                                                                                </Route>
                                                                                                      <Route path="/rewards">
                                                                                                        <UnifiedLayout>
                                                                                                          <Gamification />
                                                                                                        </UnifiedLayout>
                                                                                                      </Route>
                                                                                                      <Route path="/security">
                                                                                                        <UnifiedLayout>
                                                                                                          <TwoFactorAuth />
                                                                                                        </UnifiedLayout>
                                                                                                      </Route>
                                                                                                      <Route path="/marketplace">
                                                                                                        <UnifiedLayout>
                                                                                                          <InsuranceMarketplace />
                                                                                                        </UnifiedLayout>
                                                                                                      </Route>
                                                                                                      <Route path="/chatbot">
                                                                                                        <UnifiedLayout>
                                                                                                          <Chatbot />
                                                                                                        </UnifiedLayout>
                                                                                                      </Route>
                                                                                                      <Route path="/referral-program">
                                                                                                        <UnifiedLayout>
                                                                                                          <ReferralProgram />
                                                                                                        </UnifiedLayout>
                                                                                                      </Route>
                                                                                                                                                                                                            <Route path="/agent-performance">
                                                                                                                                                                                                              <UnifiedLayout>
                                                                                                                                                                                                                <AgentPerformance />
                                                                                                                                                                                                              </UnifiedLayout>
                                                                                                                                                                                                            </Route>
                                                                                                                                                                                                            <Route path="/knowledge-graph">
                                                                                                                                                                                                              <UnifiedLayout>
                                                                                                                                                                                                                <KnowledgeGraphExplorer />
                                                                                                                                                                                                              </UnifiedLayout>
                                                                                                                                                                                                            </Route>
                                                                                                                                                                                                            <Route path="/ai-assistant">
                                                                                                                                                                                                              <UnifiedLayout>
                                                                                                                                                                                                                <AIKnowledgeAssistant />
                                                                                                                                                                                                              </UnifiedLayout>
                                                                                                                                                                                                            </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                        <Route path="/fraud-network">
                                                                                                                                                                                                                                                                                                                                                                                                                          <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                            <FraudNetworkVisualization />
                                                                                                                                                                                                                                                                                                                                                                                                                          </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                        </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                <Route path="/mcmc-risk">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    <MCMCRiskModeling />
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                              <Route path="/voice-assistant">
                                                                                                                                                                                                                                                                                                                                                                                                                                <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                  <VoiceAssistant />
                                                                                                                                                                                                                                                                                                                                                                                                                                </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                              </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                              <Route path="/churn-prediction">
                                                                                                                                                                                                                                                                                                                                                                                                                                <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                  <ChurnPrediction />
                                                                                                                                                                                                                                                                                                                                                                                                                                </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                              </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                              <Route path="/loyalty-program">
                                                                                                                                                                                                                                                                                                                                                                                                                                <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                  <LoyaltyProgram />
                                                                                                                                                                                                                                                                                                                                                                                                                                </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                              </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                              <Route path="/insurance-literacy">
                                                                                                                                                                                                                                                                                                                                                                                                                                <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                  <InsuranceLiteracyHub />
                                                                                                                                                                                                                                                                                                                                                                                                                                </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                              </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            <Route path="/smart-claim-routing">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                <SmartClaimRouting />
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                                    <Route path="/recommendation-quiz">
                                                                                                                                                                                                                                                                                                                                                                                                                                      <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                        <ProductRecommendationQuiz />
                                                                                                                                                                                                                                                                                                                                                                                                                                      </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                    </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                                    <Route path="/premium-calculator">
                                                                                                                                                                                                                                                                                                                                                                                                                                      <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                        <PremiumCalculator />
                                                                                                                                                                                                                                                                                                                                                                                                                                      </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                    </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                                    <Route path="/insurance-score">
                                                                                                                                                                                                                                                                                                                                                                                                                                      <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                        <InsuranceScore />
                                                                                                                                                                                                                                                                                                                                                                                                                                      </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                    </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                                    <Route path="/claims-timeline">
                                                                                                                                                                                                                                                                                                                                                                                                                                      <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                        <ClaimsTimeline />
                                                                                                                                                                                                                                                                                                                                                                                                                                      </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                    </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                                    <Route path="/emergency-sos">
                                                                                                                                                                                                                                                                                                                                                                                                                                      <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                        <EmergencySOS />
                                                                                                                                                                                                                                                                                                                                                                                                                                      </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                    </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        <Route path="/digital-wallet">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            <DigitalWallet />
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    <Route path="/rate-management">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        <PremiumRateManagement />
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            <Route path="/erpnext-integration">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                <ERPNextIntegration />
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            <Route path="/telco-credit-scoring">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                <TelcoCreditScoring />
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            <Route path="/microinsurance">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                <Microinsurance />
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            </Route>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            <Route path="/model-security">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              <UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                <ModelSecurityDashboard />
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              </UnifiedLayout>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            </Route>
      <Route path="/claims-evidence">
        <UnifiedLayout>
          <ClaimsEvidence />
        </UnifiedLayout>
      </Route>
      <Route path="/policy-renewal">
        <UnifiedLayout>
          <PolicyRenewal />
        </UnifiedLayout>
      </Route>
      <Route path="/family-coverage">
        <UnifiedLayout>
          <FamilyCoverage />
        </UnifiedLayout>
      </Route>
      <Route path="/claims-tracker">
        <UnifiedLayout>
          <ClaimsTracker />
        </UnifiedLayout>
      </Route>
      <Route path="/health-wellness">
        <UnifiedLayout>
          <HealthWellness />
        </UnifiedLayout>
      </Route>
      <Route path="/embedded-insurance">
        <UnifiedLayout>
          <EmbeddedInsurance />
        </UnifiedLayout>
      </Route>
      <Route path="/savings-investment">
        <UnifiedLayout>
          <SavingsInvestment />
        </UnifiedLayout>
      </Route>
      <Route path="/p2p-insurance">
        <UnifiedLayout>
          <P2PInsurance />
        </UnifiedLayout>
      </Route>
      <Route path="/parametric-insurance">
        <UnifiedLayout>
          <ParametricInsurance />
        </UnifiedLayout>
      </Route>
      <Route path="/bancassurance">
        <UnifiedLayout>
          <Bancassurance />
        </UnifiedLayout>
      </Route>
      <Route path="/gig-economy">
        <UnifiedLayout>
          <GigEconomy />
        </UnifiedLayout>
      </Route>
      <Route path="/sme-business">
        <UnifiedLayout>
          <SMEBusiness />
        </UnifiedLayout>
      </Route>
      <Route path="/loyalty-rewards">
        <UnifiedLayout>
          <LoyaltyRewards />
        </UnifiedLayout>
      </Route>
      <Route path="/financial-wellness">
        <UnifiedLayout>
          <FinancialWellness />
        </UnifiedLayout>
      </Route>
            <Route path="/reinsurance">
              <UnifiedLayout>
                <ReinsuranceManagement />
              </UnifiedLayout>
            </Route>
            <Route path="/operational-reports">
              <UnifiedLayout>
                <OperationalReports />
              </UnifiedLayout>
            </Route>
            <Route path="/naicom-compliance">
              <UnifiedLayout>
                <NAICOMCompliance />
              </UnifiedLayout>
            </Route>
            <Route path="/audit-trail">
              <UnifiedLayout>
                <AuditTrailSystem />
              </UnifiedLayout>
            </Route>
            <Route path="/claims-adjudication">
              <UnifiedLayout>
                <ClaimsAdjudicationEngine />
              </UnifiedLayout>
            </Route>
            <Route path="/policy-renewal-automation">
              <UnifiedLayout>
                <PolicyRenewalAutomation />
              </UnifiedLayout>
            </Route>
            <Route path="/agent-commission">
              <UnifiedLayout>
                <AgentCommissionManagement />
              </UnifiedLayout>
            </Route>
            <Route path="/batch-processing">
              <UnifiedLayout>
                <BatchProcessingEngine />
              </UnifiedLayout>
            </Route>
            <Route path="/customer-360">
              <UnifiedLayout>
                <Customer360View />
              </UnifiedLayout>
            </Route>
            <Route path="/document-management">
              <UnifiedLayout>
                <DocumentManagementSystem />
              </UnifiedLayout>
            </Route>
            <Route path="/customer-feedback">
              <UnifiedLayout>
                <CustomerFeedbackLoop />
              </UnifiedLayout>
            </Route>
            <Route path="/multi-currency">
              <UnifiedLayout>
                <MultiCurrencySupport />
              </UnifiedLayout>
            </Route>
            <Route path="/bank-integrations">
              <UnifiedLayout>
                <NigerianBankIntegrations />
              </UnifiedLayout>
            </Route>
            <Route path="/reconciliation">
              <UnifiedLayout>
                <ReconciliationEngine />
              </UnifiedLayout>
            </Route>
            <Route path="/disaster-recovery">
              <UnifiedLayout>
                <DisasterRecoveryModule />
              </UnifiedLayout>
            </Route>
            <Route path="/ab-testing">
              <UnifiedLayout>
                <ABTestingFramework />
              </UnifiedLayout>
            </Route>
                        <Route path="/performance-monitoring">
                          <UnifiedLayout>
                            <PerformanceMonitoringDashboard />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/insurance-radar">
                          <UnifiedLayout>
                            <InsuranceRadar />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/postgresql-scaling">
                          <UnifiedLayout>
                            <PostgreSQLScaling />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/ussd-gateway">
                          <UnifiedLayout>
                            <USSDGateway />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/nmid-integration">
                          <UnifiedLayout>
                            <NMIDIntegration />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/actuarial-module">
                          <UnifiedLayout>
                            <ActuarialModule />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/agent-portal">
                          <UnifiedLayout>
                            <AgentPortal />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/bancassurance-portal">
                          <UnifiedLayout>
                            <BancassurancePortal />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/group-life-admin">
                          <UnifiedLayout>
                            <GroupLifeAdmin />
                          </UnifiedLayout>
                        </Route>
                        <Route path="/pfa-integration">
                          <UnifiedLayout>
                            <PFAIntegration />
                          </UnifiedLayout>
                        </Route>
      <Route path="/agricultural-insurance-suite">
        <UnifiedLayout>
          <AgriculturalInsuranceSuite />
        </UnifiedLayout>
      </Route>
      <Route path="/embedded-distribution">
        <UnifiedLayout>
          <EmbeddedDistributionPlatform />
        </UnifiedLayout>
      </Route>
      <Route path="/digital-consumer-products">
        <UnifiedLayout>
          <DigitalConsumerProducts />
        </UnifiedLayout>
      </Route>
      <Route path="/takaful-products-suite">
        <UnifiedLayout>
          <TakafulProductsSuite />
        </UnifiedLayout>
      </Route>
      <Route path="/niira-compulsory-insurance">
        <UnifiedLayout>
          <NIIRACompulsoryInsurance />
        </UnifiedLayout>
      </Route>
      <Route path="/insurance-tech-innovations">
        <UnifiedLayout>
          <InsuranceTechInnovations />
        </UnifiedLayout>
      </Route>
      <Route path="/admin-config">
        <UnifiedLayout>
          <AdminConfigCenter />
        </UnifiedLayout>
      </Route>
      <Route path="/ifrs17">
        <UnifiedLayout>
          <IFRS17Dashboard />
        </UnifiedLayout>
      </Route>
      {/* Q-wave Q6 member innovation surfaces (2026-09-25) */}
      <Route path="/parametric-coverage">
        <UnifiedLayout>
          <ParametricCoverage />
        </UnifiedLayout>
      </Route>
      <Route path="/pool-membership">
        <UnifiedLayout>
          <PoolMembership />
        </UnifiedLayout>
      </Route>
      <Route path="/driving-score">
        <UnifiedLayout>
          <DrivingScore />
        </UnifiedLayout>
      </Route>
      <Route path="/usage-cover">
        <UnifiedLayout>
          <UsageCoverActivation />
        </UnifiedLayout>
      </Route>
      <Route path="/wellness">
        <UnifiedLayout>
          <WellnessFeed />
        </UnifiedLayout>
      </Route>
      <Route path="/photo-reimbursement">
        <UnifiedLayout>
          <PhotoReimbursement />
        </UnifiedLayout>
      </Route>
      <Route path="/plan-upgrade">
        <UnifiedLayout>
          <FreemiumUpgrade />
        </UnifiedLayout>
      </Route>
                        <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <RoleProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
            {/* Q6 PWA hardening (2026-09-25): additive install prompt; renders
                nothing when beforeinstallprompt never fires. */}
            <InstallPrompt />
          </TooltipProvider>
        </RoleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
