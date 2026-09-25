/**
 * PhotoReimbursement.tsx — Q-wave Q6 (2026-09-25)
 * One-tap photo reimbursement: snap/upload a receipt, get reimbursed.
 * Bound to the REAL Q4 backend: existing P-wave presigned upload
 * (documentManagement.requestUploadUrl + direct PUT to object storage),
 * then careRetention.photoReimbursementSubmit / photoReimbursementList.
 * The server's OCR disclosure (manual-entry fallback) is surfaced verbatim —
 * no OCR result is ever implied client-side.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Camera, ReceiptText } from "lucide-react";
import { careRetentionApi, uploadApi } from "@/services/innovationApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/innovation/states";

const ACCEPTED = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
type AcceptedMime = (typeof ACCEPTED)[number];
const MAX_BYTES = 10 * 1024 * 1024; // mirrors the server-side 10MB cap

export default function PhotoReimbursement() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [step, setStep] = useState<string>("");

  const list = useQuery({
    queryKey: ["innovation", "reimbursement", "list"],
    queryFn: () => careRetentionApi.photoReimbursementList({ limit: 20 }),
    retry: 1,
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Attach a receipt photo or PDF first.");
      const mimeType = file.type as AcceptedMime;
      // Step 1: authorize + presign (server issues a user-scoped key).
      setStep("Requesting secure upload…");
      const signed = await uploadApi.requestUploadUrl({
        fileName: file.name,
        mimeType,
        fileSize: file.size,
      });
      // Step 2: PUT bytes directly to object storage.
      setStep("Uploading receipt…");
      await uploadApi.uploadBytes(signed.uploadUrl, file, mimeType);
      // Step 3: submit the reimbursement with the issued storage key.
      setStep("Submitting for review…");
      return careRetentionApi.photoReimbursementSubmit({
        documentRefs: [signed.fileKey],
        amount: Number(amount),
        currency: "NGN",
        description: description || undefined,
      });
    },
    onSuccess: result => {
      setStep("");
      if (!result) return;
      toast.success("Reimbursement submitted for review.");
      if (result.ocrDisclosure) {
        // Disclosed manual-entry fallback — shown verbatim, not an OCR result.
        toast.info(result.ocrDisclosure, { duration: 8000 });
      }
      setFile(null);
      setAmount("");
      setDescription("");
      if (fileInput.current) fileInput.current.value = "";
      queryClient.invalidateQueries({
        queryKey: ["innovation", "reimbursement"],
      });
    },
    onError: error => {
      setStep("");
      toast.error(error instanceof Error ? error.message : "Submission failed");
    },
  });

  const onPick = (picked: File | null) => {
    if (!picked) {
      setFile(null);
      return;
    }
    if (!ACCEPTED.includes(picked.type as AcceptedMime)) {
      toast.warning("Use a JPEG, PNG, WebP image or a PDF.");
      return;
    }
    if (picked.size > MAX_BYTES) {
      toast.warning("File exceeds the 10MB limit.");
      return;
    }
    setFile(picked);
  };

  const amountNumber = Number(amount);
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          Photo Reimbursement
        </h1>
        <p className="text-sm text-stone-500">
          Snap a receipt, enter the amount, and submit — staff review and pay
          out approved requests.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Camera className="h-5 w-5 text-amber-600" aria-hidden />
            New reimbursement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={e => {
              e.preventDefault();
              if (!file) {
                toast.warning("Attach a receipt first.");
                return;
              }
              if (!amountValid) {
                toast.warning("Enter a valid amount.");
                return;
              }
              submit.mutate();
            }}
          >
            <div>
              <label
                htmlFor="receipt"
                className="mb-1 block text-xs font-medium text-stone-600"
              >
                Receipt photo or PDF (max 10MB)
              </label>
              <Input
                id="receipt"
                ref={fileInput}
                type="file"
                accept={ACCEPTED.join(",")}
                capture="environment"
                onChange={e => onPick(e.target.files?.[0] ?? null)}
              />
              {file && (
                <p className="mt-1 text-xs text-stone-500">
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="amount"
                className="mb-1 block text-xs font-medium text-stone-600"
              >
                Amount (NGN)
              </label>
              <Input
                id="amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="description"
                className="mb-1 block text-xs font-medium text-stone-600"
              >
                What is this for? (optional)
              </label>
              <Textarea
                id="description"
                rows={2}
                maxLength={2000}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={submit.isPending}
              className="w-full sm:w-auto"
            >
              {submit.isPending ? step || "Submitting…" : "Submit for review"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <ReceiptText className="h-5 w-5 text-amber-600" aria-hidden />
            Your requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <LoadingState label="Loading your requests…" />
          ) : list.isError ? (
            <ErrorState
              message="We couldn’t load your reimbursement requests. Please try again."
              onRetry={() => list.refetch()}
            />
          ) : (list.data?.reimbursements ?? []).length === 0 ? (
            <EmptyState
              title="No reimbursement requests yet"
              hint="Submitted requests appear here with their review status."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {list.data!.reimbursements.map(r => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {r.currency} {r.amount}
                    </p>
                    <p className="text-xs text-stone-500">
                      {new Date(r.createdAt).toLocaleString()}
                      {r.claimId ? ` · linked to claim #${r.claimId}` : ""}
                      {r.ocrStatus === "manual_entry"
                        ? " · manual review (no automated receipt reading on this deployment)"
                        : ""}
                    </p>
                  </div>
                  <Badge className="bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-500/20">
                    {r.status.replace(/_/g, " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
