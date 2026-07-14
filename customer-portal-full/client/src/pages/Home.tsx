import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, FileText, CreditCard, Clock, CheckCircle, Users, Heart, Car, Home as HomeIcon, ArrowRight, Phone, MessageCircle, Leaf, CloudRain, Fish, Tractor, Calculator, HelpCircle, Sparkles, Wallet, Smartphone, Camera, Bell, Package, Zap, PiggyBank, Landmark, Bike, Building, Coins, Cloud, Gift, Trophy } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useState } from "react";

const insuranceProducts = [
  {
    id: "health",
    name: "Health Insurance",
    icon: Heart,
    description: "Comprehensive health coverage for you and your family",
    startingPrice: "₦75,000",
    coverageRange: "₦2M - ₦10M",
    highlights: ["Hospital & Surgical", "Outpatient Care", "Maternity Benefits"],
    color: "from-red-500 to-red-600",
    iconBg: "bg-red-100",
    iconColor: "text-red-600",
    category: "personal",
  },
  {
    id: "auto",
    name: "Auto Insurance",
    icon: Car,
    description: "Protect your vehicle against accidents, theft, and damage",
    startingPrice: "₦35,000",
    coverageRange: "₦1M - ₦5M",
    highlights: ["Third-Party Liability", "Comprehensive Coverage", "Roadside Assistance"],
    color: "from-blue-500 to-blue-600",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    category: "personal",
  },
  {
    id: "property",
    name: "Property Insurance",
    icon: HomeIcon,
    description: "Safeguard your home and belongings from unexpected events",
    startingPrice: "₦85,000",
    coverageRange: "₦10M - ₦50M",
    highlights: ["Building Coverage", "Contents Protection", "Fire & Flood"],
    color: "from-green-500 to-green-600",
    iconBg: "bg-green-100",
    iconColor: "text-green-600",
    category: "personal",
  },
  {
    id: "life",
    name: "Life Insurance",
    icon: Users,
    description: "Financial security for your loved ones",
    startingPrice: "₦120,000",
    coverageRange: "₦10M - ₦50M",
    highlights: ["Death Benefit", "Critical Illness", "Education Fund"],
    color: "from-purple-500 to-purple-600",
    iconBg: "bg-purple-100",
    iconColor: "text-purple-600",
    category: "personal",
  },
  {
    id: "crop",
    name: "Crop Insurance",
    icon: Leaf,
    description: "Protect your harvest against drought, flood, pests, and disease",
    startingPrice: "₦45,000",
    coverageRange: "₦500K - ₦20M",
    highlights: ["Drought Protection", "Flood Coverage", "Pest & Disease"],
    color: "from-emerald-500 to-emerald-600",
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
    category: "agricultural",
  },
  {
    id: "livestock",
    name: "Livestock Insurance",
    icon: Tractor,
    description: "Coverage for cattle, poultry, goats, and other farm animals",
    startingPrice: "₦30,000",
    coverageRange: "₦200K - ₦10M",
    highlights: ["Cattle & Goats", "Poultry Coverage", "Disease & Theft"],
    color: "from-amber-500 to-amber-600",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    category: "agricultural",
  },
  {
    id: "weather-index",
    name: "Weather Index Insurance",
    icon: CloudRain,
    description: "Automatic payouts based on rainfall and temperature data",
    startingPrice: "₦25,000",
    coverageRange: "₦100K - ₦5M",
    highlights: ["Rainfall Index", "Temperature Triggers", "Automatic Payout"],
    color: "from-cyan-500 to-cyan-600",
    iconBg: "bg-cyan-100",
    iconColor: "text-cyan-600",
    category: "agricultural",
  },
  {
    id: "aquaculture",
    name: "Aquaculture Insurance",
    icon: Fish,
    description: "Protection for fish farms, ponds, and marine operations",
    startingPrice: "₦55,000",
    coverageRange: "₦500K - ₦15M",
    highlights: ["Fish Mortality", "Pond Equipment", "Water Quality"],
    color: "from-teal-500 to-teal-600",
    iconBg: "bg-teal-100",
    iconColor: "text-teal-600",
    category: "agricultural",
  },
];

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  const handleApplyNow = (productId: string) => {
    if (isAuthenticated) {
      setLocation(`/apply?product=${productId}`);
    } else {
      // Redirect to auth page with return URL and product context
      setLocation(`/auth?redirect=/apply?product=${productId}&product=${productId}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 via-blue-700 to-slate-900">
      <nav className="container mx-auto px-6 py-6 flex justify-between items-center">
        <div className="flex items-center gap-2 text-white">
          <Shield className="h-8 w-8" />
          <span className="text-2xl font-bold">InsurePortal</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#products" className="text-white hover:text-blue-200 font-medium">
            Products
          </a>
          <Link href="/auth">
            <Button variant="secondary" size="lg">
              Login / Sign Up
            </Button>
          </Link>
        </div>
      </nav>

      <main>
        <section className="container mx-auto px-6 py-24 text-center text-white">
          <h1 className="text-6xl font-bold mb-6">
            Insurance Made Simple
          </h1>
          <p className="text-xl text-blue-100 mb-12 max-w-2xl mx-auto">
            Manage your policies, file claims, and make payments all in one place. 
            Your insurance, simplified.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a href="#products">
              <Button size="lg" variant="secondary" className="text-lg px-8 py-6">
                View Products
              </Button>
            </a>
            <Link href="/auth">
              <Button size="lg" variant="outline" className="text-lg px-8 py-6 text-white border-white hover:bg-white/10">
                Login / Sign Up
              </Button>
            </Link>
          </div>
        </section>

        {/* Why Choose InsurePortal Banner */}
        <section className="container mx-auto px-6 py-12">
          <Card className="bg-white/10 backdrop-blur-lg border-white/20">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4 text-white">
                <Shield className="h-6 w-6" />
                <h2 className="text-xl font-semibold">Why Choose InsurePortal?</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-white">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-400" />
                  <span>NAICOM Licensed</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-400" />
                  <span>24/7 Claims Support</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-400" />
                  <span>Fast Digital Processing</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-400" />
                  <span>Blockchain-Secured Policies</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Quick Tools Section - For Non-Registered Users */}
        <section className="container mx-auto px-6 py-12">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-white mb-3">Try Our Free Tools</h2>
            <p className="text-blue-100 max-w-xl mx-auto">
              Explore our insurance tools without signing up. Get personalized recommendations and instant premium estimates.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {/* Find My Coverage Card */}
            <Link href="/recommendation-quiz">
              <Card className="bg-white/10 backdrop-blur-lg border-white/20 hover:bg-white/20 transition-all cursor-pointer group h-full">
                <CardContent className="p-8">
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                      <HelpCircle className="h-7 w-7 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-white mb-2 group-hover:text-purple-200 transition-colors">
                        Find My Coverage
                      </h3>
                      <p className="text-blue-100 text-sm mb-4">
                        Answer 6 quick questions and get personalized insurance recommendations based on your life stage, income, and priorities.
                      </p>
                      <div className="flex items-center gap-2 text-purple-300">
                        <Sparkles className="h-4 w-4" />
                        <span className="text-sm font-medium">AI-Powered Recommendations</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm text-blue-200">
                      <span>2 min</span>
                      <span>•</span>
                      <span>No signup required</span>
                    </div>
                    <ArrowRight className="h-5 w-5 text-white group-hover:translate-x-1 transition-transform" />
                  </div>
                </CardContent>
              </Card>
            </Link>

            {/* Premium Calculator Card */}
            <Link href="/premium-calculator">
              <Card className="bg-white/10 backdrop-blur-lg border-white/20 hover:bg-white/20 transition-all cursor-pointer group h-full">
                <CardContent className="p-8">
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center flex-shrink-0">
                      <Calculator className="h-7 w-7 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-white mb-2 group-hover:text-green-200 transition-colors">
                        Premium Calculator
                      </h3>
                      <p className="text-blue-100 text-sm mb-4">
                        Get instant premium estimates for Health, Auto, Property, and Life insurance. Adjust coverage and see prices update in real-time.
                      </p>
                      <div className="flex items-center gap-2 text-green-300">
                        <Sparkles className="h-4 w-4" />
                        <span className="text-sm font-medium">Real-time Calculations</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm text-blue-200">
                      <span>Instant results</span>
                      <span>•</span>
                      <span>No signup required</span>
                    </div>
                    <ArrowRight className="h-5 w-5 text-white group-hover:translate-x-1 transition-transform" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </section>

        {/* Insurance Products Section - PUBLIC */}
        <section id="products" className="bg-gray-50 py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Our Insurance Products</h2>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                Comprehensive coverage options designed to protect what matters most to you.
              </p>
            </div>

            {/* Personal Insurance Section */}
            <div className="mb-16">
              <div className="flex items-center gap-3 mb-8">
                <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Users className="h-5 w-5 text-blue-600" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900">Personal Insurance</h3>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                {insuranceProducts.filter(p => p.category === "personal").map((product) => (
                  <Card key={product.id} className="group hover:shadow-xl transition-all duration-300 overflow-hidden border-0 shadow-lg">
                    <div className={`bg-gradient-to-r ${product.color} p-6 text-white`}>
                      <div className={`w-14 h-14 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center mb-4`}>
                        <product.icon className="h-7 w-7 text-white" />
                      </div>
                      <h3 className="text-xl font-bold mb-1">{product.name}</h3>
                      <p className="text-white/80 text-sm">{product.description}</p>
                    </div>
                    <CardContent className="p-6">
                      <div className="mb-6">
                        <div className="flex items-baseline gap-1 mb-1">
                          <span className="text-sm text-gray-500">From</span>
                          <span className="text-2xl font-bold text-gray-900">{product.startingPrice}</span>
                          <span className="text-sm text-gray-500">/year</span>
                        </div>
                        <p className="text-sm text-gray-500">Coverage: {product.coverageRange}</p>
                      </div>
                      <div className="space-y-2 mb-6">
                        {product.highlights.map((highlight, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                            <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                            <span>{highlight}</span>
                          </div>
                        ))}
                      </div>
                      <Button 
                        className="w-full group-hover:bg-blue-600" 
                        onClick={() => handleApplyNow(product.id)}
                      >
                        Get a Quote
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Agricultural Insurance Section */}
            <div className="mb-16">
              <div className="flex items-center gap-3 mb-8">
                <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <Leaf className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">Agricultural Insurance</h3>
                  <p className="text-sm text-gray-500">Protecting Nigerian farmers and agribusinesses</p>
                </div>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                {insuranceProducts.filter(p => p.category === "agricultural").map((product) => (
                  <Card key={product.id} className="group hover:shadow-xl transition-all duration-300 overflow-hidden border-0 shadow-lg">
                    <div className={`bg-gradient-to-r ${product.color} p-6 text-white`}>
                      <div className={`w-14 h-14 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center mb-4`}>
                        <product.icon className="h-7 w-7 text-white" />
                      </div>
                      <h3 className="text-xl font-bold mb-1">{product.name}</h3>
                      <p className="text-white/80 text-sm">{product.description}</p>
                    </div>
                    <CardContent className="p-6">
                      <div className="mb-6">
                        <div className="flex items-baseline gap-1 mb-1">
                          <span className="text-sm text-gray-500">From</span>
                          <span className="text-2xl font-bold text-gray-900">{product.startingPrice}</span>
                          <span className="text-sm text-gray-500">/year</span>
                        </div>
                        <p className="text-sm text-gray-500">Coverage: {product.coverageRange}</p>
                      </div>
                      <div className="space-y-2 mb-6">
                        {product.highlights.map((highlight, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                            <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                            <span>{highlight}</span>
                          </div>
                        ))}
                      </div>
                      <Button 
                        className="w-full group-hover:bg-emerald-600" 
                        onClick={() => handleApplyNow(product.id)}
                      >
                        Get a Quote
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

                        {/* Microinsurance Section */}
                        <div className="mb-16">
                          <div className="flex items-center gap-3 mb-8">
                            <div className="h-10 w-10 rounded-lg bg-pink-100 flex items-center justify-center">
                              <Wallet className="h-5 w-5 text-pink-600" />
                            </div>
                            <div>
                              <h3 className="text-2xl font-bold text-gray-900">Microinsurance</h3>
                              <p className="text-sm text-gray-500">Affordable protection for low-income & underserved communities</p>
                            </div>
                          </div>
                          <Card className="bg-gradient-to-r from-pink-500 to-purple-600 text-white overflow-hidden">
                            <CardContent className="p-8">
                              <div className="grid md:grid-cols-2 gap-8 items-center">
                                <div>
                                  <div className="flex items-center gap-2 mb-4">
                                    <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-medium">NAICOM Approved</span>
                                    <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-medium">No Documents Required</span>
                                  </div>
                                  <h4 className="text-3xl font-bold mb-4">Insurance for Everyone</h4>
                                  <p className="text-white/90 mb-6">
                                    Starting from just ₦50/month. Enroll in 2 minutes via phone, USSD, or mobile money. 
                                    Get paid within 24 hours. No complex paperwork - just your phone number and NIN.
                                  </p>
                                  <div className="grid grid-cols-2 gap-4 mb-6">
                                    <div className="flex items-center gap-2">
                                      <CheckCircle className="h-5 w-5 text-green-300" />
                                      <span>Funeral Cover</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <CheckCircle className="h-5 w-5 text-green-300" />
                                      <span>Hospital Cash</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <CheckCircle className="h-5 w-5 text-green-300" />
                                      <span>Personal Accident</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <CheckCircle className="h-5 w-5 text-green-300" />
                                      <span>Crop Insurance</span>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-3">
                                    <Link href="/microinsurance">
                                      <Button size="lg" variant="secondary">
                                        Get Covered Now
                                        <ArrowRight className="h-4 w-4 ml-2" />
                                      </Button>
                                    </Link>
                                    <Button size="lg" variant="outline" className="text-white border-white hover:bg-white/10">
                                      <Smartphone className="h-4 w-4 mr-2" />
                                      Dial *384*Insurance#
                                    </Button>
                                  </div>
                                </div>
                                <div className="hidden md:block">
                                  <div className="bg-white/10 backdrop-blur rounded-2xl p-6 space-y-4">
                                    <div className="text-center mb-4">
                                      <div className="text-5xl font-bold">₦50</div>
                                      <div className="text-white/80">Starting premium/month</div>
                                    </div>
                                    <div className="space-y-3">
                                      <div className="flex justify-between items-center bg-white/10 rounded-lg p-3">
                                        <span>Enrollment Time</span>
                                        <span className="font-bold">2 Minutes</span>
                                      </div>
                                      <div className="flex justify-between items-center bg-white/10 rounded-lg p-3">
                                        <span>Claim Payout</span>
                                        <span className="font-bold">24 Hours</span>
                                      </div>
                                      <div className="flex justify-between items-center bg-white/10 rounded-lg p-3">
                                        <span>Documents Needed</span>
                                        <span className="font-bold">None</span>
                                      </div>
                                      <div className="flex justify-between items-center bg-white/10 rounded-lg p-3">
                                        <span>Payment Options</span>
                                        <span className="font-bold">Airtime, Mobile Money</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </div>

            {/* New Products & Services Section */}
            <div className="mb-16">
              <div className="flex items-center gap-3 mb-8">
                <div className="h-10 w-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">New Products & Services</h3>
                  <p className="text-sm text-gray-500">Innovative insurance solutions for modern needs</p>
                </div>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Link href="/gig-economy">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center mb-3">
                        <Bike className="h-6 w-6 text-orange-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-orange-600">Gig Economy Insurance</h4>
                      <p className="text-sm text-gray-500">On-demand coverage for delivery riders, freelancers & artisans</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/p2p-insurance">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center mb-3">
                        <Coins className="h-6 w-6 text-purple-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-purple-600">P2P Insurance</h4>
                      <p className="text-sm text-gray-500">Community pools with shared risk & lower premiums</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/parametric-insurance">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-cyan-100 flex items-center justify-center mb-3">
                        <Cloud className="h-6 w-6 text-cyan-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-cyan-600">Parametric Insurance</h4>
                      <p className="text-sm text-gray-500">Automatic payouts based on weather & flight data</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/bancassurance">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-3">
                        <Landmark className="h-6 w-6 text-blue-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-blue-600">Bancassurance</h4>
                      <p className="text-sm text-gray-500">Insurance through your bank with exclusive discounts</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/sme-business">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center mb-3">
                        <Building className="h-6 w-6 text-indigo-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-indigo-600">SME Business Insurance</h4>
                      <p className="text-sm text-gray-500">Professional liability, cyber & business interruption</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/savings-investment">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center mb-3">
                        <PiggyBank className="h-6 w-6 text-green-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-green-600">Savings & Investment</h4>
                      <p className="text-sm text-gray-500">Endowments, education plans & retirement annuities</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/health-wellness">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center mb-3">
                        <Heart className="h-6 w-6 text-red-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-red-600">Health & Wellness</h4>
                      <p className="text-sm text-gray-500">Fitness tracking, telemedicine & wellness rewards</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/loyalty-rewards">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-yellow-100 flex items-center justify-center mb-3">
                        <Trophy className="h-6 w-6 text-yellow-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-yellow-600">Loyalty & Rewards</h4>
                      <p className="text-sm text-gray-500">Earn points, partner discounts & referral bonuses</p>
                    </CardContent>
                  </Card>
                </Link>
              </div>
            </div>

            {/* Customer Tools Section */}
            <div className="mb-16">
              <div className="flex items-center gap-3 mb-8">
                <div className="h-10 w-10 rounded-lg bg-teal-100 flex items-center justify-center">
                  <Package className="h-5 w-5 text-teal-600" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">Customer Tools</h3>
                  <p className="text-sm text-gray-500">Manage your insurance with ease</p>
                </div>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Link href="/claims-evidence">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-3">
                        <Camera className="h-6 w-6 text-blue-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-blue-600">Claims Evidence</h4>
                      <p className="text-sm text-gray-500">Upload photos & videos with AI verification</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/claims-tracker">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center mb-3">
                        <Package className="h-6 w-6 text-green-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-green-600">Claims Tracker</h4>
                      <p className="text-sm text-gray-500">Delivery-style tracking for your claims</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/policy-renewal">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center mb-3">
                        <Bell className="h-6 w-6 text-orange-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-orange-600">Policy Renewal</h4>
                      <p className="text-sm text-gray-500">Smart reminders & one-click renewals</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/family-coverage">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center mb-3">
                        <Users className="h-6 w-6 text-purple-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-purple-600">Family Coverage</h4>
                      <p className="text-sm text-gray-500">Unified view of all family policies</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/financial-wellness">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mb-3">
                        <Wallet className="h-6 w-6 text-emerald-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-emerald-600">Financial Wellness</h4>
                      <p className="text-sm text-gray-500">Credit score, budgeting & savings goals</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/embedded-insurance">
                  <Card className="hover:shadow-lg transition-all cursor-pointer group h-full">
                    <CardContent className="p-5">
                      <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center mb-3">
                        <Zap className="h-6 w-6 text-indigo-600" />
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-indigo-600">Embedded Insurance</h4>
                      <p className="text-sm text-gray-500">B2B2C API for partner integrations</p>
                    </CardContent>
                  </Card>
                </Link>
              </div>
            </div>

                        {/* Need Help */}
                        <div className="mt-16 text-center">
              <Card className="inline-block max-w-2xl">
                <CardContent className="p-8">
                  <h3 className="text-2xl font-bold text-gray-900 mb-3">Need Help Choosing?</h3>
                  <p className="text-gray-600 mb-6">
                    Our insurance advisors are here to help you find the perfect coverage.
                  </p>
                  <div className="flex flex-wrap justify-center gap-4">
                    <Button variant="outline">
                      <Phone className="h-4 w-4 mr-2" />
                      +234 1 234 5678
                    </Button>
                    <Button variant="outline">
                      <MessageCircle className="h-4 w-4 mr-2" />
                      WhatsApp
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="bg-gradient-to-br from-blue-600 via-blue-700 to-slate-900 py-16">
          <div className="container mx-auto px-6">
            <h2 className="text-4xl font-bold text-center text-white mb-16">
              Everything You Need
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <Card className="bg-white/10 backdrop-blur-lg border-white/20">
                <CardContent className="pt-6 text-center">
                  <Shield className="h-16 w-16 text-blue-300 mx-auto mb-4" />
                  <h3 className="text-2xl font-bold text-white mb-2">Manage Policies</h3>
                  <p className="text-blue-100">View and manage all your insurance policies in one dashboard</p>
                </CardContent>
              </Card>

              <Card className="bg-white/10 backdrop-blur-lg border-white/20">
                <CardContent className="pt-6 text-center">
                  <FileText className="h-16 w-16 text-blue-300 mx-auto mb-4" />
                  <h3 className="text-2xl font-bold text-white mb-2">File Claims</h3>
                  <p className="text-blue-100">Submit and track claims easily with our streamlined process</p>
                </CardContent>
              </Card>

              <Card className="bg-white/10 backdrop-blur-lg border-white/20">
                <CardContent className="pt-6 text-center">
                  <CreditCard className="h-16 w-16 text-blue-300 mx-auto mb-4" />
                  <h3 className="text-2xl font-bold text-white mb-2">Quick Payments</h3>
                  <p className="text-blue-100">Pay premiums securely and manage payment methods</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Why Choose Us Section */}
        <section className="bg-gray-50 py-16">
          <div className="container mx-auto px-6">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <div>
                <h2 className="text-4xl font-bold text-gray-900 mb-6">Why Choose Us</h2>
                <div className="space-y-6">
                  <div className="flex gap-4">
                    <CheckCircle className="h-6 w-6 text-green-500 flex-shrink-0 mt-1" />
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900 mb-2">24/7 Support</h3>
                      <p className="text-gray-600">Get help whenever you need it from our dedicated support team</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <Clock className="h-6 w-6 text-green-500 flex-shrink-0 mt-1" />
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900 mb-2">Fast Claims Processing</h3>
                      <p className="text-gray-600">Most claims processed within 48 hours</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <Users className="h-6 w-6 text-green-500 flex-shrink-0 mt-1" />
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900 mb-2">Trusted by Thousands</h3>
                      <p className="text-gray-600">Join over 50,000 satisfied customers across Nigeria</p>
                    </div>
                  </div>
                </div>
              </div>
              <Card className="bg-gradient-to-br from-blue-600 to-blue-700 p-8 shadow-xl">
                <h3 className="text-2xl font-bold text-white mb-6">Ready to Get Started?</h3>
                <p className="text-blue-100 mb-6">
                  Create your account today and experience hassle-free insurance management.
                </p>
                <Link href="/dashboard">
                  <Button size="lg" variant="secondary" className="w-full">
                    Create Account
                  </Button>
                </Link>
              </Card>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-black/30 backdrop-blur-lg border-t border-white/10 mt-24">
        <div className="container mx-auto px-6 py-12">
          <div className="grid md:grid-cols-4 gap-8 text-white">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Shield className="h-6 w-6" />
                <span className="text-xl font-bold">InsurePortal</span>
              </div>
              <p className="text-blue-200 text-sm">
                Your trusted insurance management platform
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Personal Insurance</h4>
              <ul className="space-y-2 text-sm text-blue-200">
                <li>Health Insurance</li>
                <li>Auto Insurance</li>
                <li>Property Insurance</li>
                <li>Life Insurance</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Agricultural Insurance</h4>
              <ul className="space-y-2 text-sm text-blue-200">
                <li>Crop Insurance</li>
                <li>Livestock Insurance</li>
                <li>Weather Index Insurance</li>
                <li>Aquaculture Insurance</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-blue-200">
                <li>About Us</li>
                <li>Contact</li>
                <li>Careers</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-sm text-blue-200">
                <li>Help Center</li>
                <li>Terms of Service</li>
                <li>Privacy Policy</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 mt-8 pt-8 text-center text-sm text-blue-200">
            © 2026 InsurePortal. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
