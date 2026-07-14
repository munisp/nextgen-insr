# Comprehensive KYC/KYB/Liveness Improvement Recommendations

**Platform:** InsurePortal Platform — Agent Banking & Financial Services  
**Date:** May 2026  
**Scope:** Identity verification, business verification, and biometric liveness detection for Nigerian POS agent networks

---

## Executive Summary

The InsurePortal Platform platform currently implements a multi-layered KYC/KYB system with active liveness detection, document verification, and device fingerprinting. This document provides actionable recommendations across six categories to bring the platform to ISO 30107-3 compliance, defend against deepfake injection attacks, meet CBN 2026 baseline standards, and improve conversion rates on budget African devices.

---

## 1. Liveness Detection Enhancements

### 1.1 Deepfake Injection Attack Prevention

The most critical emerging threat to mobile KYC is **virtual camera injection** — attackers use tools like ManyCam, OBS Virtual Camera, or rooted device camera hooks to inject pre-recorded or AI-generated video directly into the camera feed, bypassing all optical liveness checks.

| Threat Vector            | Current Defense                     | Recommended Enhancement                                                                                                        |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Virtual camera injection | None                                | Browser API fingerprinting: detect `enumerateDevices()` anomalies, check `MediaStreamTrack.getSettings()` for synthetic labels |
| Deepfake video replay    | Active challenges (blink/turn/nod)  | Add **3D depth estimation** via monocular depth networks (MiDaS) — flat images have uniform depth                              |
| Printed photo attack     | Texture/frequency analysis          | Add **specular reflection challenge** — flash the screen white and analyze reflection pattern on face                          |
| Screen replay attack     | Edge detection + bright pixel check | Add **moiré pattern detection** — screens produce characteristic interference patterns at certain angles                       |
| Mask/prosthetic attack   | Color analysis                      | Add **skin perfusion detection** — measure subtle color changes from blood flow using rPPG (remote photoplethysmography)       |

**Implementation priority:** Virtual camera detection (HIGH) → 3D depth estimation (HIGH) → Specular reflection (MEDIUM) → Moiré detection (MEDIUM) → rPPG (LOW — requires high-quality camera).

### 1.2 Multi-Challenge Randomization

Current implementation uses a fixed challenge sequence. Attackers can pre-record responses for known sequences.

**Recommendation:** Implement a randomized challenge pool with dynamic ordering:

- Pool of 8+ challenge types: blink, turn left, turn right, nod up, nod down, smile, open mouth, raise eyebrows
- Randomly select 3 challenges per session from the pool
- Vary timing requirements (1.5s–3.5s per challenge)
- Add "hold still" phases between challenges to detect pre-recorded motion
- Include one "surprise" challenge that appears mid-sequence with a 2-second response window

### 1.3 Passive Liveness Improvements

The current passive liveness uses texture, frequency, color, and edge analysis. Enhance with:

- **Micro-expression detection** — real faces exhibit involuntary micro-movements (pupil dilation, micro-saccades) that static images and videos lack
- **Environmental consistency check** — verify that lighting direction on the face matches the ambient environment (inconsistency suggests compositing)
- **Temporal consistency** — analyze 3–5 frames for natural micro-motion patterns (breathing, subtle head sway) that are absent in static presentations

### 1.4 ISO 30107-3 Compliance Path

To achieve ISO 30107-3 Level 2 (APCER < 5%, BPCER < 5%):

1. **Establish a PAD test dataset** — collect 500+ presentation attack samples across all attack types (print, screen, mask, deepfake) using devices common in the Nigerian market
2. **Implement attack-type-specific scoring** — separate scores for 2D attacks (print/screen) vs. 3D attacks (mask/prosthetic) vs. digital injection
3. **Report APCER per attack instrument** — track and report attack success rates per attack type, not just aggregate
4. **Third-party testing** — engage iBeta or equivalent lab for formal ISO 30107-3 certification

---

## 2. KYC Process Improvements

### 2.1 CBN 2026 Baseline Compliance

The Central Bank of Nigeria's 2026 baseline standards require:

| Requirement                       | Current Status             | Gap                                                   |
| --------------------------------- | -------------------------- | ----------------------------------------------------- |
| BVN verification for all agents   | Implemented (kycClient.ts) | None                                                  |
| NIN cross-reference               | Implemented                | None                                                  |
| Tiered KYC (Level 1/2/3)          | Partial — single tier      | Implement 3-tier system with progressive limits       |
| Real-time BVN-NIN linkage check   | Not implemented            | Add NIBSS API integration for real-time validation    |
| Biometric deduplication           | Not implemented            | Add 1:N face matching against enrolled agent database |
| Periodic re-verification (annual) | Not implemented            | Add scheduled re-KYC workflow with notification       |
| PEP/sanctions screening           | Not implemented            | Integrate ComplyAdvantage or Refinitiv World-Check    |

### 2.2 Tiered KYC Implementation

Implement CBN's 3-tier system for agent onboarding:

**Tier 1 (Basic — ₦50K daily limit):**

- Phone number verification (OTP)
- BVN validation
- Selfie capture (passive liveness only)
- Maximum 3 transactions per day

**Tier 2 (Standard — ₦200K daily limit):**

- All Tier 1 requirements
- NIN verification with photo match
- Active liveness check (2 challenges)
- Utility bill or address proof
- Maximum 10 transactions per day

**Tier 3 (Enhanced — ₦5M daily limit):**

- All Tier 2 requirements
- Full active liveness (3 randomized challenges)
- Government ID document scan (NFC chip reading if available)
- In-person verification by super-agent OR video call verification
- PEP/sanctions screening
- Annual re-verification required

### 2.3 NFC Document Verification

For agents with NFC-enabled smartphones and chip-bearing documents (Nigerian ePassport, some national IDs):

- **Passive Authentication (PA)** — verify the document's digital signature chain back to the issuing country's CSCA certificate
- **Active Authentication (AA)** — challenge-response with the chip to prove physical possession
- **Chip Authentication (CA)** — establish encrypted channel to prevent eavesdropping

This provides cryptographic proof that the document is genuine and unaltered — far stronger than OCR-based document verification alone.

### 2.4 Document Fraud Detection

Enhance document verification with:

- **Template matching** — maintain a database of genuine document templates (Nigerian passport, voter's card, driver's license) and detect deviations in layout, font, hologram placement
- **MRZ consistency check** — validate Machine Readable Zone checksums against visual zone data
- **Photo tampering detection** — analyze JPEG compression artifacts, edge inconsistencies around the photo area, and EXIF metadata anomalies
- **Cross-document consistency** — verify that name, DOB, and photo match across BVN record, NIN record, and submitted documents

---

## 3. KYB (Know Your Business) Enhancements

### 3.1 Business Verification Workflow

For merchant and super-agent onboarding:

| Verification Step                              | Data Source               | Automation Level      |
| ---------------------------------------------- | ------------------------- | --------------------- |
| CAC registration check                         | CAC API                   | Fully automated       |
| Business name/RC number validation             | CAC registry              | Fully automated       |
| Director/shareholder identification            | CAC + BVN                 | Semi-automated        |
| Tax clearance (TIN) verification               | FIRS API                  | Fully automated       |
| Physical address verification                  | Google Maps + agent visit | Semi-automated        |
| Bank account ownership confirmation            | NIBSS NIP                 | Fully automated       |
| UBO (Ultimate Beneficial Owner) identification | Manual + CAC              | Manual with AI assist |

### 3.2 Ongoing Business Monitoring

- **Transaction pattern analysis** — flag businesses with sudden volume spikes (>300% of baseline)
- **Dormancy detection** — alert when a verified business has zero transactions for 30+ days
- **Ownership change detection** — periodic CAC re-check (quarterly) for director/shareholder changes
- **Adverse media screening** — automated news monitoring for business name + directors
- **Network analysis** — identify businesses sharing the same directors, addresses, or bank accounts (shell company detection)

### 3.3 Enhanced Due Diligence (EDD) Triggers

Automatically escalate to EDD when:

- Transaction volume exceeds ₦50M monthly
- Business operates in high-risk sectors (crypto, forex, real estate)
- Directors are PEPs or have adverse media hits
- Business is less than 6 months old with high transaction volumes
- Multiple businesses share the same registered address

---

## 4. Device and Infrastructure Improvements

### 4.1 Device Compatibility Matrix

Maintain a living device compatibility database:

| Device Category              | Market Share (Nigeria) | Liveness Approach              | Special Handling                      |
| ---------------------------- | ---------------------- | ------------------------------ | ------------------------------------- |
| Budget Android (<$100)       | ~45%                   | Passive-first, active fallback | Extended timeouts, relaxed thresholds |
| Mid-range Android ($100-300) | ~35%                   | Active with 2 challenges       | Standard thresholds                   |
| High-end Android (>$300)     | ~10%                   | Full active (3 challenges)     | Standard thresholds                   |
| iPhone (any)                 | ~8%                    | Full active (3 challenges)     | Standard thresholds                   |
| Feature phones (KaiOS)       | ~2%                    | Document-only (no liveness)    | SMS-based OTP verification            |

### 4.2 Progressive Enhancement Strategy

- **Camera quality detection** — measure resolution, noise floor, and frame rate before starting liveness
- **Adaptive challenge selection** — choose challenges that work best for the detected device capability
- **Graceful degradation chain:** Full active → Reduced active (1 challenge) → Passive → Document-only + in-person verification
- **Offline capability** — cache liveness challenges locally, queue results for sync when connectivity returns

### 4.3 Network Resilience for Rural Areas

- **Progressive image upload** — start with 320px thumbnail for initial check, upload full resolution only if needed
- **Compression-aware analysis** — train models on heavily compressed images (JPEG quality 30-50) common on 2G uploads
- **Store-and-forward** — allow agents to complete KYC capture offline, sync within 24 hours
- **SMS fallback** — for areas with no data connectivity, allow basic Tier 1 KYC via USSD/SMS (BVN + OTP only)

---

## 5. Fraud Prevention and Risk Scoring

### 5.1 Unified Risk Score

Combine all signals into a single 0-100 risk score:

| Signal                      | Weight | Description                                    |
| --------------------------- | ------ | ---------------------------------------------- |
| Liveness confidence         | 25%    | Active/passive liveness score                  |
| Document authenticity       | 20%    | Template match + MRZ + tampering score         |
| Geo-IP correlation          | 15%    | Impossible travel, VPN, country mismatch       |
| Device reputation           | 15%    | Historical success rate, known issues          |
| Behavioral biometrics       | 10%    | Typing speed, touch pressure, gesture patterns |
| Network signals             | 10%    | IP reputation, ISP, time-of-day patterns       |
| Cross-reference consistency | 5%     | BVN-NIN-document photo match score             |

### 5.2 Behavioral Biometrics (Passive)

Collect during the KYC flow without requiring explicit user action:

- **Touch dynamics** — pressure, area, duration of screen touches
- **Accelerometer patterns** — how the user holds the phone (angle, stability)
- **Typing cadence** — rhythm and speed when entering personal information
- **Navigation patterns** — time spent on each screen, scroll behavior
- **Session fingerprint** — combine all behavioral signals into a unique session profile

These create a "behavioral signature" that is extremely difficult to replicate, even with stolen credentials.

### 5.3 Velocity and Pattern Rules

- **Same-device multi-identity** — flag if the same device fingerprint attempts KYC for 3+ different identities within 7 days
- **Photo reuse detection** — perceptual hash comparison against all previously submitted photos
- **Rapid sequential attempts** — flag if same BVN/NIN is used in 5+ KYC attempts across different platforms within 24 hours (requires industry data sharing)
- **Geographic clustering** — flag if 10+ new agent registrations originate from the same GPS coordinates within 48 hours

---

## 6. Compliance and Audit

### 6.1 Audit Trail Requirements

Every KYC/KYB decision must have:

- Timestamp (UTC) of each verification step
- Raw input data hash (for non-repudiation without storing PII)
- Decision rationale (which checks passed/failed and why)
- Reviewer identity (for manual reviews)
- Retention period tag (7 years per CBN requirement)
- GDPR/NDPA data subject access request support

### 6.2 Regulatory Reporting

Automated reports for CBN compliance:

- Monthly KYC completion rates (by tier)
- Suspicious activity reports (SARs) auto-generated from risk scores >80
- Failed verification statistics (by failure reason)
- Agent churn correlation with KYC friction
- Re-verification compliance rates

### 6.3 Data Protection (NDPA Compliance)

Nigeria's Data Protection Act 2023 requirements:

- **Purpose limitation** — biometric data used only for identity verification, not marketing
- **Data minimization** — store only verification results and confidence scores, not raw biometric templates
- **Right to erasure** — implement `clearGeoIpData()` pattern across all PII stores
- **Cross-border transfer** — ensure biometric processing happens within Nigeria or in adequate jurisdictions
- **Breach notification** — 72-hour notification to NDPC for any biometric data breach

---

## 7. Implementation Roadmap

### Phase 1 (Immediate — 0-30 days)

- Virtual camera injection detection
- Multi-challenge randomization
- Tiered KYC implementation (Tier 1/2/3)
- Device compatibility matrix automation

### Phase 2 (Short-term — 30-90 days)

- 3D depth estimation for deepfake defense
- NFC document verification (for supported devices)
- PEP/sanctions screening integration
- Behavioral biometrics collection (passive)

### Phase 3 (Medium-term — 90-180 days)

- Full KYB workflow with CAC/FIRS integration
- ISO 30107-3 formal testing preparation
- Biometric deduplication (1:N matching)
- Cross-platform fraud signal sharing

### Phase 4 (Long-term — 180-365 days)

- rPPG-based skin perfusion detection
- Industry consortium for fraud signal sharing
- AI model retraining with Nigerian-specific attack datasets
- Formal ISO 30107-3 Level 2 certification

---

## 8. Key Metrics to Track

| Metric                                | Current Baseline | Target          | Measurement        |
| ------------------------------------- | ---------------- | --------------- | ------------------ |
| Liveness pass rate (legitimate users) | ~85%             | >95%            | Monthly            |
| Liveness false accept rate (attacks)  | Unknown          | <3%             | Quarterly red-team |
| KYC completion rate (start to finish) | ~70%             | >90%            | Weekly             |
| Average KYC completion time           | ~8 minutes       | <4 minutes      | Weekly             |
| Device-specific failure rate          | Varies           | <10% per device | Monthly            |
| Deepfake detection rate               | Unknown          | >97%            | Quarterly          |
| Document fraud detection rate         | Unknown          | >95%            | Quarterly          |
| Agent onboarding dropout (due to KYC) | ~25%             | <10%            | Monthly            |

---

## References

1. ISO/IEC 30107-1:2023 — Biometric Presentation Attack Detection Framework
2. ISO/IEC 30107-3:2017 — PAD Testing and Reporting
3. CBN Tiered KYC Requirements (2013, updated 2026)
4. CBN Baseline Standards 2026 for KYC/KYB/AML
5. Nigeria Data Protection Act 2023 (NDPA)
6. FATF Guidance on Digital Identity (2020)
7. iBeta ISO 30107-3 PAD Testing Methodology
8. NIBSS BVN/NIN Verification API Documentation
