import DashboardLayout from "@/components/DashboardLayout";
import { useState } from "react";

import { trpc } from "@/lib/trpc";
export default function CommissionCalculatorPage() {
  const [volume, setVolume] = useState(1000000);
  const [txCount, setTxCount] = useState(100);
  const [txType, setTxType] = useState("premium_payment");

  const tiers = [
    {
      name: "Bronze",
      min: "₦0",
      max: "₦500K",
      base: "0.5%",
      bonus: "0%",
      minTx: 0,
    },
    {
      name: "Silver",
      min: "₦500K",
      max: "₦2M",
      base: "0.7%",
      bonus: "0.1%",
      minTx: 50,
    },
    {
      name: "Gold",
      min: "₦2M",
      max: "₦10M",
      base: "0.9%",
      bonus: "0.2%",
      minTx: 200,
    },
    {
      name: "Platinum",
      min: "₦10M",
      max: "₦50M",
      base: "1.1%",
      bonus: "0.3%",
      minTx: 500,
    },
    {
      name: "Diamond",
      min: "₦50M+",
      max: "∞",
      base: "1.3%",
      bonus: "0.5%",
      minTx: 1000,
    },
  ];

  const multipliers: Record<string, number> = {
    premium_payment: 1.0,
    claim_payout: 1.2,
    transfer: 0.8,
    bill_payment: 0.6,
    airtime: 0.4,
    card_payment: 0.9,
    qr_payment: 0.7,
    nfc_payment: 0.9,
    ussd: 0.5,
  };

  function getTier(vol: number) {
    if (vol <= 500000) return tiers[0];
    if (vol <= 2000000) return tiers[1];
    if (vol <= 10000000) return tiers[2];
    if (vol <= 50000000) return tiers[3];
    return tiers[4];
  }

  const currentTier = getTier(volume);
  const baseRate = parseFloat(currentTier.base) / 100;
  const bonusRate = parseFloat(currentTier.bonus) / 100;
  const mult = multipliers[txType] || 1.0;
  const baseCommission = volume * baseRate * mult;
  const bonusCommission = txCount >= currentTier.minTx ? volume * bonusRate : 0;
  const totalCommission = baseCommission + bonusCommission;
  const effectiveRate = ((totalCommission / volume) * 100).toFixed(4);

  const tierColors: Record<string, string> = {
    Bronze: "text-amber-600",
    Silver: "text-gray-300",
    Gold: "text-yellow-400",
    Platinum: "text-blue-300",
    Diamond: "text-purple-300",
  };
  // Sprint 87: Wired to commissionCascadeHistory router
  const { data, isLoading } = trpc.commissionCascadeHistory.list.useQuery({
    // @ts-ignore Sprint 85
    page: 1,
    limit: 10,
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold text-white">Commission Calculator</h1>

        <div className="grid grid-cols-2 gap-6">
          <div className="bg-gray-800 rounded p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Simulator</h2>
            <div>
              <label className="text-gray-400 text-sm">
                Monthly Volume (₦)
              </label>
              <input
                type="range"
                min={0}
                max={100000000}
                step={100000}
                value={volume}
                onChange={e => setVolume(Number(e.target.value))}
                className="w-full mt-1"
              />
              <div className="text-white font-mono">
                ₦{volume.toLocaleString()}
              </div>
            </div>
            <div>
              <label className="text-gray-400 text-sm">Transaction Count</label>
              <input
                type="range"
                min={0}
                max={2000}
                step={10}
                value={txCount}
                onChange={e => setTxCount(Number(e.target.value))}
                className="w-full mt-1"
              />
              <div className="text-white font-mono">{txCount} transactions</div>
            </div>
            <div>
              <label className="text-gray-400 text-sm">Transaction Type</label>
              <select
                value={txType}
                onChange={e => setTxType(e.target.value)}
                className="w-full mt-1 bg-gray-700 text-white rounded p-2"
              >
                {Object.entries(multipliers).map(([k, v]) => (
                  <option key={k} value={k}>
                    {k.replace(/_/g, " ")} ({v}x)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-gray-800 rounded p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Result</h2>
            <div className="text-center py-4">
              <div
                className={`text-4xl font-bold ${tierColors[currentTier.name]}`}
              >
                {currentTier.name}
              </div>
              <div className="text-gray-400 text-sm mt-1">Current Tier</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-700 rounded p-3">
                <div className="text-gray-400 text-xs">Base Commission</div>
                <div className="text-white font-bold">
                  ₦
                  {baseCommission.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
              <div className="bg-gray-700 rounded p-3">
                <div className="text-gray-400 text-xs">Bonus Commission</div>
                <div className="text-green-400 font-bold">
                  ₦
                  {bonusCommission.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
              <div className="bg-gray-700 rounded p-3">
                <div className="text-gray-400 text-xs">Total Commission</div>
                <div className="text-blue-400 font-bold text-lg">
                  ₦
                  {totalCommission.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
              <div className="bg-gray-700 rounded p-3">
                <div className="text-gray-400 text-xs">Effective Rate</div>
                <div className="text-yellow-400 font-bold">
                  {effectiveRate}%
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 rounded p-4">
          <h2 className="text-lg font-semibold text-white mb-3">
            Commission Tiers
          </h2>
          <table className="w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="text-left p-3 text-gray-300 text-sm">Tier</th>
                <th className="text-left p-3 text-gray-300 text-sm">
                  Volume Range
                </th>
                <th className="text-center p-3 text-gray-300 text-sm">
                  Base Rate
                </th>
                <th className="text-center p-3 text-gray-300 text-sm">
                  Bonus Rate
                </th>
                <th className="text-center p-3 text-gray-300 text-sm">
                  Min TX Count
                </th>
              </tr>
            </thead>
            <tbody>
              {tiers.map(t => (
                <tr
                  key={t.name}
                  className={`border-t border-gray-700 ${currentTier.name === t.name ? "bg-blue-900/30" : ""}`}
                >
                  <td className={`p-3 font-bold ${tierColors[t.name]}`}>
                    {t.name}
                  </td>
                  <td className="p-3 text-gray-300">
                    {t.min} – {t.max}
                  </td>
                  <td className="p-3 text-center text-white">{t.base}</td>
                  <td className="p-3 text-center text-green-400">{t.bonus}</td>
                  <td className="p-3 text-center text-gray-400">{t.minTx}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
