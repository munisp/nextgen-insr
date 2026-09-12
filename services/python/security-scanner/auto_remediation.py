"""
Security scanner auto-remediation engine.

SecurityRemediationEngine.scan_code() performs REAL static analysis of
Python source (AST-based, not vibes): hardcoded secrets, weak hashes,
unsafe deserialization, shell injection sinks, debug-mode servers.

remediate() applies only fixes that are provably safe rewrites
(md5->sha256 for non-security use is NOT auto-applied — changing a hash
breaks stored digests, so it is reported as manual). Every finding reports
whether it was auto-fixed or requires a human; nothing is claimed fixed
that was not rewritten. verify() re-scans the rewritten source and reports
the honest before/after counts.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field

SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|secret|password|token)\s*=\s*['\"][^'\"]{8,}['\"]"),
    re.compile(r"AKIA[0-9A-Z]{16}"),  # AWS access key id
    re.compile(r"-----BEGIN (RSA |EC )?PRIVATE KEY-----"),
]

WEAK_HASH_CALLS = {"md5", "sha1"}
SHELL_SINKS = {"os.system", "os.popen", "subprocess.call", "subprocess.run", "subprocess.Popen"}
UNSAFE_YAML_LOAD = re.compile(r"yaml\.load\((?![^)]*Loader=)")


@dataclass
class Finding:
    rule: str
    severity: str  # critical | high | medium | low
    line: int
    detail: str
    auto_fixable: bool
    fixed: bool = False


@dataclass
class ScanResult:
    findings: list[Finding] = field(default_factory=list)
    lines_scanned: int = 0

    def counts(self) -> dict:
        out: dict[str, int] = {}
        for f in self.findings:
            out[f.severity] = out.get(f.severity, 0) + 1
        return out


class SecurityRemediationEngine:
    """AST-driven scanner + conservative auto-fixer."""

    # ── scanning ────────────────────────────────────────────────────────────

    def scan_code(self, source: str, filename: str = "<memory>") -> ScanResult:
        """Scan Python source; returns every real finding with its line."""
        result = ScanResult(lines_scanned=source.count("\n") + 1)
        lines = source.splitlines()

        for lineno, line in enumerate(lines, start=1):
            if line.strip().startswith("#"):
                continue
            for pat in SECRET_PATTERNS:
                if pat.search(line):
                    result.findings.append(Finding(
                        rule="hardcoded-secret", severity="critical", line=lineno,
                        detail=f"possible hardcoded credential in {filename}:{lineno}",
                        auto_fixable=False))

        try:
            tree = ast.parse(source)
        except SyntaxError as e:
            result.findings.append(Finding(
                rule="unparseable", severity="low", line=e.lineno or 0,
                detail=f"source does not parse: {e}", auto_fixable=False))
            return result

        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                name = self._call_name(node)
                short = name.rsplit(".", 1)[-1]
                if short in WEAK_HASH_CALLS:
                    result.findings.append(Finding(
                        rule="weak-hash", severity="high", line=node.lineno,
                        detail=f"{name}() is cryptographically broken",
                        auto_fixable=False))  # changing the hash breaks stored digests — human decision
                if name in SHELL_SINKS and node.args and self._has_nonliteral(node.args[0]):
                    result.findings.append(Finding(
                        rule="shell-injection", severity="critical", line=node.lineno,
                        detail=f"{name}() called with non-literal command — injection risk",
                        auto_fixable=False))
                if name in ("eval", "exec"):
                    result.findings.append(Finding(
                        rule="dynamic-exec", severity="high", line=node.lineno,
                        detail=f"{name}() executes dynamic input",
                        auto_fixable=False))
                if name == "yaml.load" and not any(
                        kw.arg == "Loader" for kw in node.keywords):
                    result.findings.append(Finding(
                        rule="unsafe-yaml-load", severity="high", line=node.lineno,
                        detail="yaml.load() without a SafeLoader allows arbitrary object construction",
                        auto_fixable=True))  # safe rewrite: yaml.safe_load(...)
                if name == "pickle.loads" or name == "pickle.load":
                    result.findings.append(Finding(
                        rule="unsafe-deserialization", severity="high", line=node.lineno,
                        detail=f"{name}() on untrusted data enables code execution",
                        auto_fixable=False))
                if name.endswith(".run") and any(
                        kw.arg == "debug" and isinstance(kw.value, ast.Constant)
                        and kw.value.value is True for kw in node.keywords):
                    result.findings.append(Finding(
                        rule="debug-server", severity="medium", line=node.lineno,
                        detail="server started with debug=True", auto_fixable=True))
        return result

    @staticmethod
    def _call_name(node: ast.Call) -> str:
        parts = []
        f = node.func
        while isinstance(f, ast.Attribute):
            parts.append(f.attr)
            f = f.value
        if isinstance(f, ast.Name):
            parts.append(f.id)
        return ".".join(reversed(parts))

    @staticmethod
    def _has_nonliteral(node: ast.expr) -> bool:
        return not isinstance(node, ast.Constant)

    # ── remediation ─────────────────────────────────────────────────────────

    def remediate(self, source: str) -> tuple[str, ScanResult]:
        """Apply ONLY provably-safe rewrites. Returns (new_source, findings).

        Findings not auto_fixable are left in place with fixed=False — they
        still appear in the post-scan, so nothing is hidden.
        """
        findings = self.scan_code(source).findings
        new = source
        for f in findings:
            if not f.auto_fixable:
                continue
            if f.rule == "unsafe-yaml-load":
                # yaml.load(x) -> yaml.safe_load(x) (same call shape, safe ctor)
                rewritten, n = UNSAFE_YAML_LOAD.subn("yaml.safe_load(", new)
                if n:
                    new = rewritten
                    f.fixed = True
            elif f.rule == "debug-server":
                new2 = re.sub(r"debug=True", "debug=False", new, count=1)
                if new2 != new:
                    new = new2
                    f.fixed = True
        return new, ScanResult(findings=findings, lines_scanned=source.count("\n") + 1)

    def verify(self, original: str, remediated: str) -> dict:
        """Honest before/after: re-scan the rewritten source and diff rules."""
        from collections import Counter

        before = Counter(f.rule for f in self.scan_code(original).findings)
        after = Counter(f.rule for f in self.scan_code(remediated).findings)
        fixed = {rule: n - after.get(rule, 0) for rule, n in before.items()}
        return {
            "before": sum(before.values()),
            "after": sum(after.values()),
            "fixed_by_rule": {r: n for r, n in fixed.items() if n > 0},
            "remaining_by_rule": dict(after),
        }
