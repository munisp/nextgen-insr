/**
 * ProductBrowse.tsx — R3 batch 1 (2026-10-01, R3)
 * Member product catalog browser, bound to the MONOLITH
 * insuranceProductCatalog router via services/memberPoliciesApi.ts
 * (productCatalogApi). NOT_FOUND/FORBIDDEN → null remains only as a
 * defensive fallback for older deployments; every figure rendered comes from
 * a real proc response — nothing is fabricated.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Star, Package } from "lucide-react";
import {
  productCatalogApi,
  type CatalogProduct,
} from "@/services/memberPoliciesApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

const PRODUCT_TYPES = [
  { value: "all", label: "All types" },
  { value: "life", label: "Life" },
  { value: "health", label: "Health" },
  { value: "motor", label: "Motor" },
  { value: "property", label: "Property" },
  { value: "agriculture", label: "Agriculture" },
  { value: "micro", label: "Micro-insurance" },
] as const;

function formatNgn(amount: string | null): string {
  if (amount == null) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `₦${n.toLocaleString()}`;
}

function ProductCard({ product }: { product: CatalogProduct }) {
  return (
    <li className="rounded-lg border border-stone-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-stone-900">{product.name}</p>
          <p className="text-xs capitalize text-stone-500">
            {product.coverageType}
            {product.naicomProductCode
              ? ` · NAICOM ${product.naicomProductCode}`
              : ""}
          </p>
        </div>
        <span className="whitespace-nowrap text-sm font-medium text-stone-900">
          from {formatNgn(product.minPremium)}
        </span>
      </div>
      {product.description && (
        <p className="mt-2 line-clamp-2 text-xs text-stone-600">
          {product.description}
        </p>
      )}
    </li>
  );
}

export default function ProductBrowse() {
  const [productType, setProductType] = useState<
    (typeof PRODUCT_TYPES)[number]["value"]
  >("all");
  const [search, setSearch] = useState("");

  const featured = useQuery({
    queryKey: ["r3", "productCatalog", "featured"],
    queryFn: () => productCatalogApi.getFeatured(),
    retry: 1,
  });
  const products = useQuery({
    queryKey: ["r3", "productCatalog", "list", productType, search],
    queryFn: () =>
      productCatalogApi.listProducts({
        productType,
        search: search.trim() || undefined,
        limit: 50,
      }),
    retry: 1,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          Browse Insurance Products
        </h1>
        <p className="text-sm text-stone-500">
          NAICOM-registered products available on the platform, served live
          from the insurance product catalog.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Star className="h-5 w-5 text-amber-600" aria-hidden />
            Featured products
          </CardTitle>
        </CardHeader>
        <CardContent>
          {featured.isLoading ? (
            <LoadingState label="Loading featured products…" />
          ) : featured.isError ? (
            <ErrorState
              message="We couldn’t load featured products. Please try again."
              onRetry={() => featured.refetch()}
            />
          ) : featured.data === null ? (
            <UnavailableState feature="Featured products" />
          ) : (featured.data ?? []).length === 0 ? (
            <EmptyState
              title="No featured products"
              hint="There are no active products to feature right now."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {featured.data!.map(p => (
                <ProductCard key={p.id} product={p} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Package className="h-5 w-5 text-amber-600" aria-hidden />
            All products
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-400"
                aria-hidden
              />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search products or NAICOM codes…"
                className="w-full rounded-md border border-stone-300 py-2 pl-9 pr-3 text-sm"
              />
            </label>
            <select
              value={productType}
              onChange={e =>
                setProductType(
                  e.target.value as (typeof PRODUCT_TYPES)[number]["value"]
                )
              }
              className="rounded-md border border-stone-300 px-3 py-2 text-sm"
              aria-label="Filter by product type"
            >
              {PRODUCT_TYPES.map(t => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {products.isLoading ? (
            <LoadingState label="Loading products…" />
          ) : products.isError ? (
            <ErrorState
              message="We couldn’t load the product catalog. Please try again."
              onRetry={() => products.refetch()}
            />
          ) : products.data === null ? (
            <UnavailableState feature="Insurance product catalog" />
          ) : (products.data?.data ?? []).length === 0 ? (
            <EmptyState
              title="No products found"
              hint="Try a different search term or product type."
            />
          ) : (
            <>
              <p className="text-xs text-stone-500">
                {products.data!.total} product
                {products.data!.total === 1 ? "" : "s"} in the catalog
              </p>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {products.data!.data.map(p => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
