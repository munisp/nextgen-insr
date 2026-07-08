// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Enhanced CRUD Operations — InsurePortal Insurance Platform
 *
 * Provides:
 * 1. Full-text search across agents, customers, transactions
 * 2. Pagination with cursor and offset support
 * 3. Sorting and filtering
 * 4. Bulk operations (approve, reject, export)
 * 5. Soft delete support
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Pagination
// ═══════════════════════════════════════════════════════════════════════════════
export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export function paginate<T>(
  items: T[],
  params: PaginationParams
): PaginatedResult<T> {
  const { page, limit } = params;
  const total = items.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const data = items.slice(start, start + limit);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Full-Text Search
// ═══════════════════════════════════════════════════════════════════════════════
export function fullTextSearch<T extends Record<string, unknown>>(
  items: T[],
  query: string,
  searchFields: (keyof T)[]
): T[] {
  if (!query || query.trim().length === 0) return items;

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  return items.filter(item => {
    const searchText = searchFields
      .map(field => String(item[field] ?? ""))
      .join(" ")
      .toLowerCase();

    return terms.every(term => searchText.includes(term));
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sorting
// ═══════════════════════════════════════════════════════════════════════════════
export function sortItems<T extends Record<string, unknown>>(
  items: T[],
  sortBy: string,
  sortOrder: "asc" | "desc" = "desc"
): T[] {
  return [...items].sort((a, b) => {
    const aVal = a[sortBy];
    const bVal = b[sortBy];

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return sortOrder === "asc" ? -1 : 1;
    if (bVal == null) return sortOrder === "asc" ? 1 : -1;

    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
    }

    const aStr = String(aVal);
    const bStr = String(bVal);
    return sortOrder === "asc"
      ? aStr.localeCompare(bStr)
      : bStr.localeCompare(aStr);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Filtering
// ═══════════════════════════════════════════════════════════════════════════════
export interface FilterCondition {
  field: string;
  operator:
    | "eq"
    | "neq"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "contains"
    | "in"
    | "between";
  value: unknown;
}

export function filterItems<T extends Record<string, unknown>>(
  items: T[],
  conditions: FilterCondition[]
): T[] {
  return items.filter(item => {
    return conditions.every(cond => {
      const fieldVal = item[cond.field];

      switch (cond.operator) {
        case "eq":
          return fieldVal === cond.value;
        case "neq":
          return fieldVal !== cond.value;
        case "gt":
          return (
            typeof fieldVal === "number" && fieldVal > (cond.value as number)
          );
        case "gte":
          return (
            typeof fieldVal === "number" && fieldVal >= (cond.value as number)
          );
        case "lt":
          return (
            typeof fieldVal === "number" && fieldVal < (cond.value as number)
          );
        case "lte":
          return (
            typeof fieldVal === "number" && fieldVal <= (cond.value as number)
          );
        case "contains":
          return String(fieldVal ?? "")
            .toLowerCase()
            .includes(String(cond.value).toLowerCase());
        case "in":
          return Array.isArray(cond.value) && cond.value.includes(fieldVal);
        case "between": {
          if (!Array.isArray(cond.value) || cond.value.length !== 2)
            return true;
          const num = typeof fieldVal === "number" ? fieldVal : 0;
          return num >= cond.value[0] && num <= cond.value[1];
        }
        default:
          return true;
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bulk Operations
// ═══════════════════════════════════════════════════════════════════════════════
export interface BulkOperationResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: { id: string; error: string }[];
}

export async function bulkOperation<T extends { id: string }>(
  items: T[],
  ids: string[],
  operation: (item: T) => Promise<void> | void
): Promise<BulkOperationResult> {
  const result: BulkOperationResult = {
    total: ids.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  for (const id of ids) {
    const item = items.find(i => i.id === id);
    if (!item) {
      result.failed++;
      result.errors.push({ id, error: "Not found" });
      continue;
    }
    try {
      await operation(item);
      result.succeeded++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        id,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Export to CSV
// ═══════════════════════════════════════════════════════════════════════════════
export function exportToCsv<T extends Record<string, unknown>>(
  items: T[],
  columns: { key: keyof T; label: string }[]
): string {
  const header = columns.map(c => `"${c.label}"`).join(",");
  const rows = items.map(item =>
    columns
      .map(c => {
        const val = item[c.key];
        if (val == null) return '""';
        if (typeof val === "string") return `"${val.replace(/"/g, '""')}"`;
        return `"${String(val)}"`;
      })
      .join(",")
  );
  return [header, ...rows].join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Soft Delete
// ═══════════════════════════════════════════════════════════════════════════════
export function softDelete<T extends { deletedAt?: number | null }>(
  items: T[],
  index: number
): T {
  const item = items[index];
  if (item) {
    (item as any).deletedAt = Date.now();
  }
  return item;
}

export function filterDeleted<T extends { deletedAt?: number | null }>(
  items: T[],
  includeDeleted = false
): T[] {
  if (includeDeleted) return items;
  return items.filter(item => !item.deletedAt);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Audit Trail
// ═══════════════════════════════════════════════════════════════════════════════
export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  performedBy: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: number;
}

const auditTrail: AuditEntry[] = [];

export function recordAudit(
  entry: Omit<AuditEntry, "id" | "timestamp">
): AuditEntry {
  const full: AuditEntry = {
    ...entry,
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  auditTrail.push(full);
  if (auditTrail.length > 100000)
    auditTrail.splice(0, auditTrail.length - 100000);
  return full;
}

export function getAuditTrail(
  entityType?: string,
  entityId?: string,
  limit = 100
): AuditEntry[] {
  let filtered = auditTrail;
  if (entityType) filtered = filtered.filter(e => e.entityType === entityType);
  if (entityId) filtered = filtered.filter(e => e.entityId === entityId);
  return filtered.slice(-limit).reverse();
}
