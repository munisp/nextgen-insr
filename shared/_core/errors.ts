/** Shared error factories (used by server/_core/sdk.ts). */

/** Creates an Error marking a 403-style authorization failure. */
export function ForbiddenError(message: string): Error {
  const err = new Error(message);
  err.name = "ForbiddenError";
  return err;
}
