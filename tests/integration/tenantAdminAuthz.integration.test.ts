/**
 * tenantAdminAuthz.integration.test.ts — platform-admin authorization gates
 * (F-05 residual fixes, THREAT_MODEL.md §7.1/§7.3).
 *
 * Part 1 — multiTenantIsolationRouter (tenant CRUD):
 *   Every procedure is platform-admin surface and is now mounted on
 *   adminProcedure (JWT role=admin + Permify admin_access). Previously any
 *   authenticated user could enumerate/create/suspend tenants.
 *
 * Part 2 — platform-provisioning invariant:
 *   users.tenantId IS NULL = platform scope (deliberately unscoped, see
 *   THREAT_MODEL.md). The user-management surface (tenantAdmin.updateUser)
 *   must never let a caller move a user across the tenant boundary or into
 *   platform scope, and a tenant-scoped admin must not touch platform-scope
 *   or cross-tenant users. inviteUser remains NOT_IMPLEMENTED: there is no
 *   tRPC path that provisions users at all, so no path can create a
 *   platform-scope (tenantId NULL) user.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { getDb } from "../../server/db";
import { users, tenants } from "../../drizzle/schema";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
  type TestUser,
} from "./helpers/trpc";

const FILE = "tenantAdminAuthz";

const TENANT_A = 930001;
const TENANT_B = 930002;

/** Tenant-scoped platform-role admin: role=admin but pinned to TENANT_A. */
const tenantAdminA: TestUser = {
  id: 930011,
  email: "admin-a@tenant-a.integration",
  name: "Tenant A Admin",
  role: "admin",
  tenantId: TENANT_A,
};

const tenantScopedUser: TestUser = {
  id: 930012,
  email: "user-a@tenant-a.integration",
  name: "Tenant A User",
  role: "user",
  tenantId: TENANT_A,
};

// Seeded target rows in users (filled in beforeAll).
let platformTargetId = 0;
let tenantAUserId = 0;
let tenantBUserId = 0;

async function seedUser(
  keycloakSub: string,
  tenantId: number | null
): Promise<number> {
  const db = (await getDb())!;
  const [u] = await db
    .insert(users)
    .values({
      keycloakSub,
      email: `${keycloakSub}@integration.local`,
      name: keycloakSub,
      role: "user",
      tenantId,
    })
    .returning();
  return u!.id;
}

describe("multiTenantIsolation router is platform-admin gated (integration)", () => {
  beforeAll(() => resetAssertionCount());
  afterAll(() =>
    console.log(`[integration] ${FILE}/part1: ${getAssertionCount()} assertions`)
  );

  it("non-admin authenticated user is FORBIDDEN on all tenant CRUD procedures", async () => {
    const caller = callerFor(regularUser);
    await expectTrpcError(caller.multiTenantIsolation.listTenants(), "FORBIDDEN");
    await expectTrpcError(caller.multiTenantIsolation.getTenant({ id: 1 }), "FORBIDDEN");
    await expectTrpcError(
      caller.multiTenantIsolation.createTenant({ name: "evil-tenant" }),
      "FORBIDDEN"
    );
    await expectTrpcError(
      caller.multiTenantIsolation.suspendTenant({ id: 1, reason: "abuse" }),
      "FORBIDDEN"
    );
    await expectTrpcError(caller.multiTenantIsolation.getStats(), "FORBIDDEN");
  });

  it("tenant-scoped non-admin user is likewise FORBIDDEN", async () => {
    const caller = callerFor(tenantScopedUser);
    await expectTrpcError(
      caller.multiTenantIsolation.createTenant({ name: "evil-tenant-2" }),
      "FORBIDDEN"
    );
    await expectTrpcError(
      caller.multiTenantIsolation.suspendTenant({ id: 1, reason: "abuse" }),
      "FORBIDDEN"
    );
  });

  it("anonymous caller is UNAUTHORIZED", async () => {
    const caller = callerFor(null);
    await expectTrpcError(caller.multiTenantIsolation.listTenants(), "UNAUTHORIZED");
  });

  it("platform admin can create, read, suspend and stat tenants (positive control)", async () => {
    const caller = callerFor(adminUser);
    const created = await caller.multiTenantIsolation.createTenant({
      name: "authz-test-tenant",
      domain: "authz-test.integration.local",
    });
    expect(created.id).toBeGreaterThan(0);

    const fetched = await caller.multiTenantIsolation.getTenant({ id: created.id });
    expect(fetched?.id).toBe(created.id);

    const suspended = await caller.multiTenantIsolation.suspendTenant({
      id: created.id,
      reason: "authz positive control",
    });
    expect(suspended.success).toBe(true);

    const list = await caller.multiTenantIsolation.listTenants();
    expect(list.tenants.some(t => t.id === created.id)).toBe(true);

    const stats = await caller.multiTenantIsolation.getStats();
    expect(stats.totalTenants).toBeGreaterThan(0);

    // cleanup fixture
    const db = (await getDb())!;
    await db.delete(tenants).where(eq(tenants.id, created.id));
  });
});

describe("platform-provisioning invariant (integration, real DB)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    platformTargetId = await seedUser("inv-platform-target", null);
    tenantAUserId = await seedUser("inv-tenant-a-user", TENANT_A);
    tenantBUserId = await seedUser("inv-tenant-b-user", TENANT_B);
  });

  afterAll(async () => {
    const db = (await getDb())!;
    await db.delete(users).where(like(users.keycloakSub, "inv-%"));
    console.log(`[integration] ${FILE}/part2: ${getAssertionCount()} assertions`);
  });

  it("non-admin cannot touch user management at all", async () => {
    const caller = callerFor(tenantScopedUser);
    await expectTrpcError(
      caller.tenantAdmin.updateUser({ userId: String(tenantAUserId), name: "x" }),
      "FORBIDDEN"
    );
  });

  it("tenant-scoped admin CANNOT edit a platform-scope (tenantId NULL) user", async () => {
    const caller = callerFor(tenantAdminA);
    await expectTrpcError(
      caller.tenantAdmin.updateUser({
        userId: String(platformTargetId),
        name: "pwned",
      }),
      "FORBIDDEN"
    );
    // Row must be untouched.
    const db = (await getDb())!;
    const [row] = await db.select().from(users).where(eq(users.id, platformTargetId));
    expect(row!.name).toBe("inv-platform-target");
  });

  it("tenant-scoped admin CANNOT edit a user in another tenant", async () => {
    const caller = callerFor(tenantAdminA);
    await expectTrpcError(
      caller.tenantAdmin.updateUser({
        userId: String(tenantBUserId),
        name: "pwned",
      }),
      "FORBIDDEN"
    );
  });

  it("tenant-scoped admin CAN edit a same-tenant user (positive control)", async () => {
    const caller = callerFor(tenantAdminA);
    const res = await caller.tenantAdmin.updateUser({
      userId: String(tenantAUserId),
      name: "Tenant A User Renamed",
    });
    expect(res.success).toBe(true);
    const db = (await getDb())!;
    const [row] = await db.select().from(users).where(eq(users.id, tenantAUserId));
    expect(row!.name).toBe("Tenant A User Renamed");
    // tenantId unchanged — still pinned to TENANT_A.
    expect(row!.tenantId).toBe(TENANT_A);
  });

  it("no caller can pass tenantId through updateUser — strict schema rejects it and the row keeps platform scope", async () => {
    const caller = callerFor(adminUser); // even a platform admin
    await expectTrpcError(
      caller.tenantAdmin.updateUser({
        userId: String(platformTargetId),
        name: "still-platform",
        // @ts-expect-error — deliberately smuggling a tenantId key
        tenantId: TENANT_A,
      }),
      "BAD_REQUEST"
    );
    const db = (await getDb())!;
    const [row] = await db.select().from(users).where(eq(users.id, platformTargetId));
    expect(row!.tenantId).toBeNull();
  });

  it("there is no tRPC user-provisioning path: inviteUser fails loudly for everyone", async () => {
    await expectTrpcError(
      callerFor(adminUser).tenantAdmin.inviteUser(),
      "NOT_IMPLEMENTED"
    );
    await expectTrpcError(
      callerFor(tenantAdminA).tenantAdmin.inviteUser(),
      "NOT_IMPLEMENTED"
    );
  });

  it("platform admin retains full scope (positive control)", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.tenantAdmin.updateUser({
      userId: String(platformTargetId),
      role: "supervisor",
    });
    expect(res.success).toBe(true);
    const db = (await getDb())!;
    const [row] = await db.select().from(users).where(eq(users.id, platformTargetId));
    expect(row!.role).toBe("supervisor");
    expect(row!.tenantId).toBeNull(); // role change must not alter scope
  });
});
