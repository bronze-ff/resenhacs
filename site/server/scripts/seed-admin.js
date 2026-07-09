import { createDb } from '../src/db.js'

const steamId = process.argv[2]
if (!/^\d{17}$/.test(steamId ?? '')) {
  console.error('Uso: node scripts/seed-admin.js <steam_id64 com 17 dígitos>')
  process.exit(1)
}

const db = createDb(process.env.DATABASE_URL)
await db.query(
  `insert into players (steam_id64, is_admin) values ($1, true)
   on conflict (steam_id64) do update set is_admin = true`,
  [steamId],
)
console.log(`Jogador ${steamId} agora é admin.`)
await db.close()
