const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'ngapp', user: 'ngapp', password: 'ngapp' });

async function main() {
  // Get enum map
  const { rows: enums } = await pool.query(`SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid ORDER BY t.typname, e.enumsortorder`);
  const enumMap = {};
  for (const { typname, enumlabel } of enums) { if (!enumMap[typname]) enumMap[typname] = []; enumMap[typname].push(enumlabel); }

  await pool.query('ANALYZE');
  const { rows: emptyTables } = await pool.query(`SELECT relname FROM pg_stat_user_tables WHERE n_live_tup = 0 AND relname NOT LIKE '%_migrations%' ORDER BY relname`);
  console.log(`${emptyTables.length} empty tables remaining`);

  // Get valid FK targets
  const agentIds = (await pool.query('SELECT id FROM agents LIMIT 3')).rows.map(r => r.id);
  const merchantIds = (await pool.query('SELECT id FROM merchants LIMIT 3')).rows.map(r => r.id);
  const webhookEndpointIds = (await pool.query('SELECT id FROM webhook_endpoints LIMIT 3')).rows.map(r => r.id);
  const apiKeyIds = (await pool.query('SELECT id FROM api_keys LIMIT 3')).rows.map(r => r.id);

  let seeded = 0, skipped = 0;

  for (const { relname: table } of emptyTables) {
    const { rows: cols } = await pool.query(`SELECT column_name, data_type, column_default, is_nullable, udt_name, character_maximum_length FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position`, [table]);
    if (cols.length === 0) { skipped++; continue; }
    const insertCols = cols.filter(c => !(c.column_default && c.column_default.includes('nextval')));
    if (insertCols.length === 0) { skipped++; continue; }
    const colNames = insertCols.map(c => `"${c.column_name}"`).join(', ');

    const rows = [];
    for (let i = 0; i < 3; i++) {
      const vals = insertCols.map(c => {
        const n = c.column_name;
        const maxl = c.character_maximum_length || 999;
        // Use real FK values
        if ((n.includes('agent') || n.includes('Agent')) && (n.endsWith('Id') || n.endsWith('_id'))) return agentIds[i % agentIds.length] || 1;
        if ((n.includes('merchant') || n.includes('Merchant')) && (n.endsWith('Id') || n.endsWith('_id'))) return merchantIds[i % (merchantIds.length || 1)] || 1;
        if (n === 'endpoint_id' || n === 'endpointId') return webhookEndpointIds[i % (webhookEndpointIds.length || 1)] || 1;
        if ((n === 'apiKeyId' || n === 'api_key_id') && apiKeyIds.length) return apiKeyIds[i % apiKeyIds.length];
        if ((n.endsWith('Id') || n.endsWith('_id')) && n !== 'id') return i + 1;
        if (n === 'id' && !c.column_default) return i + 1;
        if (enumMap[c.udt_name]) { const ev = enumMap[c.udt_name]; return `'${ev[i % ev.length]}'`; }
        if (c.data_type === 'ARRAY') return `'{}'`;
        if (['integer','bigint','smallint'].includes(c.data_type)) return i + 1;
        if (['numeric','double precision','real'].includes(c.data_type)) return `${(i + 1) * 1.5}`;
        if (c.data_type === 'boolean') return i === 0 ? 'true' : 'false';
        if (c.data_type === 'jsonb' || c.data_type === 'json') return `'{"i":${i+1}}'`;
        if (c.data_type.includes('timestamp')) return `NOW() - INTERVAL '${(i+1)*7} days'`;
        if (c.data_type === 'date') return `CURRENT_DATE - ${(i+1)*7}`;
        if (c.data_type === 'uuid') return `gen_random_uuid()`;
        if (c.data_type === 'inet') return `'10.0.0.${i+1}'`;
        // text/varchar
        let v = `${table.slice(0, Math.min(maxl - 4, 15))} ${i+1}`;
        if (v.length > maxl) v = v.slice(0, maxl);
        return `'${v}'`;
      });
      rows.push(`(${vals.join(', ')})`);
    }

    try {
      await pool.query(`INSERT INTO "${table}" (${colNames}) VALUES ${rows.join(', ')} ON CONFLICT DO NOTHING`);
      seeded++;
    } catch (err) {
      try {
        const vals = insertCols.map(c => {
          const n = c.column_name;
          const maxl = c.character_maximum_length || 999;
          if ((n.includes('agent') || n.includes('Agent')) && (n.endsWith('Id') || n.endsWith('_id'))) return agentIds[0] || 1;
          if ((n.includes('merchant') || n.includes('Merchant')) && (n.endsWith('Id') || n.endsWith('_id'))) return merchantIds[0] || 1;
          if (n === 'endpoint_id' || n === 'endpointId') return webhookEndpointIds[0] || 1;
          if ((n === 'apiKeyId' || n === 'api_key_id') && apiKeyIds.length) return apiKeyIds[0];
          if ((n.endsWith('Id') || n.endsWith('_id')) && n !== 'id') return 1;
          if (n === 'id' && !c.column_default) return 1;
          if (enumMap[c.udt_name]) { return `'${enumMap[c.udt_name][0]}'`; }
          if (c.data_type === 'ARRAY') return `'{}'`;
          if (['integer','bigint','smallint'].includes(c.data_type)) return 1;
          if (['numeric','double precision','real'].includes(c.data_type)) return '1.0';
          if (c.data_type === 'boolean') return 'true';
          if (c.data_type === 'jsonb' || c.data_type === 'json') return `'{"i":1}'`;
          if (c.data_type.includes('timestamp')) return 'NOW()';
          if (c.data_type === 'date') return 'CURRENT_DATE';
          if (c.data_type === 'uuid') return 'gen_random_uuid()';
          if (c.data_type === 'inet') return `'10.0.0.1'`;
          let v = `seed ${table.slice(0, Math.min(maxl - 6, 12))}`;
          if (v.length > maxl) v = v.slice(0, maxl);
          return `'${v}'`;
        });
        await pool.query(`INSERT INTO "${table}" (${colNames}) VALUES (${vals.join(', ')}) ON CONFLICT DO NOTHING`);
        seeded++;
      } catch (e2) {
        console.error(`SKIP ${table}: ${e2.message.split('\n')[0]}`);
        skipped++;
      }
    }
  }

  console.log(`\nSeeded: ${seeded}, Skipped: ${skipped}`);
  
  // Final count
  await pool.query('ANALYZE');
  const { rows: [{ count }] } = await pool.query(`SELECT COUNT(*) FROM pg_stat_user_tables WHERE n_live_tup = 0 AND relname NOT LIKE '%_migrations%'`);
  console.log(`Empty tables remaining: ${count}`);
  
  await pool.end();
}
main().catch(console.error);
