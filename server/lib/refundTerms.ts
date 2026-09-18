/**
 * refundTerms.ts — AB-19: server-derived refund terms.
 *
 * When the disputed transaction is on record, the client-supplied amount and
 * destination are NOT trusted: the refund may not exceed the original amount
 * (fail-closed rejection) and must return to the transaction's source
 * account when known. Pure function — unit-testable without a database.
 */
import { TRPCError } from "@trpc/server";

export interface OriginalTransaction {
  id: number;
  amount: string | number;
  customerAccount: string | null;
  destinationAccount: string | null;
}

export interface RefundTerms {
  effectiveAmount: number;
  effectiveDestination: string;
  originalTxId: number | null;
}

export function deriveRefundTerms(
  origTx: OriginalTransaction | null,
  input: { amount: number; accountNumber: string }
): RefundTerms {
  if (!origTx) {
    return {
      effectiveAmount: input.amount,
      effectiveDestination: input.accountNumber,
      originalTxId: null,
    };
  }
  const origAmount = Number(origTx.amount);
  if (input.amount > origAmount) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Refund amount (₦${input.amount}) exceeds the original transaction amount (₦${origAmount})`,
    });
  }
  const sourceAccount = origTx.customerAccount || origTx.destinationAccount;
  return {
    effectiveAmount: input.amount,
    effectiveDestination: sourceAccount || input.accountNumber,
    originalTxId: origTx.id,
  };
}
