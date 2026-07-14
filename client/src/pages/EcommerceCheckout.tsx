// @ts-nocheck
import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function InsuranceCheckout() {
  const customerId = 1; // From auth context
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [submitting, setSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState(null);

  const [address, setAddress] = useState({
    street: "",
    city: "",
    state: "",
    country: "Nigeria",
    zipCode: "",
    phone: "",
  });

  const { data: cart } = trpc.insuranceCart.getCart.useQuery({ customerId });
  const createOrder = trpc.policyOrders.createFromCart.useMutation({
    onSuccess: data => {
      setSubmitting(false);
      setOrderResult(data);
    },
    onError: () => setSubmitting(false),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    createOrder.mutate({
      customerId,
      merchantId: 1,
      paymentMethod,
      shippingAddress: address,
    });
  };

  if (orderResult) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center space-y-4">
        <div className="text-6xl">✓</div>
        <h1 className="text-2xl font-bold text-green-700">Order Placed!</h1>
        <p className="text-gray-600">Order #{orderResult.orderNumber}</p>
        <p className="text-lg font-medium">
          Total: {orderResult.currency}{" "}
          {Number(orderResult.total).toLocaleString()}
        </p>
        <div className="flex gap-3 justify-center mt-6">
          <a
            href="/insurance/orders"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg"
          >
            View Orders
          </a>
          <a href="/insurance/catalog" className="px-4 py-2 border rounded-lg">
            Continue Shopping
          </a>
        </div>
      </div>
    );
  }

  const subTotal = cart?.subTotal || 0;
  const tax = subTotal * 0.075;
  const shipping = subTotal >= 50000 ? 0 : 500;
  const total = subTotal + tax + shipping;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Checkout</h1>

      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 lg:grid-cols-2 gap-8"
      >
        {/* Shipping Address */}
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Shipping Address</h2>
          <input
            placeholder="Street Address"
            value={address.street}
            onChange={e => setAddress({ ...address, street: e.target.value })}
            required
            className="w-full px-3 py-2 border rounded-lg"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="City"
              value={address.city}
              onChange={e => setAddress({ ...address, city: e.target.value })}
              required
              className="px-3 py-2 border rounded-lg"
            />
            <input
              placeholder="State"
              value={address.state}
              onChange={e => setAddress({ ...address, state: e.target.value })}
              required
              className="px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Zip Code"
              value={address.zipCode}
              onChange={e =>
                setAddress({ ...address, zipCode: e.target.value })
              }
              required
              className="px-3 py-2 border rounded-lg"
            />
            <input
              placeholder="Phone"
              value={address.phone}
              onChange={e => setAddress({ ...address, phone: e.target.value })}
              required
              className="px-3 py-2 border rounded-lg"
            />
          </div>

          {/* Payment Method */}
          <h2 className="text-lg font-medium pt-4">Payment Method</h2>
          <div className="space-y-2">
            {[
              "card",
              "bank_transfer",
              "ussd",
              "mobile_money",
              "cash_on_delivery",
            ].map(method => (
              <label
                key={method}
                className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="payment"
                  value={method}
                  checked={paymentMethod === method}
                  onChange={e => setPaymentMethod(e.target.value)}
                />
                <span className="capitalize">{method.replace(/_/g, " ")}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Order Summary */}
        <div className="border rounded-lg p-6 h-fit space-y-3">
          <h2 className="text-lg font-bold">Order Summary</h2>
          {cart?.items?.map(item => (
            <div key={item.id} className="flex justify-between text-sm">
              <span>
                {item.name} × {item.quantity}
              </span>
              <span>
                ₦{(Number(item.unitPrice) * item.quantity).toLocaleString()}
              </span>
            </div>
          ))}
          <hr />
          <div className="flex justify-between text-sm">
            <span>Subtotal</span>
            <span>₦{subTotal.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>VAT (7.5%)</span>
            <span>₦{Math.round(tax).toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Shipping</span>
            <span>{shipping === 0 ? "Free" : `₦${shipping}`}</span>
          </div>
          <hr />
          <div className="flex justify-between font-bold text-lg">
            <span>Total</span>
            <span>₦{Math.round(total).toLocaleString()}</span>
          </div>
          <button
            type="submit"
            disabled={submitting || !cart?.items?.length}
            className="w-full py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 mt-4"
          >
            {submitting ? "Processing..." : "Place Order"}
          </button>
        </div>
      </form>
    </div>
  );
}
