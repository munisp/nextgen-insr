import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const CHARTS_DIR = path.resolve(__dirname, "../k8s/charts");

const EXPECTED_CHARTS = [
  "kafka",
  "redis",
  "temporal",
  "keycloak",
  "opensearch",
  "apisix",
  "mojaloop",
  "permify",
  "dapr",
  "fluvio",
  "lakehouse",
  "tigerbeetle",
  "postgresql",
];

describe("Kubernetes Helm Charts", () => {
  describe("Chart Directory Structure", () => {
    it("should have all 13 middleware chart directories", () => {
      for (const chart of EXPECTED_CHARTS) {
        const chartDir = path.join(CHARTS_DIR, chart);
        expect(fs.existsSync(chartDir), `Missing chart: ${chart}`).toBe(true);
      }
    });

    it("should have the umbrella chart", () => {
      const umbrella = path.join(CHARTS_DIR, "pos-insureportal-umbrella");
      expect(fs.existsSync(umbrella)).toBe(true);
    });

    it("should have Chart.yaml for each component", () => {
      for (const chart of EXPECTED_CHARTS) {
        const chartYaml = path.join(CHARTS_DIR, chart, "Chart.yaml");
        expect(fs.existsSync(chartYaml), `Missing Chart.yaml: ${chart}`).toBe(
          true
        );
      }
    });

    it("should have values.yaml for each component", () => {
      for (const chart of EXPECTED_CHARTS) {
        const valuesYaml = path.join(CHARTS_DIR, chart, "values.yaml");
        expect(fs.existsSync(valuesYaml), `Missing values.yaml: ${chart}`).toBe(
          true
        );
      }
    });

    it("should have templates directory for each component", () => {
      for (const chart of EXPECTED_CHARTS) {
        const templatesDir = path.join(CHARTS_DIR, chart, "templates");
        expect(
          fs.existsSync(templatesDir),
          `Missing templates/: ${chart}`
        ).toBe(true);
      }
    });
  });

  describe("Chart.yaml Validation", () => {
    for (const chart of EXPECTED_CHARTS) {
      it(`${chart}: Chart.yaml should have apiVersion v2`, () => {
        const content = fs.readFileSync(
          path.join(CHARTS_DIR, chart, "Chart.yaml"),
          "utf-8"
        );
        expect(content).toContain("apiVersion: v2");
      });

      it(`${chart}: Chart.yaml should have version field`, () => {
        const content = fs.readFileSync(
          path.join(CHARTS_DIR, chart, "Chart.yaml"),
          "utf-8"
        );
        expect(content).toMatch(/version:\s+["']?\d+\.\d+\.\d+/);
      });
    }
  });

  describe("Template Validation", () => {
    for (const chart of EXPECTED_CHARTS) {
      it(`${chart}: should have at least 3 template files`, () => {
        const templatesDir = path.join(CHARTS_DIR, chart, "templates");
        const files = fs.readdirSync(templatesDir);
        expect(files.length).toBeGreaterThanOrEqual(3);
      });

      it(`${chart}: should have service.yaml template`, () => {
        const service = path.join(
          CHARTS_DIR,
          chart,
          "templates",
          "service.yaml"
        );
        expect(fs.existsSync(service), `Missing service.yaml: ${chart}`).toBe(
          true
        );
      });

      it(`${chart}: should have a workload template (deployment or statefulset)`, () => {
        const templatesDir = path.join(CHARTS_DIR, chart, "templates");
        const files = fs.readdirSync(templatesDir);
        const hasWorkload = files.some(
          f => f.includes("deployment") || f.includes("statefulset")
        );
        expect(hasWorkload, `Missing workload template: ${chart}`).toBe(true);
      });
    }
  });

  describe("Values.yaml Validation", () => {
    for (const chart of EXPECTED_CHARTS) {
      it(`${chart}: values.yaml should define resource requests`, () => {
        const content = fs.readFileSync(
          path.join(CHARTS_DIR, chart, "values.yaml"),
          "utf-8"
        );
        expect(content.toLowerCase()).toMatch(/resources|cpu|memory/);
      });
    }
  });

  describe("Umbrella Chart", () => {
    it("should have Chart.yaml with all 13 dependencies", () => {
      const content = fs.readFileSync(
        path.join(CHARTS_DIR, "pos-insureportal-umbrella", "Chart.yaml"),
        "utf-8"
      );
      for (const chart of EXPECTED_CHARTS) {
        expect(content).toContain(`name: ${chart}`);
      }
    });

    it("should have values.yaml with all component sections", () => {
      const content = fs.readFileSync(
        path.join(CHARTS_DIR, "pos-insureportal-umbrella", "values.yaml"),
        "utf-8"
      );
      for (const chart of EXPECTED_CHARTS) {
        expect(content).toContain(`${chart}:`);
      }
    });

    it("should have values-production.yaml with production overrides", () => {
      const prodValues = path.join(
        CHARTS_DIR,
        "pos-insureportal-umbrella",
        "values-production.yaml"
      );
      expect(fs.existsSync(prodValues)).toBe(true);
      const content = fs.readFileSync(prodValues, "utf-8");
      expect(content).toContain("production");
    });

    it("should have namespace template", () => {
      const ns = path.join(
        CHARTS_DIR,
        "pos-insureportal-umbrella",
        "templates",
        "namespace.yaml"
      );
      expect(fs.existsSync(ns)).toBe(true);
    });

    it("should have network policy template", () => {
      const np = path.join(
        CHARTS_DIR,
        "pos-insureportal-umbrella",
        "templates",
        "networkpolicy.yaml"
      );
      expect(fs.existsSync(np)).toBe(true);
    });
  });

  describe("Template Content Quality", () => {
    for (const chart of EXPECTED_CHARTS) {
      it(`${chart}: templates should use Helm templating`, () => {
        const templatesDir = path.join(CHARTS_DIR, chart, "templates");
        const files = fs.readdirSync(templatesDir);
        let hasHelmSyntax = false;
        for (const file of files) {
          const content = fs.readFileSync(
            path.join(templatesDir, file),
            "utf-8"
          );
          if (content.includes("{{") && content.includes("}}")) {
            hasHelmSyntax = true;
            break;
          }
        }
        expect(hasHelmSyntax, `No Helm templating found in ${chart}`).toBe(
          true
        );
      });
    }
  });

  describe("Total Chart Count", () => {
    it("should have exactly 14 chart directories (13 + umbrella)", () => {
      const dirs = fs
        .readdirSync(CHARTS_DIR)
        .filter(d => fs.statSync(path.join(CHARTS_DIR, d)).isDirectory());
      expect(dirs.length).toBe(14);
    });

    it("should have 90+ template files across all charts", () => {
      let totalTemplates = 0;
      const dirs = fs.readdirSync(CHARTS_DIR);
      for (const dir of dirs) {
        const templatesDir = path.join(CHARTS_DIR, dir, "templates");
        if (fs.existsSync(templatesDir)) {
          totalTemplates += fs.readdirSync(templatesDir).length;
        }
      }
      expect(totalTemplates).toBeGreaterThanOrEqual(90);
    });
  });
});
