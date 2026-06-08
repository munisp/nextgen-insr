// UssdLocalizationPage — Sprint 77
// Multi-language USSD menu management (EN/FR/SW/HA/YO)
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Languages, Globe, Edit } from "lucide-react";

import { trpc } from "@/lib/trpc";
const LOCALES = [
  { code: "en", name: "English", flag: "EN" },
  { code: "fr", name: "French", flag: "FR" },
  { code: "sw", name: "Swahili", flag: "SW" },
  { code: "ha", name: "Hausa", flag: "HA" },
  { code: "yo", name: "Yoruba", flag: "YO" },
];

const MENU_ITEMS = [
  {
    key: "welcome",
    en: "Welcome to InsurePortal",
    fr: "Bienvenue chez InsurePortal",
    sw: "Karibu InsurePortal",
    ha: "Barka da zuwa InsurePortal",
    yo: "Kaabo si InsurePortal",
  },
  {
    key: "cash_in",
    en: "Cash In",
    fr: "Depot",
    sw: "Weka Pesa",
    ha: "Saka Kudi",
    yo: "Fi Owo Sii",
  },
  {
    key: "cash_out",
    en: "Cash Out",
    fr: "Retrait",
    sw: "Toa Pesa",
    ha: "Fitar Kudi",
    yo: "Gba Owo Jade",
  },
  {
    key: "balance",
    en: "Check Balance",
    fr: "Consulter Solde",
    sw: "Angalia Salio",
    ha: "Duba Ma'auni",
    yo: "Wo Iye Owo",
  },
  {
    key: "transfer",
    en: "Transfer",
    fr: "Transfert",
    sw: "Hamisha",
    ha: "Tura",
    yo: "Gbigbe",
  },
  {
    key: "airtime",
    en: "Buy Airtime",
    fr: "Acheter Credit",
    sw: "Nunua Muda",
    ha: "Sayi Airtaim",
    yo: "Ra Akoko Afefe",
  },
  {
    key: "bills",
    en: "Pay Bills",
    fr: "Payer Factures",
    sw: "Lipa Bili",
    ha: "Biya Kudin",
    yo: "San Owo Iwe",
  },
  {
    key: "enter_amount",
    en: "Enter Amount:",
    fr: "Entrez le montant:",
    sw: "Ingiza Kiasi:",
    ha: "Shigar da Adadi:",
    yo: "Tẹ Iye:",
  },
  {
    key: "enter_pin",
    en: "Enter PIN:",
    fr: "Entrez le PIN:",
    sw: "Ingiza PIN:",
    ha: "Shigar da PIN:",
    yo: "Tẹ PIN:",
  },
  {
    key: "success",
    en: "Transaction Successful",
    fr: "Transaction Reussie",
    sw: "Muamala Umefanikiwa",
    ha: "Ciniki Ya Yi Nasara",
    yo: "Idunadura Ti Ṣaṣeyọri",
  },
];

export default function UssdLocalizationPage() {
  const [locale, setLocale] = useState("en");
  // Sprint 87: Wired to ussdLocalization router
  const { data, isLoading } = trpc.ussdLocalization.list.useQuery({
    // @ts-ignore Sprint 85
    page: 1,
    limit: 10,
  });

  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Languages className="h-8 w-8 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold">USSD Localization</h1>
            <p className="text-muted-foreground">
              Multi-language USSD menu management
            </p>
          </div>
        </div>

        {/* Language Selector */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" /> Language Selection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 flex-wrap">
              {LOCALES.map(l => (
                <Button
                  key={l.code}
                  variant={locale === l.code ? "default" : "outline"}
                  onClick={() => setLocale(l.code)}
                >
                  {l.flag} — {l.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* USSD Menu Preview */}
        <Card>
          <CardHeader>
            <CardTitle>
              USSD Menu Preview — {LOCALES.find(l => l.code === locale)?.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-w-sm mx-auto p-4 rounded-lg bg-black text-green-400 font-mono text-sm">
              <p className="mb-2">
                {MENU_ITEMS.find(m => m.key === "welcome")?.[
                  locale as keyof (typeof MENU_ITEMS)[0]
                ] || ""}
              </p>
              <p>
                1.{" "}
                {MENU_ITEMS.find(m => m.key === "cash_in")?.[
                  locale as keyof (typeof MENU_ITEMS)[0]
                ] || ""}
              </p>
              <p>
                2.{" "}
                {MENU_ITEMS.find(m => m.key === "cash_out")?.[
                  locale as keyof (typeof MENU_ITEMS)[0]
                ] || ""}
              </p>
              <p>
                3.{" "}
                {MENU_ITEMS.find(m => m.key === "balance")?.[
                  locale as keyof (typeof MENU_ITEMS)[0]
                ] || ""}
              </p>
              <p>
                4.{" "}
                {MENU_ITEMS.find(m => m.key === "transfer")?.[
                  locale as keyof (typeof MENU_ITEMS)[0]
                ] || ""}
              </p>
              <p>
                5.{" "}
                {MENU_ITEMS.find(m => m.key === "airtime")?.[
                  locale as keyof (typeof MENU_ITEMS)[0]
                ] || ""}
              </p>
              <p>
                6.{" "}
                {MENU_ITEMS.find(m => m.key === "bills")?.[
                  locale as keyof (typeof MENU_ITEMS)[0]
                ] || ""}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Translation Table */}
        <Card>
          <CardHeader>
            <CardTitle>Translation Strings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Key</th>
                    {LOCALES.map(l => (
                      <th key={l.code} className="text-left p-2">
                        {l.flag}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MENU_ITEMS.map(m => (
                    <tr key={m.key} className="border-b hover:bg-muted/30">
                      <td className="p-2 font-mono text-xs">{m.key}</td>
                      {LOCALES.map(l => (
                        <td key={l.code} className="p-2 text-xs">
                          {m[l.code as keyof typeof m]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
