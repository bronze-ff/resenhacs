import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'
import TagEstilo from '../components/TagEstilo.jsx'
import { nomeMapa, dataHora } from '../lib/format.js'
import { CabecalhoPagina, Card, DataTable, EstadoVazio, RatingBadge, SectionHeader, Skeleton, SkeletonLista } from '../components/ui'

// Tokens de medalha (--color-ouro/prata/bronze em index.css) em vez de cores hardcoded
// da paleta padrão do Tailwind — mesmo esquema de token usado pro resto da paleta do app.
const MEDALHAS = {
  0: { texto: 'text-ouro', borda: 'border-ouro/50', fundo: 'bg-ouro/[0.06]', nome: 'Ouro' },
  1: { texto: 'text-prata', borda: 'border-prata/40', fundo: 'bg-prata/[0.04]', nome: 'Prata' },
  2: { texto: 'text-bronze', borda: 'border-bronze/45', fundo: 'bg-bronze/[0.05]', nome: 'Bronze' },
}

function Medalha({ posicao }) {
  const m = MEDALHAS[posicao]
  if (!m) return <span className="font-mono tabular-nums text-texto-fraco">{posicao + 1}</span>
  return <span className={`font-display text-lg font-semibold tabular-nums ${m.texto}`}>{posicao + 1}º</span>
}

// Seta de julgamento (bom/ruim) — a cor nunca vai sozinha (regra do sinal duplo).
function Juizo({ bom }) {
  return (
    <span aria-hidden="true" className="mr-1 text-[11px]">
      {bom ? '▲' : '▼'}
    </span>
  )
}

// Avatar do ranking com fallback pra quem nunca logou no site (avatarUrl null) — mesmo
// padrão do Avatar em Partida.jsx (Economia/Utilitária), mas quadrado maior pro card.
function AvatarRanking({ r, tamanho = 'h-14 w-14', texto = 'text-xl' }) {
  const titulo = r.nick || r.steamId
  if (r.avatarUrl) {
    return <img src={r.avatarUrl} alt="" className={`panel-cut-sm ${tamanho} shrink-0 border border-borda object-cover`} />
  }
  return (
    <span className={`panel-cut-sm flex ${tamanho} shrink-0 items-center justify-center border border-borda bg-superficie-alta font-display ${texto} font-bold text-texto-fraco`}>
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
      <div className="rotulo">{rotulo}</div>
      <div className={`mt-0.5 truncate font-display text-lg font-semibold leading-tight tabular-nums ${cor ?? 'text-texto'}`}>{valor}</div>
    </div>
  )
}

// Degrau do pódio (top 3). No desktop a ordem visual é 2-1-3 com o 1º mais alto; no
// mobile empilha 1-2-3. Destaca o próprio usuário logado com o rótulo "você".
function DegrauPodio({ r, posicao, souEu }) {
  const m = MEDALHAS[posicao]
  const primeiro = posicao === 0
  const ordem = { 0: 'sm:order-2', 1: 'sm:order-1', 2: 'sm:order-3' }[posicao]
  return (
    <Link
      to={`/jogador/${r.steamId}`}
      className={`panel-cut realce-topo group relative flex flex-col gap-4 border ${m.borda} ${m.fundo} p-4 transition-colors duration-200 hover:bg-superficie-alta sm:p-5 ${ordem} ${primeiro ? 'sm:pb-8' : 'sm:mt-8'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AvatarRanking r={r} tamanho={primeiro ? 'h-16 w-16' : 'h-14 w-14'} texto="text-2xl" />
          <div className="min-w-0">
            <div className="rotulo">
              <span className={m.texto}>{m.nome}</span>
              {souEu && <span className="ml-2 text-destaque">· você</span>}
            </div>
            <div className="mt-1 truncate font-display text-2xl font-semibold leading-none text-texto group-hover:text-destaque">
              {r.nick || r.steamId}
            </div>
            <div className="mt-1.5"><TagEstilo estilo={r.estilo} /></div>
          </div>
        </div>
        <span className={`font-display font-semibold leading-none tabular-nums ${m.texto} ${primeiro ? 'text-6xl' : 'text-5xl'}`}>
          {posicao + 1}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-3 border-t border-borda pt-3">
        <div className="min-w-0">
          <div className="rotulo">Rating</div>
          <span className="mt-1 inline-flex items-center">
            <RatingBadge valor={r.rating} className="text-sm" />
            <SetaForma forma={r.forma} />
          </span>
        </div>
        <Stat rotulo="K/D" valor={r.kd} />
        <Stat
          rotulo="Winrate"
          valor={<><Juizo bom={r.winrate >= 50} />{r.winrate}%</>}
          cor={r.winrate >= 50 ? 'text-sucesso' : 'text-perigo'}
        />
        <Stat rotulo="Partidas" valor={r.partidas} />
      </div>
    </Link>
  )
}

// Card mobile (estilo app FACEIT): avatar + posição/nick + grade de 4 stats.
// Destaca o próprio usuário logado com borda no destaque.
function CardJogador({ r, posicao, souEu }) {
  return (
    <Card
      as={Link}
      interativo={!souEu}
      to={`/jogador/${r.steamId}`}
      className={`flex gap-3 p-4 ${souEu ? '!border-destaque/70 !bg-superficie-alta' : ''}`}
    >
      <AvatarRanking r={r} tamanho="h-12 w-12" texto="text-lg" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-xs tabular-nums text-texto-fraco">#{posicao + 1}</span>
          <span className="min-w-0 flex-1 truncate font-display text-lg font-semibold text-texto">{r.nick || r.steamId}</span>
          <TagEstilo estilo={r.estilo} />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          <div className="min-w-0">
            <div className="rotulo">Rating</div>
            <span className="mt-0.5 inline-flex items-center">
              <RatingBadge valor={r.rating} className="text-sm" />
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
      <div className="rotulo">{rotulo}</div>
      <div className="mt-2 truncate font-display text-xl font-semibold leading-none text-texto">{nick}</div>
      <div className="mt-1.5 font-mono text-xs text-texto-fraco">{valor}</div>
    </>
  )
  if (to) {
    return (
      <Card as={Link} interativo to={to} className="block p-4">
        {conteudo}
      </Card>
    )
  }
  return <Card className="p-4">{conteudo}</Card>
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
      <SectionHeader titulo="Recordes do grupo" subtitulo="Marcas de todas as Partidas — não seguem o período." />
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

function CelulaLado({ l }) {
  if (!l) return <span className="text-texto-fraco">—</span>
  const bom = l.winrate >= 50
  return (
    <span className={bom ? 'text-sucesso' : 'text-perigo'}>
      <Juizo bom={bom} />
      {l.winrate}% <span className="text-texto-fraco">({l.vitorias}/{l.rounds})</span>
    </span>
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
      <SectionHeader titulo="Winrate por lado" subtitulo="Rounds vencidos pelo grupo de CT e de T em cada mapa." />
      <div className="panel-cut border border-borda bg-superficie">
        <DataTable
          head={
            <tr>
              <th className="px-4 py-2.5">Mapa</th>
              <th className="px-3 py-2.5 text-right">CT</th>
              <th className="px-4 py-2.5 text-right">T</th>
            </tr>
          }
        >
          {[...porMapa.entries()].map(([mapa, lados]) => (
            <tr key={mapa}>
              <td className="px-4 py-2.5 font-display font-semibold text-texto">{nomeMapa(mapa)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums"><CelulaLado l={lados.CT} /></td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums"><CelulaLado l={lados.T} /></td>
            </tr>
          ))}
        </DataTable>
      </div>
    </section>
  )
}

function CarregandoRanking() {
  return (
    <div className="space-y-6" role="status" aria-label="Carregando ranking">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="panel-cut h-44 sm:mt-8" />
        <Skeleton className="panel-cut h-52" />
        <Skeleton className="panel-cut h-44 sm:mt-8" />
      </div>
      <SkeletonLista linhas={5} altura="h-12" rotulo="Carregando ranking" />
    </div>
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

  if (ranking === null) return <CarregandoRanking />

  const comPartida = ranking.filter((r) => r.partidas > 0)
  const semPartida = ranking.filter((r) => r.partidas === 0)
  const maisAces = [...comPartida].sort((a, b) => b.aces - a.aces)[0]
  const maisClutches = [...comPartida].sort((a, b) => b.clutchWins - a.clutchWins)[0]
  const melhorWinrate = [...comPartida].filter((r) => r.partidas >= 3).sort((a, b) => b.winrate - a.winrate)[0]
  // Categorias "peixe grande, lago pequeno": olham a TAXA, não o total — com piso
  // mínimo de amostra pra não premiar quem teve sorte numa tentativa só.
  const melhorClutchPct = [...comPartida].filter((r) => r.clutchAttempts >= 5).sort((a, b) => b.clutchPct - a.clutchPct)[0]
  const melhorEntryRate = [...comPartida].filter((r) => r.entryKills + r.entryDeaths >= 10).sort((a, b) => b.entryWinPct - a.entryWinPct)[0]

  // Pódio só com 3+ Jogadores; abaixo disso a lista sozinha já conta a história.
  const podio = comPartida.length >= 3 ? comPartida.slice(0, 3) : []
  const restoMobile = comPartida.slice(podio.length)

  return (
    <div className="space-y-8">
      <CabecalhoPagina
        eyebrow="Ranking"
        titulo="Ranking do grupo"
        descricao="Quem está carregando a resenha, por rating médio no período."
        acoes={<FiltroPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />}
        className="!mb-0"
      />

      {comPartida.length === 0 && (
        <EstadoVazio
          titulo="Sem Partidas no ranking"
          descricao={`Ninguém do grupo tem Partidas registradas ${de || ate ? 'nesse período' : 'ainda'}.`}
        />
      )}

      {podio.length > 0 && (
        <section aria-label="Pódio" className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
          {podio.map((r, i) => (
            <DegrauPodio key={r.steamId} r={r} posicao={i} souEu={r.steamId === jogador?.steamId} />
          ))}
        </section>
      )}

      {comPartida.length > 0 && (
        <section>
          <SectionHeader titulo="Classificação" />
          {restoMobile.length > 0 && (
            <div className="space-y-2 lg:hidden">
              {restoMobile.map((r) => {
                const i = comPartida.indexOf(r)
                return <CardJogador key={r.steamId} r={r} posicao={i} souEu={r.steamId === jogador?.steamId} />
              })}
            </div>
          )}

          <div className="panel-cut hidden border border-borda bg-superficie lg:block">
            <DataTable
              head={
                <tr>
                  <th className="w-14 px-4 py-2.5">#</th>
                  <th className="px-3 py-2.5">Jogador</th>
                  <th className="px-3 py-2.5 text-right">Partidas</th>
                  <th className="px-3 py-2.5 text-right">Winrate</th>
                  <th className="px-3 py-2.5 text-right">K/D</th>
                  <th className="px-3 py-2.5 text-right">HS%</th>
                  <th className="px-3 py-2.5 text-right">ACEs</th>
                  <th className="px-3 py-2.5 text-right">Clutches</th>
                  <th className="px-4 py-2.5 text-right">Rating</th>
                </tr>
              }
            >
              {comPartida.map((r, i) => {
                const souEu = r.steamId === jogador?.steamId
                return (
                  <tr key={r.steamId} className={souEu ? 'bg-destaque/[0.06]' : ''}>
                    <td className="px-4 py-2.5"><Medalha posicao={i} /></td>
                    <td className="px-3 py-2.5">
                      <Link to={`/jogador/${r.steamId}`} className="flex items-center gap-2.5 font-display text-base font-semibold text-texto hover:text-destaque">
                        <AvatarRanking r={r} tamanho="h-7 w-7" texto="text-xs" />
                        {r.nick || r.steamId}
                        <TagEstilo estilo={r.estilo} />
                        {souEu && <span className="font-mono text-[11px] normal-case tracking-normal text-destaque">você</span>}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-texto-fraco">{r.partidas}</td>
                    <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${r.winrate >= 50 ? 'text-sucesso' : 'text-perigo'}`}>
                      <Juizo bom={r.winrate >= 50} />{r.winrate}%
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-texto">{r.kd}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-texto-fraco">{r.hsPct}%</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-texto-fraco">{r.aces}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-texto-fraco" title="Clutches vencidos / tentativas (1vX)">
                      {r.clutchWins}/{r.clutchAttempts}
                      {r.clutchAttempts > 0 && (
                        <span className={`ml-1.5 text-xs ${r.clutchPct >= 50 ? 'text-sucesso' : 'text-texto-fraco'}`}>{r.clutchPct}%</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <RatingBadge valor={r.rating} />
                      <SetaForma forma={r.forma} />
                    </td>
                  </tr>
                )
              })}
            </DataTable>
          </div>

          {semPartida.length > 0 && (
            <p className="mt-3 font-mono text-xs text-texto-fraco">
              Ainda sem partidas: {semPartida.map((r) => r.nick || r.steamId).join(', ')}
            </p>
          )}
        </section>
      )}

      {comPartida.length > 0 && (maisAces?.aces > 0 || maisClutches?.clutchWins > 0 || melhorWinrate || melhorClutchPct || melhorEntryRate) && (
        <section>
          <SectionHeader titulo="Destaques do período" />
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
        </section>
      )}

      <Recordes />
      <LadoPorMapa />
    </div>
  )
}
