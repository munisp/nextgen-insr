# Snyk CVE Scanning — Setup Guide

This guide explains how to activate the `snyk-scan` CI job in `.github/workflows/ci.yml`
for the InsurePortal InsurePortal Platform platform.

---

## Overview

The `snyk-scan` CI job performs two scans on every push to `main` and `develop`:

1. **npm dependency scan** — checks all direct and transitive npm packages against the Snyk
   vulnerability database (broader coverage than `npm audit`)
2. **IaC scan** — checks all Dockerfiles, `docker-compose*.yml`, and Kubernetes manifests for
   misconfigurations

Results are uploaded to the **GitHub Security tab** as SARIF and retained as downloadable
artifacts for 30 days.

---

## Step 1 — Create a Snyk Account

1. Visit [https://app.snyk.io/login](https://app.snyk.io/login)
2. Sign up with your GitHub account (free tier supports unlimited open-source scans)
3. Navigate to **Account Settings → API Token**
4. Copy the token (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

---

## Step 2 — Add `SNYK_TOKEN` to GitHub Actions Secrets

```bash
# Option A: GitHub CLI (recommended)
gh secret set SNYK_TOKEN --repo YOUR_ORG/platform-shell --body "YOUR_SNYK_TOKEN"

# Option B: GitHub web UI
# Repository → Settings → Secrets and variables → Actions → New repository secret
# Name: SNYK_TOKEN
# Value: <your token>
```

---

## Step 3 — Verify the CI Job Activates

After adding the secret, push any commit to `main` or `develop`. The `snyk-scan` job
will appear in the Actions tab. On success:

- Green check on the `snyk-scan` job
- SARIF report visible in **Security → Code scanning alerts**
- JSON artifact downloadable from the Actions run summary

---

## Severity Thresholds

The CI job is configured with `--severity-threshold=high` and `--fail-on=upgradable`.
This means:

| Severity | Behaviour                                  |
| -------- | ------------------------------------------ |
| Critical | Fails the build if an upgrade is available |
| High     | Fails the build if an upgrade is available |
| Medium   | Reported in SARIF, does not fail the build |
| Low      | Reported in SARIF, does not fail the build |

To change thresholds, edit `.github/workflows/ci.yml` → `snyk-scan` job → `args`.

---

## Snyk `.snyk` Policy File

A `.snyk` policy file can be used to ignore specific vulnerabilities with justification:

```yaml
# .snyk — Snyk policy file
# Ignore specific CVEs with justification and expiry date
ignore:
  SNYK-JS-EXAMPLE-12345:
    - "*":
        reason: "Not exploitable in our usage — we do not call the vulnerable function"
        expires: "2026-12-31T00:00:00.000Z"
        created: "2026-04-10T00:00:00.000Z"
patch: {}
```

Create this file at the repository root when needed.

---

## IaC Scan Coverage

The IaC scan checks the following files automatically:

| File                     | Checks                                             |
| ------------------------ | -------------------------------------------------- |
| `Dockerfile`             | Non-root USER, no `latest` tags, no secrets in ENV |
| `docker-compose*.yml`    | Privileged mode, host networking, volume mounts    |
| `infra/tigerbeetle/`     | Port exposure, resource limits                     |
| `infra/apisix/`          | Admin API exposure                                 |
| `monitoring/prometheus/` | Retention limits, authentication                   |

---

## Integration with Branch Protection

The `snyk-scan` job is listed as a required status check in `.github/branch-protection.json`.
After running `scripts/setup-branch-protection.sh`, PRs to `main` will be blocked if the
Snyk scan fails.

---

## Troubleshooting

**Job skipped:** The `if: ${{ secrets.SNYK_TOKEN != '' }}` condition means the job is
silently skipped if the secret is not set. This is intentional for forks and contributors
who do not have access to the secret.

**SARIF upload fails:** GitHub Advanced Security must be enabled on the repository
(free for public repos, requires GitHub Advanced Security licence for private repos).
See [GitHub Advanced Security Setup](./GITHUB_ADVANCED_SECURITY.md).

**IaC scan errors:** Snyk IaC requires the repository to be imported in the Snyk dashboard.
Visit [https://app.snyk.io/org/YOUR_ORG/projects](https://app.snyk.io/org/YOUR_ORG/projects)
and import the repository.
