#!/usr/bin/env python3
"""Fix all duplicate column/property name errors across insureportal server files."""
import subprocess
import re
import os

BASE = "/home/ubuntu/nextgen-insr"

def get_tsc_errors():
    """Run tsc and return list of (file, line, col, code, message) tuples."""
    result = subprocess.run(
        ["npx", "tsc", "--noEmit", "--project", "insureportal/tsconfig.json"],
        capture_output=True, text=True, cwd=BASE, timeout=120
    )
    errors = []
    for line in (result.stdout + result.stderr).splitlines():
        m = re.match(r"(.+\.ts)\((\d+),(\d+)\): error (TS\d+): (.+)", line)
        if m:
            errors.append({
                "file": m.group(1),
                "line": int(m.group(2)),
                "col": int(m.group(3)),
                "code": m.group(4),
                "msg": m.group(5),
            })
    return errors

def fix_duplicate_agentId_in_destructuring(filepath):
    """Fix duplicate agentId in destructuring patterns in middleware files."""
    with open(filepath) as f:
        lines = f.readlines()
    
    fixed = 0
    i = 0
    while i < len(lines):
        line = lines[i]
        # Pattern: two consecutive lines with agentId in a destructuring
        if i + 1 < len(lines):
            next_line = lines[i + 1]
            # Check for duplicate agentId in destructuring (TS2300 pattern)
            if ('agentId' in line and 'agentId' in next_line and 
                ('integer' in line or 'varchar' in line or 'serial' in line)):
                # Second one should be renamed to agentCode
                if 'varchar' in next_line or ('integer' in line and 'varchar' in next_line):
                    lines[i + 1] = next_line.replace('agentId', 'agentCode', 1)
                    fixed += 1
                elif 'integer' in next_line and 'integer' in line:
                    lines[i + 1] = next_line.replace('agentId', 'agentIdRef', 1)
                    fixed += 1
        i += 1
    
    if fixed > 0:
        with open(filepath, 'w') as f:
            f.writelines(lines)
        print(f"  Fixed {fixed} duplicate agentId in {os.path.relpath(filepath, BASE)}")
    return fixed

def fix_lakehouse_cron_duplicates(filepath):
    """Fix duplicate property names in lakehouseCron.ts."""
    with open(filepath) as f:
        content = f.read()
    
    # Find duplicate properties in object literals
    # The issue is likely duplicate keys in insert/update objects
    lines = content.split('\n')
    
    # Track which properties we've seen in each object literal block
    in_object = 0
    seen_props = {}
    fixed_lines = []
    fixed = 0
    
    for i, line in enumerate(lines):
        # Simple heuristic: track brace depth
        open_braces = line.count('{') - line.count('}')
        
        # Check for duplicate property: "  key: value,"
        prop_match = re.match(r'\s+(\w+):\s+', line)
        if prop_match and in_object > 0:
            prop_name = prop_match.group(1)
            if prop_name in seen_props.get(in_object, set()):
                # Rename duplicate
                new_name = f"{prop_name}2"
                line = line.replace(f"{prop_name}:", f"{new_name}:", 1)
                fixed += 1
            else:
                seen_props.setdefault(in_object, set()).add(prop_name)
        
        in_object = max(0, in_object + open_braces)
        if in_object == 0:
            seen_props = {}
        
        fixed_lines.append(line)
    
    if fixed > 0:
        with open(filepath, 'w') as f:
            f.write('\n'.join(fixed_lines))
        print(f"  Fixed {fixed} duplicate properties in {os.path.relpath(filepath, BASE)}")
    return fixed

# Fix specific known files
files_to_fix = [
    "insureportal/server/middleware/commissionMiddleware.ts",
    "insureportal/server/middleware/settlementMiddleware.ts",
]

for rel_path in files_to_fix:
    full_path = os.path.join(BASE, rel_path)
    if os.path.exists(full_path):
        fix_duplicate_agentId_in_destructuring(full_path)

# Fix lakehouseCron.ts
lakehouse_path = os.path.join(BASE, "insureportal/server/lakehouseCron.ts")
if os.path.exists(lakehouse_path):
    with open(lakehouse_path) as f:
        content = f.read()
    # Check lines 107 and 128
    lines = content.split('\n')
    print(f"lakehouseCron line 106: {lines[106]}")
    print(f"lakehouseCron line 107: {lines[107]}")
    print(f"lakehouseCron line 127: {lines[127]}")
    print(f"lakehouseCron line 128: {lines[128]}")

# Fix agent.ts duplicates
agent_path = os.path.join(BASE, "insureportal/server/routers/agent.ts")
if os.path.exists(agent_path):
    with open(agent_path) as f:
        lines = f.readlines()
    # Check lines 75, 91, 471, 511, 551
    for ln in [74, 90, 470, 510, 550]:
        if ln < len(lines):
            print(f"agent.ts line {ln+1}: {lines[ln].rstrip()}")
            if ln+1 < len(lines):
                print(f"agent.ts line {ln+2}: {lines[ln+1].rstrip()}")
