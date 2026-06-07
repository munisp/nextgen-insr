import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Globe,
  Palette,
  DollarSign,
  Eye,
  Loader2,
} from "lucide-react";

const STEPS = [
  {
    id: 1,
    label: "Invite Code",
    icon: Check,
    description: "Enter your partner invite code",
  },
  {
    id: 2,
    label: "Company Details",
    icon: Building2,
    description: "Register your company",
  },
  {
    id: 3,
    label: "Branding",
    icon: Palette,
    description: "Customize your look",
  },
  {
    id: 4,
    label: "Regions & Fees",
    icon: DollarSign,
    description: "Set up remittance routes",
  },
  {
    id: 5,
    label: "Preview & Launch",
    icon: Eye,
    description: "Review and go live",
  },
];

export default function PartnerOnboarding() {
  const [step, setStep] = useState(1);
  const [inviteCode, setInviteCode] = useState("");
  const [codeValid, setCodeValid] = useState(false);
  const [tenantId, setTenantId] = useState<number | null>(null);

  // Step 2 form
  const [companyName, setCompanyName] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [country, setCountry] = useState("NGA");
  const [currency, setCurrency] = useState("NGN");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");

  // Step 3 branding
  const [primaryColor, setPrimaryColor] = useState("#2563EB");
  const [secondaryColor, setSecondaryColor] = useState("#1E40AF");
  const [accentColor, setAccentColor] = useState("#F59E0B");
  const [bgColor, setBgColor] = useState("#0F172A");
  const [textColor, setTextColor] = useState("#F8FAFC");
  const [brandName, setBrandName] = useState("");
  const [tagline, setTagline] = useState("");
  const [fontFamily, setFontFamily] = useState("Inter");

  // Step 4 regions
  const [regions, setRegions] = useState<
    Array<{
      sourceCountry: string;
      sourceCurrency: string;
      destinationCountry: string;
      destinationCurrency: string;
    }>
  >([]);
  const [newCorrSrc, setNewCorrSrc] = useState("NGA");
  const [newCorrSrcCur, setNewCorrSrcCur] = useState("NGN");
  const [newCorrDst, setNewCorrDst] = useState("GBR");
  const [newCorrDstCur, setNewCorrDstCur] = useState("GBP");
  const [feeType, setFeeType] = useState<"percentage" | "flat">("percentage");
  const [feeValue, setFeeValue] = useState("1.5");

  const validateCode = trpc.inviteCodes.validate.useQuery(
    { code: inviteCode },
    { enabled: false }
  );

  const registerTenant = trpc.partnerOnboarding.registerTenant.useMutation({
    onSuccess: (data: any) => {
      setTenantId(data.tenant.id);
      setBrandName(data.tenant.name);
      setTagline(`${data.tenant.name} — Fast, Secure Remittances`);
      setStep(3);
      toast.success("Company registered successfully!");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateBranding = trpc.partnerOnboarding.updateBranding.useMutation({
    onSuccess: () => {
      setStep(4);
      toast.success("Branding saved!");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const addRegion = trpc.partnerOnboarding.addRegion.useMutation({
    onSuccess: () => toast.success("Region added!"),
    onError: (err: any) => toast.error(err.message),
  });

  const addFee = trpc.partnerOnboarding.addFeeOverride.useMutation();

  const completeOnboarding =
    trpc.partnerOnboarding.completeOnboarding.useMutation({
      onSuccess: (data: any) => {
        toast.success(data.message);
        setStep(6); // done
      },
      onError: (err: any) => toast.error(err.message),
    });

  async function handleValidateCode() {
    if (!inviteCode.trim()) {
      toast.error("Please enter an invite code");
      return;
    }
    const result = await validateCode.refetch();
    if (result.data?.valid) {
      setCodeValid(true);
      setStep(2);
      toast.success("Invite code validated!");
    } else {
      toast.error(result.data?.reason ?? "Invalid code");
    }
  }

  function handleRegister() {
    if (!companyName || !regNumber || !email || !phone) {
      toast.error("Please fill all required fields");
      return;
    }
    registerTenant.mutate({
      // @ts-ignore Sprint 85
      inviteCode,
      companyName,
      companyRegistrationNumber: regNumber,
      country,
      currency,
      contactEmail: email,
      contactPhone: phone,
      address,
      website,
    });
  }

  function handleSaveBranding() {
    if (!tenantId) return;
    updateBranding.mutate({
      // @ts-ignore Sprint 85
      tenantId,
      primaryColor,
      secondaryColor,
      accentColor,
      backgroundColor: bgColor,
      textColor,
      brandName,
      tagline,
      fontFamily,
    });
  }

  function handleAddRegion() {
    if (!tenantId) return;
    addRegion.mutate({
      // @ts-ignore Sprint 85
      tenantId,
      sourceCountry: newCorrSrc,
      sourceCurrency: newCorrSrcCur,
      destinationCountry: newCorrDst,
      destinationCurrency: newCorrDstCur,
    });
    setRegions(prev => [
      ...prev,
      {
        sourceCountry: newCorrSrc,
        sourceCurrency: newCorrSrcCur,
        destinationCountry: newCorrDst,
        destinationCurrency: newCorrDstCur,
      },
    ]);
  }

  function handleAddFee() {
    if (!tenantId) return;
    addFee.mutate({
      // @ts-ignore Sprint 85
      tenantId,
      feeType,
      feeValue,
      txType: "transfer",
    });
    toast.success("Fee structure saved!");
  }

  function handleGoLive() {
    if (!tenantId) return;
    // @ts-ignore Sprint 85
    completeOnboarding.mutate({ tenantId });
  }

  if (step === 6) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-lg w-full text-center">
          <CardHeader>
            <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-green-500" />
            </div>
            <CardTitle className="text-2xl">Welcome to InsurePortal!</CardTitle>
            <CardDescription>
              Your white-label remittance platform is now live. You can manage
              your instance from the Tenant Admin Dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => (window.location.href = "/admin/tenant")}
              className="w-full"
            >
              Go to Tenant Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card/50 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">
              InsurePortal Partner Onboarding
            </span>
          </div>
          <Badge variant="outline">Step {step} of 5</Badge>
        </div>
      </div>

      {/* Step indicator */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
                  step === s.id
                    ? "bg-primary text-primary-foreground"
                    : step > s.id
                      ? "bg-green-500/10 text-green-500"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {step > s.id ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <s.icon className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="w-8 h-px bg-border mx-1" />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Invite Code */}
        {step === 1 && (
          <Card className="max-w-lg mx-auto">
            <CardHeader>
              <CardTitle>Enter Your Invite Code</CardTitle>
              <CardDescription>
                Only partners with a valid invite code can register as a
                white-label tenant. Contact our partnerships team to obtain a
                code.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="inviteCode">Invite Code</Label>
                <Input
                  id="inviteCode"
                  placeholder="RF-XXXXXXXXXXXX"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value.toUpperCase())}
                  className="font-mono text-lg tracking-wider"
                />
              </div>
              <Button
                onClick={handleValidateCode}
                className="w-full"
                disabled={validateCode.isFetching}
              >
                {validateCode.isFetching ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Validate & Continue
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Company Details */}
        {step === 2 && (
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle>Company Details</CardTitle>
              <CardDescription>Tell us about your organization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Company Name *</Label>
                  <Input
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    placeholder="Acme Remittance Ltd"
                  />
                </div>
                <div>
                  <Label>Registration Number *</Label>
                  <Input
                    value={regNumber}
                    onChange={e => setRegNumber(e.target.value)}
                    placeholder="RC-123456"
                  />
                </div>
                <div>
                  <Label>Country</Label>
                  <Input
                    value={country}
                    onChange={e => setCountry(e.target.value)}
                    placeholder="NGA"
                    maxLength={3}
                  />
                </div>
                <div>
                  <Label>Currency</Label>
                  <Input
                    value={currency}
                    onChange={e => setCurrency(e.target.value)}
                    placeholder="NGN"
                    maxLength={3}
                  />
                </div>
                <div>
                  <Label>Contact Email *</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="partner@acme.com"
                  />
                </div>
                <div>
                  <Label>Contact Phone *</Label>
                  <Input
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+234 800 000 0000"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Address</Label>
                  <Input
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="123 Victoria Island, Lagos"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Website</Label>
                  <Input
                    value={website}
                    onChange={e => setWebsite(e.target.value)}
                    placeholder="https://acme-remit.com"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ArrowLeft className="h-4 w-4 mr-2" /> Back
                </Button>
                <Button
                  onClick={handleRegister}
                  className="flex-1"
                  disabled={registerTenant.isPending}
                >
                  {registerTenant.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Register & Continue <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Branding */}
        {step === 3 && (
          <Card className="max-w-3xl mx-auto">
            <CardHeader>
              <CardTitle>Customize Your Brand</CardTitle>
              <CardDescription>
                Set your colors, fonts, and branding to match your identity
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Brand Name</Label>
                  <Input
                    value={brandName}
                    onChange={e => setBrandName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Tagline</Label>
                  <Input
                    value={tagline}
                    onChange={e => setTagline(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Font Family</Label>
                  <select
                    value={fontFamily}
                    onChange={e => setFontFamily(e.target.value)}
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="Inter">Inter</option>
                    <option value="Poppins">Poppins</option>
                    <option value="Roboto">Roboto</option>
                    <option value="Open Sans">Open Sans</option>
                    <option value="Montserrat">Montserrat</option>
                  </select>
                </div>
              </div>

              <div>
                <Label className="mb-3 block">Color Palette</Label>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {[
                    {
                      label: "Primary",
                      value: primaryColor,
                      set: setPrimaryColor,
                    },
                    {
                      label: "Secondary",
                      value: secondaryColor,
                      set: setSecondaryColor,
                    },
                    {
                      label: "Accent",
                      value: accentColor,
                      set: setAccentColor,
                    },
                    { label: "Background", value: bgColor, set: setBgColor },
                    { label: "Text", value: textColor, set: setTextColor },
                  ].map(c => (
                    <div key={c.label} className="text-center">
                      <div
                        className="w-full h-12 rounded-lg border cursor-pointer mb-1"
                        style={{ backgroundColor: c.value }}
                        onClick={() => {
                          const input = document.createElement("input");
                          input.type = "color";
                          input.value = c.value;
                          input.addEventListener("input", e =>
                            c.set((e.target as HTMLInputElement).value)
                          );
                          input.click();
                        }}
                      />
                      <span className="text-xs text-muted-foreground">
                        {c.label}
                      </span>
                      <Input
                        value={c.value}
                        onChange={e => c.set(e.target.value)}
                        className="mt-1 text-xs h-7"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Live Preview */}
              <div>
                <Label className="mb-3 block">Live Preview</Label>
                <div
                  className="rounded-xl border overflow-hidden"
                  style={{
                    backgroundColor: bgColor,
                    color: textColor,
                    fontFamily,
                  }}
                >
                  <div
                    className="px-6 py-4 flex items-center justify-between"
                    style={{ backgroundColor: primaryColor }}
                  >
                    <span className="font-bold text-white text-lg">
                      {brandName || "Your Brand"}
                    </span>
                    <div className="flex gap-2">
                      <span className="text-white/80 text-sm">Send Money</span>
                      <span className="text-white/80 text-sm">Track</span>
                      <span className="text-white/80 text-sm">Help</span>
                    </div>
                  </div>
                  <div className="px-6 py-8 text-center">
                    <h2 className="text-2xl font-bold mb-2">
                      {tagline || "Fast, Secure Remittances"}
                    </h2>
                    <p className="opacity-70 mb-4">
                      Send money to loved ones across borders instantly
                    </p>
                    <button
                      className="px-6 py-2 rounded-lg font-medium text-sm"
                      style={{ backgroundColor: accentColor, color: bgColor }}
                    >
                      Send Money Now
                    </button>
                  </div>
                  <div
                    className="px-6 py-3 text-center text-xs opacity-50"
                    style={{ backgroundColor: secondaryColor }}
                  >
                    Powered by InsurePortal &middot; {brandName}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={() => setStep(2)}>
                  <ArrowLeft className="h-4 w-4 mr-2" /> Back
                </Button>
                <Button
                  onClick={handleSaveBranding}
                  className="flex-1"
                  disabled={updateBranding.isPending}
                >
                  {updateBranding.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Save Branding & Continue{" "}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Regions & Fees */}
        {step === 4 && (
          <Card className="max-w-3xl mx-auto">
            <CardHeader>
              <CardTitle>Remittance Regions & Fee Structure</CardTitle>
              <CardDescription>
                Define which regions you want to operate and set your fee
                structure
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Add region */}
              <div>
                <Label className="mb-2 block">Add Region</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs">Source Country</Label>
                    <Input
                      value={newCorrSrc}
                      onChange={e => setNewCorrSrc(e.target.value)}
                      maxLength={3}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Source Currency</Label>
                    <Input
                      value={newCorrSrcCur}
                      onChange={e => setNewCorrSrcCur(e.target.value)}
                      maxLength={3}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Dest Country</Label>
                    <Input
                      value={newCorrDst}
                      onChange={e => setNewCorrDst(e.target.value)}
                      maxLength={3}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Dest Currency</Label>
                    <Input
                      value={newCorrDstCur}
                      onChange={e => setNewCorrDstCur(e.target.value)}
                      maxLength={3}
                    />
                  </div>
                </div>
                <Button
                  onClick={handleAddRegion}
                  size="sm"
                  className="mt-2"
                  disabled={addRegion.isPending}
                >
                  Add Region
                </Button>
              </div>

              {/* Regions list */}
              {regions.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-4 py-2">Route</th>
                        <th className="text-left px-4 py-2">Currencies</th>
                        <th className="text-left px-4 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {regions.map((c, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-4 py-2">
                            {c.sourceCountry} → {c.destinationCountry}
                          </td>
                          <td className="px-4 py-2">
                            {c.sourceCurrency} → {c.destinationCurrency}
                          </td>
                          <td className="px-4 py-2">
                            <Badge variant="outline" className="text-green-500">
                              Active
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Fee structure */}
              <div>
                <Label className="mb-2 block">Default Fee Structure</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Fee Type</Label>
                    <select
                      value={feeType}
                      onChange={e =>
                        setFeeType(e.target.value as "percentage" | "flat")
                      }
                      className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="percentage">Percentage</option>
                      <option value="flat">Flat Fee</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">
                      Fee Value ({feeType === "percentage" ? "%" : "NGN"})
                    </Label>
                    <Input
                      value={feeValue}
                      onChange={e => setFeeValue(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  onClick={handleAddFee}
                  size="sm"
                  className="mt-2"
                  variant="secondary"
                >
                  Save Fee Structure
                </Button>
              </div>

              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={() => setStep(3)}>
                  <ArrowLeft className="h-4 w-4 mr-2" /> Back
                </Button>
                <Button onClick={() => setStep(5)} className="flex-1">
                  Review & Launch <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 5: Preview & Launch */}
        {step === 5 && (
          <Card className="max-w-3xl mx-auto">
            <CardHeader>
              <CardTitle>Review & Go Live</CardTitle>
              <CardDescription>
                Review your configuration before launching your white-label
                instance
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Summary cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Company
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="font-semibold">{companyName}</p>
                    <p className="text-sm text-muted-foreground">{email}</p>
                    <p className="text-sm text-muted-foreground">
                      {country} / {currency}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Branding
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="font-semibold">{brandName}</p>
                    <div className="flex gap-1 mt-2">
                      {[primaryColor, secondaryColor, accentColor].map(
                        (c, i) => (
                          <div
                            key={i}
                            className="w-6 h-6 rounded-full border"
                            style={{ backgroundColor: c }}
                          />
                        )
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {fontFamily}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Regions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="font-semibold">
                      {regions.length} region(s)
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Fee: {feeValue}
                      {feeType === "percentage" ? "%" : " flat"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Full preview */}
              <div>
                <Label className="mb-3 block">White-Label Preview</Label>
                <div
                  className="rounded-xl border overflow-hidden shadow-lg"
                  style={{
                    backgroundColor: bgColor,
                    color: textColor,
                    fontFamily,
                  }}
                >
                  <div
                    className="px-6 py-3 flex items-center justify-between"
                    style={{ backgroundColor: primaryColor }}
                  >
                    <span className="font-bold text-white">{brandName}</span>
                    <div className="flex gap-4 text-sm text-white/80">
                      <span>Send</span>
                      <span>Track</span>
                      <span>Rates</span>
                      <span>Help</span>
                    </div>
                  </div>
                  <div className="px-6 py-12 text-center">
                    <h1 className="text-3xl font-bold mb-3">{tagline}</h1>
                    <p className="opacity-70 mb-6 max-w-md mx-auto">
                      Send money across borders with the best rates. Fast,
                      secure, and reliable.
                    </p>
                    <div className="flex gap-3 justify-center">
                      <button
                        className="px-8 py-3 rounded-lg font-medium"
                        style={{ backgroundColor: accentColor, color: bgColor }}
                      >
                        Send Money
                      </button>
                      <button className="px-8 py-3 rounded-lg font-medium border border-current opacity-70">
                        Track Transfer
                      </button>
                    </div>
                  </div>
                  <div
                    className="grid grid-cols-3 gap-4 px-6 py-8"
                    style={{ backgroundColor: secondaryColor + "20" }}
                  >
                    {regions.slice(0, 3).map((c, i) => (
                      <div
                        key={i}
                        className="text-center p-4 rounded-lg"
                        style={{ backgroundColor: secondaryColor + "30" }}
                      >
                        <p className="font-bold">
                          {c.sourceCountry} → {c.destinationCountry}
                        </p>
                        <p className="text-sm opacity-70">
                          {c.sourceCurrency} → {c.destinationCurrency}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div
                    className="px-6 py-3 text-center text-xs opacity-40"
                    style={{ backgroundColor: secondaryColor }}
                  >
                    Powered by InsurePortal Platform
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={() => setStep(4)}>
                  <ArrowLeft className="h-4 w-4 mr-2" /> Back
                </Button>
                <Button
                  onClick={handleGoLive}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  disabled={completeOnboarding.isPending}
                >
                  {completeOnboarding.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Go Live!
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
