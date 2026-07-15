import { useEffect, useRef, useState, Fragment } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { nomeMapa, dataHora, origemPartida, nomeArma, corRating, TIPO_COMPRA } from '../lib/format.js'
import { MapIcon, SectionHeader } from '../components/ui'
import ReplayViewer from '../components/ReplayViewer.jsx'
import MapaCalor from '../components/MapaCalor.jsx'
import { useAuth } from '../auth/AuthContext.jsx'

function SecaoReplay({ replayUrl, seek, onSelecionarPonto }) {
  const [replay, setReplay] = useState(null)
  const [erro, setErro] = useState(false)
  const [aba, setAba] = useState('replay') // replay | calor

  useEffect(() => {
    if (!replayUrl) return
    setReplay(null)
    setErro(false)
    fetch(replayUrl)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setReplay)
      .catch(() => setErro(true))
  }, [replayUrl])

  // Deep link de um Highlight sempre volta pra aba do replay animado.
  useEffect(() => {
    if (seek) setAba('replay')
  }, [seek?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!replayUrl) {
    return (
      <p className="font-mono text-sm text-texto-fraco">
        Replay 2D indisponível — gerado pelo Coletor quando o demo é processado (Fase 4).
      </p>
    )
  }
  if (erro) return <p className="font-mono text-sm text-perigo">Não foi possível carregar o replay.</p>
  if (!replay) return <p className="font-mono text-sm text-texto-fraco">Carregando replay…</p>

  return (
    <div className="space-y-3">
      <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
        {[['replay', 'Replay 2D'], ['calor', 'Mapa de calor']].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setAba(v)}
            className={`flex min-h-10 items-center px-3 py-1.5 transition-colors lg:min-h-0 ${aba === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {aba === 'replay' ? (
        <ReplayViewer replay={replay} seek={seek} />
      ) : (
        <MapaCalor replay={replay} onSelecionarPonto={onSelecionarPonto} />
      )}
    </div>
  )
}

// Avatar do jogador (mesmo padrão do Ranking: panel-cut-sm + border + object-cover) com
// fallback pra quem nunca logou no site (avatarUrl null — comum, ~metade do placar de uma
// partida costuma ser adversário sem conta) — mostra a inicial do nick tingida na cor do
// time em vez de sumir/quebrar o layout. Compartilhado entre Scoreboard, Economia e Utilitária.
function Avatar({ p }) {
  const titulo = p?.nick || p?.steamId || '?'
  if (p?.avatarUrl) {
    return (
      <img
        src={p.avatarUrl}
        alt=""
        title={titulo}
        className="panel-cut-sm h-6 w-6 flex-shrink-0 border border-borda object-cover"
      />
    )
  }
  const inicial = titulo.charAt(0).toUpperCase()
  const cor =
    p?.team === 'A'
      ? 'border-time-a/50 bg-time-a/10 text-time-a'
      : p?.team === 'B'
        ? 'border-time-b/50 bg-time-b/10 text-time-b'
        : 'border-borda bg-superficie-alta text-texto-fraco'
  return (
    <span
      title={titulo}
      className={`panel-cut-sm flex h-6 w-6 flex-shrink-0 items-center justify-center border font-display text-[10px] font-bold ${cor}`}
    >
      {inicial}
    </span>
  )
}

function SteamIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M11.98 2C6.68 2 2.32 5.94 1.5 11.03l5.62 2.32a3.05 3.05 0 0 1 1.75-.55c.06 0 .12 0 .18.01l2.5-3.63v-.05a3.83 3.83 0 1 1 3.83 3.83h-.07l-3.57 2.55v.16a3.05 3.05 0 1 1-6.1.24L.1 14.5C.85 18.85 4.65 22 11.98 22c6.63 0 12-5.37 12-12s-5.37-8-12-8zm-2.4 15.44-1.3-.54a2.3 2.3 0 0 0 4.24-1.65l1.3.53a3.62 3.62 0 0 1-4.24 1.66zm7.65-8.6a2.5 2.5 0 1 0 0 5.01 2.5 2.5 0 0 0 0-5.01zm0 4.13a1.62 1.62 0 1 1 0-3.24 1.62 1.62 0 0 1 0 3.24z" />
    </svg>
  )
}

// Nome do Jogador: sempre um link pro perfil dele no Resenha (mesmo se for adversário/fora
// do grupo — o perfil já sabe lidar com quem nunca fez onboarding), + link direto pro
// perfil Steam (ícone separado, pra não competir com o clique do nome).
function NomeJogador({ p, mostrarTagGrupo = true, className = '' }) {
  return (
    <span className={`flex items-center gap-2 font-mono ${className}`.trim()}>
      <Link
        to={`/jogador/${p.steamId}`}
        className="flex items-center gap-2 text-texto transition-colors hover:text-destaque"
      >
        <Avatar p={p} />
        {p.nick || p.steamId}
      </Link>
      {mostrarTagGrupo && p.isTracked && (
        <span className="text-[10px] uppercase tracking-widest text-destaque">grupo</span>
      )}
      <a
        href={`https://steamcommunity.com/profiles/${p.steamId}`}
        target="_blank"
        rel="noreferrer"
        title="Abrir perfil na Steam"
        className="text-texto-fraco/60 transition-colors hover:text-texto"
        onClick={(e) => e.stopPropagation()}
      >
        <SteamIcon className="h-3.5 w-3.5" />
      </a>
    </span>
  )
}

// Seta que gira 90° quando aberto — mesmo ícone pros dois estados, só rotaciona.
function SetaExpandir({ aberto }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${aberto ? 'rotate-90' : ''}`}
    >
      <path d="M9 5L15 12L9 19" />
    </svg>
  )
}

// Recolhido por padrão: kills por arma NESSA partida (não é a agregação de carreira do
// perfil) — serve pra conferir na hora "com que arma ele matou" (ex.: alguém alega só ter
// jogado de uma arma específica e o grupo quer confirmar).
function ArmasDoJogador({ weapons, onAbrirDetalhe }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-1 py-2">
      {(!weapons || weapons.length === 0) ? (
        <p className="font-mono text-xs text-texto-fraco">Sem kills registrados nessa partida.</p>
      ) : (
        weapons.map((w) => (
          <div
            key={w.weapon}
            className="panel-cut-sm flex items-center gap-2 border border-borda bg-superficie px-2 py-1 font-mono text-xs"
          >
            <span className="font-semibold text-texto">{nomeArma(w.weapon)}</span>
            <span className="text-texto-fraco">{w.kills} kill{w.kills === 1 ? '' : 's'}</span>
            {w.hsKills > 0 && <span className="text-texto-fraco">· {w.hsKills} HS</span>}
          </div>
        ))
      )}
      <button
        onClick={onAbrirDetalhe}
        className="ml-auto panel-cut-sm border border-borda px-2 py-1 font-mono text-xs text-texto-fraco transition-colors hover:border-destaque hover:text-destaque"
      >
        Ver detalhe por round →
      </button>
    </div>
  )
}

const ROTULO_COMPRA = { eco: 'Eco', forcado: 'Forçada', semi: 'Semi', full: 'Full' }

const CATEGORIAS_ARMA_ORDEM = ['Rifles', 'Snipers', 'SMGs', 'Pistolas', 'Shotguns', 'Pesadas', 'Outras']

// Uma linha do comparativo: barra espelhada (A cresce pra esquerda, B pra direita) a
// partir de um valor central — mesma ideia visual do Head to Head do Leetify.
function LinhaComparativa({ label, valorA, valorB }) {
  const max = Math.max(valorA, valorB, 1)
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span className="w-8 shrink-0 text-right tabular-nums text-texto">{valorA}</span>
      <div className="flex h-3 flex-1 flex-row-reverse overflow-hidden rounded-sm bg-fundo">
        <div className="h-full bg-time-a" style={{ width: `${(valorA / max) * 100}%` }} />
      </div>
      <span className="w-16 shrink-0 text-center uppercase tracking-wide text-texto-fraco">{label}</span>
      <div className="flex h-3 flex-1 overflow-hidden rounded-sm bg-fundo">
        <div className="h-full bg-time-b" style={{ width: `${(valorB / max) * 100}%` }} />
      </div>
      <span className="w-8 shrink-0 tabular-nums text-texto">{valorB}</span>
    </div>
  )
}

// Aba Head to Head: jogador de referência (default = você, se jogou essa
// Partida) comparado contra TODOS os adversários do time contrário de uma
// vez — kills/dano em cada linha, expande pra ver o weapon breakdown +
// flashes trocados com aquele adversário específico.
function AbaHeadToHead({ matchId, jogadores, jogadorLogado }) {
  const jogouEssaPartida = jogadores.some((p) => p.steamId === jogadorLogado?.steamId)
  const [referenciaId, setReferenciaId] = useState(jogouEssaPartida ? jogadorLogado.steamId : '')
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(false)
  const [expandido, setExpandido] = useState(null)

  useEffect(() => {
    if (!referenciaId) {
      setDados(null)
      return
    }
    setDados(null)
    setErro(false)
    setExpandido(null)
    fetch(`/api/matches/${matchId}/head-to-head/${referenciaId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setDados)
      .catch(() => setErro(true))
  }, [matchId, referenciaId])

  const referencia = jogadores.find((p) => p.steamId === referenciaId)

  return (
    <div className="space-y-3">
      <label className="flex flex-wrap items-center gap-2 font-mono text-xs text-texto-fraco">
        Comparando:
        <select
          value={referenciaId}
          onChange={(e) => setReferenciaId(e.target.value)}
          className="cursor-pointer rounded border border-borda bg-superficie px-2 py-1.5 font-mono text-xs text-texto"
        >
          <option value="">Escolha um jogador…</option>
          {jogadores.map((p) => (
            <option key={p.steamId} value={p.steamId}>{p.nick || p.steamId}</option>
          ))}
        </select>
      </label>

      {!referenciaId && <p className="font-mono text-sm text-texto-fraco">Escolha um jogador pra comparar contra o time adversário.</p>}
      {referenciaId && erro && <p className="font-mono text-sm text-perigo">Não foi possível carregar o comparativo.</p>}
      {referenciaId && !erro && !dados && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
      {dados && dados.oponentes.length === 0 && <p className="font-mono text-sm text-texto-fraco">Sem adversários pra comparar.</p>}

      {dados?.oponentes.map((o) => {
        const aberto = expandido === o.steamId
        const categorias = CATEGORIAS_ARMA_ORDEM.filter((c) => o.killsPorCategoria[c] || o.killsPorCategoriaRecebido[c])
        const semFlash = o.flashes.porMim.vezes === 0 && o.flashes.porEle.vezes === 0
        return (
          <div key={o.steamId} className="panel-cut-sm border border-borda bg-superficie">
            <button
              onClick={() => setExpandido(aberto ? null : o.steamId)}
              className="flex w-full flex-wrap items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-superficie-alta"
            >
              <span className="flex min-w-0 items-center gap-2 font-mono text-sm">
                <Avatar p={referencia} />
                <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-texto">{o.kills}</span>
              </span>
              <div className="flex h-3 min-w-[80px] flex-1 flex-row-reverse overflow-hidden rounded-sm bg-fundo">
                <div className="h-full bg-time-a" style={{ width: `${(o.dano / Math.max(o.dano, o.danoRecebido, 1)) * 100}%` }} />
              </div>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-texto-fraco">dano</span>
              <div className="flex h-3 min-w-[80px] flex-1 overflow-hidden rounded-sm bg-fundo">
                <div className="h-full bg-time-b" style={{ width: `${(o.danoRecebido / Math.max(o.dano, o.danoRecebido, 1)) * 100}%` }} />
              </div>
              <span className="flex min-w-0 items-center gap-2 font-mono text-sm">
                <span className="w-6 shrink-0 tabular-nums text-texto">{o.deaths}</span>
                <Avatar p={o} />
                <span className="truncate text-texto">{o.nick || o.steamId}</span>
              </span>
              <SetaExpandir aberto={aberto} />
            </button>
            {aberto && (
              <div className="space-y-1.5 border-t border-borda/60 px-3 py-2.5">
                {categorias.length === 0 && (
                  <p className="font-mono text-xs text-texto-fraco">Nenhuma kill entre os dois nessa Partida.</p>
                )}
                {categorias.map((cat) => (
                  <LinhaComparativa key={cat} label={cat} valorA={o.killsPorCategoria[cat] ?? 0} valorB={o.killsPorCategoriaRecebido[cat] ?? 0} />
                ))}
                {semFlash ? (
                  <p className="font-mono text-xs text-texto-fraco">Nenhum dos dois flashou o outro.</p>
                ) : (
                  <LinhaComparativa label="Flashes" valorA={o.flashes.porMim.vezes} valorB={o.flashes.porEle.vezes} />
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Modal separado (aberto sob demanda): timeline round-a-round de UM Jogador — o que
// comprou, quando matou/morreu e com quê. Busca lazy (só quando abre pra esse Jogador).
function ModalDetalhePartida({ matchId, jogador, onFechar }) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    setDados(null)
    setErro(false)
    fetch(`/api/matches/${matchId}/jogador/${jogador.steamId}/detalhe`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setDados)
      .catch(() => setErro(true))
  }, [matchId, jogador.steamId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fundo/80 p-0 lg:p-4" onClick={onFechar}>
      <div
        className="flex h-full w-full flex-col overflow-y-hidden border border-borda bg-superficie lg:panel-cut lg:h-auto lg:max-h-[90vh] lg:w-full lg:max-w-2xl lg:overflow-y-auto lg:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-borda bg-superficie px-4 py-3 lg:static lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar p={jogador} />
            <div className="min-w-0">
              <h3 className="truncate font-display text-lg font-bold text-texto">{jogador.nick || jogador.steamId}</h3>
              {jogador.duelWinPct !== null && (
                <p className="font-mono text-xs text-texto-fraco" title="De todo confronto que terminou em morte envolvendo ele (matou ou morreu), quantos % ele venceu (saiu vivo)">
                  Duelos vencidos: <span className="text-texto">{jogador.duelWinPct}%</span> ({jogador.kills}V/{jogador.deaths}D)
                </p>
              )}
            </div>
          </div>
          <button onClick={onFechar} className="flex min-h-10 min-w-10 shrink-0 items-center justify-center font-mono text-sm uppercase text-texto-fraco hover:text-texto">
            fechar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 lg:px-0 lg:py-3">
          {erro && <p className="font-mono text-sm text-perigo">Não foi possível carregar o detalhe.</p>}
          {!erro && !dados && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
          {dados && dados.rounds.length === 0 && (
            <p className="font-mono text-sm text-texto-fraco">Sem dados round-a-round pra essa partida (demo antiga).</p>
          )}
          {dados && dados.rounds.length > 0 && (
            <>
              {/* Legenda fixa: explica de cara o que cada coluna/cor significa, sem
                  precisar perguntar — mesma dúvida que já apareceu uma vez. */}
              <p className="mb-3 font-mono text-[11px] leading-relaxed text-texto-fraco">
                Cada linha é um round: o tipo/valor da compra dele naquele round (com o
                detalhe de cada item), e do lado direito, em{' '}
                <span className="text-sucesso">verde</span> as kills (arma e se foi
                headshot) e em <span className="text-perigo">vermelho</span> a morte dele
                — arma de quem matou e, entre parênteses, a arma que ELE estava segurando
                na hora — quando ele sobrevive o round, não aparece nada em vermelho.
              </p>
              <div className="space-y-1.5">
                {dados.rounds.map((r) => (
                  <div key={r.roundNumber} className="panel-cut-sm flex flex-wrap items-center gap-2 border border-borda bg-fundo px-3 py-2 font-mono text-xs">
                    <span className="w-14 shrink-0 text-texto-fraco">Round {r.roundNumber}</span>
                    {r.buyType && (
                      <span className="text-texto-fraco">
                        {ROTULO_COMPRA[r.buyType] ?? r.buyType} (${r.equipValue ?? 0})
                      </span>
                    )}
                    {r.compras.length > 0 && (
                      <span className="text-texto-fraco/80">
                        · comprou: {r.compras.map((c, i) => (
                          <span key={i}>
                            {i > 0 && ', '}
                            {nomeArma(c.item)}{c.cost != null ? ` ($${c.cost})` : ''}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="ml-auto flex flex-wrap items-center justify-end gap-x-2">
                      {r.matou.map((k, i) => (
                        <span key={i} className="text-sucesso">matou: {nomeArma(k.weapon)}{k.headshot ? ' (HS)' : ''}</span>
                      ))}
                      {r.morreu && (
                        <span className="text-perigo">
                          morreu: {nomeArma(r.morreu.weapon)}
                          {r.morreu.victimWeapon && r.morreu.victimWeapon !== r.morreu.weapon && (
                            <> (segurando: {nomeArma(r.morreu.victimWeapon)})</>
                          )}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Scoreboard({ time, jogadores, matchId, podePromover, onPromover, promovendo }) {
  const [expandido, setExpandido] = useState(null)
  const [detalheAberto, setDetalheAberto] = useState(null)
  return (
    // O modal (fixed inset-0) precisa ficar FORA do painel com panel-cut: clip-path
    // cria um containing block novo pra descendentes fixed (igual transform/filter) —
    // por dentro do card, o modal ficava preso e minúsculo em vez de cobrir a tela.
    <>
    <div className="panel-cut overflow-x-auto border border-borda">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-superficie text-left font-mono text-[10px] uppercase tracking-wider text-texto-fraco">
            <th className="px-3 py-2">Time {time}</th>
            <th className="px-2 py-2 text-right">K</th>
            <th className="hidden px-2 py-2 text-right sm:table-cell" title="Team kills (não contam pro K nem pro rating)">TK</th>
            <th className="px-2 py-2 text-right">D</th>
            <th className="px-2 py-2 text-right">A</th>
            <th className="px-2 py-2 text-right">ADR</th>
            <th className="hidden px-2 py-2 text-right sm:table-cell">HS%</th>
            <th className="px-3 py-2 text-right">Rating</th>
          </tr>
        </thead>
        <tbody>
          {jogadores.map((p) => {
            const adr = p.roundsPlayed ? Math.round((p.damage / p.roundsPlayed) * 10) / 10 : 0
            const hs = p.kills ? Math.round((p.headshotKills / p.kills) * 100) : 0
            const aberto = expandido === p.steamId
            return (
              <Fragment key={p.steamId}>
                <tr className="border-t border-borda transition-colors hover:bg-superficie-alta">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandido(aberto ? null : p.steamId)}
                        title="Ver kills por arma nessa partida"
                        className="text-texto-fraco transition-colors hover:text-destaque"
                      >
                        <SetaExpandir aberto={aberto} />
                      </button>
                      <NomeJogador p={p} />
                      {!p.isTracked && podePromover && (
                        <button
                          onClick={() => onPromover(p.steamId)}
                          disabled={promovendo === p.steamId}
                          className="panel-cut-sm border border-borda px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-texto-fraco transition-colors hover:border-destaque hover:text-destaque disabled:opacity-50"
                        >
                          {promovendo === p.steamId ? '…' : '+ grupo'}
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{p.kills}</td>
                  <td className={`hidden px-2 py-2 text-right tabular-nums sm:table-cell ${p.teamKills > 0 ? 'text-perigo' : 'text-texto-fraco'}`}>
                    {p.teamKills || 0}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{p.deaths}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{p.assists}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{adr}</td>
                  <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">{hs}%</td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${corRating(p.rating)}`}>
                    {p.rating?.toFixed(2) ?? '–'}
                  </td>
                </tr>
                {aberto && (
                  <tr className="border-t border-borda/60 bg-fundo/40">
                    <td colSpan={8}>
                      <ArmasDoJogador weapons={p.weapons} onAbrirDetalhe={() => setDetalheAberto(p)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
    {detalheAberto && (
      <ModalDetalhePartida matchId={matchId} jogador={detalheAberto} onFechar={() => setDetalheAberto(null)} />
    )}
    </>
  )
}

// Popover local (nome + descrição) pra sugerir um round como Tática — abre ao clicar num
// round sem highlight na linha do tempo. Fica pendente de aprovação (Task 10/14 cuidam do
// fluxo de aprovação); aqui só dispara o POST e mostra confirmação.
// `variante` escolhe o posicionamento: "absoluta" (desktop, ancorado no round clicado —
// como era antes do M3) ou "bloco" (mobile, abaixo da faixa inteira de rounds).
function SugerirTatica({ matchId, map, roundNumber, onFechar, variante = 'bloco' }) {
  const classesSucesso =
    variante === 'absoluta'
      ? 'panel-cut absolute left-0 top-full z-10 mt-1 w-56 border border-sucesso/40 bg-superficie p-3 font-mono text-xs text-sucesso'
      : 'panel-cut mt-2 w-full border border-sucesso/40 bg-superficie p-3 font-mono text-xs text-sucesso sm:w-64'
  const classesForm =
    variante === 'absoluta'
      ? 'panel-cut absolute left-0 top-full z-10 mt-1 w-64 space-y-2 border border-borda bg-superficie p-3 text-left'
      : 'panel-cut mt-2 w-full space-y-2 border border-borda bg-superficie p-3 text-left sm:w-64'
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(null)
  const [sucesso, setSucesso] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    try {
      const res = await fetch('/api/taticas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, descricao, map, matchId, roundNumber }),
      })
      if (res.ok) {
        setSucesso(true)
      } else {
        const b = await res.json().catch(() => ({}))
        setErro(b.erro ?? 'Erro ao sugerir tática.')
      }
    } finally {
      setEnviando(false)
    }
  }

  if (sucesso) {
    return (
      <div className={classesSucesso}>
        Tática sugerida! Aguardando aprovação.
      </div>
    )
  }

  return (
    <form
      onSubmit={enviar}
      onClick={(e) => e.stopPropagation()}
      className={classesForm}
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-texto-fraco">Sugerir tática · round {roundNumber}</p>
      <input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Nome curto"
        required
        className="w-full rounded border border-borda bg-fundo px-2 py-1.5 font-mono text-xs"
      />
      <textarea
        value={descricao}
        onChange={(e) => setDescricao(e.target.value)}
        placeholder="Descrição"
        rows={2}
        className="w-full rounded border border-borda bg-fundo px-2 py-1.5 font-mono text-xs"
      />
      {erro && <p className="font-mono text-xs text-perigo">{erro}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="font-mono text-xs text-texto-fraco hover:text-texto">
          cancelar
        </button>
        <button
          type="submit"
          disabled={enviando}
          className="panel-cut-sm border border-destaque bg-destaque px-2 py-1 font-mono text-xs font-semibold uppercase text-fundo disabled:opacity-50"
        >
          {enviando ? '…' : 'sugerir'}
        </button>
      </div>
    </form>
  )
}

// Linha do tempo dos rounds: quem venceu cada um e o que aconteceu de notável nele
// (ace/multikill/clutch já detectados). Não é uma decomposição de rating round a round
// (isso exigiria guardar win-probability por kill, que não persistimos hoje) — é o
// "o que rolou em cada round" que dá pra montar com o que já temos.
function LinhaDoTempoRounds({ rounds, highlights, timeDoGrupo, onClicarHighlight, replayDisponivel, matchId, map }) {
  const [roundAberto, setRoundAberto] = useState(null)
  if (!rounds || rounds.length === 0) return null
  const porRound = new Map()
  for (const h of highlights) {
    if (!porRound.has(h.roundNumber)) porRound.set(h.roundNumber, [])
    porRound.get(h.roundNumber).push(h)
  }
  return (
    <div className="panel-cut border border-borda bg-superficie p-3">
      <div className="flex gap-1 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible">
        {rounds.map((r) => {
          const hs = porRound.get(r.roundNumber) ?? []
          const vencedorGrupo = timeDoGrupo ? r.winnerTeam === timeDoGrupo : null
          const cor =
            vencedorGrupo === true ? 'border-sucesso/50 bg-sucesso/10' : vencedorGrupo === false ? 'border-perigo/50 bg-perigo/10' : 'border-borda bg-fundo'
          const conteudo = (
            <div className={`panel-cut-sm flex h-9 w-9 flex-shrink-0 flex-col items-center justify-center border ${cor} font-mono text-[10px]`}>
              <span className="text-texto">{r.roundNumber}</span>
              {hs.length > 0 && <span className="leading-none text-destaque">●</span>}
            </div>
          )
          const primeiroComFrame = hs.find((h) => h.frame != null)
          return primeiroComFrame && replayDisponivel ? (
            <button key={r.roundNumber} className="flex-shrink-0" title={hs.map((h) => h.kind).join(', ')} onClick={() => onClicarHighlight(primeiroComFrame)}>
              {conteudo}
            </button>
          ) : (
            <div key={r.roundNumber} className="relative flex-shrink-0">
              <button
                className="flex-shrink-0"
                title={`${r.winReason ?? ''} — clique pra sugerir como tática`.trim()}
                onClick={() => setRoundAberto((v) => (v === r.roundNumber ? null : r.roundNumber))}
              >
                {conteudo}
              </button>
              {/* Desktop (lg+): popover absolute ancorado nesse round, como era antes do M3 —
                  só funciona sem clipping porque a faixa volta a overflow-visible no desktop
                  (ver comentário abaixo do map). */}
              {roundAberto === r.roundNumber && (
                <div className="hidden lg:block">
                  <SugerirTatica matchId={matchId} map={map} roundNumber={r.roundNumber} onFechar={() => setRoundAberto(null)} variante="absoluta" />
                </div>
              )}
            </div>
          )
        })}
      </div>
      {/* Mobile (abaixo de lg): a faixa rola horizontalmente (overflow-x-auto), então um
          popover absolute dentro dela seria clipado (regra CSS: eixo "visible" vira "auto"
          quando o outro eixo não é visible) — por isso aqui ele é renderizado em bloco, fora
          da faixa, abaixo dela inteira. No desktop (lg+) a faixa quebra linha (flex-wrap)
          com overflow visível, então o popover volta a ser absolute/ancorado no round
          clicado (variante "absoluta" acima, dentro do map). São dois mounts do mesmo
          componente — só um fica visível por vez conforme o breakpoint. */}
      {roundAberto != null && (
        <div className="lg:hidden">
          <SugerirTatica matchId={matchId} map={map} roundNumber={roundAberto} onFechar={() => setRoundAberto(null)} variante="bloco" />
        </div>
      )}
      <p className="mt-2 font-mono text-[11px] text-texto-fraco">
        Verde/vermelho = round vencido/perdido pelo grupo. ● = teve highlight nesse round (clique pra assistir). Rounds sem
        highlight: clique pra sugerir como tática.
      </p>
    </div>
  )
}

const COR_BARRA_COMPRA = {
  eco: 'bg-texto-fraco/50', forcado: 'bg-perigo/60', semi: 'bg-texto/60', full: 'bg-sucesso/60',
}

// "$3200" -> "$3.2k" — cabe acima/abaixo da barra sem precisar de hover, mesmo com 28+
// rounds visíveis lado a lado. Abaixo de 1000 mostra o valor cheio (pistol round: $800...).
function fmtEquip(v) {
  if (v == null) return '–'
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v}`
}

// Cabeçalho de time: nome colorido (time-a/time-b) + os 5 avatares — a primeira coisa que
// o olho vê, antes de qualquer barra. "seu time" identifica o lado do grupo (substitui o
// "· contorno = time do grupo" que só aparecia no rodapé antes).
function CabecalhoTimeEconomia({ time, jogadores, timeDoGrupo }) {
  const cor = time === 'A' ? 'text-time-a' : 'text-time-b'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`font-display text-sm font-bold uppercase tracking-widest ${cor}`}>Time {time}</span>
      {timeDoGrupo === time && (
        <span className="panel-cut-sm border border-destaque/40 bg-destaque/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-destaque">
          seu time
        </span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-1">
        {jogadores?.map((p) => <Avatar key={p.steamId} p={p} />)}
      </div>
    </div>
  )
}

// Gráfico divergente: Time A cresce pra cima, Time B cresce pra baixo, separados pelo
// número do round no meio — a POSIÇÃO da barra já diz de qual time é (mais robusto que só
// cor). Preenchimento da barra = tipo de compra (igual antes, com legenda sempre visível
// embaixo); borda em border-time-a/border-time-b reforça o time em cada barra individual;
// o número acima/abaixo (na cor do time) mostra o valor sem precisar de hover. Cabeçalhos
// espelhados no topo (Time A) e na base (Time B) fecham a leitura vertical.
function LinhaDoTempoEconomia({ economia, timeDoGrupo, timeA, timeB }) {
  if (!economia || economia.length === 0) return null
  const porRound = new Map()
  for (const e of economia) {
    if (!porRound.has(e.roundNumber)) porRound.set(e.roundNumber, {})
    porRound.get(e.roundNumber)[e.team] = e
  }
  const maiorEquip = Math.max(...economia.map((e) => e.equipValue), 1)
  const ALTURA_MAX = 44 // px — precisa bater com h-11 (44px) das caixas abaixo
  const altura = (equip) => (equip ? Math.max(4, (equip / maiorEquip) * ALTURA_MAX) : 4)
  const rounds = [...porRound.keys()].sort((a, b) => a - b)

  return (
    <div className="panel-cut border border-borda bg-superficie p-3">
      <div className="mb-2">
        <CabecalhoTimeEconomia time="A" jogadores={timeA} timeDoGrupo={timeDoGrupo} />
      </div>

      <div className="flex items-stretch gap-1 overflow-x-auto py-1">
        {rounds.map((rn) => {
          const r = porRound.get(rn)
          const a = r.A
          const b = r.B
          return (
            <div key={rn} className="flex w-[30px] flex-shrink-0 flex-col items-center">
              <span className="whitespace-nowrap font-mono text-[8px] font-semibold tabular-nums text-time-a">
                {a ? fmtEquip(a.equipValue) : '–'}
              </span>
              <div className="flex h-11 w-full items-end justify-center">
                <div
                  title={
                    a
                      ? `Round ${rn} · Time A: $${a.equipValue} (${TIPO_COMPRA[a.buyType]?.label ?? a.buyType})`
                      : `Round ${rn} · Time A: sem dado`
                  }
                  className={`w-4 rounded-t-sm border-2 ${a ? `${COR_BARRA_COMPRA[a.buyType]} border-time-a/70` : 'border-borda bg-borda'}`}
                  style={{ height: altura(a?.equipValue) }}
                />
              </div>
              <span className="my-0.5 font-mono text-[9px] font-semibold text-texto-fraco">{rn}</span>
              <div className="flex h-11 w-full items-start justify-center">
                <div
                  title={
                    b
                      ? `Round ${rn} · Time B: $${b.equipValue} (${TIPO_COMPRA[b.buyType]?.label ?? b.buyType})`
                      : `Round ${rn} · Time B: sem dado`
                  }
                  className={`w-4 rounded-b-sm border-2 ${b ? `${COR_BARRA_COMPRA[b.buyType]} border-time-b/70` : 'border-borda bg-borda'}`}
                  style={{ height: altura(b?.equipValue) }}
                />
              </div>
              <span className="whitespace-nowrap font-mono text-[8px] font-semibold tabular-nums text-time-b">
                {b ? fmtEquip(b.equipValue) : '–'}
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-2">
        <CabecalhoTimeEconomia time="B" jogadores={timeB} timeDoGrupo={timeDoGrupo} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-borda pt-2 font-mono text-[11px] text-texto-fraco">
        {Object.entries(TIPO_COMPRA).map(([tipo, info]) => (
          <span key={tipo} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-sm ${COR_BARRA_COMPRA[tipo]}`} />
            {info.label}
          </span>
        ))}
        <span>· preenchimento = tipo de compra · borda laranja/azul = Time A/Time B · número acima/abaixo = valor do equipamento</span>
      </div>
    </div>
  )
}

// Uma tabela por time (mesmo padrão do Scoreboard, que já faz isso duas seções acima).
// Recebe só os jogadores de UM time — o split A/B é feito no TabelaUtilitaria logo abaixo.
function TabelaUtilitariaTime({ time, jogadores }) {
  const cor = time === 'A' ? 'text-time-a' : 'text-time-b'
  const borda = time === 'A' ? 'border-time-a/30' : 'border-time-b/30'
  return (
    <div className={`panel-cut overflow-x-auto border ${borda}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className={`border-b ${borda} bg-superficie text-left`}>
            {/* Abaixo de 640px "Cegou aliado"/"Flash assist" somem (hidden sm:table-cell),
                então a tabela tem só 5 colunas — a super-linha precisa de um colSpan
                diferente por breakpoint, senão descasa da grade real. */}
            <th className="px-3 py-2 sm:hidden" colSpan={5}>
              <span className={`font-display text-xs font-bold uppercase tracking-widest ${cor}`}>Time {time}</span>
            </th>
            <th className="hidden px-3 py-2 sm:table-cell" colSpan={7}>
              <span className={`font-display text-xs font-bold uppercase tracking-widest ${cor}`}>Time {time}</span>
            </th>
          </tr>
          <tr className="bg-superficie text-left font-mono text-[10px] uppercase tracking-wider text-texto-fraco">
            <th className="px-3 py-2">Jogador</th>
            <th className="px-2 py-2 text-right" title="Smokes / Flashes / HEs / Molotovs jogadas">Granadas</th>
            <th className="px-2 py-2 text-right" title="Inimigos cegados por mais de 1.1s (vezes) e segundos totais — cegueira rápida/de raspão não conta">Cegou inimigo</th>
            <th className="hidden px-2 py-2 text-right sm:table-cell" title="Aliados cegados por mais de 1.1s (vezes) e segundos totais — inclui auto-flash">Cegou aliado</th>
            <th className="hidden px-2 py-2 text-right sm:table-cell" title="Flash que cegou um inimigo morto por um colega logo em seguida, ainda cego (crédito pra quem jogou a flash)">Flash assist</th>
            <th className="px-2 py-2 text-right" title="Dano de HE em inimigo (fogo amigo à parte, entre parênteses)">Dano HE</th>
            <th className="px-2 py-2 text-right" title="Dano de molotov/incendiary em inimigo (fogo amigo à parte, entre parênteses)">Dano fogo</th>
          </tr>
        </thead>
        <tbody>
          {jogadores.map((p) => {
            const u = p.utilitaria ?? {}
            return (
              <tr key={p.steamId} className="border-t border-borda transition-colors hover:bg-superficie-alta">
                <td className="px-3 py-2.5">
                  <NomeJogador p={p} />
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums text-texto-fraco">
                  {u.smokesThrown ?? 0}/{u.flashesThrown ?? 0}/{u.heThrown ?? 0}/{u.molotovsThrown ?? 0}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {u.enemiesFlashed ?? 0}
                  <span className="ml-1 text-xs text-texto-fraco">({(u.enemyFlashDuration ?? 0).toFixed(1)}s)</span>
                </td>
                <td className={`hidden px-2 py-2.5 text-right tabular-nums sm:table-cell ${u.teammatesFlashed > 0 ? 'text-perigo' : ''}`}>
                  {u.teammatesFlashed ?? 0}
                  <span className="ml-1 text-xs text-texto-fraco">({(u.teammateFlashDuration ?? 0).toFixed(1)}s)</span>
                </td>
                <td className="hidden px-2 py-2.5 text-right tabular-nums sm:table-cell">{u.flashAssists ?? 0}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {u.heDamage ?? 0}
                  {u.heTeamDamage > 0 && <span className="ml-1 text-xs text-perigo">({u.heTeamDamage})</span>}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {u.molotovDamage ?? 0}
                  {u.molotovTeamDamage > 0 && <span className="ml-1 text-xs text-perigo">({u.molotovTeamDamage})</span>}
                </td>
              </tr>
            )
          })}
          {jogadores.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-4 text-center font-mono text-xs text-texto-fraco">
                Sem jogadores nesse time.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function TabelaUtilitaria({ timeA, timeB }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <TabelaUtilitariaTime time="A" jogadores={timeA} />
        <TabelaUtilitariaTime time="B" jogadores={timeB} />
      </div>
      <p className="panel-cut-sm border border-borda bg-superficie px-3 py-2 font-mono text-[11px] leading-relaxed text-texto-fraco">
        Granadas = smokes/flashes/HEs/molotovs jogadas (não necessariamente acertaram alguém).{' '}
        Cegou = vezes que a flash pegou alguém por mais de 1.1s (cegueira de raspão não conta — mesmo critério do Leetify), com o total de segundos causados. Auto-flash conta como "cegou aliado".{' '}
        Dano HE/fogo = só em inimigo; número em <span className="text-perigo">vermelho entre parênteses</span> é fogo amigo.
      </p>
    </div>
  )
}

function FormClipe({ matchId, jogadores, onAdicionado }) {
  const doGrupo = jogadores.filter((p) => p.isTracked)
  const [steamId, setSteamId] = useState(doGrupo[0]?.steamId ?? '')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [erro, setErro] = useState(null)

  async function enviar(e) {
    e.preventDefault()
    setErro(null)
    const res = await fetch('/api/clips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, steamId, url, title }),
    })
    if (res.ok) {
      setUrl('')
      setTitle('')
      onAdicionado()
    } else {
      const b = await res.json().catch(() => ({}))
      setErro(b.erro ?? 'Erro ao anexar clipe.')
    }
  }

  return (
    <form onSubmit={enviar} className="panel-cut flex flex-wrap items-end gap-2 border border-borda bg-superficie p-3">
      <select
        value={steamId}
        onChange={(e) => setSteamId(e.target.value)}
        className="rounded border border-borda bg-fundo px-2 py-2 font-mono text-sm"
      >
        {doGrupo.map((p) => (
          <option key={p.steamId} value={p.steamId}>{p.nick || p.steamId}</option>
        ))}
      </select>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Link do Allstar/Medal/YouTube"
        className="flex-1 rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm"
      />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título (opcional)"
        className="w-40 rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm"
      />
      <button
        type="submit"
        className="panel-cut-sm border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo"
      >
        Anexar clipe
      </button>
      {erro && <p className="w-full font-mono text-sm text-perigo">{erro}</p>}
    </form>
  )
}

const ABAS = [
  { id: 'geral', label: 'Visão Geral' },
  { id: 'h2h', label: 'Head to Head' },
  { id: 'replay', label: 'Replay 2D' },
  { id: 'economia', label: 'Economia' },
  { id: 'utilitaria', label: 'Utilitária' },
  { id: 'clipes', label: 'Clipes' },
]

// Barra de abas da Partida — mesmo padrão visual do toggle Replay 2D/Mapa de
// calor (botões num trilho, aba ativa em destaque), só que ocupando a largura
// toda e com scroll horizontal no mobile (6 abas não cabem em 375px).
function BarraAbas({ abas, ativa, onSelecionar }) {
  return (
    <div className="flex overflow-x-auto rounded border border-borda font-mono text-xs uppercase">
      {abas.map((a) => (
        <button
          key={a.id}
          onClick={() => onSelecionar(a.id)}
          className={`flex-shrink-0 whitespace-nowrap px-3 py-2 transition-colors ${
            ativa === a.id ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

export default function Partida() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { jogador } = useAuth()
  const [m, setM] = useState(null)
  const [erro, setErro] = useState(false)
  const [promovendo, setPromovendo] = useState(null)
  const [seek, setSeek] = useState(null)
  const [abaAtiva, setAbaAtiva] = useState('geral')
  const replayRef = useRef(null)
  const autoJumpFeito = useRef(false)

  // Usado tanto pelos Highlights (clicar num "ACE round 5") quanto pelo Mapa de calor
  // (clicar num ponto de morte/kill) — os dois só precisam saber round + frame.
  function irParaMomento(round, frame) {
    setAbaAtiva('replay')
    setSeek({ round, frame, key: `${round}-${frame}-${Date.now()}` })
  }

  function irParaHighlight(h) {
    if (h.frame == null) return
    irParaMomento(h.roundNumber, h.frame)
  }

  function carregar() {
    // Reseta o erro a cada tentativa: um refetch falho (ex.: rede oscilou ao anexar
    // clipe) não pode transformar uma partida já carregada em "não encontrada".
    setErro(false)
    fetch(`/api/matches/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(setM)
      .catch(() => setErro(true))
  }

  async function promover(steamId) {
    setPromovendo(steamId)
    try {
      await fetch('/api/players/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamId }),
      })
      carregar()
    } finally {
      setPromovendo(null)
    }
  }

  useEffect(() => {
    setM(null) // troca de :id via navegação client-side não deve mostrar a partida antiga
    autoJumpFeito.current = false
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Veio de "?highlight=<id>" (link do Perfil do Jogador: "em qual partida foi esse
  // clutch mesmo?") — assim que a partida carregar, pula sozinho pro momento certo.
  useEffect(() => {
    const highlightId = searchParams.get('highlight')
    if (!m || !highlightId || autoJumpFeito.current) return
    const h = m.highlights.find((x) => x.id === highlightId)
    if (h) {
      autoJumpFeito.current = true
      irParaHighlight(h)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m])

  // O scroll pro Replay 2D só pode rodar depois que a aba 'replay' estiver montada —
  // irParaMomento troca a aba e o seek na mesma função, mas o scrollIntoView ali
  // ainda veria o DOM antigo (a troca de aba só aplica no próximo paint). Por isso
  // o scroll mora aqui, reagindo à mudança de abaAtiva.
  useEffect(() => {
    if (abaAtiva === 'replay' && seek) {
      replayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaAtiva])

  if (erro && !m) return <p className="font-mono text-sm text-texto-fraco">Partida não encontrada.</p>
  if (!m) return <p className="font-mono text-sm text-texto-fraco">Carregando…</p>

  const timeA = m.players.filter((p) => p.team === 'A')
  const timeB = m.players.filter((p) => p.team === 'B')

  // Resultado do ponto de vista do grupo (Jogadores whitelistados na partida). won é
  // nullable (empate — placar igual — não tem vencedor); `!p.won` sozinho trataria
  // empate como derrota, por isso os 3 estados são checados explicitamente.
  const doGrupo = m.players.filter((p) => p.isTracked)
  // Time predominante do grupo nessa partida (pra colorir a linha do tempo de rounds).
  // null se não tem ninguém do grupo ou o grupo se dividiu igual nos dois times.
  const contagemTimes = doGrupo.reduce((acc, p) => ({ ...acc, [p.team]: (acc[p.team] ?? 0) + 1 }), {})
  const timeDoGrupo =
    (contagemTimes.A ?? 0) > (contagemTimes.B ?? 0) ? 'A' : (contagemTimes.B ?? 0) > (contagemTimes.A ?? 0) ? 'B' : null
  const resultadoGrupo =
    doGrupo.length === 0
      ? null
      : doGrupo.every((p) => p.won === true)
        ? 'vitoria'
        : doGrupo.every((p) => p.won === false)
          ? 'derrota'
          : doGrupo.every((p) => p.won === null)
            ? 'empate'
            : 'misto'

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/" className="font-mono text-sm text-texto-fraco hover:text-texto">← Partidas</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <MapIcon map={m.map} size={40} />
            <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">{nomeMapa(m.map)}</h2>
            <span
              title={origemPartida(m.source).title}
              className="panel-cut-sm border border-borda bg-superficie px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-texto-fraco"
            >
              {origemPartida(m.source).label}
            </span>
          </div>
          <p className="font-mono text-sm text-texto-fraco">{dataHora(m.playedAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {resultadoGrupo === 'vitoria' && (
            <span className="panel-cut-sm border border-sucesso/40 bg-sucesso/10 px-2.5 py-1 font-display text-xs font-bold uppercase tracking-widest text-sucesso">
              Vitória
            </span>
          )}
          {resultadoGrupo === 'derrota' && (
            <span className="panel-cut-sm border border-perigo/40 bg-perigo/10 px-2.5 py-1 font-display text-xs font-bold uppercase tracking-widest text-perigo">
              Derrota
            </span>
          )}
          {resultadoGrupo === 'empate' && (
            <span className="panel-cut-sm border border-borda bg-superficie px-2.5 py-1 font-display text-xs font-bold uppercase tracking-widest text-texto-fraco">
              Empate
            </span>
          )}
          {resultadoGrupo === 'misto' && (
            <span className="panel-cut-sm border border-borda bg-superficie px-2.5 py-1 font-display text-xs font-bold uppercase tracking-widest text-texto-fraco" title="O grupo jogou dividido nos dois times">
              Misto
            </span>
          )}
          <div className="font-mono text-3xl font-bold tabular-nums">
            <span className={m.scoreA === m.scoreB ? 'text-texto' : m.scoreA > m.scoreB ? 'text-sucesso' : 'text-perigo'}>{m.scoreA ?? '–'}</span>
            <span className="mx-2 text-texto-fraco">:</span>
            <span className={m.scoreA === m.scoreB ? 'text-texto' : m.scoreB > m.scoreA ? 'text-sucesso' : 'text-perigo'}>{m.scoreB ?? '–'}</span>
          </div>
        </div>
      </div>

      <BarraAbas abas={ABAS} ativa={abaAtiva} onSelecionar={setAbaAtiva} />

      {abaAtiva === 'geral' && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Scoreboard time="A" jogadores={timeA} matchId={m.id} podePromover={jogador?.isSuperAdmin} onPromover={promover} promovendo={promovendo} />
            <Scoreboard time="B" jogadores={timeB} matchId={m.id} podePromover={jogador?.isSuperAdmin} onPromover={promover} promovendo={promovendo} />
          </div>

          {m.highlights.length > 0 && (
            <section>
              <SectionHeader titulo="Highlights" />
              <div className="flex flex-wrap gap-2">
                {m.highlights.map((h) => {
                  const podeAssistir = h.frame != null && m.replayUrl
                  const conteudo = (
                    <>
                      <span className="font-display font-semibold uppercase text-destaque">{h.kind}</span>{' '}
                      <span className="text-texto">{h.nick || h.steamId}</span>{' '}
                      <span className="text-texto-fraco">round {h.roundNumber}</span>
                      {podeAssistir && <span className="ml-1.5 text-texto-fraco">▶</span>}
                    </>
                  )
                  return podeAssistir ? (
                    <button
                      key={h.id}
                      onClick={() => irParaHighlight(h)}
                      className="panel-cut-sm border border-borda bg-superficie px-3 py-2 font-mono text-sm transition-colors hover:border-destaque/60 hover:bg-superficie-alta"
                      title="Assistir no Replay 2D"
                    >
                      {conteudo}
                    </button>
                  ) : (
                    <div key={h.id} className="panel-cut-sm border border-borda bg-superficie px-3 py-2 font-mono text-sm">
                      {conteudo}
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}

      {abaAtiva === 'h2h' && (
        <section>
          <AbaHeadToHead matchId={m.id} jogadores={m.players} jogadorLogado={jogador} />
        </section>
      )}

      {abaAtiva === 'replay' && (
        <>
          <section ref={replayRef}>
            <SecaoReplay
              replayUrl={m.replayUrl}
              seek={seek}
              onSelecionarPonto={({ round, frame }) => irParaMomento(round, frame)}
            />
          </section>

          <section>
            <LinhaDoTempoRounds
              rounds={m.rounds}
              highlights={m.highlights}
              timeDoGrupo={timeDoGrupo}
              onClicarHighlight={irParaHighlight}
              replayDisponivel={!!m.replayUrl}
              matchId={m.id}
              map={m.map}
            />
          </section>
        </>
      )}

      {abaAtiva === 'economia' && m.economia?.length > 0 && (
        <section>
          <LinhaDoTempoEconomia economia={m.economia} timeDoGrupo={timeDoGrupo} timeA={timeA} timeB={timeB} />
        </section>
      )}

      {abaAtiva === 'utilitaria' && (
        <section>
          <TabelaUtilitaria timeA={timeA} timeB={timeB} />
        </section>
      )}

      {abaAtiva === 'clipes' && (
        <section>
          <div className="mb-3 space-y-2">
            {m.clips.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhum clipe anexado ainda.</p>}
            {m.clips.map((c) => (
              <a
                key={c.id}
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="panel-cut-sm flex items-center gap-3 border border-borda bg-superficie p-3 font-mono text-sm transition-colors hover:border-destaque/60"
              >
                <span className="flex-shrink-0 rounded bg-fundo px-2 py-1 text-xs uppercase tracking-wide text-destaque">{c.provider}</span>
                <span className="min-w-0 flex-1 truncate text-texto">{c.title || c.url}</span>
              </a>
            ))}
          </div>
          <FormClipe matchId={m.id} jogadores={m.players} onAdicionado={carregar} />
        </section>
      )}
    </div>
  )
}
