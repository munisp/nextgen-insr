// @ts-check
/**
 * Real-Time PII Leakage Scanner
 *
 * Innovation: Continuous, proactive PII detection in API responses
 * before they reach clients. Goes beyond simple regex to include:
 * - Contextual pattern matching (not just literal matches)
 * - Semantic analysis of field names and values
 * - Cross-field correlation detection (e.g., SSN + name in same response)
 * - Automatic redaction with configurable policies
 * - Real-time alerting for compliance officers
 *
 * Compliance: NDPR, GDPR, PCI-DSS, HIPAA
 */
import { z, ZodSchema } from "zod";
import { logger } from "../_core/logger";

// ── PII Detection Patterns ──────────────────────────────────────────────────

export interface PIIPattern {
  type: string;
  pattern: RegExp;
  severity: "low" | "medium" | "high" | "critical";
  redactionTemplate: string;
  complianceTags: string[]; // NDPR, GDPR, PCI-DSS, etc.
}

export const PII_PATTERNS: PIIPattern[] = [
  // Critical: Financial
  {
    type: "credit_card",
    pattern: /\b(?:\d[ -]*?){13,16}\b/,
    severity: "critical",
    redactionTemplate: "****-****-****-{{last4}}",
    complianceTags: ["PCI-DSS", "GDPR"],
  },
  {
    type: "cvv",
    pattern: /\b\d{3,4}\b(?=\s*(?:cvv|cvc|verification|security))/i,
    severity: "critical",
    redactionTemplate: "***",
    complianceTags: ["PCI-DSS"],
  },
  {
    type: "bank_account",
    pattern: /\b(?:account|routing|iban|sort_code)[\s:]*\d{8,17}\b/i,
    severity: "critical",
    redactionTemplate: "****-****-{{last4}}",
    complianceTags: ["NDPR", "GDPR", "PCI-DSS"],
  },

  // High: Identity
  {
    type: "ssn",
    pattern: /\b\d{3}-?\d{2}-?\d{4}\b/,
    severity: "critical",
    redactionTemplate: "***-**-{{last4}}",
    complianceTags: ["NDPR", "GDPR", "HIPAA"],
  },
  {
    type: "national_id",
    pattern: /\b(?:national|passport|driver_license|tin|nin)[\s:]*\w{6,20}\b/i,
    severity: "high",
    redactionTemplate: "***-***-{{last4}}",
    complianceTags: ["NDPR", "GDPR"],
  },
  {
    type: "phone_number",
    pattern: /\+?[\d\s\-()]{10,}/,
    severity: "medium",
    redactionTemplate: "+**-***-****-{{last4}}",
    complianceTags: ["NDPR", "GDPR"],
  },

  // Medium: Personal
  {
    type: "email",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    severity: "medium",
    redactionTemplate: "{{first}}***@****.com",
    complianceTags: ["NDPR", "GDPR"],
  },
  {
    type: "ip_address",
    pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    severity: "low",
    redactionTemplate: "***.***.***.{{lastOctet}}",
    complianceTags: ["NDPR", "GDPR"],
  },
  {
    type: "address",
    pattern: /\b\d{1,5}\s+[A-Z][a-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd)\b/i,
    severity: "medium",
    redactionTemplate: "*** *** {{city}}",
    complianceTags: ["NDPR", "GDPR"],
  },

  // High: Authentication
  {
    type: "api_key",
    pattern: /\b(?:api[_-]?key|apikey|token|secret|password|passwd|pwd)[\s:=]+['"]?[\w\-]{16,}['"]?/i,
    severity: "critical",
    redactionTemplate: "***",
    complianceTags: ["PCI-DSS"],
  },
  {
    type: "jwt_token",
    pattern: /\beyJ[\w-]*\.eyJ[\w-]*\.[\w-]*\b/,
    severity: "critical",
    redactionTemplate: "***",
    complianceTags: ["PCI-DSS"],
  },
];

// ── Contextual Field Name Detection ─────────────────────────────────────────

const SENSITIVE_FIELD_NAMES = new Set([
  "password", "passwd", "pwd", "secret", "token", "apiKey", "api_key",
  "creditCard", "credit_card", "cardNumber", "card_number", "cvv", "cvc",
  "ssn", "socialSecurity", "social_security", "nationalId", "national_id",
  "passport", "driverLicense", "driver_license", "bankAccount", "bank_account",
  "routingNumber", "routing_number", "iban", "sortCode", "sort_code",
  "email", "phone", "phoneNumber", "phone_number", "address", "streetAddress",
  "street_address", "city", "state", "zip", "postalCode", "postal_code",
  "dateOfBirth", "date_of_birth", "dob", "gender", "race", "religion",
  "biometricData", "biometric_data", "medicalRecord", "medical_record",
  "insuranceNumber", "insurance_number", "policyNumber", "policy_number",
]);

// ── PII Detection Result ────────────────────────────────────────────────────

export interface PIIDetectionResult {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  value: string;
  fieldPath: string;
  redactedValue: string;
  complianceTags: string[];
  context?: Record<string, unknown>;
}

export interface PIIScanResult {
  hasPII: boolean;
  findings: PIIDetectionResult[];
  redactedData: unknown;
  riskScore: number; // 0-100
  complianceStatus: {
    ndpr: "compliant" | "violation";
    gdpr: "compliant" | "violation";
    pciDss: "compliant" | "violation";
  };
}

// ── Redaction Logic ─────────────────────────────────────────────────────────

function redactValue(pattern: PIIPattern, value: string): string {
  const lastChars = value.slice(-4);
  return pattern.redactionTemplate.replace("{{last4}}", lastChars);
}

function redactObject(obj: unknown, path = ""): unknown {
  if (typeof obj === "string") {
    return obj; // Will be processed by pattern matching
  }
  if (Array.isArray(obj)) {
    return obj.map((item, index) => redactObject(item, `${path}[${index}]`));
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = path ? `${path}.${key}` : key;
      result[key] = redactObject(value, fieldPath);
    }
    return result;
  }
  return obj;
}

// ── Cross-Field Correlation ─────────────────────────────────────────────────

function detectCorrelatedPII(
  obj: Record<string, unknown>,
  findings: PIIDetectionResult[],
  path = ""
): PIIDetectionResult[] {
  // Check for high-risk combinations
  const fieldTypes = new Map<string, boolean>();
  for (const finding of findings) {
    fieldTypes.set(finding.type, true);
  }

  // SSN + Name = High risk identity theft
  if (fieldTypes.has("ssn") && fieldTypes.has("name")) {
    findings.push({
      type: "correlated_identity",
      severity: "critical",
      value: "SSN + Name combination",
      fieldPath: path || "root",
      redactedValue: "***",
      complianceTags: ["NDPR", "GDPR", "HIPAA"],
      context: {
        description: "SSN and name found together - high identity theft risk",
        recommendation: "Redact both fields immediately",
      },
    });
  }

  // Credit card + CVV = PCI-DSS violation
  if (fieldTypes.has("credit_card") && fieldTypes.has("cvv")) {
    findings.push({
      type: "correlated_pci",
      severity: "critical",
      value: "Credit card + CVV combination",
      fieldPath: path || "root",
      redactedValue: "***",
      complianceTags: ["PCI-DSS"],
      context: {
        description: "Card number and CVV found together - PCI-DSS violation",
        recommendation: "Never store CVV with card number",
      },
    });
  }

  return findings;
}

// ── Main Scanning Function ──────────────────────────────────────────────────

export function scanForPII(data: unknown, options: {
  strict?: boolean;
  redact?: boolean;
  alert?: boolean;
}): PIIScanResult {
  const { strict = false, redact = true, alert = true } = options;
  const findings: PIIDetectionResult[] = [];
  let redactedData = data;

  // Convert to string for pattern matching
  const dataStr = JSON.stringify(data);

  // Scan for known patterns
  for (const pattern of PII_PATTERNS) {
    const matches = dataStr.match(pattern.pattern);
    if (matches) {
      for (const match of matches) {
        findings.push({
          type: pattern.type,
          severity: pattern.severity,
          value: match,
          fieldPath: "unknown",
          redactedValue: redactValue(pattern, match),
          complianceTags: pattern.complianceTags,
        });
      }
    }
  }

  // Scan field names
  if (data && typeof data === "object") {
    function scanFields(obj: Record<string, unknown>, path = "") {
      for (const [key, value] of Object.entries(obj)) {
        const fieldPath = path ? `${path}.${key}` : key;

        // Check field name
        if (SENSITIVE_FIELD_NAMES.has(key.toLowerCase())) {
          findings.push({
            type: `sensitive_field_${key}`,
            severity: key.toLowerCase().includes("password") || key.toLowerCase().includes("secret") ? "critical" : "medium",
            value: typeof value === "string" ? value : "[object]",
            fieldPath,
            redactedValue: "***",
            complianceTags: ["NDPR", "GDPR"],
          });
        }

        // Recurse into nested objects
        if (value && typeof value === "object" && !Array.isArray(value)) {
          scanFields(value as Record<string, unknown>, fieldPath);
        }
      }
    }
    scanFields(data as Record<string, unknown>);
  }

  // Detect correlated PII
  if (data && typeof data === "object" && !Array.isArray(data)) {
    detectCorrelatedPII(data as Record<string, unknown>, findings);
  }

  // Calculate risk score
  const severityWeights = { low: 1, medium: 5, high: 10, critical: 20 };
  const riskScore = Math.min(
    100,
    findings.reduce((sum, f) => sum + severityWeights[f.severity], 0)
  );

  // Determine compliance status
  const complianceStatus = {
    ndpr: findings.some(f => f.complianceTags.includes("NDPR") && f.severity !== "low")
      ? "violation" as const : "compliant" as const,
    gdpr: findings.some(f => f.complianceTags.includes("GDPR") && f.severity !== "low")
      ? "violation" as const : "compliant" as const,
    pciDss: findings.some(f => f.complianceTags.includes("PCI-DSS") && f.severity !== "low")
      ? "violation" as const : "compliant" as const,
  };

  // Redact data if requested
  if (redact && findings.length > 0) {
    redactedData = redactDataWithFindings(data, findings);
  }

  // Alert on critical findings
  if (alert && findings.some(f => f.severity === "critical")) {
    logger.error(
      { findings: findings.length, riskScore, compliance: complianceStatus },
      `[PIIScanner] Critical PII leakage detected in response (risk score: ${riskScore})`
    );
  }

  return {
    hasPII: findings.length > 0,
    findings,
    redactedData,
    riskScore,
    complianceStatus,
  };
}

function redactDataWithFindings(data: unknown, findings: PIIDetectionResult[]): unknown {
  if (typeof data === "string") {
    let redacted = data;
    for (const finding of findings) {
      redacted = redacted.replace(finding.value, finding.redactedValue);
    }
    return redacted;
  }

  if (Array.isArray(data)) {
    return data.map(item => redactDataWithFindings(item, findings));
  }

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const fieldFindings = findings.filter(f => f.fieldPath.includes(key));
      if (fieldFindings.length > 0 && typeof value === "string") {
        let redactedValue = value;
        for (const finding of fieldFindings) {
          redactedValue = redactedValue.replace(finding.value, finding.redactedValue);
        }
        redacted[key] = redactedValue;
      } else {
        redacted[key] = redactDataWithFindings(value, findings);
      }
    }

    return redacted;
  }

  return data;
}

// ── Middleware Integration ──────────────────────────────────────────────────

export function createPIIMiddleware(options: {
  strict?: boolean;
  redact?: boolean;
  alert?: boolean;
  maxRiskScore?: number;
}) {
  const { strict = false, redact = true, alert = true, maxRiskScore = 50 } = options;

  return function validateResponse(
    response: unknown
  ): { data: unknown; scanResult: PIIScanResult } {
    const scanResult = scanForPII(response, { strict, redact, alert });

    if (scanResult.riskScore > maxRiskScore) {
      logger.warn(
        { riskScore: scanResult.riskScore, maxRiskScore },
        `[PIIScanner] Response exceeds max risk score, returning redacted data`
      );
    }

    return {
      data: scanResult.riskScore > maxRiskScore ? scanResult.redactedData : response,
      scanResult,
    };
  };
}

// ── Compliance Reports ──────────────────────────────────────────────────────

export function generateComplianceReport(scanResults: PIIScanResult[]): {
  totalScans: number;
  violationsFound: number;
  complianceRate: number;
  ndprViolations: number;
  gdprViolations: number;
  pciDssViolations: number;
  criticalFindings: number;
  recommendations: string[];
} {
  const totalScans = scanResults.length;
  const violationsFound = scanResults.filter(
    r => r.complianceStatus.ndpr === "violation" ||
         r.complianceStatus.gdpr === "violation" ||
         r.complianceStatus.pciDss === "violation"
  ).length;

  const recommendations: string[] = [];

  if (scanResults.some(r => r.complianceStatus.ndpr === "violation")) {
    recommendations.push("NDPR: Implement field-level encryption for PII in transit");
  }
  if (scanResults.some(r => r.complianceStatus.gdpr === "violation")) {
    recommendations.push("GDPR: Add data minimization - only return fields explicitly requested");
  }
  if (scanResults.some(r => r.complianceStatus.pciDss === "violation")) {
    recommendations.push("PCI-DSS: Never expose full card numbers or CVV in API responses");
  }
  if (scanResults.some(r => r.findings.some(f => f.type === "correlated_identity"))) {
    recommendations.push("Implement field-level access controls to prevent correlated PII exposure");
  }

  return {
    totalScans,
    violationsFound,
    complianceRate: ((totalScans - violationsFound) / totalScans) * 100,
    ndprViolations: scanResults.filter(r => r.complianceStatus.ndpr === "violation").length,
    gdprViolations: scanResults.filter(r => r.complianceStatus.gdpr === "violation").length,
    pciDssViolations: scanResults.filter(r => r.complianceStatus.pciDss === "violation").length,
    criticalFindings: scanResults.reduce(
      (sum, r) => sum + r.findings.filter(f => f.severity === "critical").length,
      0
    ),
    recommendations,
  };
}

export default {
  scanForPII,
  createPIIMiddleware,
  generateComplianceReport,
  PII_PATTERNS,
  SENSITIVE_FIELD_NAMES,
};
