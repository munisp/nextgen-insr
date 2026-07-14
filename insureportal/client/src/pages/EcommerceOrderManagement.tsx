// @ts-nocheck
import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function InsuranceOrderManagement() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<number | null>(null);
  const limit = 20;

  const { data: orders, refetch } = trpc.policyOrders.listOrders.useQuery({
    status: statusFilter || undefined,
    limit,
    offset: page * limit,
  });

  const { data: orderDetail } = trpc.policyOrders.getOrder.useQuery(
    { id: selectedOrder! },
    { enabled: !!selectedOrder }
  );

  const updateStatus = trpc.policyOrders.updateStatus.useMutation({
    onSuccess: () => {
      refetch();
      setSelectedOrder(null);
    },
  });

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    confirmed: "bg-blue-100 text-blue-800",
    processing: "bg-purple-100 text-purple-800",
    shipped: "bg-indigo-100 text-indigo-800",
    delivered: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
    refunded: "bg-gray-100 text-gray-800",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Order Management</h1>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="processing">Processing</option>
            <option value="shipped">Shipped</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Order Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium">
                Order #
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium">
                Customer
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium">Total</th>
              <th className="px-4 py-3 text-left text-sm font-medium">
                Status
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium">Date</th>
              <th className="px-4 py-3 text-left text-sm font-medium">
                Offline
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {orders?.orders.map(order => (
              <tr key={order.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-mono">
                  {order.orderNumber}
                </td>
                <td className="px-4 py-3 text-sm">#{order.customerId}</td>
                <td className="px-4 py-3 text-sm font-medium">
                  {order.currency} {Number(order.total).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-1 rounded ${statusColors[order.status] || ""}`}
                  >
                    {order.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {new Date(order.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-sm">
                  {order.offlineCreated ? (
                    <span className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
                      Offline
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => setSelectedOrder(order.id)}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-500">
          Total: {orders?.total || 0} orders
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            Prev
          </button>
          <button
            onClick={() => setPage(page + 1)}
            disabled={(page + 1) * limit >= (orders?.total || 0)}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && orderDetail && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setSelectedOrder(null)}
        >
          <div
            className="bg-white rounded-lg p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-4">
              Order #{orderDetail.orderNumber}
            </h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Status:</span>
                <span
                  className={`text-xs px-2 py-1 rounded ${statusColors[orderDetail.status] || ""}`}
                >
                  {orderDetail.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Total:</span>
                <span className="font-medium">
                  {orderDetail.currency}{" "}
                  {Number(orderDetail.total).toLocaleString()}
                </span>
              </div>
              <hr />
              <h3 className="font-medium">Items:</h3>
              {orderDetail.items?.map(item => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span>
                    {item.name} × {item.quantity}
                  </span>
                  <span>₦{Number(item.total).toLocaleString()}</span>
                </div>
              ))}
              <hr />
              {/* Status Actions */}
              {orderDetail.status !== "delivered" &&
                orderDetail.status !== "cancelled" && (
                  <div className="flex gap-2 mt-4">
                    {orderDetail.status === "pending" && (
                      <button
                        onClick={() =>
                          updateStatus.mutate({
                            id: selectedOrder,
                            status: "confirmed",
                          })
                        }
                        className="px-3 py-2 bg-blue-600 text-white rounded text-sm"
                      >
                        Confirm
                      </button>
                    )}
                    {orderDetail.status === "confirmed" && (
                      <button
                        onClick={() =>
                          updateStatus.mutate({
                            id: selectedOrder,
                            status: "processing",
                          })
                        }
                        className="px-3 py-2 bg-purple-600 text-white rounded text-sm"
                      >
                        Process
                      </button>
                    )}
                    {orderDetail.status === "processing" && (
                      <button
                        onClick={() =>
                          updateStatus.mutate({
                            id: selectedOrder,
                            status: "shipped",
                          })
                        }
                        className="px-3 py-2 bg-indigo-600 text-white rounded text-sm"
                      >
                        Ship
                      </button>
                    )}
                    {orderDetail.status === "shipped" && (
                      <button
                        onClick={() =>
                          updateStatus.mutate({
                            id: selectedOrder,
                            status: "delivered",
                          })
                        }
                        className="px-3 py-2 bg-green-600 text-white rounded text-sm"
                      >
                        Deliver
                      </button>
                    )}
                    <button
                      onClick={() =>
                        updateStatus.mutate({
                          id: selectedOrder,
                          status: "cancelled",
                        })
                      }
                      className="px-3 py-2 bg-red-600 text-white rounded text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                )}
            </div>
            <button
              onClick={() => setSelectedOrder(null)}
              className="mt-4 w-full py-2 border rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
