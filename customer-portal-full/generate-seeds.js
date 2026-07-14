const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'ngapp', user: 'ngapp', password: 'ngapp' });

async function main() {
  // Get empty tables
  const { rows: emptyTables } = await pool.query(`
    SELECT t.relname FROM pg_stat_user_tables t
    WHERE t.n_live_tup = 0 AND t.relname NOT LIKE '%_migrations%'
    ORDER BY t.relname
  `);

  let seeded = 0, skipped = 0;

  for (const { relname: table } of emptyTables) {
    // Get columns
    const { rows: cols } = await pool.query(`
      SELECT column_name, data_type, column_default, is_nullable, udt_name
      FROM information_schema.columns 
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [table]);

    if (cols.length === 0) { skipped++; continue; }

    // Skip auto-generated id columns
    const insertCols = cols.filter(c => {
      if (c.column_default && c.column_default.includes('nextval')) return false;
      return true;
    });

    if (insertCols.length === 0) { skipped++; continue; }

    const colNames = insertCols.map(c => `"${c.column_name}"`).join(', ');
    
    // Generate 2-3 sample rows
    const rows = [];
    for (let i = 1; i <= 3; i++) {
      const vals = insertCols.map(c => generateValue(c, i, table));
      rows.push(`(${vals.join(', ')})`);
    }

    try {
      const sql = `INSERT INTO "${table}" (${colNames}) VALUES ${rows.join(',\n  ')} ON CONFLICT DO NOTHING`;
      await pool.query(sql);
      seeded++;
    } catch (err) {
      // Try with just 1 row
      try {
        const vals = insertCols.map(c => generateValue(c, 1, table));
        const sql = `INSERT INTO "${table}" (${colNames}) VALUES (${vals.join(', ')}) ON CONFLICT DO NOTHING`;
        await pool.query(sql);
        seeded++;
      } catch (e2) {
        console.error(`SKIP ${table}: ${e2.message.split('\n')[0]}`);
        skipped++;
      }
    }
  }

  console.log(`\nSeeded: ${seeded}, Skipped: ${skipped}, Total: ${emptyTables.length}`);
  await pool.end();
}

function generateValue(col, idx, table) {
  const { column_name: name, data_type: dtype, udt_name, is_nullable } = col;
  
  // Handle ID columns that aren't auto-increment
  if (name === 'id' && !col.column_default) {
    return idx;
  }

  // Foreign keys (columns ending in Id or _id)
  if (name.endsWith('Id') || name.endsWith('_id')) {
    if (name.includes('user') || name.includes('User') || name.includes('customer') || name.includes('Customer') || name.includes('owner')) return idx;
    if (name.includes('agent') || name.includes('Agent')) return idx + 6; // agents start at 7
    if (name.includes('policy') || name.includes('Policy')) return idx;
    if (name.includes('claim') || name.includes('Claim')) return idx;
    if (name.includes('device') || name.includes('Device')) return idx;
    return idx;
  }

  // Enum/custom types
  if (udt_name && !['int4', 'int8', 'float8', 'float4', 'numeric', 'bool', 'text', 'varchar', 'timestamp', 'timestamptz', 'date', 'jsonb', 'json', 'uuid', 'inet'].includes(udt_name)) {
    // Try to get enum values
    return `'value${idx}'`;
  }

  switch (dtype) {
    case 'integer':
    case 'bigint':
    case 'smallint':
      if (name.includes('amount') || name.includes('Amount') || name.includes('premium') || name.includes('Premium') || name.includes('balance') || name.includes('Balance')) return idx * 50000;
      if (name.includes('count') || name.includes('Count')) return idx * 5;
      if (name.includes('score') || name.includes('Score')) return 70 + idx * 5;
      if (name.includes('level') || name.includes('Level')) return idx;
      if (name.includes('port') || name.includes('Port')) return 8080 + idx;
      return idx;
    case 'numeric':
    case 'double precision':
    case 'real':
      if (name.includes('rate') || name.includes('Rate') || name.includes('ratio') || name.includes('Ratio')) return `${(0.05 * idx).toFixed(4)}`;
      if (name.includes('latitude') || name.includes('lat')) return `${6.45 + idx * 0.01}`;
      if (name.includes('longitude') || name.includes('lng') || name.includes('lon')) return `${3.40 + idx * 0.01}`;
      if (name.includes('amount') || name.includes('Amount')) return idx * 50000;
      return `${idx * 1.5}`;
    case 'boolean':
      return idx === 1 ? 'true' : 'false';
    case 'text':
    case 'character varying':
      if (name === 'name' || name === 'Name') return `'Sample ${table} ${idx}'`;
      if (name.includes('email') || name.includes('Email')) return `'sample${idx}@insureportal.ng'`;
      if (name.includes('phone') || name.includes('Phone')) return `'+234801234567${idx}'`;
      if (name.includes('url') || name.includes('Url') || name.includes('URL')) return `'/uploads/${table}/${idx}.pdf'`;
      if (name.includes('status') || name.includes('Status')) return `'active'`;
      if (name.includes('type') || name.includes('Type')) return `'standard'`;
      if (name.includes('description') || name.includes('Description') || name.includes('content') || name.includes('Content') || name.includes('message') || name.includes('Message') || name.includes('reason') || name.includes('Reason') || name.includes('notes') || name.includes('Notes')) return `'Sample data for ${table} record ${idx}'`;
      if (name.includes('reference') || name.includes('Reference') || name.includes('ref') || name.includes('Ref') || name.includes('number') || name.includes('Number') || name.includes('code') || name.includes('Code')) return `'${table.toUpperCase().slice(0,3)}-2026-${String(idx).padStart(3,'0')}'`;
      if (name.includes('address') || name.includes('Address')) return `'${idx} Insurance Road, Lagos'`;
      if (name.includes('method') || name.includes('Method') || name.includes('channel') || name.includes('Channel')) return `'web'`;
      if (name.includes('key') || name.includes('Key') || name.includes('token') || name.includes('Token') || name.includes('secret') || name.includes('Secret') || name.includes('hash') || name.includes('Hash')) return `'${table}_key_${idx}_' || md5(random()::text)`;
      if (name.includes('ip') || name.includes('Ip') || name === 'ipAddress') return `'102.89.23.${40+idx}'`;
      return `'${table.replace(/_/g, ' ')} ${idx}'`;
    case 'json':
    case 'jsonb':
      return `'{"sample": true, "index": ${idx}}'::jsonb`;
    case 'timestamp without time zone':
    case 'timestamp with time zone':
      if (name.includes('expires') || name.includes('Expires') || name.includes('due') || name.includes('Due') || name.includes('end') || name.includes('End')) return `NOW() + INTERVAL '${idx * 30} days'`;
      return `NOW() - INTERVAL '${idx * 7} days'`;
    case 'date':
      return `CURRENT_DATE - ${idx * 7}`;
    case 'uuid':
      return `gen_random_uuid()`;
    case 'inet':
      return `'102.89.23.${40+idx}'`;
    case 'ARRAY':
      return `'{}'`;
    default:
      if (is_nullable === 'YES') return 'NULL';
      return `'${idx}'`;
  }
}

main().catch(console.error);
