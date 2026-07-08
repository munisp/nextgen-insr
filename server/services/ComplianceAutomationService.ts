// @ts-check

/**
 * Automated Compliance and Regulatory Reporting Service
 * 
 * Features:
 * - Automated NAICOM reporting
 * - CBN regulatory compliance
 * - GDPR/NDPR data rights handling
 * - AML/KYC compliance monitoring
 * - Audit trail management
 * - Compliance risk scoring
 * 
 * Usage:
 *   const compliance = new ComplianceAutomationService();
 *   const report = await compliance.generateNAICOMReport(month);
 *   const dsarResult = await compliance.handleDSARRequest(request);
 */

import { db } from '../db.js';
import { transactions, customers, fraudAlerts, auditLogs } from '../drizzle/schema.js';
import { eq, sql, gte, lte, and } from 'drizzle-orm';

// Type Definitions
interface ComplianceReport {
  reportId: string;
  type: string;
  period: string;
  generatedAt: string;
  status: 'draft' | 'review' | 'submitted' | 'approved';
  findings: ComplianceFinding[];
  metrics: Record<string, number>;
}

interface ComplianceFinding {
  id: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  recommendation: string;
  status: 'open' | 'in_progress' | 'resolved';
}

interface DSARRequest {
  requestId: string;
  customerId: string;
  type: 'access' | 'rectification' | 'erasure' | 'portability';
  status: 'received' | 'processing' | 'completed' | 'rejected';
  createdAt: string;
  completedAt?: string;
  dataSubjects: string[];
}

interface ComplianceRiskScore {
  overall: number; // 0-100
  categories: {
    aml: number;
    kyc: number;
    dataPrivacy: number;
    reporting: number;
    audit: number;
  };
  criticalIssues: string[];
  recommendations: string[];
}

/**
 * Compliance Automation Service
 */
export class ComplianceAutomationService {
  private readonly REGULATION_REQUIREMENTS = {
    naicom: {
      premiumReporting: 'monthly',
      claimReporting: 'monthly',
      solvencyRatio: 15,
      maximumSinglePolicy: 50000000,
    },
    cbn: {
      amlThreshold: 5000000,
      cftReporting: 'immediate',
      transactionReporting: 'daily',
    },
    gdpr: {
      dsarResponseTime: 30, // days
      dataRetention: 365 * 5, // 5 years
      consentRequired: true,
    },
  };

  /**
   * Generate NAICOM regulatory report
   */
  async generateNAICOMReport(month: Date): Promise<ComplianceReport> {
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);

    const [
      totalPremiums,
      totalClaims,
      transactionCount,
      activePolicies,
      fraudAlerts,
    ] = await Promise.all([
      db
        .select({ value: sql`SUM(${transactions.amount})`.mapWith(Number) })
        .from(transactions)
        .where(and(
          gte(transactions.createdAt, monthStart),
          lte(transactions.createdAt, monthEnd),
          eq(transactions.type, 'premium')
        )),
      db
        .select({ value: sql`SUM(${transactions.amount})`.mapWith(Number) })
        .from(transactions)
        .where(and(
          gte(transactions.createdAt, monthStart),
          lte(transactions.createdAt, monthEnd),
          eq(transactions.type, 'claim')
        )),
      db.$count(transactions, {
        where: and(
          gte(transactions.createdAt, monthStart),
          lte(transactions.createdAt, monthEnd)
        ),
      }),
      db.$count(customers, {
        where: sql`${customers.status} = 'active'`,
      }),
      db.$count(fraudAlerts, {
        where: and(
          gte(fraudAlerts.createdAt, monthStart),
          lte(fraudAlerts.createdAt, monthEnd),
          eq(fraudAlerts.status, 'confirmed')
        ),
      }),
    ]);

    const totalPremiumValue = totalPremiums[0]?.value || 0;
    const totalClaimsValue = totalClaims[0]?.value || 0;
    const claimsRatio = totalPremiumValue > 0 ? (totalClaimsValue / totalPremiumValue) * 100 : 0;

    const findings: ComplianceFinding[] = [];

    // Check claims ratio
    if (claimsRatio > 70) {
      findings.push({
        id: crypto.randomUUID(),
        category: 'solvency',
        severity: 'high',
        description: `Claims ratio (${claimsRatio.toFixed(1)}%) exceeds 70% threshold`,
        recommendation: 'Review underwriting standards and pricing',
        status: 'open',
      });
    }

    // Check fraud rate
    const fraudRate = transactionCount > 0 ? (fraudAlerts / transactionCount) * 100 : 0;
    if (fraudRate > 5) {
      findings.push({
        id: crypto.randomUUID(),
        category: 'fraud',
        severity: 'high',
        description: `Fraud rate (${fraudRate.toFixed(2)}%) exceeds 5% threshold`,
        recommendation: 'Enhanced fraud detection measures required',
        status: 'open',
      });
    }

    return {
      reportId: crypto.randomUUID(),
      type: 'naicom_monthly',
      period: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`,
      generatedAt: new Date().toISOString(),
      status: 'draft',
      findings,
      metrics: {
        totalPremiums: totalPremiumValue,
        totalClaims: totalClaimsValue,
        claimsRatio: claimsRatio,
        transactions: transactionCount,
        activePolicies: activePolicies,
        confirmedFraud: fraudAlerts,
      },
    };
  }

  /**
   * Handle DSAR (Data Subject Access Request) under GDPR/NDPR
   */
  async handleDSARRequest(request: {
    customerId: string;
    type: 'access' | 'rectification' | 'erasure' | 'portability';
  }): Promise<DSARRequest> {
    const requestId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Get all customer data
    const [customer, transactions, fraudAlerts] = await Promise.all([
      db
        .select()
        .from(customers)
        .where(eq(customers.id, request.customerId))
        .limit(1),
      db
        .select()
        .from(transactions)
        .where(eq(transactions.customerId, request.customerId))
        .limit(1000),
      db
        .select()
        .from(fraudAlerts)
        .where(sql`${fraudAlerts.customerId} = ${request.customerId}`)
        .limit(100),
    ]);

    const dataSubjects: string[] = [];
    if (customer[0]) {
      dataSubjects.push('customer_profile');
    }
    if (transactions.length > 0) {
      dataSubjects.push('transaction_history');
    }
    if (fraudAlerts.length > 0) {
      dataSubjects.push('fraud_alerts');
    }

    // Create DSAR request record
    await db.insert(auditLogs).values({
      id: requestId,
      type: 'dsar_request',
      description: `DSAR request: ${request.type} for customer ${request.customerId}`,
      createdAt: now,
      updatedAt: now,
    });

    return {
      requestId,
      customerId: request.customerId,
      type: request.type,
      status: 'processing',
      createdAt: now,
      completedAt: undefined,
      dataSubjects,
    };
  }

  /**
   * Calculate compliance risk score
   */
  async calculateComplianceRiskScore(): Promise<ComplianceRiskScore> {
    // AML Risk
    const recentTransactions = await db
      .select()
      .from(transactions)
      .where(gte(transactions.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
      .limit(1000);

    const highRiskTransactions = recentTransactions.filter(
      t => (t.amount || 0) > this.REGULATION_REQUIREMENTS.cbn.amlThreshold
    );
    const amlRisk = highRiskTransactions.length > 10 ? 80 : highRiskTransactions.length > 5 ? 60 : highRiskTransactions.length > 0 ? 40 : 10;

    // KYC Risk
    const incompleteKYC = await db
      .$count(customers, {
        where: sql`${customers.kycStatus} IN ('pending', 'incomplete')`,
      });
    const kycRisk = incompleteKYC > 100 ? 80 : incompleteKYC > 50 ? 60 : incompleteKYC > 10 ? 40 : 10;

    // Data Privacy Risk
    const activeDSARRequests = await db
      .$count(auditLogs, {
        where: and(
          eq(auditLogs.type, 'dsar_request'),
          eq(auditLogs.status, 'pending')
        ),
      });
    const dataPrivacyRisk = activeDSARRequests > 5 ? 80 : activeDSARRequests > 2 ? 60 : 10;

    // Reporting Risk
    const pendingReports = await db
      .$count(auditLogs, {
        where: and(
          eq(auditLogs.type, 'compliance_report'),
          eq(auditLogs.status, 'overdue')
        ),
      });
    const reportingRisk = pendingReports > 3 ? 90 : pendingReports > 1 ? 60 : 10;

    // Audit Risk
    const daysSinceLastAudit = 30; // Would be calculated from actual audit dates
    const auditRisk = daysSinceLastAudit > 90 ? 80 : daysSinceLastAudit > 60 ? 60 : 10;

    const overall = Math.round(
      amlRisk * 0.25 +
      kycRisk * 0.25 +
      dataPrivacyRisk * 0.20 +
      reportingRisk * 0.15 +
      auditRisk * 0.15
    );

    const criticalIssues: string[] = [];
    if (amlRisk > 60) criticalIssues.push('High AML risk - enhanced monitoring required');
    if (kycRisk > 60) criticalIssues.push('KYC compliance issues - customer verification backlog');
    if (dataPrivacyRisk > 60) criticalIssues.push('DSAR response delays -GDPR/NDPR non-compliance risk');
    if (reportingRisk > 60) criticalIssues.push('Pending compliance reports - regulatory penalties risk');

    const recommendations: string[] = [];
    if (overall > 70) {
      recommendations.push('Immediate compliance review required');
      recommendations.push('Escalate to compliance officer');
    } else if (overall > 40) {
      recommendations.push('Address critical compliance issues within 30 days');
    } else {
      recommendations.push('Maintain current compliance standards');
    }

    return {
      overall,
      categories: {
        aml: amlRisk,
        kyc: kycRisk,
        dataPrivacy: dataPrivacyRisk,
        reporting: reportingRisk,
        audit: auditRisk,
      },
      criticalIssues,
      recommendations,
    };
  }

  /**
   * Generate AML compliance report
   */
  async generateAMLReport(month: Date): Promise<ComplianceReport> {
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);

    const [
      suspiciousTransactions,
      cftReports,
      highValueTransactions,
    ] = await Promise.all([
      db.$count(fraudAlerts, {
        where: and(
          gte(fraudAlerts.createdAt, monthStart),
          lte(fraudAlerts.createdAt, monthEnd),
          sql`${fraudAlerts.type} IN ('suspicious', 'cft')`
        ),
      }),
      db.$count(fraudAlerts, {
        where: and(
          gte(fraudAlerts.createdAt, monthStart),
          lte(fraudAlerts.createdAt, monthEnd),
          eq(fraudAlerts.type, 'cft')
        ),
      }),
      db.$count(transactions, {
        where: and(
          gte(transactions.createdAt, monthStart),
          lte(transactions.createdAt, monthEnd),
          sql`${transactions.amount} >= ${this.REGULATION_REQUIREMENTS.cbn.amlThreshold}`
        ),
      }),
    ]);

    return {
      reportId: crypto.randomUUID(),
      type: 'aml_monthly',
      period: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`,
      generatedAt: new Date().toISOString(),
      status: 'draft',
      findings: [],
      metrics: {
        suspiciousTransactions,
        cftReports,
        highValueTransactions,
      },
    };
  }

  /**
   * Get compliance audit trail
   */
  async getAuditTrail(options: {
    startDate?: Date;
    endDate?: Date;
    type?: string;
    limit?: number;
  }): Promise<Array<{
    id: string;
    type: string;
    description: string;
    createdAt: string;
    userId?: string;
  }>> {
    const startDate = options.startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const endDate = options.endDate || new Date();
    const limit = options.limit || 100;

    const whereConditions = and(
      gte(auditLogs.createdAt, startDate),
      lte(auditLogs.createdAt, endDate)
    );

    const results = await db
      .select({
        id: auditLogs.id,
        type: auditLogs.type,
        description: auditLogs.description,
        createdAt: auditLogs.createdAt,
        userId: auditLogs.userId,
      })
      .from(auditLogs)
      .where(whereConditions)
      .orderBy(sql`${auditLogs.createdAt} DESC`)
      .limit(limit);

    return results;
  }
}

// Export singleton instance
export const complianceAutomation = new ComplianceAutomationService();
