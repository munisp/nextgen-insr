/**
 * _core/trpc.ts — Re-export of the shared tRPC React client.
 *
 * This file exists so that pages using `import { trpc } from "@/_core/trpc"`
 * resolve correctly.  The canonical client lives in @/lib/trpc.
 */
export { trpc } from "@/lib/trpc";
