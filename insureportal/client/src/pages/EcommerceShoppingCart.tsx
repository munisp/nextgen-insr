// @ts-nocheck
import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function InsuranceShoppingCart() {
  const customerId = 1; // From auth context in production
  const [syncing, setSyncing] = useState(false);

  const { data: cart, refetch } = trpc.insuranceCart.getCart.useQuery({
    customerId,
  });
  const updateItem = trpc.insuranceCart.updateItem.useMutation({
    onSuccess: () => refetch(),
  });
  const removeItem = trpc.insuranceCart.removeItem.useMutation({
    onSuccess: () => refetch(),
  });
  const clearCart = trpc.insuranceCart.clearCart.useMutation({
    onSuccess: () => refetch(),
  });
  const syncOffline = trpc.insuranceCart.syncOfflineCart.useMutation({
    onSuccess: () => {
      setSyncing(false);
      refetch();
    },
  });

  const handleSyncOffline = () => {
    // Get offline cart from localStorage
    const offlineData = localStorage.getItem("offline_cart");
    if (!offlineData) return;
    setSyncing(true);
    const parsed = JSON.parse(offlineData);
    syncOffline.mutate({
      customerId,
      items: parsed.items || [],
      deviceId: parsed.deviceId || "unknown",
      checksum: parsed.checksum || "",
      strategy: "max_quantity",
    });
    localStorage.removeItem("offline_cart");
  };

  const subTotal = cart?.subTotal || 0;
  const tax = subTotal * 0.075;
  const shipping = subTotal >= 50000 ? 0 : 500;
  const total = subTotal + tax + shipping - (cart?.discountAmount || 0);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Shopping Cart</h1>
        <div className="flex gap-2">
          <button
            onClick={handleSyncOffline}
            disabled={syncing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync Offline Cart"}
          </button>
          <button
            onClick={() => clearCart.mutate({ customerId })}
            className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
          >
            Clear Cart
          </button>
        </div>
      </div>

      {!cart?.items?.length ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">Your cart is empty</p>
          <p className="text-sm mt-2">
            Add products from the catalog to get started
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Cart Items */}
          <div className="lg:col-span-2 space-y-4">
            {cart.items.map(item => (
              <div
                key={item.id}
                className="border rounded-lg p-4 flex justify-between items-center"
              >
                <div>
                  <h3 className="font-medium">{item.name}</h3>
                  <p className="text-sm text-gray-500">SKU: {item.sku}</p>
                  <p className="text-sm font-medium mt-1">
                    ₦{Number(item.unitPrice).toLocaleString()} × {item.quantity}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center border rounded">
                    <button
                      onClick={() =>
                        updateItem.mutate({
                          customerId,
                          sku: item.sku,
                          quantity: Math.max(0, item.quantity - 1),
                        })
                      }
                      className="px-2 py-1 hover:bg-gray-100"
                    >
                      -
                    </button>
                    <span className="px-3">{item.quantity}</span>
                    <button
                      onClick={() =>
                        updateItem.mutate({
                          customerId,
                          sku: item.sku,
                          quantity: item.quantity + 1,
                        })
                      }
                      className="px-2 py-1 hover:bg-gray-100"
                    >
                      +
                    </button>
                  </div>
                  <button
                    onClick={() =>
                      removeItem.mutate({ customerId, sku: item.sku })
                    }
                    className="text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Order Summary */}
          <div className="border rounded-lg p-4 h-fit space-y-3">
            <h3 className="font-bold text-lg">Order Summary</h3>
            <div className="flex justify-between text-sm">
              <span>Subtotal ({cart.itemCount} items)</span>
              <span>₦{subTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>VAT (7.5%)</span>
              <span>₦{tax.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Shipping</span>
              <span>{shipping === 0 ? "Free" : `₦${shipping}`}</span>
            </div>
            {(cart.discountAmount || 0) > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Discount</span>
                <span>-₦{cart.discountAmount.toLocaleString()}</span>
              </div>
            )}
            <hr />
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span>₦{total.toLocaleString()}</span>
            </div>
            <a
              href="/insurance/checkout"
              className="block w-full text-center px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
            >
              Proceed to Checkout
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
