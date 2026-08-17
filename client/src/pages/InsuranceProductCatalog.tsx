import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";

export default function InsuranceProductCatalog() {
  const [search, setSearch] = useState("");
  const [productType, setProductType] = useState<string>("all");
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data: products, isLoading } =
    // F-12 (wave-4b): real listProducts input is
    // {limit, offset, productType, search, isActive} — the phantom
    // categoryId/active fields are gone; the type filter passes the
    // insurance_product_types.code through to the productType enum.
    trpc.insuranceProductCatalog.listProducts.useQuery({
      limit,
      offset: page * limit,
      productType: productType as "life" | "health" | "motor" | "property" | "agriculture" | "micro" | "all",
      search: search || undefined,
      isActive: true,
    });

  const { data: categories } = trpc.insuranceProductCatalog.listCategories.useQuery();
  // F-12 (wave-4b): real input is {threshold}; the return is a product-row
  // array (honest-empty — no slot tracking is delivered).
  const { data: lowStock } = trpc.insuranceProductCatalog.lowStockAlerts.useQuery({
    threshold: 10,
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Product Catalog</h1>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-2 border rounded-lg"
          />
          <select
            value={productType}
            onChange={e => setProductType(e.target.value)}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="">All Categories</option>
            {categories?.map(cat => (
              <option key={cat.id} value={cat.code ?? ""}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Low Stock Alerts */}
      {lowStock && lowStock.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-medium text-yellow-800">
            Low Stock Alerts ({lowStock.length})
          </h3>
          <div className="mt-2 text-sm text-yellow-700">
            {lowStock.slice(0, 5).map(item => (
              <div key={item.id}>
                {item.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Product Grid */}
      {isLoading ? (
        <div className="text-center py-8">Loading products...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {products?.data.map(product => (
              <div
                key={product.id}
                className="border rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                {/* F-12 (wave-4b): real insurance_products columns are
                    {productCode, name, description, coverageType, minPremium,
                    maxCoverageAmount, isActive} — no image/currency/price/sku/
                    status fields exist; bindings below use real columns. */}
                <h3 className="font-medium text-lg">{product.name}</h3>
                <p className="text-sm text-gray-500">{product.productCode}</p>
                <p className="text-lg font-bold mt-2">
                  Min premium ₦{Number(product.minPremium ?? 0).toLocaleString()}
                </p>
                <div className="flex gap-2 mt-3">
                  <span
                    className={`text-xs px-2 py-1 rounded ${product.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}
                  >
                    {product.isActive ? "active" : "inactive"}
                  </span>
                  {product.coverageType && (
                    <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800">
                      {product.coverageType}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex justify-between items-center mt-4">
            <span className="text-sm text-gray-500">
              Showing {page * limit + 1} -{" "}
              {Math.min((page + 1) * limit, products?.total || 0)} of{" "}
              {products?.total || 0}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={(page + 1) * limit >= (products?.total || 0)}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
