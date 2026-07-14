#!/usr/bin/env python3
"""Fix duplicate column names in insureportal/drizzle/schema.ts"""

SCHEMA_FILE = "insureportal/drizzle/schema.ts"

with open(SCHEMA_FILE) as f:
    lines = f.readlines()

# Fix line 522 (index 521): duplicate agentId in audit_log -> rename to userId
# Original: agentId: varchar("agentId", { length: 32 }),
# Fix: userId: varchar("userId", { length: 32 }),
if 'agentId: varchar("agentId"' in lines[521]:
    lines[521] = lines[521].replace('agentId: varchar("agentId"', 'userId: varchar("userId"')
    print(f"Fixed line 522: {lines[521].rstrip()}")

# Fix line 2297 (index 2296): duplicate agentId in commission_payouts -> rename to agentCode
# Original: agentId: varchar("agent_code", { length: 32 }).notNull(),
# Fix: agentCode: varchar("agent_code", { length: 32 }).notNull(),
if 'agentId: varchar("agent_code"' in lines[2296]:
    lines[2296] = lines[2296].replace('agentId: varchar("agent_code"', 'agentCode: varchar("agent_code"')
    print(f"Fixed line 2297: {lines[2296].rstrip()}")

# Fix line 2436 (index 2435): same pattern
if 'agentId: varchar("agent_code"' in lines[2435]:
    lines[2435] = lines[2435].replace('agentId: varchar("agent_code"', 'agentCode: varchar("agent_code"')
    print(f"Fixed line 2436: {lines[2435].rstrip()}")

# Fix line 2470 (index 2469): same pattern
if 'agentId: varchar("agent_code"' in lines[2469]:
    lines[2469] = lines[2469].replace('agentId: varchar("agent_code"', 'agentCode: varchar("agent_code"')
    print(f"Fixed line 2470: {lines[2469].rstrip()}")

# Fix feeTypeEnum -> erpTypeEnum
fixed_fee = 0
for i, line in enumerate(lines):
    if 'feeTypeEnum' in line:
        lines[i] = line.replace('feeTypeEnum', 'erpTypeEnum')
        fixed_fee += 1
        print(f"Fixed feeTypeEnum at line {i+1}: {lines[i].rstrip()}")

with open(SCHEMA_FILE, "w") as f:
    f.writelines(lines)

print(f"\nAll fixes applied. Fixed {fixed_fee} feeTypeEnum references.")
