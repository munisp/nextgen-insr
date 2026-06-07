/**
 * InsurePortal Agency Banking Platform — Privacy Policy & NDPR Compliance Page
 * Covers NDPR (Nigeria Data Protection Regulation) and GDPR-aligned disclosures.
 */
import { Link } from "wouter";

const BG = "oklch(0.10 0.015 260)";
const CARD = "oklch(0.14 0.015 260)";
const BORDER = "oklch(0.22 0.015 260)";
const BLUE = "oklch(0.65 0.22 260)";
const DISP = "'Inter', sans-serif";

const SECTIONS = [
  {
    title: "1. Introduction",
    content: `InsurePortal Financial Services Limited ("InsurePortal", "we", "us", or "our") is committed to protecting the privacy and personal data of all individuals who interact with our Agency Banking Platform. This Privacy Policy describes how we collect, use, store, and disclose personal data in compliance with the Nigeria Data Protection Regulation (NDPR) 2019, the Nigeria Data Protection Act (NDPA) 2023, and applicable international standards including the General Data Protection Regulation (GDPR) where relevant.`,
  },
  {
    title: "2. Data Controller Information",
    content: `InsurePortal Financial Services Limited is the data controller for personal data processed through this platform. Our registered address is: 1, Broad Street, Lagos Island, Lagos State, Nigeria. Data Protection Officer: dpo@insureportal.ng | +234 (0) 800 54LINK.`,
  },
  {
    title: "3. Categories of Personal Data Collected",
    content: `We collect and process the following categories of personal data:\n\n• Identity Data: Full name, date of birth, BVN (Bank Verification Number), NIN (National Identification Number), passport photograph, signature.\n• Contact Data: Phone number, email address, residential address, state of origin.\n• Financial Data: Bank account details, transaction history, float balance, commission records, settlement account information.\n• Device & Technical Data: Terminal serial number, device fingerprint, IP address, geolocation coordinates, operating system version.\n• KYC Data: Government-issued ID documents, utility bills, business registration certificates, facial biometrics.\n• Usage Data: Login timestamps, transaction logs, audit trails, session data.`,
  },
  {
    title: "4. Legal Basis for Processing",
    content: `We process personal data on the following legal bases under the NDPR and NDPA:\n\n• Contractual Necessity: Processing required to fulfil our agency banking agreement with you.\n• Legal Obligation: Compliance with CBN regulations, FIRS requirements, NFIU reporting obligations, and anti-money laundering (AML) laws.\n• Legitimate Interests: Fraud detection, security monitoring, platform improvement, and risk management.\n• Consent: Where you have provided explicit consent, such as for marketing communications or optional biometric verification.`,
  },
  {
    title: "5. How We Use Your Data",
    content: `Your personal data is used to:\n\n• Onboard and verify your identity as an agent or merchant.\n• Process financial transactions including Cash In, Cash Out, Transfers, and Bill Payments.\n• Detect and prevent fraud, money laundering, and other financial crimes.\n• Comply with regulatory reporting requirements (CBN, EFCC, NFIU).\n• Calculate and disburse commissions and settlements.\n• Provide customer support and resolve disputes.\n• Send transaction alerts, compliance notices, and service updates.\n• Conduct credit scoring and assess loan eligibility (where applicable).`,
  },
  {
    title: "6. Data Sharing and Disclosure",
    content: `We may share your personal data with:\n\n• Regulatory Bodies: Central Bank of Nigeria (CBN), Nigeria Financial Intelligence Unit (NFIU), Economic and Financial Crimes Commission (EFCC), Federal Inland Revenue Service (FIRS).\n• Banking Partners: Sponsor banks and payment processors required to complete transactions.\n• Technology Partners: Cloud infrastructure providers, KYC verification services, and fraud detection vendors — all bound by data processing agreements.\n• Law Enforcement: When required by valid court order or legal process.\n\nWe do not sell personal data to third parties for marketing purposes.`,
  },
  {
    title: "7. Data Retention",
    content: `We retain personal data for the following periods:\n\n• Transaction Records: 7 years (CBN requirement)\n• KYC Documents: 5 years after account closure\n• Audit Logs: 5 years\n• Fraud Investigation Records: 10 years\n• Marketing Consent Records: Until consent is withdrawn\n\nAfter the applicable retention period, data is securely deleted or anonymised in accordance with our Data Retention Policy.`,
  },
  {
    title: "8. Your Rights Under NDPR/NDPA",
    content: `As a data subject, you have the following rights:\n\n• Right of Access: Request a copy of the personal data we hold about you.\n• Right to Rectification: Request correction of inaccurate or incomplete data.\n• Right to Erasure: Request deletion of your data where there is no legitimate basis for continued processing.\n• Right to Data Portability: Receive your data in a structured, machine-readable format.\n• Right to Object: Object to processing based on legitimate interests.\n• Right to Withdraw Consent: Where processing is based on consent, you may withdraw at any time.\n\nTo exercise these rights, submit a Data Rights Request through the platform or email: privacy@insureportal.ng. We will respond within 30 days.`,
  },
  {
    title: "9. Data Security",
    content: `We implement industry-standard technical and organisational measures to protect your personal data, including:\n\n• AES-256 encryption for data at rest\n• TLS 1.3 for data in transit\n• Multi-factor authentication (MFA) for all administrative access\n• Role-based access control (RBAC) with principle of least privilege\n• Regular penetration testing and security audits\n• 24/7 fraud monitoring and anomaly detection\n• Geofencing and device fingerprinting for transaction security`,
  },
  {
    title: "10. Cookies and Tracking",
    content: `Our platform uses session cookies strictly necessary for authentication and security. We do not use third-party advertising cookies. Analytics data is collected in aggregate form only. You may configure your browser to reject cookies, but this may affect platform functionality.`,
  },
  {
    title: "11. International Data Transfers",
    content: `Where personal data is transferred outside Nigeria (e.g., to cloud infrastructure providers), we ensure adequate safeguards are in place through Standard Contractual Clauses (SCCs) or equivalent mechanisms approved by the Nigeria Data Protection Commission (NDPC).`,
  },
  {
    title: "12. Children's Privacy",
    content: `Our platform is not intended for individuals under 18 years of age. We do not knowingly collect personal data from minors. If you believe a minor has provided us with personal data, please contact our DPO immediately.`,
  },
  {
    title: "13. Changes to This Policy",
    content: `We may update this Privacy Policy from time to time. Material changes will be communicated via in-platform notification and email at least 30 days before they take effect. Continued use of the platform after the effective date constitutes acceptance of the revised policy.`,
  },
  {
    title: "14. Contact Us",
    content: `For privacy-related enquiries, data rights requests, or to report a data breach:\n\nData Protection Officer: dpo@insureportal.ng\nPrivacy Team: privacy@insureportal.ng\nPhone: +234 (0) 800 54LINK (548465)\nAddress: 1, Broad Street, Lagos Island, Lagos State, Nigeria\n\nYou also have the right to lodge a complaint with the Nigeria Data Protection Commission (NDPC) at ndpc.gov.ng.`,
  },
];

export default function PrivacyPolicy() {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: BG, fontFamily: DISP }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: BORDER, background: CARD }}
      >
        <div className="flex items-center gap-3">
          <Link href="/hub">
            <button
              className="text-xs px-3 py-1.5 rounded-lg border"
              style={{ borderColor: BORDER, color: BLUE }}
            >
              ← Hub
            </button>
          </Link>
          <div
            className="text-lg font-black text-white"
            style={{ fontFamily: DISP }}
          >
            Privacy Policy
          </div>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ background: "oklch(0.65 0.22 260 / 0.15)", color: BLUE }}
          >
            NDPR / GDPR Compliant
          </span>
        </div>
        <div className="text-xs text-gray-400">Effective: 1 April 2026</div>
      </div>

      {/* Content */}
      <div className="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
        {/* Intro banner */}
        <div
          className="rounded-xl p-5 mb-8"
          style={{
            background: "oklch(0.65 0.22 260 / 0.08)",
            border: `1px solid ${BORDER}`,
          }}
        >
          <div className="text-sm font-bold text-white mb-1">
            InsurePortal Financial Services Limited — Privacy Policy
          </div>
          <div className="text-xs text-gray-400">
            This document governs the collection, use, and protection of
            personal data on the InsurePortal Agency Banking Platform. It is compliant
            with the Nigeria Data Protection Regulation (NDPR) 2019, the Nigeria
            Data Protection Act (NDPA) 2023, and applicable GDPR standards. Last
            updated: 1 April 2026.
          </div>
        </div>

        {/* Table of Contents */}
        <div
          className="rounded-xl p-5 mb-8"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div className="text-sm font-bold text-white mb-3">
            Table of Contents
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
            {SECTIONS.map((s, i) => (
              <a
                key={i}
                href={`#section-${i}`}
                className="text-xs hover:underline"
                style={{ color: BLUE }}
              >
                {s.title}
              </a>
            ))}
          </div>
        </div>

        {/* Sections */}
        <div className="flex flex-col gap-6">
          {SECTIONS.map((s, i) => (
            <div
              key={i}
              id={`section-${i}`}
              className="rounded-xl p-5"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div className="text-sm font-bold text-white mb-3">{s.title}</div>
              <div className="text-xs text-gray-300 leading-relaxed whitespace-pre-line">
                {s.content}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-gray-500 pb-8">
          © 2026 InsurePortal Financial Services Limited. All rights reserved.
          <br />
          Regulated by the Central Bank of Nigeria (CBN) | RC No. 1234567 | NDPC
          Registration No. NDPC-2024-001234
        </div>
      </div>
    </div>
  );
}
