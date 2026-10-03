/**
 * MemberProducts.tsx — /member/products (W7-B10, 2026-10-06)
 *
 * Marketplace / product browse. Documented choice (2026-10-06, W7-B10):
 * MemberQuotes only exposes products as a name-only picker inside the
 * quote-cart form — that is not a browse surface (no search, no type
 * filter, no premium/description detail), so the parity row "Marketplace /
 * products browse" gets this small dedicated page instead of a link.
 *
 * Wired to the REAL catalog (server/routers/insuranceProductCatalog.ts):
 *   - insuranceProductCatalog.listProducts (active products, paginated,
 *     coverageType filter + server-side search; marketing metadata only)
 *
 * Read-only browse; "Get a quote" links to /member/quotes where the real
 * quote-cart flow lives — no pricing is fabricated here.
 */
import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmtNgn = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    n
  );

const PRODUCT_TYPES = [
  "life",
  "health",
  "motor",
  "property",
  "agriculture",
  "micro",
] as const;

export default function MemberProducts() {
  const [productType, setProductType] = useState<string>("all");
  const [searchInput, setSearchInput] = useState<string>("");
  const [search, setSearch] = useState<string | undefined>(undefined);

  const productsQuery = trpc.insuranceProductCatalog.listProducts.useQuery(
    {
      limit: 50,
      offset: 0,
      productType: productType as
        | "life"
        | "health"
        | "motor"
        | "property"
        | "agriculture"
        | "micro"
        | "all",
      ...(search ? { search } : {}),
      isActive: true,
    },
    { retry: false }
  );

  const products = productsQuery.data?.data ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Product Marketplace"
          description="Browse active insurance products. To buy, add the product to your quote cart on the Quotes page."
        >
          <div className="grid gap-4 sm:grid-cols-2 max-w-lg mb-4">
            <div className="space-y-2">
              <Label htmlFor="productType">Type</Label>
              <Select value={productType} onValueChange={setProductType}>
                <SelectTrigger id="productType">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {PRODUCT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="productSearch">Search</Label>
              <div className="flex gap-2">
                <Input
                  id="productSearch"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Name, description or NAICOM code"
                />
                <Button
                  variant="outline"
                  onClick={() => setSearch(searchInput.trim() || undefined)}
                >
                  Search
                </Button>
              </div>
            </div>
          </div>

          {productsQuery.isLoading ? (
            <MemberLoading label="Loading products" />
          ) : productsQuery.isError ? (
            <MemberError message={productsQuery.error.message} />
          ) : products.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No active products match your filters.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-3">
                {productsQuery.data?.total ?? products.length} product
                {(productsQuery.data?.total ?? products.length) === 1
                  ? ""
                  : "s"}{" "}
                found
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Min premium</TableHead>
                    <TableHead>Max coverage</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <span className="font-medium">{p.name}</span>
                        {p.description ? (
                          <span className="block text-xs text-muted-foreground mt-1">
                            {p.description}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{p.coverageType}</Badge>
                      </TableCell>
                      <TableCell>
                        {p.minPremium != null
                          ? fmtNgn(Number(p.minPremium))
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {p.maxCoverageAmount != null
                          ? fmtNgn(Number(p.maxCoverageAmount))
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Link href="/member/quotes">
                          <Button variant="outline" size="sm">
                            Get a quote
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
