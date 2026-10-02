/**
 * MemberQuotes.tsx — /member/quotes
 *
 * Wired to the REAL member-scoped quote cart router (server/routers/memberQuotes.ts):
 *   - memberQuotes.myQuoteCart      (pending cart, newest first)
 *   - memberQuotes.quoteSummary     (real COUNT/SUM over pending quotes)
 *   - memberQuotes.addToQuoteCart   (mutation; priced by the fail-closed
 *     rating engine — PRECONDITION_FAILED is surfaced honestly)
 *   - memberQuotes.removeQuoteItem  (cancel one pending quote)
 *   - memberQuotes.clearQuoteCart   (cancel all pending quotes)
 * Product picker options come from the real catalog:
 *   - insuranceProductCatalog.listProducts
 *
 * No fabricated rows: loading skeletons, honest empty cart, error card.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { ShoppingCart, Trash2 } from "lucide-react";

const fmtNgn = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    n
  );

export default function MemberQuotes() {
  const utils = trpc.useUtils();
  const [productId, setProductId] = useState<string>("");
  const [sumInsured, setSumInsured] = useState<string>("");
  const [durationMonths, setDurationMonths] = useState<string>("12");
  const [formError, setFormError] = useState<string | null>(null);

  const cartQuery = trpc.memberQuotes.myQuoteCart.useQuery(undefined, {
    retry: false,
  });
  const summaryQuery = trpc.memberQuotes.quoteSummary.useQuery(undefined, {
    retry: false,
  });
  const productsQuery = trpc.insuranceProductCatalog.listProducts.useQuery(
    { limit: 100 },
    { retry: false }
  );

  const invalidate = () => {
    utils.memberQuotes.myQuoteCart.invalidate();
    utils.memberQuotes.quoteSummary.invalidate();
  };

  const addMutation = trpc.memberQuotes.addToQuoteCart.useMutation({
    onSuccess: (data) => {
      setFormError(null);
      setSumInsured("");
      toast.success(
        `Quote added — premium ${fmtNgn(data.premiumAmount)} (${data.currency})`
      );
      invalidate();
    },
    onError: (err) => {
      // Fail-closed rating engine: when no filed rating table covers the
      // product the server throws PRECONDITION_FAILED and adds NO quote.
      // Surface that honestly instead of pretending the add succeeded.
      const code = (err as { data?: { code?: string } }).data?.code;
      const message =
        code === "PRECONDITION_FAILED"
          ? `Pricing unavailable: ${err.message}. No quote was added.`
          : err.message;
      setFormError(message);
      toast.error(message);
    },
  });

  const removeMutation = trpc.memberQuotes.removeQuoteItem.useMutation({
    onSuccess: () => {
      toast.success("Quote removed");
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const clearMutation = trpc.memberQuotes.clearQuoteCart.useMutation({
    onSuccess: (data) => {
      toast.success(`Cart cleared (${data.cancelled} quote(s) cancelled)`);
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const pid = Number(productId);
    const sum = Number(sumInsured);
    const dur = Number(durationMonths);
    if (!Number.isInteger(pid) || pid <= 0) {
      setFormError("Select a product.");
      return;
    }
    if (!Number.isFinite(sum) || sum <= 0) {
      setFormError("Enter a valid sum insured.");
      return;
    }
    addMutation.mutate({ productId: pid, sumInsured: sum, durationMonths: dur });
  };

  const cart = cartQuery.data;
  const items = cart?.items ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Quote Cart"
          description="Your pending quotes. Premiums are priced from filed rating tables; if pricing is unavailable no quote is created."
        >
          {cartQuery.isLoading ? (
            <MemberLoading label="Loading your quote cart" />
          ) : cartQuery.isError ? (
            <MemberError message={cartQuery.error.message} />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Your quote cart is empty. Use the form below to request a quote.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Sum Insured</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Total Payable</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((q) => (
                    <TableRow key={q.id}>
                      <TableCell>{q.productName}</TableCell>
                      <TableCell>{fmtNgn(Number(q.sumInsured ?? 0))}</TableCell>
                      <TableCell>
                        {fmtNgn(Number(q.premiumAmount ?? 0))}
                      </TableCell>
                      <TableCell>
                        {fmtNgn(Number(q.totalPayable ?? 0))}
                      </TableCell>
                      <TableCell>{q.durationMonths} mo</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{q.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove quote ${q.id}`}
                          disabled={removeMutation.isPending}
                          onClick={() =>
                            removeMutation.mutate({ quoteId: q.id })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">
                  {summaryQuery.isError
                    ? "Summary unavailable."
                    : `${summaryQuery.data?.count ?? items.length} item(s) — total premium ${fmtNgn(
                        summaryQuery.data?.totalPremium ??
                          cart?.totalPremium ??
                          0
                      )} ${cart?.currency ?? "NGN"}`}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={clearMutation.isPending}
                  onClick={() => clearMutation.mutate()}
                >
                  Clear cart
                </Button>
              </div>
            </>
          )}
        </MemberSection>

        <MemberSection
          title="Request a Quote"
          description="Pick a product and sum insured. The premium is computed by the rating engine."
        >
          {productsQuery.isLoading ? (
            <MemberLoading label="Loading products" />
          ) : productsQuery.isError ? (
            <MemberError message={productsQuery.error.message} />
          ) : (productsQuery.data?.data.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No insurance products are currently available.
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="product">Product</Label>
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger id="product">
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {productsQuery.data?.data.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sumInsured">Sum insured (NGN)</Label>
                  <Input
                    id="sumInsured"
                    type="number"
                    min="1"
                    step="any"
                    value={sumInsured}
                    onChange={(e) => setSumInsured(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="duration">Duration (months)</Label>
                  <Input
                    id="duration"
                    type="number"
                    min="1"
                    max="120"
                    value={durationMonths}
                    onChange={(e) => setDurationMonths(e.target.value)}
                    required
                  />
                </div>
              </div>
              {formError ? (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              ) : null}
              <Button type="submit" disabled={addMutation.isPending}>
                <ShoppingCart className="h-4 w-4 mr-2" />
                {addMutation.isPending ? "Adding…" : "Add to quote cart"}
              </Button>
            </form>
          )}
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
