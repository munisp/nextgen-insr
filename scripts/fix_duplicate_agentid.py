#!/usr/bin/env python3
"""Fix all duplicate agentId: agent.id / agentId: agent.agentId patterns."""
import os
import re

BASE = "/home/ubuntu/nextgen-insr"

# Files with duplicate agentId in object literals
FILES = [
    "insureportal/server/routers/agent.ts",
    "insureportal/server/middleware/commissionMiddleware.ts",
    "insureportal/server/middleware/settlementMiddleware.ts",
    "insureportal/server/lakehouseCron.ts",
]

for rel_path in FILES:
    full_path = os.path.join(BASE, rel_path)
    if not os.path.exists(full_path):
        print(f"SKIP (not found): {rel_path}")
        continue
    
    with open(full_path) as f:
        content = f.read()
    
    original = content
    
    # Pattern 1: agentId: agent.id followed by agentId: agent.agentId
    # Fix: rename first one to agentNumericId
    content = re.sub(
        r'(agentId:\s+\w+\.id,\s*\n\s*)(agentId:\s+\w+\.agentId)',
        lambda m: m.group(1).replace('agentId:', 'agentNumericId:') + m.group(2),
        content
    )
    
    # Pattern 2: Two consecutive agentId lines in destructuring (TS2300)
    # { agentId: integer, agentId: varchar } -> { agentId: integer, agentCode: varchar }
    content = re.sub(
        r'(agentId:\s+integer[^,\n]*,?\s*\n\s*)(agentId:\s+varchar)',
        lambda m: m.group(1) + m.group(2).replace('agentId:', 'agentCode:'),
        content
    )
    
    # Pattern 3: agentId: agents.agentId (duplicate in lakehouseCron select)
    # If there's already agentId: agents.id, rename the second
    content = re.sub(
        r'(agentId:\s+\w+\.id,\s*\n\s*)(agentId:\s+\w+\.agentId)',
        lambda m: m.group(1) + m.group(2).replace('agentId:', 'agentCode:'),
        content
    )
    
    if content != original:
        with open(full_path, 'w') as f:
            f.write(content)
        print(f"Fixed: {rel_path}")
    else:
        print(f"No changes needed: {rel_path}")

# Also fix the main schema.ts duplicate import at line 4605
main_schema = os.path.join(BASE, "drizzle/schema.ts")
with open(main_schema) as f:
    lines = f.readlines()

# Check line 4605 (index 4604) for duplicate import
if len(lines) > 4604:
    line = lines[4604]
    print(f"\nMain schema line 4605: {line.rstrip()}")
    if 'import' in line and 'pgTable' in line:
        # This is a duplicate import - comment it out
        lines[4604] = "// " + line  # Comment out the duplicate
        with open(main_schema, 'w') as f:
            f.writelines(lines)
        print("Fixed: commented out duplicate import in drizzle/schema.ts line 4605")

print("\nDone.")
