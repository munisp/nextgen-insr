import { trpc } from "@/lib/trpc";
import { useState } from "react";

export default function Customer360Page() {
  const { data, isLoading } = trpc.customer360.dashboard.useQuery();
  const [selectedId, setSelectedId] = useState("");
  const { data: profile } = trpc.customer360.getProfile.useQuery(
    { customerId: selectedId || "cust-1001" },
    { enabled: true }
  );
  const sentiment = trpc.customer360.analyzeSentiment.useMutation();

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
                {data.totalCustomers.toLocaleString()}
              </p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="text-2xl font-bold">
                {data.activeCustomers.toLocaleString()}
              </p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">
                Avg Lifetime Value
              </p>
              <p className="text-2xl font-bold">
                ₦{(data.avgLifetimeValue / 1000).toFixed(0)}K
              </p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Churn Rate</p>
              <p className="text-2xl font-bold">{data.churnRate}%</p>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Segments</h2>
            <div className="border rounded p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Segment</th>
                    <th className="text-right p-2">Count</th>
                    <th className="text-right p-2">Avg Txn Value</th>
                    <th className="text-right p-2">Monthly Txns</th>
                  </tr>
                </thead>
                <tbody>
                  {data.segments.map((s: any) => (
                    <tr key={s.name} className="border-b">
                      <td className="p-2 font-medium">{s.name}</td>
                      <td className="p-2 text-right">
                        {s.count.toLocaleString()}
                      </td>
                      <td className="p-2 text-right">
                        ₦{s.avgTxnValue.toLocaleString()}
                      </td>
                      <td className="p-2 text-right">{s.avgMonthlyTxns}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {profile && (
        <div>
          <h2 className="text-lg font-semibold mb-3">
            Customer Profile: {profile.name}
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded p-4 col-span-1">
              <p className="text-sm">
                <strong>Phone:</strong> {profile.phone}
              </p>
              <p className="text-sm">
                <strong>BVN:</strong> {profile.bvn}
              </p>
              <p className="text-sm">
                <strong>Segment:</strong> {profile.segment}
              </p>
              <p className="text-sm">
                <strong>KYC:</strong> {profile.kycStatus}
              </p>
              <p className="text-sm">
                <strong>Risk Score:</strong> {profile.riskScore}
              </p>
              <p className="text-sm">
                <strong>Account Age:</strong> {profile.accountAge}
              </p>
              <p className="text-sm">
                <strong>Lifetime Value:</strong> ₦
                {profile.lifetimeValue.toLocaleString()}
              </p>
              <button
                className="mt-3 px-3 py-1 bg-blue-600 text-white rounded text-xs"
                onClick={() => sentiment.mutate({ customerId: profile.id })}
              >
                Analyze Sentiment
              </button>
              {sentiment.data && (
                <div className="mt-2 text-xs">
                  <p>
                    Sentiment: <strong>{sentiment.data.sentiment}</strong> (
                    {(sentiment.data.score * 100).toFixed(0)}%)
                  </p>
                  <p>Keywords: {sentiment.data.keywords.join(", ")}</p>
                </div>
              )}
            </div>
            <div className="border rounded p-4 col-span-2">
              <h3 className="font-semibold text-sm mb-2">
                Recent Interactions
              </h3>
              <div className="space-y-2">
                {profile.interactions.map((i, idx) => (
                  <div
                    key={idx}
                    className="flex justify-between items-center border-b pb-2"
                  >
                    <div>
                      <p className="text-sm">{i.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.channel}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(i.date).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
