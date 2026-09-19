import React, { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { toast } from 'sonner';
import { Loader2, Shield, FileText, Camera, Phone, Building2, CheckCircle2, XCircle, Clock, AlertTriangle, Fingerprint, Eye, Brain } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type VerificationStep = 'overview' | 'identity' | 'document' | 'liveness' | 'review';

// J-wave (2026-09): liveness session ids were bare ms — predictable.
function livenessSessionId(kind: string): string {
  const rb = new Uint8Array(6);
  globalThis.crypto.getRandomValues(rb);
  return `${kind}-${Date.now().toString(36).toUpperCase()}-${Array.from(rb, b => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
const KYCStatus: React.FC = () => {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const utils = trpc.useUtils();
  const [activeStep, setActiveStep] = useState<VerificationStep>('overview');
  const [documentType, setDocumentType] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [, setDocumentFile] = useState<File | null>(null);
  const [ninValue, setNinValue] = useState('');
  const [bvnValue, setBvnValue] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneValue, setPhoneValue] = useState('');
  const [otpValue, setOtpValue] = useState('');

  const { data: kycStatus, isLoading } = trpc.kyc.status.useQuery(undefined, { enabled: isAuthenticated });
  const { data: kycGate } = trpc.kyc.gate.useQuery(undefined, { enabled: isAuthenticated });
  const { data: serviceHealth } = trpc.kyc.serviceHealth.useQuery(undefined, { enabled: isAuthenticated });

  const submitMut = trpc.kyc.submit.useMutation({
    onSuccess: () => { toast.success('Verification submitted'); utils.kyc.status.invalidate(); utils.kyc.gate.invalidate(); },
    onError: (err: { message: string }) => toast.error(err.message),
  });
  const ninMut = trpc.kyc.verifyNIN.useMutation({
    onSuccess: () => { toast.success('NIN verification submitted'); utils.kyc.status.invalidate(); setNinValue(''); },
    onError: (err: { message: string }) => toast.error(err.message),
  });
  const bvnMut = trpc.kyc.verifyBVN.useMutation({
    onSuccess: () => { toast.success('BVN verification submitted'); utils.kyc.status.invalidate(); setBvnValue(''); },
    onError: (err: { message: string }) => toast.error(err.message),
  });
  const phoneMut = trpc.kyc.verifyPhone.useMutation({
    onSuccess: () => { toast.success('Phone verification submitted'); utils.kyc.status.invalidate(); },
    onError: (err: { message: string }) => toast.error(err.message),
  });
  const livenessMut = trpc.kyc.liveness.detect.useMutation({
    onSuccess: () => { toast.success('Liveness check submitted'); utils.kyc.status.invalidate(); },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  if (authLoading) return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="h-8 w-8 animate-spin" /><p className="ml-2">Loading...</p></div>;
  if (!isAuthenticated) return <Card className="w-full max-w-2xl mx-auto mt-8"><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>Please log in to access KYC verification.</CardDescription></CardHeader></Card>;

  const statusIcon = (ok: boolean) => ok ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <XCircle className="h-5 w-5 text-gray-300" />;
  const levelBadge = (level: string) => {
    const cls: Record<string, string> = { level3: 'bg-green-100 text-green-800', level2: 'bg-blue-100 text-blue-800', level1: 'bg-yellow-100 text-yellow-800', none: 'bg-gray-100 text-gray-800' };
    const lbl: Record<string, string> = { level3: 'Level 3', level2: 'Level 2', level1: 'Level 1', none: 'Not Verified' };
    return <span className={`px-3 py-1 rounded-full text-sm font-medium ${cls[level] || cls.none}`}>{lbl[level] || lbl.none}</span>;
  };
  const onDocSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!documentType) { toast.error('Select document type'); return; }
    submitMut.mutate({ verificationType: 'document', documentType, documentNumber: documentNumber || undefined });
    setDocumentType(''); setDocumentNumber(''); setDocumentFile(null);
  };

  const steps: { id: VerificationStep; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Shield className="h-5 w-5" /> },
    { id: 'identity', label: 'Identity', icon: <Fingerprint className="h-5 w-5" /> },
    { id: 'document', label: 'Documents', icon: <FileText className="h-5 w-5" /> },
    { id: 'liveness', label: 'Biometric', icon: <Camera className="h-5 w-5" /> },
    { id: 'review', label: 'Review', icon: <Eye className="h-5 w-5" /> },
  ];

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">KYC Verification</h1><p className="text-muted-foreground">Powered by DeepFace, PaddleOCR, VLM &amp; Docling</p></div>
        {kycGate && levelBadge(kycGate.level)}
      </div>

      <div className="flex space-x-1 bg-muted p-1 rounded-lg">
        {steps.map((s) => (
          <button key={s.id} onClick={() => setActiveStep(s.id)} className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center ${activeStep === s.id ? 'bg-background shadow-sm' : 'hover:bg-background/50'}`}>
            {s.icon}<span className="hidden sm:inline">{s.label}</span>
          </button>
        ))}
      </div>

      {activeStep === 'overview' && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Shield className="h-5 w-5 text-blue-600" />Verification Status</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (<>
                <div className="flex items-center justify-between"><span className="text-sm">NIN</span>{statusIcon(kycStatus?.ninVerified ?? false)}</div>
                <div className="flex items-center justify-between"><span className="text-sm">BVN</span>{statusIcon(kycStatus?.bvnVerified ?? false)}</div>
                <div className="flex items-center justify-between"><span className="text-sm">Phone</span>{statusIcon(kycStatus?.phoneVerified ?? false)}</div>
                <div className="flex items-center justify-between"><span className="text-sm">Document</span>{statusIcon(kycStatus?.documentVerified ?? false)}</div>
                <div className="flex items-center justify-between"><span className="text-sm">Biometric</span>{statusIcon(kycStatus?.biometricVerified ?? false)}</div>
                <div className="flex items-center justify-between"><span className="text-sm">Liveness</span>{statusIcon(kycStatus?.livenessVerified ?? false)}</div>
                <div className="flex items-center justify-between"><span className="text-sm">AML</span>{statusIcon(kycStatus?.amlCleared ?? false)}</div>
              </>)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Brain className="h-5 w-5 text-purple-600" />AI Engines</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {serviceHealth && Object.entries(serviceHealth).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <div><p className="text-sm font-medium">{(v as { service: string }).service}</p><p className="text-xs text-muted-foreground">Port {(v as { port: number }).port}</p></div>
                  <Badge variant={(v as { status: string }).status === 'healthy' ? 'default' : 'destructive'} className="text-xs">{(v as { status: string }).status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" />KYC Gate</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {kycGate && (<>
                <div className="flex items-center justify-between"><span className="text-sm">Access</span><Badge variant={kycGate.allowed ? 'default' : 'destructive'}>{kycGate.allowed ? 'Allowed' : 'Restricted'}</Badge></div>
                <div className="flex items-center justify-between"><span className="text-sm">Level</span>{levelBadge(kycGate.level)}</div>
                {kycGate.reason && <p className="text-sm text-amber-600 bg-amber-50 p-2 rounded">{kycGate.reason}</p>}
              </>)}
            </CardContent>
          </Card>
          <Card className="md:col-span-2 lg:col-span-3">
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Clock className="h-5 w-5 text-gray-600" />History</CardTitle></CardHeader>
            <CardContent>
              {kycStatus?.events && kycStatus.events.length > 0 ? (
                <div className="space-y-2">{kycStatus.events.slice(0, 10).map((e: { id: string; type: string; status: string; timestamp: Date }) => (
                  <div key={e.id} className="flex items-center justify-between p-2 border rounded">
                    <div className="flex items-center gap-2"><Badge variant="outline" className="text-xs">{e.type}</Badge><span className="text-sm">{e.status}</span></div>
                    <span className="text-xs text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</span>
                  </div>
                ))}</div>
              ) : <p className="text-sm text-muted-foreground">No events yet.</p>}
            </CardContent>
          </Card>
        </div>
      )}

      {activeStep === 'identity' && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Fingerprint className="h-5 w-5 text-blue-600" />NIN Verification</CardTitle><CardDescription>Via NIMC registry</CardDescription></CardHeader>
            <CardContent>
              <form onSubmit={(e) => { e.preventDefault(); ninMut.mutate({ nin: ninValue, firstName, lastName }); }} className="space-y-3">
                <div><Label htmlFor="nin">NIN (11 digits)</Label><Input id="nin" value={ninValue} onChange={e => setNinValue(e.target.value)} placeholder="12345678901" maxLength={11} /></div>
                <div className="grid grid-cols-2 gap-2"><div><Label>First Name</Label><Input value={firstName} onChange={e => setFirstName(e.target.value)} /></div><div><Label>Last Name</Label><Input value={lastName} onChange={e => setLastName(e.target.value)} /></div></div>
                <Button type="submit" disabled={ninMut.isLoading || ninValue.length !== 11} className="w-full">{ninMut.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verify NIN</Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-5 w-5 text-green-600" />BVN Verification</CardTitle><CardDescription>Via NIBSS</CardDescription></CardHeader>
            <CardContent>
              <form onSubmit={(e) => { e.preventDefault(); bvnMut.mutate({ bvn: bvnValue, firstName, lastName }); }} className="space-y-3">
                <div><Label htmlFor="bvn">BVN (11 digits)</Label><Input id="bvn" value={bvnValue} onChange={e => setBvnValue(e.target.value)} placeholder="22345678901" maxLength={11} /></div>
                <Button type="submit" disabled={bvnMut.isLoading || bvnValue.length !== 11} className="w-full">{bvnMut.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verify BVN</Button>
              </form>
            </CardContent>
          </Card>
          <Card className="md:col-span-2">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Phone className="h-5 w-5 text-amber-600" />Phone Verification</CardTitle><CardDescription>OTP-based</CardDescription></CardHeader>
            <CardContent>
              <form onSubmit={(e) => { e.preventDefault(); phoneMut.mutate({ phone: phoneValue, otp: otpValue }); }} className="space-y-3">
                <div className="grid grid-cols-2 gap-3"><div><Label>Phone</Label><Input value={phoneValue} onChange={e => setPhoneValue(e.target.value)} placeholder="+234..." /></div><div><Label>OTP</Label><Input value={otpValue} onChange={e => setOtpValue(e.target.value)} placeholder="123456" maxLength={6} /></div></div>
                <Button type="submit" disabled={phoneMut.isLoading || !phoneValue || otpValue.length !== 6} className="w-full">{phoneMut.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verify Phone</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {activeStep === 'document' && (
        <div className="grid gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="h-5 w-5 text-indigo-600" />Document Verification</CardTitle><CardDescription>PaddleOCR + VLM + Docling pipeline</CardDescription></CardHeader>
            <CardContent>
              <form onSubmit={onDocSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Document Type</Label><Select value={documentType} onValueChange={setDocumentType}><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger><SelectContent><SelectItem value="national_id">National ID</SelectItem><SelectItem value="international_passport">Passport</SelectItem><SelectItem value="drivers_license">{"Driver's License"}</SelectItem><SelectItem value="voters_card">{"Voter's Card"}</SelectItem><SelectItem value="utility_bill">Utility Bill</SelectItem><SelectItem value="bank_statement">Bank Statement</SelectItem><SelectItem value="cac_certificate">CAC Certificate</SelectItem></SelectContent></Select></div>
                  <div><Label>Document Number</Label><Input value={documentNumber} onChange={e => setDocumentNumber(e.target.value)} placeholder="e.g. A12345678" /></div>
                </div>
                <div><Label>Upload</Label><Input type="file" accept="image/*,.pdf" onChange={e => setDocumentFile(e.target.files?.[0] ?? null)} /></div>
                <div className="bg-blue-50 p-3 rounded-lg text-sm space-y-1"><p className="font-medium text-blue-800">AI Pipeline</p><p className="text-blue-700">1. PaddleOCR text extraction</p><p className="text-blue-700">2. VLM classification</p><p className="text-blue-700">3. Docling layout parsing</p><p className="text-blue-700">4. Tampering detection</p></div>
                <Button type="submit" disabled={submitMut.isLoading || !documentType} className="w-full">{submitMut.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Submit Document</Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Submitted Documents</CardTitle></CardHeader>
            <CardContent>
              {kycStatus?.documents && kycStatus.documents.length > 0 ? (
                <div className="space-y-2">{kycStatus.documents.map((d: { id: string; type: string; number: string; status: string; submittedAt: Date }) => (
                  <div key={d.id} className="flex items-center justify-between p-3 border rounded"><div><p className="font-medium text-sm">{d.type}</p>{d.number && <p className="text-xs text-muted-foreground">{d.number}</p>}</div><Badge variant={d.status === 'Approved' ? 'default' : d.status === 'Rejected' ? 'destructive' : 'secondary'}>{d.status}</Badge></div>
                ))}</div>
              ) : <p className="text-sm text-muted-foreground">No documents submitted yet.</p>}
            </CardContent>
          </Card>
        </div>
      )}

      {activeStep === 'liveness' && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Camera className="h-5 w-5 text-rose-600" />Passive Liveness</CardTitle><CardDescription>DeepFace anti-spoofing</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-rose-50 p-3 rounded-lg text-sm"><p className="font-medium text-rose-800">Multi-Signal: Texture, Frequency, Edge, Color</p></div>
              <Button onClick={() => livenessMut.mutate({ sessionId: livenessSessionId("sess") })} disabled={livenessMut.isLoading} className="w-full">{livenessMut.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}Start Passive Liveness</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Eye className="h-5 w-5 text-violet-600" />Active Challenges</CardTitle><CardDescription>Blink, head turn, smile</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-violet-50 p-3 rounded-lg text-sm"><p className="font-medium text-violet-800">Interactive verification challenges</p></div>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" onClick={() => livenessMut.mutate({ sessionId: livenessSessionId("blink") })}>Blink</Button>
                <Button variant="outline" size="sm" onClick={() => livenessMut.mutate({ sessionId: livenessSessionId("head") })}>Head Turn</Button>
                <Button variant="outline" size="sm" onClick={() => livenessMut.mutate({ sessionId: livenessSessionId("smile") })}>Smile</Button>
              </div>
            </CardContent>
          </Card>
          <Card className="md:col-span-2">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Fingerprint className="h-5 w-5 text-teal-600" />Face Verification</CardTitle><CardDescription>Rust identity matching engine</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-teal-50 p-3 rounded-lg text-sm space-y-1"><p className="font-medium text-teal-800">Matching Pipeline</p><p className="text-teal-700">DeepFace embeddings + Rust cosine similarity + fraud signals</p></div>
              <Button onClick={() => submitMut.mutate({ verificationType: 'biometric' })} disabled={submitMut.isLoading} className="w-full">{submitMut.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Fingerprint className="mr-2 h-4 w-4" />}Start Face Verification</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {activeStep === 'review' && (
        <div className="grid gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-4 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg text-center"><p className="text-2xl font-bold text-blue-800">{kycGate?.level === 'level3' ? '3' : kycGate?.level === 'level2' ? '2' : kycGate?.level === 'level1' ? '1' : '0'}</p><p className="text-sm text-blue-600">KYC Level</p></div>
                <div className="p-4 bg-green-50 rounded-lg text-center"><p className="text-2xl font-bold text-green-800">{kycStatus?.documents?.length ?? 0}</p><p className="text-sm text-green-600">Documents</p></div>
                <div className="p-4 bg-purple-50 rounded-lg text-center"><p className="text-2xl font-bold text-purple-800">{kycStatus?.events?.length ?? 0}</p><p className="text-sm text-purple-600">Verifications</p></div>
                <div className="p-4 bg-amber-50 rounded-lg text-center"><p className="text-2xl font-bold text-amber-800">{kycGate?.allowed ? 'Yes' : 'No'}</p><p className="text-sm text-amber-600">Gate Access</p></div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Technology Stack</CardTitle></CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-4 gap-4">
                <div className="p-4 border rounded-lg"><p className="font-medium text-sm">DeepFace</p><p className="text-xs text-muted-foreground mt-1">Liveness, face verification, anti-spoofing</p><Badge variant="outline" className="mt-2 text-xs">Port 8110</Badge></div>
                <div className="p-4 border rounded-lg"><p className="font-medium text-sm">Document OCR</p><p className="text-xs text-muted-foreground mt-1">PaddleOCR + VLM + Docling</p><Badge variant="outline" className="mt-2 text-xs">Port 8111</Badge></div>
                <div className="p-4 border rounded-lg"><p className="font-medium text-sm">Orchestrator</p><p className="text-xs text-muted-foreground mt-1">Go NIN/BVN/CAC, AML, risk scoring</p><Badge variant="outline" className="mt-2 text-xs">Port 8085</Badge></div>
                <div className="p-4 border rounded-lg"><p className="font-medium text-sm">Identity Matcher</p><p className="text-xs text-muted-foreground mt-1">Rust embedding comparison, fraud</p><Badge variant="outline" className="mt-2 text-xs">Port 8112</Badge></div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default KYCStatus;
