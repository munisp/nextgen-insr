/**
 * Sprint 52 — Bulk Operations & Data Export
 * F17: Select all, batch delete, batch export
 * F18: CSV/PDF export from data tables
 */
import { useState, useCallback, useMemo } from "react";

interface BulkOpsOptions<T> {
  items: T[];
  idKey: keyof T;
  onBulkDelete?: (ids: (string | number)[]) => Promise<void>;
  onBulkExport?: (ids: (string | number)[]) => Promise<void>;
}

export function useBulkOperations<T>({
  items,
  idKey,
  onBulkDelete,
  onBulkExport,
}: BulkOpsOptions<T>) {
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(
    new Set()
  );

  const toggleItem = useCallback((id: string | number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map(item => item[idKey] as string | number)));
  }, [items, idKey]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleAll = useCallback(() => {
    if (selectedIds.size === items.length) deselectAll();
    else selectAll();
  }, [selectedIds.size, items.length, selectAll, deselectAll]);

  const isSelected = useCallback(
    (id: string | number) => selectedIds.has(id),
    [selectedIds]
  );
  const allSelected = useMemo(
    () => items.length > 0 && selectedIds.size === items.length,
    [items.length, selectedIds.size]
  );
  const someSelected = useMemo(
    () => selectedIds.size > 0 && selectedIds.size < items.length,
    [selectedIds.size, items.length]
  );

  const bulkDelete = useCallback(async () => {
    if (onBulkDelete) await onBulkDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
  }, [selectedIds, onBulkDelete]);

  const bulkExport = useCallback(async () => {
    if (onBulkExport) await onBulkExport(Array.from(selectedIds));
  }, [selectedIds, onBulkExport]);

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    toggleItem,
    selectAll,
    deselectAll,
    toggleAll,
    isSelected,
    allSelected,
    someSelected,
    bulkDelete,
    bulkExport,
  };
}

// ─── CSV Export Utility ─────────────────────────────────────────
export function exportToCsv<T extends Record<string, any>>(
  data: T[],
  filename: string,
  columns?: { key: keyof T; label: string }[]
) {
  if (!data.length) return;

  const cols =
    columns || Object.keys(data[0]).map(k => ({ key: k as keyof T, label: k }));
  const header = cols.map(c => `"${String(c.label)}"`).join(",");
  const rows = data.map(row =>
    cols
      .map(c => {
        const val = row[c.key];
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      })
      .join(",")
  );

  const csv = [header, ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── PDF Export Utility (HTML-based) ────────────────────────────
export function exportToPdf<T extends Record<string, any>>(
  data: T[],
  title: string,
  columns?: { key: keyof T; label: string }[]
) {
  if (!data.length) return;

  const cols =
    columns || Object.keys(data[0]).map(k => ({ key: k as keyof T, label: k }));

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { font-size: 18px; margin-bottom: 5px; }
        .meta { color: #666; font-size: 12px; margin-bottom: 15px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { background: #1a1a2e; color: white; padding: 8px 6px; text-align: left; }
        td { padding: 6px; border-bottom: 1px solid #eee; }
        tr:nth-child(even) { background: #f8f9fa; }
        .footer { margin-top: 20px; font-size: 10px; color: #999; text-align: center; }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      <div class="meta">Generated: ${new Date().toLocaleString()} | Records: ${data.length}</div>
      <table>
        <thead><tr>${cols.map(c => `<th>${String(c.label)}</th>`).join("")}</tr></thead>
        <tbody>
          ${data.map(row => `<tr>${cols.map(c => `<td>${row[c.key] ?? ""}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
      <div class="footer">InsurePortal POS Shell — Confidential</div>
    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  }
}

export default useBulkOperations;
