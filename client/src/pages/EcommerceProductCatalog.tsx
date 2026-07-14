// @ts-nocheck
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";

export default function InsuranceProductCatalog() {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data: products, isLoading } =
    trpc.insuranceCatalog.listProducts.useQuery({
      limit,
      offset: page * limit,
      categoryId,
      search: search || undefined,
      active: true,
    });

  const { data: categories } = trpc.insuranceCatalog.listCategories.useQuery();
  const { data: lowStock } = trpc.insuranceCatalog.lowStockAlerts.useQuery({
    limit: 10,
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
            value={categoryId || ""}
            onChange={e =>
              setCategoryId(e.target.value ? Number(e.target.value) : undefined)
            }
            className="px-3 py-2 border rounded-lg"
          >
            <option value="">All Categories</option>
            {categories?.categories.map(cat => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Low Stock Alerts */}
      {lowStock && lowStock.alerts.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-medium text-yellow-800">
            ⚠️ Low Stock Alerts ({lowStock.count})
          </h3>
          <div className="mt-2 text-sm text-yellow-700">
            {lowStock.alerts.slice(0, 5).map(item => (
              <div key={item.id}>
                {item.sku}: {item.quantity - item.reserved} units available
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
            {products?.products.map(product => (
              <div
                key={product.id}
                className="border rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                {product.imageUrl && (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-40 object-cover rounded-md mb-3"
                  />
                )}
                <h3 className="font-medium text-lg">{product.name}</h3>
                <p className="text-sm text-gray-500">{product.sku}</p>
                <p className="text-lg font-bold mt-2">
                  {product.currency} {Number(product.price).toLocaleString()}
                </p>
                <div className="flex gap-2 mt-3">
                  <span
                    className={`text-xs px-2 py-1 rounded ${product.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}
                  >
                    {product.status}
                  </span>
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
