// TypeScript enabled — Sprint 96 security audit
/**
 * compliancePdf.ts
 * Generates a weekly security compliance report PDF using pdfkit,
 * uploads it to S3, and returns the public URL + S3 key.
 */
import PDFDocument from "pdfkit";

export interface ComplianceReportData {
  periodStart: Date;
  periodEnd: Date;
  totalAlerts: number;
  highAlerts: number;
  mediumAlerts: number;
  lowAlerts: number;
  criticalAlerts?: number;
  escalatedAlerts: number;
  resolvedAlerts: number;
  topOffenders: Array<{ agentKey: string; count: number }>;
  byType: Record<string, number>;
}

/** Generates a PDF buffer from the compliance report data. */
export async function generateCompliancePdfBuffer(
  data: ComplianceReportData
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const GREEN = "#16a34a";
    const RED = "#dc2626";
    const AMBER = "#d97706";
    const BLUE = "#2563eb";
    const DARK = "#111827";
    const LIGHT = "#f9fafb";
    const BORDER = "#e5e7eb";

    const fmt = (d: Date) =>
      d.toLocaleDateString("en-NG", { dateStyle: "medium" });

    // ── Header ──────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill(DARK);
    doc
      .fillColor("#ffffff")
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("InsurePortal — Weekly Security Compliance Report", 50, 22, {
        width: doc.page.width - 100,
      });
    doc
      .fillColor("#9ca3af")
      .fontSize(10)
      .font("Helvetica")
      .text(
        `Period: ${fmt(data.periodStart)} – ${fmt(data.periodEnd)}   |   Generated: ${fmt(new Date())}`,
        50,
        52
      );

    doc.moveDown(3);

    // ── Summary Cards ────────────────────────────────────────────────────────
    const cardY = 100;
    const cardW = 110;
    const cardH = 60;
    const cardGap = 12;
    const startX = 50;

    const cards = [
      { label: "Total Alerts", value: data.totalAlerts, color: BLUE },
      {
        label: "Critical/High",
        value: (data.criticalAlerts ?? 0) + data.highAlerts,
        color: RED,
      },
      { label: "Medium", value: data.mediumAlerts, color: AMBER },
      { label: "Escalated", value: data.escalatedAlerts, color: RED },
      { label: "Resolved", value: data.resolvedAlerts, color: GREEN },
    ];

    cards.forEach((card, i) => {
      const x = startX + i * (cardW + cardGap);
      doc.rect(x, cardY, cardW, cardH).fill(LIGHT);
      doc.rect(x, cardY, 4, cardH).fill(card.color);
      doc
        .fillColor(DARK)
        .fontSize(22)
        .font("Helvetica-Bold")
        .text(String(card.value), x + 12, cardY + 8, { width: cardW - 16 });
      doc
        .fillColor("#6b7280")
        .fontSize(9)
        .font("Helvetica")
        .text(card.label, x + 12, cardY + 36, { width: cardW - 16 });
    });

    doc.y = cardY + cardH + 24;

    // ── Alerts by Type ───────────────────────────────────────────────────────
    doc
      .fillColor(DARK)
      .fontSize(13)
      .font("Helvetica-Bold")
      .text("Alerts by Type", 50, doc.y);
    doc.moveDown(0.4);

    const typeEntries = Object.entries(data.byType).sort((a, b) => b[1] - a[1]);
    const maxTypeCount = Math.max(...typeEntries.map(([, c]) => c), 1);
    const barMaxW = 300;

    typeEntries.forEach(([type, count]) => {
      const y = doc.y;
      doc
        .fillColor("#374151")
        .fontSize(9)
        .font("Helvetica")
        .text(type, 50, y, { width: 160 });
      const barW = Math.max(4, (count / maxTypeCount) * barMaxW);
      doc.rect(220, y + 1, barW, 10).fill(BLUE);
      doc
        .fillColor(DARK)
        .fontSize(9)
        .text(String(count), 225 + barW, y, { width: 40 });
      doc.moveDown(0.6);
    });

    doc.moveDown(0.5);

    // ── Top Offending Agents ─────────────────────────────────────────────────
    doc
      .fillColor(DARK)
      .fontSize(13)
      .font("Helvetica-Bold")
      .text("Top Offending Agents", 50, doc.y);
    doc.moveDown(0.4);

    if (data.topOffenders.length === 0) {
      doc
        .fillColor("#6b7280")
        .fontSize(10)
        .font("Helvetica")
        .text("No offending agents this period.", 50, doc.y);
    } else {
      // Table header
      const tableX = 50;
      const tableY = doc.y;
      doc.rect(tableX, tableY, 460, 20).fill("#f3f4f6");
      doc
        .fillColor("#374151")
        .fontSize(9)
        .font("Helvetica-Bold")
        .text("Rank", tableX + 8, tableY + 5)
        .text("Agent", tableX + 60, tableY + 5)
        .text("Alert Count", tableX + 360, tableY + 5);
      doc.y = tableY + 20;

      data.topOffenders.slice(0, 10).forEach((o, idx) => {
        const rowY = doc.y;
        if (idx % 2 === 0) {
          doc.rect(tableX, rowY, 460, 18).fill(LIGHT);
        }
        doc
          .fillColor(DARK)
          .fontSize(9)
          .font("Helvetica")
          .text(`#${idx + 1}`, tableX + 8, rowY + 4)
          .text(o.agentKey, tableX + 60, rowY + 4, { width: 280 })
          .text(String(o.count), tableX + 360, rowY + 4);
        doc.y = rowY + 18;
      });
    }

    doc.moveDown(1.5);

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.rect(50, doc.y, 460, 1).fill(BORDER);
    doc.moveDown(0.5);
    doc
      .fillColor("#9ca3af")
      .fontSize(8)
      .font("Helvetica")
      .text(
        "This report is auto-generated by the InsurePortal compliance engine. Retain for a minimum of 7 years per CBN guidelines.",
        50,
        doc.y,
        { width: 460, align: "center" }
      );

    doc.end();
  });
}
