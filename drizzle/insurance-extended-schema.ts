/**
 * InsurePortal Extended Schema — Promotions & Loyalty
 *
 * Tables backing server/routers/promotions.ts (coupon management and the
 * loyalty points program).
 */
import {
  boolean,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Promotions / Coupons ────────────────────────────────────────────────────
export const promotions = pgTable(
  "promotions",
  {
    id: serial("id").primaryKey(),
    storeId: integer("storeId"),
    name: text("name").notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    type: varchar("type", { length: 32 }).notNull(), // percentage | fixed_amount | bogo | free_shipping | bundle | flash_sale | loyalty_points
    value: numeric("value", { precision: 12, scale: 2 }).notNull(),
    minOrderAmount: numeric("minOrderAmount", { precision: 12, scale: 2 }),
    maxDiscount: numeric("maxDiscount", { precision: 12, scale: 2 }),
    usageLimit: integer("usageLimit"),
    perCustomerLimit: integer("perCustomerLimit").default(1).notNull(),
    usedCount: integer("usedCount").default(0).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    applicableProducts: integer("applicableProducts").array().default([]),
    applicableCategories: integer("applicableCategories").array().default([]),
    startDate: timestamp("startDate").notNull(),
    endDate: timestamp("endDate").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    codeIdx: uniqueIndex("promotions_code_idx").on(t.code),
  })
);

export type Promotion = typeof promotions.$inferSelect;
export type InsertPromotion = typeof promotions.$inferInsert;

// ─── Loyalty Accounts ────────────────────────────────────────────────────────
export const loyaltyAccounts = pgTable(
  "loyalty_accounts",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customerId").notNull(),
    points: integer("points").default(0).notNull(),
    lifetimePoints: integer("lifetimePoints").default(0).notNull(),
    tier: varchar("tier", { length: 16 }).default("bronze").notNull(), // bronze | silver | gold
    referralCode: varchar("referralCode", { length: 16 }).notNull(),
    referredBy: integer("referredBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    customerIdx: uniqueIndex("loyalty_accounts_customerId_idx").on(t.customerId),
    referralCodeIdx: uniqueIndex("loyalty_accounts_referralCode_idx").on(t.referralCode),
  })
);

export type LoyaltyAccount = typeof loyaltyAccounts.$inferSelect;
export type InsertLoyaltyAccount = typeof loyaltyAccounts.$inferInsert;

// ─── Loyalty Transactions ────────────────────────────────────────────────────
export const loyaltyTransactions = pgTable("loyalty_transactions", {
  id: serial("id").primaryKey(),
  accountId: integer("accountId").notNull(),
  points: integer("points").notNull(), // positive = earn, negative = redeem
  type: varchar("type", { length: 32 }).notNull(), // purchase | referral | review | bonus | redemption
  description: text("description"),
  orderId: integer("orderId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LoyaltyTransaction = typeof loyaltyTransactions.$inferSelect;
export type InsertLoyaltyTransaction = typeof loyaltyTransactions.$inferInsert;
