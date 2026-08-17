import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc";
export default function Customer360Page() {
  const { data, isLoading } = trpc.customer360.dashboard.useQuery();
  // F-12 (wave-4b): no fabricated default customer — a profile loads only
  // after a real customer id is entered.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [idInput, setIdInput] = useState("");
  const { data: profile } = trpc.customer360.getProfile.useQuery(
    { id: selectedId ?? 0 },
    { enabled: selectedId != null }
  );
  // analyzeSentiment is fail-loud NOT_IMPLEMENTED (no LLM provider) — the
  // button surfaces that honestly.
  const analyzeSentiment = () =>
    toast.error("Sentiment analysis is not configured on this deployment");

  if (isLoading)
    return <div className="p-8 text-center">Loading customer 360...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Customer 360 View</h1>
      {data && (
        <>
          <div className="grid grid-cols-4 gap-4">
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Total Customers</p>
              <p className="text-2xl font-bold">
                {data.totalRecords.toLocaleString()}
              </p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="text-2xl font-bold">
                {data.activeRecords.toLocaleString()}
              </p>
            </div>
            {/* F-12: no LTV model or churn analytics are delivered — "—". */}
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">
                Avg Lifetime Value
              </p>
              <p className="text-2xl font-bold text-muted-foreground">—</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Churn Rate</p>
              <p className="text-2xl font-bold text-muted-foreground">—</p>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Segments</h2>
            <div className="border rounded p-4 text-center text-sm text-muted-foreground">
              — no segmentation engine is delivered on this platform
            </div>
          </div>
        </>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3">Customer Profile</h2>
        <div className="flex gap-2 mb-4">
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder="Enter customer ID"
            value={idInput}
            onChange={e => setIdInput(e.target.value)}
          />
          <button
            className="border rounded px-4 py-2 text-sm bg-primary text-primary-foreground"
            onClick={() => {
              const n = Number(idInput);
              if (Number.isInteger(n) && n > 0) setSelectedId(n);
              else toast.error("Enter a numeric customer ID");
            }}
          >
            Load
          </button>
        </div>
        {profile && (
          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded p-4 col-span-1">
              <p className="text-sm">
                <strong>ID:</strong> {profile.id}
              </p>
              <p className="text-sm">
                <strong>Name:</strong> {profile.name}
              </p>
              {/* F-12: phone/BVN/segment/KYC/risk fields are not in the
                  delivered profile shape — "—". */}
              <p className="text-sm">
                <strong>Phone:</strong> —
              </p>
              <p className="text-sm">
                <strong>KYC:</strong> —
              </p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Lifetime Value</p>
              <p className="text-2xl font-bold text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground mt-1">
                no LTV model attached
              </p>
            </div>
            <div className="border rounded p-4">
              <button
                className="border rounded px-4 py-2 text-sm"
                onClick={analyzeSentiment}
              >
                Analyze Sentiment
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
