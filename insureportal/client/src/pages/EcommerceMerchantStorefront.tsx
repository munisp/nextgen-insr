// @ts-nocheck
import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function InsuranceMerchantInsurancePortal() {
  const merchantId = 1; // From auth context
  const [activeTab, setActiveTab] = useState<
    "products" | "orders" | "analytics"
  >("products");
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({
    sku: "",
    name: "",
    description: "",
    categoryId: 1,
    price: "",
    imageUrl: "",
  });

  const { data: products, refetch: refetchProducts } =
    trpc.insuranceCatalog.listProducts.useQuery({
      limit: 50,
      offset: 0,
    });

  const { data: orders } = trpc.policyOrders.listOrders.useQuery({
    merchantId,
    limit: 20,
    offset: 0,
  });

  const createProduct = trpc.insuranceCatalog.createProduct.useMutation({
    onSuccess: () => {
      setShowAddProduct(false);
      setNewProduct({
        sku: "",
        name: "",
        description: "",
        categoryId: 1,
        price: "",
        imageUrl: "",
      });
      refetchProducts();
    },
  });

  const deleteProduct = trpc.insuranceCatalog.deleteProduct.useMutation({
    onSuccess: () => refetchProducts(),
  });

  const handleAddProduct = () => {
    createProduct.mutate({
      ...newProduct,
      merchantId,
      currency: "NGN",
    });
  };

  const totalRevenue =
    orders?.orders.reduce((sum, o) => sum + Number(o.total), 0) || 0;
  const pendingOrders =
    orders?.orders.filter(o => o.status === "pending").length || 0;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Merchant InsurancePortal</h1>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-500">Total Products</p>
          <p className="text-2xl font-bold">{products?.total || 0}</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-500">Total Revenue</p>
          <p className="text-2xl font-bold">₦{totalRevenue.toLocaleString()}</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-500">Total Orders</p>
          <p className="text-2xl font-bold">{orders?.total || 0}</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-500">Pending Orders</p>
          <p className="text-2xl font-bold text-yellow-600">{pendingOrders}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b">
        {(["products", "orders", "analytics"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2 px-1 text-sm font-medium capitalize ${activeTab === tab ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500"}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Products Tab */}
      {activeTab === "products" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowAddProduct(!showAddProduct)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg"
            >
              {showAddProduct ? "Cancel" : "+ Add Product"}
            </button>
          </div>

          {showAddProduct && (
            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="font-medium">New Product</h3>
              <div className="grid grid-cols-2 gap-3">
                <input
                  placeholder="SKU"
                  value={newProduct.sku}
                  onChange={e =>
                    setNewProduct({ ...newProduct, sku: e.target.value })
                  }
                  className="px-3 py-2 border rounded"
                />
                <input
                  placeholder="Name"
                  value={newProduct.name}
                  onChange={e =>
                    setNewProduct({ ...newProduct, name: e.target.value })
                  }
                  className="px-3 py-2 border rounded"
                />
                <input
                  placeholder="Price (NGN)"
                  value={newProduct.price}
                  onChange={e =>
                    setNewProduct({ ...newProduct, price: e.target.value })
                  }
                  className="px-3 py-2 border rounded"
                />
                <input
                  placeholder="Image URL"
                  value={newProduct.imageUrl}
                  onChange={e =>
                    setNewProduct({ ...newProduct, imageUrl: e.target.value })
                  }
                  className="px-3 py-2 border rounded"
                />
              </div>
              <textarea
                placeholder="Description"
                value={newProduct.description}
                onChange={e =>
                  setNewProduct({ ...newProduct, description: e.target.value })
                }
                className="w-full px-3 py-2 border rounded"
                rows={2}
              />
              <button
                onClick={handleAddProduct}
                disabled={
                  !newProduct.sku || !newProduct.name || !newProduct.price
                }
                className="px-4 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50"
              >
                Create Product
              </button>
            </div>
          )}

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm">SKU</th>
                  <th className="px-4 py-3 text-left text-sm">Name</th>
                  <th className="px-4 py-3 text-left text-sm">Price</th>
                  <th className="px-4 py-3 text-left text-sm">Status</th>
                  <th className="px-4 py-3 text-left text-sm">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {products?.products.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono">{p.sku}</td>
                    <td className="px-4 py-3 text-sm">{p.name}</td>
                    <td className="px-4 py-3 text-sm">
                      ₦{Number(p.price).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-1 rounded ${p.isActive ? "bg-green-100 text-green-800" : "bg-gray-100"}`}
                      >
                        {p.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => deleteProduct.mutate({ id: p.id })}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Orders Tab */}
      {activeTab === "orders" && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm">Order #</th>
                <th className="px-4 py-3 text-left text-sm">Customer</th>
                <th className="px-4 py-3 text-left text-sm">Total</th>
                <th className="px-4 py-3 text-left text-sm">Status</th>
                <th className="px-4 py-3 text-left text-sm">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders?.orders.map(o => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono">
                    {o.orderNumber}
                  </td>
                  <td className="px-4 py-3 text-sm">#{o.customerId}</td>
                  <td className="px-4 py-3 text-sm font-medium">
                    ₦{Number(o.total).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800">
                      {o.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(o.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === "analytics" && (
        <div className="text-center py-8 text-gray-500">
          <p>Analytics powered by Python Intelligence Service</p>
          <p className="text-sm mt-2">
            Sales forecasting, basket analysis, and inventory velocity
          </p>
        </div>
      )}
    </div>
  );
}
