import { Router } from 'express'
import { requireAdmin } from '../auth/middleware.js'
import { paraCamel } from './granadas.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LADOS = new Set(['T', 'CT'])
const TIPOS = new Set(['execute', 'fake', 'explode', 'rush', 'split', 'setup'])
const LOCAIS = new Set(['A', 'B', 'MID'])
const ARMAS = new Set(['full', 'eco', 'force', 'pistol'])
const MAP_RE = /^[a-z0-9_]+$/

// Valida o corpo de POST/PUT; devolve {erro} ou {valores} prontos pra query.
function validarCorpo(body) {
  const map = String(body?.map ?? '')
  const lado = String(body?.lado ?? '')
  const tipo = String(body?.tipo ?? '')
  const local = String(body?.local ?? '')
  const armas = String(body?.armas ?? 'full')
  const titulo = String(body?.titulo ?? '').trim()
  const descricao = String(body?.descricao ?? '').trim() || null

  if (!MAP_RE.test(map)) return { erro: 'mapa inválido' }
  if (!LADOS.has(lado)) return { erro: 'lado deve ser T ou CT' }
  if (!TIPOS.has(tipo)) return { erro: 'tipo inválido' }
  if (!LOCAIS.has(local)) return { erro: 'local inválido' }
  if (!ARMAS.has(armas)) return { erro: 'armas inválido' }
  if (!titulo) return { erro: 'título é obrigatório' }
  if (!Array.isArray(body?.papeis)) return { erro: 'papeis deve ser uma lista' }

  const papeis = []
  for (const p of body.papeis) {
    const ordem = Number(p?.ordem)
    const descricaoPapel = String(p?.descricao ?? '').trim()
    const obrigatorio = Boolean(p?.obrigatorio)
    const granadaIds = Array.isArray(p?.granadaIds) ? p.granadaIds.map(String) : null
    if (!Number.isInteger(ordem)) return { erro: 'ordem do papel inválida' }
    if (!descricaoPapel) return { erro: 'descrição do papel é obrigatória' }
    if (granadaIds === null) return { erro: 'granadaIds deve ser uma lista' }
    papeis.push({ ordem, descricao: descricaoPapel, obrigatorio, granadaIds })
  }

  return { valores: { map, lado, tipo, local, armas, titulo, descricao, papeis } }
}

// Insere os papéis de uma tática (e os vínculos com a biblioteca de granadas)
// já dentro da transação aberta pelo caller (POST/PUT). `client` é o client
// dedicado da transação (ver createTaticasCuradasRouter), não o pool.
async function inserirPapeis(client, taticaId, papeis) {
  for (const p of papeis) {
    const { rows } = await client.query(
      `insert into taticas_papeis (tatica_id, ordem, descricao, obrigatorio)
       values ($1, $2, $3, $4)
       returning id`,
      [taticaId, p.ordem, p.descricao, p.obrigatorio],
    )
    const papelId = rows[0].id
    for (let i = 0; i < p.granadaIds.length; i += 1) {
      await client.query(
        `insert into taticas_papel_granadas (papel_id, lineup_curado_id, ordem)
         values ($1, $2, $3)`,
        [papelId, p.granadaIds[i], i],
      )
    }
  }
}

export function createTaticasCuradasRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const cond = []
    const params = []
    const { map, lado, tipo, local, armas } = req.query
    if (map && MAP_RE.test(map)) {
      params.push(map)
      cond.push(`map = $${params.length}`)
    }
    if (lado && LADOS.has(lado)) {
      params.push(lado)
      cond.push(`lado = $${params.length}`)
    }
    if (tipo && TIPOS.has(tipo)) {
      params.push(tipo)
      cond.push(`tipo = $${params.length}`)
    }
    if (local && LOCAIS.has(local)) {
      params.push(local)
      cond.push(`local = $${params.length}`)
    }
    if (armas && ARMAS.has(armas)) {
      params.push(armas)
      cond.push(`armas = $${params.length}`)
    }
    const where = cond.length ? `where ${cond.join(' and ')}` : ''

    // 3 queries (tática -> papéis -> granadas dos papéis) montadas em JS: evita
    // N+1 e devolve o playbook já aninhado pro front não precisar de 2ª chamada.
    const { rows: taticas } = await db.query(
      `select id, map, lado, tipo, local, armas, titulo, descricao, criado_por, criado_em
       from taticas_curadas ${where} order by criado_em desc limit 500`,
      params,
    )

    const taticaIds = taticas.map((t) => t.id)
    const { rows: papeis } = await db.query(
      `select id, tatica_id, ordem, descricao, obrigatorio
       from taticas_papeis where tatica_id = any($1) order by ordem asc`,
      [taticaIds],
    )

    const papelIds = papeis.map((p) => p.id)
    const { rows: granadas } = await db.query(
      `select tpg.papel_id, tpg.ordem,
              l.id, l.map, l.lado, l.tipo, l.titulo, l.descricao, l.video_url, l.tecnica, l.botao,
              l.passos, l.arremesso_x, l.arremesso_y, l.alvo_x, l.alvo_y, l.criado_por, l.criado_em
       from taticas_papel_granadas tpg
       join lineups_curados l on l.id = tpg.lineup_curado_id
       where tpg.papel_id = any($1) order by tpg.ordem asc`,
      [papelIds],
    )

    const granadasPorPapel = new Map()
    for (const g of granadas) {
      const lista = granadasPorPapel.get(g.papel_id) ?? []
      lista.push({ ...paraCamel(g), ordem: g.ordem })
      granadasPorPapel.set(g.papel_id, lista)
    }

    const papeisPorTatica = new Map()
    for (const p of papeis) {
      const lista = papeisPorTatica.get(p.tatica_id) ?? []
      lista.push({
        id: p.id, ordem: p.ordem, descricao: p.descricao, obrigatorio: p.obrigatorio,
        granadas: granadasPorPapel.get(p.id) ?? [],
      })
      papeisPorTatica.set(p.tatica_id, lista)
    }

    res.json(
      taticas.map((t) => ({
        id: t.id, map: t.map, lado: t.lado, tipo: t.tipo, local: t.local, armas: t.armas,
        titulo: t.titulo, descricao: t.descricao,
        papeis: papeisPorTatica.get(t.id) ?? [],
      })),
    )
  })

  router.get('/contagem', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      'select map, count(*) as total from taticas_curadas group by map',
    )
    res.json(rows.map((r) => ({ map: r.map, total: Number(r.total) })))
  })

  router.post('/', requireAuth, requireAdmin, async (req, res) => {
    const { erro, valores } = validarCorpo(req.body)
    if (erro) return res.status(400).json({ erro })
    const v = valores

    // pool.query() pega uma conexão emprestada e devolve ao pool a cada chamada —
    // begin/insert/commit em chamadas separadas via db.query() NÃO garantem a mesma
    // conexão entre si. Com mais de uma escrita concorrente no mesmo processo, os
    // comandos de transações diferentes podem se intercalar na mesma conexão física
    // (o commit de uma request persistiria inserts parciais de outra). Isso hoje não
    // se manifesta porque a Vercel serverless dá 1 request por instância, mas é uma
    // dependência frágil de topologia, não uma garantia do código. Por isso a
    // transação usa um client dedicado (pool.connect()): begin/insert*/commit correm
    // todos na mesma conexão física, isolados de qualquer outra transação, não
    // importa quantas rodem em paralelo no mesmo processo.
    const client = await db.connect()
    try {
      await client.query('begin')
      const { rows } = await client.query(
        `insert into taticas_curadas (map, lado, tipo, local, armas, titulo, descricao, criado_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id`,
        [v.map, v.lado, v.tipo, v.local, v.armas, v.titulo, v.descricao, req.player.steamId],
      )
      const taticaId = rows[0].id
      await inserirPapeis(client, taticaId, v.papeis)
      await client.query('commit')
      res.status(201).json({ id: taticaId })
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
  })

  router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'tática não encontrada' })
    const { erro, valores } = validarCorpo(req.body)
    if (erro) return res.status(400).json({ erro })
    const v = valores

    // Mesmo padrão de transação com client dedicado do POST (ver comentário acima) —
    // aqui substituindo tudo: update da tática, apaga papéis (cascade limpa os
    // vínculos com a biblioteca) e reinsere papéis/vínculos do zero.
    const client = await db.connect()
    try {
      await client.query('begin')
      const { rows } = await client.query(
        `update taticas_curadas
         set map = $1, lado = $2, tipo = $3, local = $4, armas = $5, titulo = $6, descricao = $7,
             atualizado_em = now()
         where id = $8
         returning id`,
        [v.map, v.lado, v.tipo, v.local, v.armas, v.titulo, v.descricao, req.params.id],
      )
      if (!rows.length) {
        await client.query('rollback')
        return res.status(404).json({ erro: 'tática não encontrada' })
      }
      await client.query('delete from taticas_papeis where tatica_id = $1', [req.params.id])
      await inserirPapeis(client, req.params.id, v.papeis)
      await client.query('commit')
      res.json({ ok: true })
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
  })

  router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'tática não encontrada' })
    const { rows } = await db.query(
      'delete from taticas_curadas where id = $1 returning id',
      [req.params.id],
    )
    if (!rows.length) return res.status(404).json({ erro: 'tática não encontrada' })
    res.json({ ok: true })
  })

  return router
}
