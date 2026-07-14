export async function generateCompliancePdf(data: Record<string, unknown>): Promise<Buffer> {
  // Stub: returns empty PDF buffer
  return Buffer.from("%PDF-1.4 stub");
}
export async function generateAuditReport(tenantId: number, from: Date, to: Date): Promise<Buffer> {
  return Buffer.from("%PDF-1.4 stub");
}

// Alias for backward compatibility
export const generateCompliancePdfBuffer = generateCompliancePdf;
