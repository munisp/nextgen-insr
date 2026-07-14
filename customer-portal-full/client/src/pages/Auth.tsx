import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Shield, Mail, Lock, User, Phone, Eye, EyeOff, ArrowRight, CheckCircle, AlertTriangle, Loader2, KeyRound, LogOut } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";

type AuthView = "login" | "signup" | "forgot" | "reset" | "2fa";

async function authApi(route: string, input: Record<string, unknown>) {
  const res = await fetch(`/api/trpc/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `Request failed (${res.status})`;
    return { error: msg };
  }
  return json?.result?.data ?? json;
}

export default function Auth() {
  const [view, setView] = useState<AuthView>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const redirectUrl = params.get("redirect") || "/dashboard";
  const productId = params.get("product");
  const action = params.get("action"); // ?action=logout
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [kycWarning, setKycWarning] = useState<{ show: boolean; level: number; steps: string[] }>({ show: false, level: 0, steps: [] });
  const [twoFARequired, setTwoFARequired] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [resetOtp, setResetOtp] = useState("");

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    fullName: "",
    phone: "",
    otp: "",
    newPassword: "",
    twoFACode: "",
  });



  // Handle ?action=logout (also handles direct navigation/page reload)
  useEffect(() => {
    const url = new URL(window.location.href);
    const urlAction = url.searchParams.get("action");
    if (urlAction === "logout" || action === "logout") {
      const token = localStorage.getItem("insureportal-token");
      if (token) {
        authApi('auth.logout', { token }).catch(() => {});
      }
      localStorage.removeItem("insureportal-token");
      localStorage.removeItem("insureportal-user");
      setSuccess("You have been logged out successfully.");
    }
  }, []);

  const handleLogin = async () => {
    const result = await authApi('auth.login', {
      email: formData.email,
      password: formData.password,
    });

    if (result?.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    // Check if 2FA is required
    if (result?.requires2FA) {
      setPendingEmail(formData.email);
      setTwoFARequired(true);
      setView("2fa");
      setLoading(false);
      return;
    }

    // Store token
    if (result?.token) {
      localStorage.setItem("insureportal-token", result.token);
      localStorage.setItem("insureportal-user", JSON.stringify(result));
    }

    // Check KYC gate
    if (result?.requiresKyc) {
      setKycWarning({
        show: true,
        level: result.kycLevel || 0,
        steps: result.kycRemainingSteps || [],
      });
      setTimeout(() => setLocation("/kyc"), 3000);
    } else {
      setLocation(redirectUrl);
    }
  };

  const handleSignup = async () => {
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }
    if (formData.password.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    const result = await authApi('auth.signup', {
      email: formData.email,
      password: formData.password,
      fullName: formData.fullName,
      phone: formData.phone,
    });

    if (result?.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    if (result?.token) {
      localStorage.setItem("insureportal-token", result.token);
      localStorage.setItem("insureportal-user", JSON.stringify(result));
    }

    setKycWarning({
      show: true,
      level: 0,
      steps: result?.kycRemainingSteps || ["bvn", "nin", "phone", "address", "id_document", "facial_match"],
    });
    setTimeout(() => setLocation("/kyc"), 3000);
  };

  const handleForgotPassword = async () => {
    const result = await authApi('auth.resetPassword', { email: formData.email });
    if (result?.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setSuccess(result.message || "Reset instructions sent to your email.");
    setPendingEmail(formData.email);
    if (result?._demo_otp) setResetOtp(result._demo_otp);
    setView("reset");
  };

  const handleResetConfirm = async () => {
    if (formData.newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }
    const result = await authApi('auth.confirmResetPassword', {
      email: pendingEmail,
      otp: formData.otp,
      newPassword: formData.newPassword,
    });
    if (result?.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setSuccess(result.message || "Password reset successfully!");
    setView("login");
  };

  const handle2FA = async () => {
    const result = await authApi('auth.validate2FA', {
      email: pendingEmail,
      code: formData.twoFACode,
    });
    if (result?.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    // 2FA passed — now complete login
    const loginResult = await authApi('auth.login', {
      email: pendingEmail,
      password: formData.password,
    });
    if (loginResult?.token) {
      localStorage.setItem("insureportal-token", loginResult.token);
      localStorage.setItem("insureportal-user", JSON.stringify(loginResult));
    }
    if (loginResult?.requiresKyc) {
      setKycWarning({ show: true, level: loginResult.kycLevel || 0, steps: loginResult.kycRemainingSteps || [] });
      setTimeout(() => setLocation("/kyc"), 3000);
    } else {
      setLocation(redirectUrl);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setKycWarning({ show: false, level: 0, steps: [] });
    setLoading(true);

    try {
      if (view === "login") await handleLogin();
      else if (view === "signup") await handleSignup();
      else if (view === "forgot") await handleForgotPassword();
      else if (view === "reset") await handleResetConfirm();
      else if (view === "2fa") await handle2FA();
    } catch (err: any) {
      setError(err?.message || "An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const renderTitle = () => {
    switch (view) {
      case "login": return "Welcome Back";
      case "signup": return "Create Account";
      case "forgot": return "Recover Account";
      case "reset": return "Reset Password";
      case "2fa": return "Two-Factor Authentication";
    }
  };

  const renderDescription = () => {
    switch (view) {
      case "login": return "Sign in to manage your insurance";
      case "signup": return "Join InsurePortal to get started";
      case "forgot": return "Enter your email to receive a reset code";
      case "reset": return "Enter the OTP code sent to your email";
      case "2fa": return "Enter the 6-digit code from your authenticator app";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 via-blue-700 to-slate-900 flex flex-col">
      {/* Header */}
      <nav className="container mx-auto px-6 py-6 flex justify-between items-center">
        <Link href="/">
          <div className="flex items-center gap-2 text-white cursor-pointer">
            <Shield className="h-8 w-8" />
            <span className="text-2xl font-bold">InsurePortal</span>
          </div>
        </Link>
      </nav>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Product Context Banner */}
          {productId && (
            <Card className="mb-6 bg-white/10 backdrop-blur-lg border-white/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 text-white">
                  <CheckCircle className="h-5 w-5 text-green-400" />
                  <div>
                    <p className="font-medium">You selected: {productId.charAt(0).toUpperCase() + productId.slice(1)} Insurance</p>
                    <p className="text-sm text-blue-200">Create an account to continue your application</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* KYC Warning */}
          {kycWarning.show && (
            <Card className="mb-6 bg-amber-50 border-amber-200">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-800">KYC Verification Required</p>
                    <p className="text-sm text-amber-700 mt-1">
                      Your KYC level is {kycWarning.level}. You need to complete verification before accessing platform features.
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {kycWarning.steps.map((step) => (
                        <Badge key={step} variant="outline" className="text-xs bg-amber-100 border-amber-300">
                          {step.replace("_", " ")}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-amber-600 mt-2">Redirecting to KYC verification...</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Auth Card */}
          <Card className="shadow-2xl">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl">{renderTitle()}</CardTitle>
              <CardDescription>{renderDescription()}</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Success Message */}
              {success && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 flex-shrink-0" />
                  {success}
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* Demo OTP hint for reset */}
              {view === "reset" && resetOtp && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                  <p className="font-medium">Demo Mode</p>
                  <p>Your OTP code is: <span className="font-mono font-bold">{resetOtp}</span></p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Signup Fields */}
                {view === "signup" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="fullName">Full Name</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="fullName" name="fullName" placeholder="Enter your full name" className="pl-10" value={formData.fullName} onChange={handleInputChange} required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone Number</Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="phone" name="phone" type="tel" placeholder="+234 801 234 5678" className="pl-10" value={formData.phone} onChange={handleInputChange} required />
                      </div>
                    </div>
                  </>
                )}

                {/* Email (login, signup, forgot) */}
                {(view === "login" || view === "signup" || view === "forgot") && (
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input id="email" name="email" type="email" placeholder="your@email.com" className="pl-10" value={formData.email} onChange={handleInputChange} required />
                    </div>
                  </div>
                )}

                {/* Password (login, signup) */}
                {(view === "login" || view === "signup") && (
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input id="password" name="password" type={showPassword ? "text" : "password"} placeholder="Enter your password" className="pl-10 pr-10" value={formData.password} onChange={handleInputChange} required />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Confirm Password (signup) */}
                {view === "signup" && (
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input id="confirmPassword" name="confirmPassword" type={showPassword ? "text" : "password"} placeholder="Confirm your password" className="pl-10" value={formData.confirmPassword} onChange={handleInputChange} required />
                    </div>
                  </div>
                )}

                {/* OTP + New Password (reset view) */}
                {view === "reset" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="otp">OTP Code</Label>
                      <div className="relative">
                        <KeyRound className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="otp" name="otp" placeholder="Enter 6-digit OTP" className="pl-10" maxLength={6} value={formData.otp} onChange={handleInputChange} required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="newPassword">New Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="newPassword" name="newPassword" type="password" placeholder="Enter new password (min 6 chars)" className="pl-10" value={formData.newPassword} onChange={handleInputChange} required />
                      </div>
                    </div>
                  </>
                )}

                {/* 2FA Code */}
                {view === "2fa" && (
                  <div className="space-y-2">
                    <Label htmlFor="twoFACode">Authentication Code</Label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input id="twoFACode" name="twoFACode" placeholder="Enter 6-digit code" className="pl-10 text-center text-lg tracking-widest" maxLength={6} value={formData.twoFACode} onChange={handleInputChange} required />
                    </div>
                    <p className="text-xs text-gray-500">Open your authenticator app to find the code</p>
                  </div>
                )}

                {/* Forgot Password Link (Login only) */}
                {view === "login" && (
                  <div className="text-right">
                    <button type="button" onClick={() => { setView("forgot"); setError(null); setSuccess(null); }} className="text-sm text-blue-600 hover:underline">
                      Forgot password?
                    </button>
                  </div>
                )}

                {/* Submit Button */}
                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {view === "login" ? "Signing In..." : view === "signup" ? "Creating Account..." : view === "forgot" ? "Sending Reset..." : view === "reset" ? "Resetting..." : "Verifying..."}
                    </>
                  ) : (
                    <>
                      {view === "login" ? "Sign In" : view === "signup" ? "Create Account" : view === "forgot" ? "Send Reset Code" : view === "reset" ? "Reset Password" : "Verify Code"}
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>

                {/* Demo Login Hint */}
                {view === "login" && (
                  <div className="text-center">
                    <p className="text-xs text-gray-400">
                      Demo: demo@insureportal.ng / demo123
                    </p>
                  </div>
                )}

                {/* Terms (Registration only) */}
                {view === "signup" && (
                  <p className="text-xs text-gray-500 text-center">
                    By creating an account, you agree to our{" "}
                    <a href="#" className="text-blue-600 hover:underline">Terms of Service</a>
                    {" "}and{" "}
                    <a href="#" className="text-blue-600 hover:underline">Privacy Policy</a>
                  </p>
                )}
              </form>

              {/* Navigation Links */}
              <div className="mt-6 text-center border-t pt-6 space-y-2">
                {(view === "login" || view === "signup") && (
                  <p className="text-sm text-gray-600">
                    {view === "login" ? "Don't have an account?" : "Already have an account?"}
                    <button type="button" onClick={() => { setView(view === "login" ? "signup" : "login"); setError(null); setSuccess(null); }} className="ml-2 text-blue-600 font-medium hover:underline">
                      {view === "login" ? "Sign Up" : "Sign In"}
                    </button>
                  </p>
                )}
                {(view === "forgot" || view === "reset" || view === "2fa") && (
                  <p className="text-sm text-gray-600">
                    <button type="button" onClick={() => { setView("login"); setError(null); setSuccess(null); }} className="text-blue-600 font-medium hover:underline">
                      Back to Sign In
                    </button>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Benefits */}
          <div className="mt-8 text-white text-center">
            <p className="text-sm text-blue-200 mb-4">Why create an account?</p>
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  <Shield className="h-5 w-5" />
                </div>
                <span>Secure Policies</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5" />
                </div>
                <span>Easy Claims</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  <User className="h-5 w-5" />
                </div>
                <span>KYC Verified</span>
              </div>
            </div>
          </div>

          {/* KYC Tier Info */}
          <div className="mt-6 text-white">
            <Card className="bg-white/5 backdrop-blur-lg border-white/10">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-blue-200 mb-3">KYC Verification Tiers</p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-red-500/20 text-red-200 border-red-400/30 text-[10px]">Tier 0</Badge>
                    <span className="text-blue-100">No access — complete BVN + NIN verification</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-yellow-500/20 text-yellow-200 border-yellow-400/30 text-[10px]">Tier 1</Badge>
                    <span className="text-blue-100">Basic — purchase policies, file claims, make payments</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-blue-500/20 text-blue-200 border-blue-400/30 text-[10px]">Tier 2</Badge>
                    <span className="text-blue-100">Enhanced — high-value policies, international coverage</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-green-500/20 text-green-200 border-green-400/30 text-[10px]">Tier 3</Badge>
                    <span className="text-blue-100">Full — reinsurance access, broker API, commercial policies</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
