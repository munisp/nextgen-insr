import { createTRPCReact } from "@trpc/react-query";
// 2026-11-27 (W26): type-only swap AnyRouter -> AppRouter, matching the main
// repo's client/src/lib/trpc.ts idiom (path adjusted for the insureportal
// layout: client/src/lib -> insureportal/server). With AnyRouter every trpc
// property access resolved to tRPC's collision-union error string, masking
// 444 errors (w24c-tsc-scoping.md section 4). This change emits zero code.
import type { AppRouter } from "../../../server/routers";

export const trpc = createTRPCReact<AppRouter>();
