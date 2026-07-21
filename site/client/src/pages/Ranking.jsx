import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'
import TagEstilo from '../components/TagEstilo.jsx'
import { nomeMapa, dataHora } from '../lib/format.js'
import { Card, SectionHeader, RatingBadge, DataTable } from '../components/ui'

function Medalha({ posicao }) {
  const cores = { 0: 'text-yellow-400', 1: 'text-slate-300', 2: 'text-amber-600' }
  if (!(posicao in cores)) return <span className="font-mono text-texto-fraco">{posicao + 1}</span>
  return <span className={`font-display font-bold ${cores[posicao]}`}>{posicao + 1}º</span>
}

// Avatar do ranking com fallback pra quem nunca logou no site (avatarUrl null) — mesmo
// padrão do Avatar em Partida.jsx (Economia/Utilitária), mas quadrado maior pro card mobile.
function AvatarRanking({ r }) {
  const titulo = r.nick || r.steamId
  if (r.avatarUrl) {
    return <img src={r.avatarUrl} alt="" className="panel-cut-sm h-14 w-14 shrink-0 border border-borda object-cover" />
  }
  return (
    <span className="panel-cut-sm flex h-14 w-14 shrink-0 items-center justify-center border border-borda bg-superficie-alta font-display text-xl font-bold text-texto-fraco">
      {titulo.charAt(0).toUpperCase()}
    </span>
  )
}

// Seta de forma recente: rating médio das últimas 5 partidas vs a média geral de
// carreira do Jogador (o server só manda `forma` quando há amostra suficiente — ver
// ranking.js). Mesmo estilo visual do ▲/▼ do Premier em Partida.jsx, mas comparando
// janela recente x histórico em vez de antes/depois de uma partida só.
function SetaForma({ forma }) {
  if (!forma || forma.tendencia === 'estavel') return null
  const subindo = forma.tendencia === 'subindo'
  return (
    <span
      className={`ml-1 font-mono text-xs ${subindo ? 'text-sucesso' : 'text-perigo'}`}
      title={`Últimas 5: ${forma.recente.toFixed(2)} · Geral: ${forma.geral.toFixed(2)}`}
    >
      {subindo ? '▲' : '▼'}
    </span>
  )
}

function Stat({ rotulo, valor, cor }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-wide text-texto-fraco">{rotulo}</div>
      <div className={`truncate text-base font-semibold tabular-nums ${cor ?? 'text-texto'}`}>{valor}</div>
    </div>
  )
}

// Card mobile (estilo app FACEIT): avatar grande + posição/nick + grade de 4 stats.
// Destaca o próprio usuário logado com fundo/borda laranja.
function CardJogador({ r, posicao, souEu }) {
  return (
    <Card
      as={Link}
      interativo={!souEu}
      to={`/jogador/${r.steamId}`}
      className={`flex gap-3 p-4 ${souEu ? '!border-destaque !bg-destaque/10' : 'hover:bg-superficie-alta'}`}
    >
      <AvatarRanking r={r} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-xs text-texto-fraco">#{posicao + 1}</span>
          <span className="min-w-0 flex-1 truncate font-display text-lg font-bold text-texto">{r.nick || r.steamId}</span>
          <TagEstilo estilo={r.estilo} />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-wide text-texto-fraco">Rating</div>
            <span className="inline-flex items-center">
              <RatingBadge valor={r.rating} className="text-base" />
              <SetaForma forma={r.forma} />
            </span>
          </div>
          <Stat rotulo="K/D" valor={r.kd} />
          <Stat rotulo="Partidas" valor={r.partidas} />
          <Stat rotulo="HS%" valor={`${r.hsPct}%`} />
        </div>
      </div>
    </Card>
  )
}

// `to` opcional: quando presente o card vira um Link (pra Partida ou Jogador de
// referência), com hover/cursor de affordance clicável. Sem `to` (ex.: recorde sem
// Partida única associável) permanece um card estático.
function CardDestaque({ rotulo, nick, valor, to }) {
  const conteudo = (
    <>
      <div className="absolute left-0 top-0 h-[2px] w-6 bg-destaque/60" />
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-texto-fraco">{rotulo}</div>
      <div className="mt-1 font-display text-lg font-bold text-destaque">{nick}</div>
      <div className="font-mono text-sm text-texto-fraco">{valor}</div>
    </>
  )
  if (to) {
    return (
      <Link
        to={to}
        className="panel-cut-sm relative block border border-borda bg-superficie p-4 transition-colors duration-200 hover:border-destaque/60"
      >
        {conteudo}
      </Link>
    )
  }
  return <div className="panel-cut-sm relative border border-borda bg-superficie p-4">{conteudo}</div>
}

// Recordes do grupo (hall da fama): marcas históricas, sempre de TODAS as Partidas —
// não respeita o filtro de período do Ranking (um recorde não deixa de ter acontecido
// só porque saiu do período selecionado na tela).
function Recordes() {
  const [recordes, setRecordes] = useState(null)

  useEffect(() => {
    fetch('/api/recordes')
      .then((res) => (res.ok ? res.json() : null))
      .then(setRecordes)
      .catch(() => setRecordes(null))
  }, [])

  if (!recordes) return null
  const { maisKills, melhorAdr, maiorSequencia, maisClutchesNaNoite } = recordes
  if (!maisKills && !melhorAdr && !maiorSequencia && !maisClutchesNaNoite) return null

  return (
    <section>
      <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
        Recordes do grupo
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {maisKills && (
          <CardDestaque
            rotulo="Mais kills numa partida"
            nick={maisKills.nick}
            valor={`${maisKills.kills} kills · ${nomeMapa(maisKills.map)} · ${dataHora(maisKills.playedAt)}`}
            to={maisKills.matchId ? `/partida/${maisKills.matchId}` : undefined}
          />
        )}
        {melhorAdr && (
          <CardDestaque
            rotulo="Melhor ADR numa partida"
            nick={melhorAdr.nick}
            valor={`${melhorAdr.adr} ADR · ${nomeMapa(melhorAdr.map)} · ${dataHora(melhorAdr.playedAt)}`}
            to={melhorAdr.matchId ? `/partida/${melhorAdr.matchId}` : undefined}
          />
        )}
        {maiorSequencia && (
          <CardDestaque
            rotulo="Maior sequência de vitórias"
            nick={`${maiorSequencia.vitorias} seguida${maiorSequencia.vitorias === 1 ? '' : 's'}`}
            valor={`${dataHora(maiorSequencia.inicio)} até ${dataHora(maiorSequencia.fim)}`}
            to={maiorSequencia.fimMatchId ? `/partida/${maiorSequencia.fimMatchId}` : undefined}
          />
        )}
        {maisClutchesNaNoite && (
          <CardDestaque
            rotulo="Mais clutches numa Resenha"
            nick={maisClutchesNaNoite.nick}
            valor={`${maisClutchesNaNoite.clutches} clutch${maisClutchesNaNoite.clutches === 1 ? '' : 'es'} · ${dataHora(maisClutchesNaNoite.sessaoInicio)}`}
            to={maisClutchesNaNoite.matchId ? `/partida/${maisClutchesNaNoite.matchId}` : undefined}
          />
        )}
      </div>
    </section>
  )
}

// "A gente é muito pior de T na Mirage?" (FIL-51) — winrate do grupo por lado (CT/T)
// em cada mapa. Só aparece mapa a mapa quando há dado (partidas reprocessadas depois
// do FIL-51, side_a); grupo sem nenhum dado ainda esconde a seção toda.
function LadoPorMapa() {
  const [linhas, setLinhas] = useState(null)

  useEffect(() => {
    fetch('/api/lado-mapa')
      .then((res) => (res.ok ? res.json() : []))
      .then(setLinhas)
      .catch(() => setLinhas([]))
  }, [])

  if (!linhas || linhas.length === 0) return null

  const porMapa = new Map()
  for (const l of linhas) {
    if (!porMapa.has(l.map)) porMapa.set(l.map, {})
    porMapa.get(l.map)[l.lado] = l
  }

  return (
    <section>
      <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
        Winrate por lado
      </h3>
      <div className="panel-cut border border-borda">
        <DataTable
          head={
            <tr>
              <th className="px-3 py-2">Mapa</th>
              <th className="px-2 py-2 text-right">CT</th>
              <th className="px-2 py-2 text-right">T</th>
            </tr>
          }
        >
          {[...porMapa.entries()].map(([mapa, lados]) => (
            <tr key={mapa}>
              <td className="px-3 py-2">{nomeMapa(mapa)}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                {lados.CT ? (
                  <span className={lados.CT.winrate >= 50 ? 'text-sucesso' : 'text-perigo'}>
                    {lados.CT.winrate}% <span className="text-texto-fraco">({lados.CT.vitorias}/{lados.CT.rounds})</span>
                  </span>
                ) : <span className="text-texto-fraco">—</span>}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {lados.T ? (
                  <span className={lados.T.winrate >= 50 ? 'text-sucesso' : 'text-perigo'}>
                    {lados.T.winrate}% <span className="text-texto-fraco">({lados.T.vitorias}/{lados.T.rounds})</span>
                  </span>
                ) : <span className="text-texto-fraco">—</span>}
              </td>
            </tr>
          ))}
        </DataTable>
      </div>
    </section>
  )
}

export default function Ranking() {
  const { jogador } = useAuth()
  const [ranking, setRanking] = useState(null)
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')

  useEffect(() => {
    const qs = new URLSearchParams()
    if (de) qs.set('from', de)
    if (ate) qs.set('to', ate)
    fetch(`/api/ranking${qs.size ? `?${qs}` : ''}`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setRanking)
      .catch(() => setRanking([]))
  }, [de, ate])

  if (ranking === null) return <p className="font-mono text-sm text-texto-fraco">Carregando…</p>

  const comPartida = ranking.filter((r) => r.partidas > 0)
  const semPartida = ranking.filter((r) => r.partidas === 0)
  const maisAces = [...comPartida].sort((a, b) => b.aces - a.aces)[0]
  const maisClutches = [...comPartida].sort((a, b) => b.clutchWins - a.clutchWins)[0]
  const melhorWinrate = [...comPartida].filter((r) => r.partidas >= 3).sort((a, b) => b.winrate - a.winrate)[0]
  // Categorias "peixe grande, lago pequeno": olham a TAXA, não o total — com piso
  // mínimo de amostra pra não premiar quem teve sorte numa tentativa só.
  const melhorClutchPct = [...comPartida].filter((r) => r.clutchAttempts >= 5).sort((a, b) => b.clutchPct - a.clutchPct)[0]
  const melhorEntryRate = [...comPartida].filter((r) => r.entryKills + r.entryDeaths >= 10).sort((a, b) => b.entryWinPct - a.entryWinPct)[0]

  return (
    <div className="space-y-6">
      <SectionHeader
        titulo="Ranking do grupo"
        className="mb-0 flex-wrap"
        acao={<FiltroPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />}
      />

      <Recordes />
      <LadoPorMapa />

      {comPartida.length === 0 && (
        <p className="font-mono text-sm text-texto-fraco">Ninguém do grupo tem Partidas registradas {de || ate ? 'nesse período' : 'ainda'}.</p>
      )}

      {comPartida.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {maisAces?.aces > 0 && (
            <CardDestaque
              rotulo="Mais ACEs"
              nick={maisAces.nick}
              valor={`${maisAces.aces} ace${maisAces.aces > 1 ? 's' : ''}`}
              to={`/jogador/${maisAces.steamId}`}
            />
          )}
          {maisClutches?.clutchWins > 0 && (
            <CardDestaque
              rotulo="Mais clutches"
              nick={maisClutches.nick}
              valor={`${maisClutches.clutchWins}/${maisClutches.clutchAttempts} tentativas · ${maisClutches.clutchPct}%`}
              to={`/jogador/${maisClutches.steamId}`}
            />
          )}
          {melhorWinrate && (
            <CardDestaque
              rotulo="Melhor winrate (3+ partidas)"
              nick={melhorWinrate.nick}
              valor={`${melhorWinrate.winrate}%`}
              to={`/jogador/${melhorWinrate.steamId}`}
            />
          )}
          {melhorClutchPct && (
            <CardDestaque
              rotulo="Melhor clutch% (5+ tentativas)"
              nick={melhorClutchPct.nick}
              valor={`${melhorClutchPct.clutchPct}% (${melhorClutchPct.clutchWins}/${melhorClutchPct.clutchAttempts})`}
              to={`/jogador/${melhorClutchPct.steamId}`}
            />
          )}
          {melhorEntryRate && (
            <CardDestaque
              rotulo="Melhor entry rate (10+ duelos)"
              nick={melhorEntryRate.nick}
              valor={`${melhorEntryRate.entryWinPct}% (${melhorEntryRate.entryKills}/${melhorEntryRate.entryKills + melhorEntryRate.entryDeaths})`}
              to={`/jogador/${melhorEntryRate.steamId}`}
            />
          )}
        </div>
      )}

      {comPartida.length > 0 && (
        <div className="space-y-3 lg:hidden">
          {comPartida.map((r, i) => (
            <CardJogador key={r.steamId} r={r} posicao={i} souEu={r.steamId === jogador?.steamId} />
          ))}
        </div>
      )}

      {comPartida.length > 0 && (
        <div className="panel-cut hidden border border-borda lg:block">
          <DataTable
            head={
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Jogador</th>
                <th className="px-2 py-2 text-right">Partidas</th>
                <th className="px-2 py-2 text-right">Winrate</th>
                <th className="px-2 py-2 text-right">K/D</th>
                <th className="hidden px-2 py-2 text-right sm:table-cell">HS%</th>
                <th className="hidden px-2 py-2 text-right sm:table-cell">ACEs</th>
                <th className="hidden px-2 py-2 text-right sm:table-cell">Clutches</th>
                <th className="px-3 py-2 text-right">Rating</th>
              </tr>
            }
          >
            {comPartida.map((r, i) => (
              <tr key={r.steamId}>
                <td className="px-3 py-2"><Medalha posicao={i} /></td>
                <td className="px-3 py-2">
                  <Link to={`/jogador/${r.steamId}`} className="flex items-center gap-2 font-mono text-texto hover:text-destaque">
                    {r.avatarUrl && (
                      <img src={r.avatarUrl} alt="" className="panel-cut-sm h-6 w-6 border border-borda object-cover" />
                    )}
                    {r.nick || r.steamId}
                    <TagEstilo estilo={r.estilo} />
                  </Link>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{r.partidas}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${r.winrate >= 50 ? 'text-sucesso' : 'text-perigo'}`}>{r.winrate}%</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.kd}</td>
                <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">{r.hsPct}%</td>
                <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">{r.aces}</td>
                <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell" title="Clutches vencidos / tentativas (1vX)">
                  {r.clutchWins}/{r.clutchAttempts}
                  {r.clutchAttempts > 0 && (
                    <span className={`ml-1.5 text-xs ${r.clutchPct >= 50 ? 'text-sucesso' : 'text-texto-fraco'}`}>{r.clutchPct}%</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <RatingBadge valor={r.rating} />
                  <SetaForma forma={r.forma} />
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}

      {semPartida.length > 0 && (
        <p className="font-mono text-xs text-texto-fraco">
          Ainda sem partidas: {semPartida.map((r) => r.nick || r.steamId).join(', ')}
        </p>
      )}
    </div>
  )
}
