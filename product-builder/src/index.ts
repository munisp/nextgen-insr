import express from "express";
import { ProductBuilderEngine } from "./engine/builder";
import { PremiumFormulaEngine } from "./engine/premium";
import { UnderwritingRuleEngine } from "./engine/underwriting";
import { ClaimsWorkflowEngine } from "./engine/claims-workflow";

const app = express();
app.use(express.json());

const builder = new ProductBuilderEngine();
const premiumEngine = new PremiumFormulaEngine();
const underwritingEngine = new UnderwritingRuleEngine();
const claimsEngine = new ClaimsWorkflowEngine();

// Product Builder API
app.get("/api/v1/builder/templates", (_req, res) => {
  res.json({ templates: builder.getTemplates() });
});

// Fail-closed (2026-10-01, C2d): persistence errors surface as 500, never
// as a silent in-memory success.
app.post("/api/v1/builder/products", async (req, res) => {
  try {
    const product = await builder.createProduct(req.body);
    res.status(201).json(product);
  } catch (e) {
    res.status(500).json({ error: "Failed to persist product", detail: String(e) });
  }
});

app.get("/api/v1/builder/products", async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ products: await builder.listProducts(status) });
  } catch (e) {
    res.status(500).json({ error: "Failed to load products", detail: String(e) });
  }
});

app.get("/api/v1/builder/products/:id", async (req, res) => {
  try {
    const product = await builder.getProduct(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (e) {
    res.status(500).json({ error: "Failed to load product", detail: String(e) });
  }
});

app.put("/api/v1/builder/products/:id", async (req, res) => {
  try {
    const product = await builder.updateProduct(req.params.id, req.body);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (e) {
    res.status(500).json({ error: "Failed to persist product update", detail: String(e) });
  }
});

app.post("/api/v1/builder/products/:id/publish", async (req, res) => {
  try {
    const result = await builder.publishProduct(req.params.id);
    if ("error" in result) return res.status(404).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Failed to publish product", detail: String(e) });
  }
});

app.post("/api/v1/builder/products/:id/retire", async (req, res) => {
  try {
    const result = await builder.retireProduct(req.params.id);
    if ("error" in result) return res.status(404).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Failed to retire product", detail: String(e) });
  }
});

// Premium Formula API
app.post("/api/v1/builder/premium/calculate", (req, res) => {
  const result = premiumEngine.calculate(req.body.formula, req.body.variables);
  res.json(result);
});

// Underwriting Rules API
app.post("/api/v1/builder/underwriting/evaluate", (req, res) => {
  const result = underwritingEngine.evaluate(req.body.rules, req.body.applicant);
  res.json(result);
});

// Claims Workflow API
app.post("/api/v1/builder/claims-workflow/evaluate", (req, res) => {
  const result = claimsEngine.evaluate(req.body.workflow, req.body.claim);
  res.json(result);
});

app.get("/health", (_req, res) => {
  res.json({ status: "healthy", service: "product-builder" });
});

const port = process.env.PORT || 8096;

// Fail-closed boot (2026-10-01, C2d): without a durable product store the
// service must not start and silently accept writes that would be lost.
builder
  .init()
  .then(() => {
    app.listen(port, () => {
      console.log(`Product Builder listening on port ${port}`);
    });
  })
  .catch((e) => {
    console.error(`FATAL: product store initialization failed (refusing to start): ${e}`);
    process.exit(1);
  });
