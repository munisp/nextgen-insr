# GitHub Advanced Security — Setup Guide

This guide explains how to enable and configure GitHub Advanced Security (GHAS) for the
InsurePortal POS Shell repository to activate CodeQL SAST, secret scanning, and Dependabot security alerts.

---

## What GitHub Advanced Security Provides

| Feature                         | Description                                                                              | Cost                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------- |
| **CodeQL SAST**                 | Static analysis for JS/TS, Go, Python — finds injection, XSS, path traversal, etc.       | Free for public repos; paid for private |
| **Secret Scanning**             | Detects accidentally committed API keys, tokens, passwords                               | Free for public repos; paid for private |
| **Dependabot Alerts**           | CVE alerts for all dependency ecosystems (npm, Go, Python, Docker)                       | Free for all repos                      |
| **Dependabot Security Updates** | Auto-opens PRs to fix vulnerable dependencies                                            | Free for all repos                      |
| **Dependabot Version Updates**  | Auto-opens PRs for dependency upgrades (already configured via `.github/dependabot.yml`) | Free for all repos                      |

---

## Step 1 — Enable GitHub Advanced Security

### For Public Repositories (Free)

GitHub Advanced Security is automatically available. No action needed.

### For Private Repositories

1. Go to **Repository → Settings → Security & analysis**
2. Click **Enable** next to "GitHub Advanced Security"
3. Confirm the licence cost (billed per active committer per month)

---

## Step 2 — Enable Individual Features

Navigate to **Repository → Settings → Security & analysis** and enable:

| Setting                         | Recommended Value                                                   |
| ------------------------------- | ------------------------------------------------------------------- |
| Dependency graph                | Enabled                                                             |
| Dependabot alerts               | Enabled                                                             |
| Dependabot security updates     | Enabled                                                             |
| Dependabot version updates      | Enabled (configured via `.github/dependabot.yml`)                   |
| Code scanning                   | Enabled (CodeQL workflow already in `.github/workflows/codeql.yml`) |
| Secret scanning                 | Enabled                                                             |
| Secret scanning push protection | Enabled (blocks pushes containing secrets)                          |

---

## Step 3 — Activate Push Protection

Secret scanning push protection blocks commits containing secrets **before** they reach
the repository. This is the strongest protection available.

```bash
# Enable via GitHub CLI
gh api \
  --method PATCH \
  /repos/YOUR_ORG/agent-dashboard \
  -f security_and_analysis[secret_scanning][status]=enabled \
  -f security_and_analysis[secret_scanning_push_protection][status]=enabled
```

Or enable in **Repository → Settings → Security & analysis → Secret scanning → Push protection → Enable**.

---

## Step 4 — Configure Dependabot Security Alerts

Dependabot alerts are already configured for all ecosystems via `.github/dependabot.yml`.
To receive email notifications:

1. Go to **Profile → Settings → Notifications**
2. Under "Dependabot alerts", select "Email" and "Web"
3. For critical alerts, also enable "Slack" if your organisation uses GitHub Slack integration

---

## Step 5 — Review CodeQL Results

After the first `codeql.yml` workflow run:

1. Go to **Repository → Security → Code scanning alerts**
2. Filter by severity: Critical, High, Medium
3. For each alert, either fix the code or dismiss with justification
4. Dismissed alerts are tracked with the dismisser's identity and reason

### CodeQL Query Suites Used

The `codeql.yml` workflow uses `security-extended,security-and-quality` which includes:

| Suite                  | Coverage                                                       |
| ---------------------- | -------------------------------------------------------------- |
| `security-extended`    | OWASP Top 10, CWE Top 25, injection, XSS, SSRF, path traversal |
| `security-and-quality` | Code quality issues that can become security vulnerabilities   |

---

## Step 6 — Set Up Security Advisories

For coordinated vulnerability disclosure:

1. Go to **Repository → Security → Security advisories**
2. Click "New draft security advisory"
3. Use this for internal tracking of vulnerabilities before public disclosure

The `security.txt` file at `client/public/.well-known/security.txt` already directs
external researchers to the correct disclosure channel.

---

## Viewing All Security Alerts

All security alerts are aggregated in **Repository → Security**:

```
Security
├── Overview          — Dashboard of all alerts by severity
├── Dependabot        — CVEs in dependencies
├── Code scanning     — CodeQL SAST findings
├── Secret scanning   — Accidentally committed secrets
└── Advisories        — Internal security advisory drafts
```

---

## Integration with Branch Protection

The `codeql.yml` workflow produces status checks that can be added to branch protection.
After the first successful run, add these to `.github/branch-protection.json`:

```json
"CodeQL — JavaScript/TypeScript",
"CodeQL — Go",
"CodeQL — Python"
```

Then re-run `scripts/setup-branch-protection.sh` to apply the updated rules.

---

## Estimated Alert Volume (First Run)

Based on the codebase size (~5,100 source files), expect approximately:

| Language              | Estimated Alerts | Expected Severity |
| --------------------- | ---------------- | ----------------- |
| JavaScript/TypeScript | 5–15             | Mostly Medium/Low |
| Go                    | 0–5              | Mostly Low        |
| Python                | 3–10             | Mostly Medium/Low |

Most alerts will be code quality issues (unused variables, missing error handling) rather
than exploitable vulnerabilities, given the security hardening already applied.
