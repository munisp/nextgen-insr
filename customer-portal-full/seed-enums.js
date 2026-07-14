const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'ngapp', user: 'ngapp', password: 'ngapp' });

async function main() {
  // Get all enum types and their values
  const { rows: enums } = await pool.query(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
    ORDER BY t.typname, e.enumsortorder
  `);
  const enumMap = {};
  for (const { typname, enumlabel } of enums) {
    if (!enumMap[typname]) enumMap[typname] = [];
    enumMap[typname].push(enumlabel);
  }

  // Get remaining empty tables
  await pool.query('ANALYZE');
  const { rows: emptyTables } = await pool.query(`
    SELECT schemaname, relname FROM pg_stat_user_tables
    WHERE n_live_tup = 0 AND relname NOT LIKE '%_migrations%'
    ORDER BY relname
  `);

  console.log(`${emptyTables.length} empty tables remaining`);
  let seeded = 0, skipped = 0;

  for (const { relname: table } of emptyTables) {
    const { rows: cols } = await pool.query(`
      SELECT column_name, data_type, column_default, is_nullable, udt_name, character_maximum_length
      FROM information_schema.columns 
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [table]);

    if (cols.length === 0) { skipped++; continue; }

    const insertCols = cols.filter(c => !(c.column_default && c.column_default.includes('nextval')));
    if (insertCols.length === 0) { skipped++; continue; }

    const colNames = insertCols.map(c => `"${c.column_name}"`).join(', ');

    const rows = [];
    for (let i = 1; i <= 3; i++) {
      const vals = insertCols.map(c => genVal(c, i, table, enumMap));
      rows.push(`(${vals.join(', ')})`);
    }

    try {
      const sql = `INSERT INTO "${table}" (${colNames}) VALUES ${rows.join(',\n  ')} ON CONFLICT DO NOTHING`;
      await pool.query(sql);
      seeded++;
    } catch (err) {
      // Try single row
      try {
        const vals = insertCols.map(c => genVal(c, 1, table, enumMap));
        const sql = `INSERT INTO "${table}" (${colNames}) VALUES (${vals.join(', ')}) ON CONFLICT DO NOTHING`;
        await pool.query(sql);
        seeded++;
      } catch (e2) {
        console.error(`SKIP ${table}: ${e2.message.split('\n')[0]}`);
        skipped++;
      }
    }
  }

  console.log(`Seeded: ${seeded}, Skipped: ${skipped}`);
  await pool.end();
}

function genVal(col, idx, table, enumMap) {
  const { column_name: name, data_type: dtype, udt_name, is_nullable, character_maximum_length: maxLen } = col;

  if (name === 'id' && !col.column_default) return idx;

  // Foreign keys
  if ((name.endsWith('Id') || name.endsWith('_id')) && name !== 'id') {
    if (name.includes('agent') || name.includes('Agent')) return idx + 6;
    return idx;
  }

  // Check if it's an enum type
  if (enumMap[udt_name]) {
    const vals = enumMap[udt_name];
    return `'${vals[Math.min(idx - 1, vals.length - 1)]}'`;
  }

  // Handle ARRAY type
  if (dtype === 'ARRAY') {
    if (udt_name === '_text' || udt_name === '_varchar') return `ARRAY['item${idx}']::text[]`;
    if (udt_name === '_int4') return `ARRAY[${idx}]::int[]`;
    return `'{}'`;
  }

  const maxl = maxLen || 999;

  switch (dtype) {
    case 'integer':
    case 'bigint':
    case 'smallint':
      if (name.includes('amount') || name.includes('Amount') || name.includes('premium') || name.includes('Premium') || name.includes('balance') || name.includes('Balance') || name.includes('volume') || name.includes('Volume')) return idx * 50000;
      if (name.includes('count') || name.includes('Count') || name.includes('attempts')) return idx * 2;
      if (name.includes('score') || name.includes('Score')) return 70 + idx * 5;
      if (name.includes('duration') || name.includes('Duration')) return idx * 30;
      return idx;
    case 'numeric':
    case 'double precision':
    case 'real':
      if (name.includes('rate') || name.includes('Rate') || name.includes('ratio') || name.includes('Ratio') || name.includes('pct') || name.includes('Pct')) return `${(0.05 * idx).toFixed(4)}`;
      if (name.includes('latitude') || name.includes('lat')) return `${6.45 + idx * 0.01}`;
      if (name.includes('longitude') || name.includes('lng') || name.includes('lon')) return `${3.40 + idx * 0.01}`;
      if (name.includes('amount') || name.includes('Amount')) return idx * 50000;
      return `${idx * 1.5}`;
    case 'boolean':
      return idx === 1 ? 'true' : 'false';
    case 'text':
    case 'character varying':
      return genText(name, idx, table, maxl);
    case 'json':
    case 'jsonb':
      return `'{"data": "sample_${idx}"}'::jsonb`;
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
    default:
      if (is_nullable === 'YES') return 'NULL';
      return `'${idx}'`;
  }
}

function genText(name, idx, table, maxl) {
  let val;
  if (name === 'name' || name === 'Name') val = `Sample ${idx}`;
  else if (name.includes('email') || name.includes('Email')) val = `s${idx}@ip.ng`;
  else if (name.includes('phone') || name.includes('Phone') || name.includes('msisdn')) val = `+23480${idx}`;
  else if (name.includes('url') || name.includes('Url') || name.includes('URL') || name.includes('endpoint') || name.includes('Endpoint')) val = `/api/${idx}`;
  else if (name.includes('ip') || name.includes('Ip') || name === 'ipAddress') val = `102.89.${idx}`;
  else if (name.includes('version') || name.includes('Version')) val = `${idx}.0.0`;
  else if (name.includes('key') || name.includes('Key') || name.includes('token') || name.includes('Token') || name.includes('secret') || name.includes('Secret') || name.includes('hash') || name.includes('Hash') || name.includes('credential') || name.includes('Credential')) val = `k${idx}`;
  else if (name.includes('carrier') || name.includes('Carrier')) val = idx === 1 ? 'MTN' : 'Airtel';
  else if (name.includes('color') || name.includes('Color') || name.includes('colour')) val = `#${String(idx * 111111).padStart(6, '0')}`;
  else if (name.includes('currency') || name.includes('Currency')) val = 'NGN';
  else if (name.includes('country') || name.includes('Country')) val = 'NG';
  else if (name.includes('platform') || name.includes('Platform')) val = idx === 1 ? 'web' : 'mobile';
  else val = `${table.slice(0, Math.min(maxl - 4, 20))} ${idx}`;

  if (val.length > maxl) val = val.slice(0, maxl);
  return `'${val.replace(/'/g, "''")}'`;
}

main().catch(console.error);
