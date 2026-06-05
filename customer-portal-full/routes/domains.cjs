/**
 * Route Domain Registry
 * 
 * Maps all 468+ tRPC route handlers into 12 logical domain groups.
 * Used for documentation, permission checks, and cache invalidation.
 * 
 * This is the first step of monolith decomposition — organizing routes
 * by bounded context while keeping them in a single process for now.
 * Future: each domain becomes its own microservice.
 */

const DOMAINS = {
  auth: {
    description: 'Authentication, authorization, and session management',
    routes: ['auth.login', 'auth.signup', 'auth.refresh', 'auth.logout', 'auth.me',
      'auth.resetPassword', 'auth.requestReset', 'auth.forgotPassword', 'auth.verifyOtp',
      'auth.enable2FA', 'auth.verify2FA', 'auth.disable2FA'],
    requiresAuth: false,
  },
  policies: {
    description: 'Insurance policy lifecycle — CRUD, renewal, comparison, applications',
    routes: ['policies.*', 'policyRenewal.*', 'policyComparison.*', 'applications.*', 'application.*', 'renewal.*'],
    requiresAuth: true,
  },
  claims: {
    description: 'Claims processing — filing, adjudication, evidence, routing, payouts',
    routes: ['claims.*', 'claimRouting.*', 'claimsEvidence.*', 'claimsPayout.*', 'adjudication.*', 'aiClaims.*'],
    requiresAuth: true,
  },
  payments: {
    description: 'Payment collection, gateway integration, reconciliation, wallets',
    routes: ['payments.*', 'premiumCollection.*', 'reconciliation.*', 'wallet.*', 'currency.*'],
    requiresAuth: true,
  },
  underwriting: {
    description: 'Risk assessment, premium calculation, rate tables, telematics',
    routes: ['underwriting.*', 'premium.*', 'premiumRates.*', 'dynamicPricing.*', 'rates.*', 'risk.*', 'telematics.*', 'pricing.*'],
    requiresAuth: true,
  },
  compliance: {
    description: 'Regulatory compliance — NAICOM, NDPR, AML/KYC, audit trail',
    routes: ['naicom.*', 'naicomFilings.*', 'compliance.*', 'complianceFilings.*', 'complianceReports.*',
      'kyc.*', 'kyb.*', 'audit.*', 'auditTrail.*', 'rbac.*'],
    requiresAuth: true,
  },
  financial: {
    description: 'Financial engines — IFRS 17, reinsurance, actuarial, ERP, accounting',
    routes: ['ifrs17.*', 'reinsurance.*', 'actuarial.*', 'financial.*', 'erp.*', 'erpnext.*',
      'commission.*', 'agentCommission.*', 'savings.*', 'pfa.*'],
    requiresAuth: true,
  },
  channels: {
    description: 'Distribution channels — USSD, WhatsApp, Telegram, embedded, bancassurance',
    routes: ['ussd.*', 'whatsapp.*', 'telegram.*', 'embedded.*', 'embeddedInsurance.*',
      'embeddedDistribution.*', 'bancassurance.*', 'telco.*', 'telcoCredit.*', 'telcoCreditScoring.*',
      'voice.*', 'chatbot.*', 'sme.*'],
    requiresAuth: false,
  },
  ai: {
    description: 'AI/ML models — fraud detection, churn prediction, anomaly detection, NLP',
    routes: ['ai.*', 'ml.*', 'fraud.*', 'fraudAlerts.*', 'fraudNetwork.*', 'churn.*',
      'model.*', 'modelSecurity.*', 'knowledgeGraph.*'],
    requiresAuth: true,
  },
  admin: {
    description: 'Platform administration — settings, RBAC, workflow, approvals, system health',
    routes: ['admin.*', 'approval.*', 'workflow.*', 'automation.*', 'system.*', 'systemHealth.*',
      'dbScaling.*', 'training.*', 'notification.*', 'notifications.*',
      'batch.*', 'dr.*', 'disasterRecovery.*'],
    requiresAuth: true,
  },
  products: {
    description: 'Insurance products — marketplace, coverage, takaful, parametric, micro',
    routes: ['products.*', 'marketplace.*', 'coverage.*', 'takaful.*', 'parametric.*',
      'microinsurance.*', 'agricultural.*', 'agriculturalInsurance.*', 'gigEconomy.*', 'gig.*',
      'groupLife.*', 'health.*', 'digital.*', 'digitalConsumer.*', 'credit.*',
      'p2p.*', 'blockchain.*', 'insureTech.*', 'techInnovations.*',
      'comparison.*', 'insuranceRadar.*', 'radar.*', 'niira.*', 'niiraInsurance.*', 'nmid.*',
      'family.*', 'familyCoverage.*', 'literacy.*', 'financialWellness.*', 'emergency.*',
      'geospatial.*', 'mcmc.*', 'abTesting.*', 'abtesting.*'],
    requiresAuth: false,
  },
  analytics: {
    description: 'Business intelligence — dashboard, reports, customer 360, performance metrics',
    routes: ['dashboard.*', 'analytics.*', 'reports.*', 'customer360.*', 'customers.*',
      'performance.*', 'executive.*', 'agents.*', 'agent.*', 'agentPerformance.*',
      'broker.*', 'brokerApi.*', 'reviews.*', 'feedback.*', 'referral.*', 'referrals.*',
      'loyalty.*', 'rewards.*', 'onboarding.*', 'profile.*', 'users.*', 'knowledge.*',
      'communication.*', 'document.*', 'documents.*', 'insuranceScore.*'],
    requiresAuth: true,
  },
};

function getDomainForRoute(routeName) {
  const prefix = routeName.split('.')[0];
  for (const [domain, config] of Object.entries(DOMAINS)) {
    for (const pattern of config.routes) {
      const routePrefix = pattern.replace('.*', '');
      if (prefix === routePrefix || routeName === pattern) return domain;
    }
  }
  return 'unknown';
}

module.exports = { DOMAINS, getDomainForRoute };
