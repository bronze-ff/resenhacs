import { useEffect, useRef, useState, Fragment } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { hrefSeguro } from '../lib/urlSegura.js'
import { nomeMapa, dataHora, origemPartida, nomeArma, corRating, TIPO_COMPRA } from '../lib/format.js'
import { orientarPlacar } from '../lib/resultado.js'
import {
  Avatar, MapIcon, SectionHeader, Select, PlataformaBadge, SteamIcon, Badge, Button, Modal, Abas,
  Skeleton, SkeletonLista, EstadoVazio, EstadoErro, Input, Textarea, classesBotao,
} from '../components/ui'
import ReplayViewer from '../components/ReplayViewer.jsx'
import MapaCalor from '../components/MapaCalor.jsx'
import SeletorClipesCompeticao from '../components/SeletorClipesCompeticao.jsx'
import SecaoClipeReal from '../components/clipes/SecaoClipeReal.jsx'
import DuelosPartida from '../components/DuelosPartida.jsx'
import AvisoPartidaSemDemo from '../components/AvisoPartidaSemDemo.jsx'
import { useAuth } from '../auth/AuthContext.jsx'
import { useTransicaoModal } from '../lib/useTransicaoModal.js'

// Placeholder de um round ainda não baixado (streaming por round — FIL-54b): mesmo
// shape de um round completo, só que sem frames/eventos. O ReplayViewer já trata os
// campos ausentes com fallback (`round.fires || []` etc.), então isso renderiza como
// "round vazio" até o fetch chegar, sem precisar de um estado de loading dedicado ali.
function roundVazio(meta) {
  return { ...meta, frames: [], kills: [], hits: [] }
}

export function SecaoReplay({ replayUrl, seek, onSelecionarPonto, matchId = null }) {
  const [replay, setReplay] = useState(null)
  const [erro, setErro] = useState(false)
  const [aba, setAba] = useState('replay') // replay | calor

  useEffect(() => {
    if (!replayUrl) return
    let vivo = true
    setReplay(null)
    setErro(false)

    fetch(replayUrl)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((indice) => {
        if (!vivo) return
        // Formato antigo (replay arquivado antes do streaming por round): cada round já
        // vem com `frames` — nada a buscar, mostra direto (comportamento inalterado).
        const streaming = indice.rounds.length > 0 && indice.rounds[0].frames === undefined
        if (!streaming) { setReplay(indice); return }

        // Formato novo: `indice` só tem metadados por round. Monta o replay com
        // placeholders e preenche assim que cada round chega — round 1 primeiro (é o
        // que a tela abre tocando), o resto em paralelo logo em seguida.
        setReplay({ ...indice, rounds: indice.rounds.map(roundVazio) })
        const buscarRound = (numero) =>
          fetch(`${replayUrl}/round/${numero}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((dadosDoRound) => {
              if (!vivo || !dadosDoRound) return
              setReplay((atual) => atual && ({
                ...atual,
                rounds: atual.rounds.map((r) => (r.round === numero ? dadosDoRound : r)),
              }))
            })
            .catch(() => {})
        const numeros = indice.rounds.map((r) => r.round)
        buscarRound(numeros[0]).then(() => {
          if (!vivo) return
          numeros.slice(1).forEach(buscarRound)
        })
      })
      .catch(() => { if (vivo) setErro(true) })

    return () => { vivo = false }
  }, [replayUrl])

  // Deep link de um Highlight sempre volta pra aba do replay animado.
  useEffect(() => {
    if (seek) setAba('replay')
  }, [seek?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!replayUrl) {
    return (
      <EstadoVazio
        titulo="Replay 2D indisponível"
        descricao="O Replay 2D é gerado pelo Coletor quando a Demo da Partida é processada."
      />
    )
  }
  if (erro) return <EstadoErro mensagem="Não foi possível carregar o replay." />
  if (!replay) {
    return (
      <div role="status" aria-label="Carregando replay" className="space-y-3">
        <Skeleton className="panel-cut-tr h-10 w-64" />
        <Skeleton className="panel-cut mx-auto aspect-square w-full max-w-[640px]" />
        <span className="sr-only">Carregando replay…</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Abas
        rotulo="Visualização do replay"
        itens={[{ valor: 'replay', rotulo: 'Replay 2D' }, { valor: 'calor', rotulo: 'Mapa de calor' }]}
        valor={aba}
        onChange={setAba}
      />
      {aba === 'replay' ? (
        <ReplayViewer replay={replay} seek={seek} matchId={matchId} />
      ) : (
        <MapaCalor replay={replay} onSelecionarPonto={onSelecionarPonto} />
      )}
    </div>
  )
}


// Nome do Jogador: sempre um link pro perfil dele no Resenha (mesmo se for adversário/fora
// do grupo — o perfil já sabe lidar com quem nunca fez onboarding), + link direto pro
// perfil Steam (ícone separado, pra não competir com o clique do nome).
// 3K/4K/5K da FACEIT (só aparece quando o dado existe e é > 0).
function MultiKills({ p }) {
  const itens = [['5K', p.pentaKills], ['4K', p.quadroKills], ['3K', p.tripleKills]].filter(([, n]) => n > 0)
  if (itens.length === 0) return null
  return (
    <span className="hidden shrink-0 gap-1 sm:flex">
      {itens.map(([rotulo, n]) => (
        <span key={rotulo} title={`${n}× ${rotulo} na partida`} className="rounded-full bg-superficie-topo px-1.5 text-[11px] text-texto">
          {rotulo}{n > 1 ? `×${n}` : ''}
        </span>
      ))}
    </span>
  )
}

function NomeJogador({ p, mostrarTagGrupo = true, className = '' }) {
  return (
    <span className={`flex min-w-0 items-center gap-2 font-mono ${className}`.trim()}>
      <Link
        to={`/jogador/${p.steamId}`}
        className="flex min-w-0 items-center gap-2 text-texto transition-colors hover:text-destaque"
      >
        <Avatar p={p} />
        <span className="max-w-[92px] truncate sm:max-w-none">{p.nick || p.steamId}</span>
      </Link>
      {mostrarTagGrupo && p.isTracked && (
        <span className="hidden shrink-0 rounded-full bg-superficie-topo px-1.5 text-[11px] text-texto-fraco sm:inline">grupo</span>
      )}
      <a
        href={`https://steamcommunity.com/profiles/${p.steamId}`}
        target="_blank"
        rel="noreferrer"
        title="Abrir perfil na Steam"
        className="-m-2 shrink-0 p-2 text-texto-fraco/60 transition-colors hover:text-texto lg:m-0 lg:p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <SteamIcon className="h-3.5 w-3.5" />
      </a>
    </span>
  )
}

// Destaque do MVP da Partida — mesmo dado (e mesmo critério) do chip que o card dessa
// Partida mostra no Feed: melhor rating entre os Jogadores do grupo, desempate por kills.
// Sem MVP (nenhum jogador rastreado) ou sem rating (partida antiga, sem o dado): não
// renderiza nada — nada de espaço vazio nem de "—" pra um destaque que não existe.
function DestaqueMvp({ mvp }) {
  if (!mvp || mvp.rating == null) return null
  return (
    <div className="flex min-w-0 items-center gap-2.5 font-mono text-sm">
      <span className="panel-cut-tr border border-ouro/40 bg-ouro/10 px-1.5 py-0.5 text-[11px] font-bold text-ouro">MVP</span>
      <Avatar p={mvp} size={28} />
      <Link to={`/jogador/${mvp.steamId}`} className="min-w-0 truncate text-texto transition-colors hover:text-destaque">
        {mvp.nick || mvp.steamId}
      </Link>
      <span className={`font-display text-lg font-semibold leading-none tabular-nums ${corRating(mvp.rating)}`} title="Rating na partida">
        {mvp.rating.toFixed(2)}
      </span>
    </div>
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
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
      {(!weapons || weapons.length === 0) ? (
        <p className="text-xs text-texto-fraco">Sem kills registrados nessa partida.</p>
      ) : (
        weapons.map((w) => (
          <div
            key={w.weapon}
            className="panel-cut-tr flex items-center gap-2 border border-borda bg-superficie-alta px-2 py-1 font-mono text-xs"
          >
            <span className="font-semibold text-texto">{nomeArma(w.weapon)}</span>
            <span className="text-texto-fraco">{w.kills} kill{w.kills === 1 ? '' : 's'}</span>
            {w.hsKills > 0 && <span className="text-texto-fraco">· {w.hsKills} HS</span>}
          </div>
        ))
      )}
      <Button variante="fantasma" tamanho="sm" onClick={onAbrirDetalhe} className="ml-auto">
        Ver detalhe por round →
      </Button>
    </div>
  )
}

const ROTULO_COMPRA = { eco: 'Eco', forcado: 'Forçada', semi: 'Semi', full: 'Full' }

const CATEGORIAS_ARMA_ORDEM = ['Rifles', 'Snipers', 'SMGs', 'Pistolas', 'Shotguns', 'Pesadas', 'Outras']

// Uma linha do comparativo: barra espelhada (A cresce pra esquerda, B pra direita) a
// partir de um valor central — mesma ideia visual do Head to Head do Leetify.
function LinhaComparativa({ label, valorA, valorB, corA = 'bg-time-a', corB = 'bg-time-b' }) {
  const max = Math.max(valorA, valorB, 1)
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span className="w-8 shrink-0 text-right tabular-nums text-texto">{valorA}</span>
      <div className="flex h-3 flex-1 flex-row-reverse overflow-hidden bg-fundo">
        <div className={`h-full ${corA}`} style={{ width: `${(valorA / max) * 100}%` }} />
      </div>
      <span className="w-16 shrink-0 text-center text-texto-fraco">{label}</span>
      <div className="flex h-3 flex-1 overflow-hidden bg-fundo">
        <div className={`h-full ${corB}`} style={{ width: `${(valorB / max) * 100}%` }} />
      </div>
      <span className="w-8 shrink-0 tabular-nums text-texto">{valorB}</span>
    </div>
  )
}

// Cache em memória do Head to Head (chave = matchId:referenciaId): a aba desmonta
// quando o usuário sai dela (render condicional em Partida()), então sem isso cada
// revisita refazia o fetch do zero mesmo pro mesmo jogador — os dados de uma Partida
// já fechada nunca mudam, então cachear é seguro e evita chamadas repetidas.
const cacheHeadToHead = new Map()

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
    setErro(false)
    setExpandido(null)
    const chave = `${matchId}:${referenciaId}`
    const emCache = cacheHeadToHead.get(chave)
    if (emCache) {
      setDados(emCache)
      return
    }
    // Guarda de cancelamento: sem isso, trocar o jogador de referência rápido demais
    // (o select fica sempre visível, dá pra trocar quantas vezes quiser) deixa uma
    // resposta antiga sobrescrever a mais nova se chegar fora de ordem.
    let cancelado = false
    setDados(null)
    fetch(`/api/matches/${matchId}/head-to-head/${referenciaId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json) => {
        cacheHeadToHead.set(chave, json)
        if (!cancelado) setDados(json)
      })
      .catch(() => { if (!cancelado) setErro(true) })
    return () => { cancelado = true }
  }, [matchId, referenciaId])

  const referencia = jogadores.find((p) => p.steamId === referenciaId)
  // As barras usam a cor do TIME real da referência (não sempre "time-a") — senão,
  // quem tava no Time B via as próprias kills pintadas de laranja (cor do Time A),
  // contradizendo o Placar da aba Visão Geral.
  const corReferencia = referencia?.team === 'B' ? 'bg-time-b' : 'bg-time-a'
  const corAdversario = referencia?.team === 'B' ? 'bg-time-a' : 'bg-time-b'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex flex-wrap items-center gap-2">
          <span className="rotulo">Comparando</span>
          <Select value={referenciaId} onChange={(e) => setReferenciaId(e.target.value)} selectClassName="py-1.5 text-xs">
            <option value="">Escolha um jogador…</option>
            {jogadores.map((p) => (
              <option key={p.steamId} value={p.steamId}>{p.nick || p.steamId}</option>
            ))}
          </Select>
        </label>
        {referencia && (
          <p className="flex items-center gap-3 font-mono text-[11px] text-texto-fraco">
            <span className="flex items-center gap-1.5"><span className={`h-2 w-2 ${corReferencia}`} aria-hidden="true" />dano causado</span>
            <span className="flex items-center gap-1.5"><span className={`h-2 w-2 ${corAdversario}`} aria-hidden="true" />dano recebido</span>
          </p>
        )}
      </div>

      {!referenciaId && (
        <EstadoVazio titulo="Escolha um jogador" descricao="Escolha um jogador pra comparar contra o time adversário." />
      )}
      {referenciaId && erro && <EstadoErro mensagem="Não foi possível carregar o comparativo." />}
      {referenciaId && !erro && !dados && <SkeletonLista linhas={5} altura="h-12" rotulo="Carregando comparativo" />}
      {dados && dados.oponentes.length === 0 && <EstadoVazio titulo="Sem adversários pra comparar." />}

      {dados?.oponentes.map((o) => {
        const aberto = expandido === o.steamId
        const categorias = CATEGORIAS_ARMA_ORDEM.filter((c) => o.killsPorCategoria[c] || o.killsPorCategoriaRecebido[c])
        const semFlash = o.flashes.porMim.vezes === 0 && o.flashes.porEle.vezes === 0
        return (
          <div key={o.steamId} className={`panel-cut-sm overflow-x-auto border bg-superficie transition-colors ${aberto ? 'border-borda-forte' : 'border-borda'}`}>
            <button
              onClick={() => setExpandido(aberto ? null : o.steamId)}
              aria-expanded={aberto}
              className="flex min-w-full flex-nowrap items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-superficie-alta"
            >
              <span className="flex min-w-0 items-center gap-2 font-mono text-sm">
                <Avatar p={referencia} />
                <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-texto">{o.kills}</span>
              </span>
              <div className="flex h-3 min-w-[36px] flex-1 flex-row-reverse overflow-hidden bg-fundo sm:min-w-[80px]">
                <div className={`h-full ${corReferencia}`} style={{ width: `${(o.dano / Math.max(o.dano, o.danoRecebido, 1)) * 100}%` }} />
              </div>
              <span className="shrink-0 font-mono text-[11px] text-texto-fraco">dano</span>
              <div className="flex h-3 min-w-[36px] flex-1 overflow-hidden bg-fundo sm:min-w-[80px]">
                <div className={`h-full ${corAdversario}`} style={{ width: `${(o.danoRecebido / Math.max(o.dano, o.danoRecebido, 1)) * 100}%` }} />
              </div>
              <span className="flex min-w-0 items-center gap-2 font-mono text-sm">
                <span className="w-6 shrink-0 tabular-nums text-texto">{o.deaths}</span>
                <Avatar p={o} />
                <span className="min-w-0 truncate text-texto">{o.nick || o.steamId}</span>
              </span>
              <SetaExpandir aberto={aberto} />
            </button>
            {aberto && (
              <div className="space-y-1.5 border-t border-borda/60 px-3 py-2.5">
                {categorias.length === 0 && (
                  <p className="text-xs text-texto-fraco">Nenhuma kill entre os dois nessa Partida.</p>
                )}
                {categorias.map((cat) => (
                  <LinhaComparativa
                    key={cat}
                    label={cat}
                    valorA={o.killsPorCategoria[cat] ?? 0}
                    valorB={o.killsPorCategoriaRecebido[cat] ?? 0}
                    corA={corReferencia}
                    corB={corAdversario}
                  />
                ))}
                {semFlash ? (
                  <p className="text-xs text-texto-fraco">Nenhum dos dois flashou o outro.</p>
                ) : (
                  <LinhaComparativa
                    label="Flashes"
                    valorA={o.flashes.porMim.vezes}
                    valorB={o.flashes.porEle.vezes}
                    corA={corReferencia}
                    corB={corAdversario}
                  />
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
  const { visivel, iniciarSaida } = useTransicaoModal()
  const fechar = () => iniciarSaida(onFechar)

  useEffect(() => {
    setDados(null)
    setErro(false)
    fetch(`/api/matches/${matchId}/jogador/${jogador.steamId}/detalhe`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setDados)
      .catch(() => setErro(true))
  }, [matchId, jogador.steamId])

  return (
    <Modal
      visivel={visivel}
      onFechar={fechar}
      tamanho="md"
      titulo={
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar p={jogador} size={32} />
          <span className="min-w-0 truncate">{jogador.nick || jogador.steamId}</span>
        </span>
      }
      subtitulo={
        jogador.duelWinPct !== null ? (
          <span title="De todo confronto que terminou em morte envolvendo ele (matou ou morreu), quantos % ele venceu (saiu vivo)">
            Duelos vencidos: <span className="text-texto">{jogador.duelWinPct}%</span> ({jogador.kills}V/{jogador.deaths}D)
          </span>
        ) : null
      }
    >
      {erro && <EstadoErro mensagem="Não foi possível carregar o detalhe." />}
      {!erro && !dados && <SkeletonLista linhas={6} altura="h-10" rotulo="Carregando detalhe" />}
      {dados && dados.rounds.length === 0 && (
        <EstadoVazio titulo="Sem dados round a round" descricao="Sem dados round-a-round pra essa partida (demo antiga)." />
      )}
      {dados && dados.rounds.length > 0 && (
        <>
          {/* Legenda fixa: explica de cara o que cada coluna/cor significa, sem
              precisar perguntar — mesma dúvida que já apareceu uma vez. */}
          <p className="mb-4 text-xs leading-relaxed text-texto-fraco">
            Cada linha é um round: o tipo/valor da compra dele naquele round (com o
            detalhe de cada item), e do lado direito, em{' '}
            <span className="text-sucesso">verde</span> as kills (arma e se foi
            headshot) e em <span className="text-perigo">vermelho</span> a morte dele
            — arma de quem matou e, entre parênteses, a arma que ELE estava segurando
            na hora — quando ele sobrevive o round, não aparece nada em vermelho.
          </p>
          <div className="space-y-1">
            {dados.rounds.map((r) => (
              <div key={r.roundNumber} className="panel-cut-tr flex flex-wrap items-center gap-x-3 gap-y-1 border border-borda bg-superficie-alta px-3 py-2 font-mono text-xs">
                <span className="w-16 shrink-0 font-display text-sm font-semibold text-texto">Round {r.roundNumber}</span>
                {r.buyType && (
                  <span className="text-texto-fraco">
                    {ROTULO_COMPRA[r.buyType] ?? r.buyType} <span className="tabular-nums">(${r.equipValue ?? 0})</span>
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
                <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3">
                  {r.matou.map((k, i) => (
                    <span key={i} className="text-sucesso">▲ matou: {nomeArma(k.weapon)}{k.headshot ? ' (HS)' : ''}</span>
                  ))}
                  {r.morreu && (
                    <span className="text-perigo">
                      ▼ morreu: {nomeArma(r.morreu.weapon)}
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
    </Modal>
  )
}

// Estrelinha ao lado do valor quando ele é o melhor da Partida INTEIRA (os 2 times) —
// estilo Leetify/scope.gg. `valor === melhor` (não >=) porque melhor já É o máximo.
function ComEstrela({ valor, melhor, children }) {
  return (
    <>
      {children}
      {melhor > 0 && valor === melhor && <span className="ml-1 text-ouro" title="Melhor da partida">★</span>}
    </>
  )
}

// Cabeçalho de coluna com tooltip (title) — sublinhado pontilhado indica que tem explicação.
function Th({ titulo, children, className = '', escondeMobile = false }) {
  return (
    <th
      title={titulo}
      className={`cursor-help px-2 py-2.5 text-right font-medium underline decoration-dotted decoration-texto-fraco/40 underline-offset-4 ${escondeMobile ? 'hidden sm:table-cell' : ''} ${className}`}
    >
      {children}
    </th>
  )
}

export function Scoreboard({ time, jogadores, matchId, podePromover, onPromover, promovendo, melhores, carregando, placar = null, doGrupo = false }) {
  const [expandido, setExpandido] = useState(null)
  const [detalheAberto, setDetalheAberto] = useState(null)
  // Coluna de pontos por partida: Premier (valve_mm) OU ELO FACEIT (faceit) — o dado
  // certo pro tipo da partida; nunca os dois ao mesmo tempo.
  const temPontos = jogadores.some((p) => p.premierBefore != null || p.faceitEloBefore != null)
  const temMvps = jogadores.some((p) => p.mvps != null)
  const corTime = time === 'A' ? 'text-time-a' : 'text-time-b'
  const fundoTime = time === 'A' ? 'bg-time-a' : 'bg-time-b'
  return (
    // O modal vai por portal (Modal) — não fica preso no clip-path do painel.
    <>
    <div className={`panel-cut overflow-hidden border border-borda bg-superficie realce-topo transition-opacity ${carregando ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between gap-3 border-b border-borda px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 ${fundoTime}`} aria-hidden="true" />
          <span className={`font-display text-lg font-semibold ${corTime}`}>Time {time}</span>
          {doGrupo && (
            <span className="rounded-full border border-borda-forte bg-superficie-alta px-2 py-0.5 text-[11px] font-medium text-texto-fraco">
              seu time
            </span>
          )}
        </div>
        {placar != null && (
          <span className={`font-display text-3xl font-semibold leading-none tabular-nums ${corTime}`}>{placar}</span>
        )}
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-superficie-alta/60 text-left font-mono text-[11px] text-texto-fraco">
            <th className="px-3 py-2.5 font-medium sm:px-4">Jogador</th>
            <Th titulo="Kills — abates confirmados (fogo amigo não conta)">K</Th>
            <Th titulo="Team kills (não contam pro K nem pro rating)" escondeMobile>TK</Th>
            <Th titulo="Deaths — vezes que morreu">D</Th>
            <Th titulo="Assists — dano/flash que ajudou a matar sem ser o abate final" escondeMobile>A</Th>
            <Th titulo="Average Damage per Round — dano médio causado por round (contando também rounds sem kill)" escondeMobile>ADR</Th>
            <Th titulo="% dos abates que foram headshot" escondeMobile>HS%</Th>
            <Th titulo="KAST — % dos rounds em que ele teve kill, assist, sobreviveu ou foi vingado (trade)" escondeMobile>KAST</Th>
            {temMvps && <Th titulo="MVPs — rounds em que foi o melhor do time (dado da FACEIT)" escondeMobile>MVP</Th>}
            {temPontos && (
              <Th titulo="Pontuação (Premier ou ELO FACEIT) antes dessa partida, e quanto ganhou/perdeu" escondeMobile>Pontos</Th>
            )}
            <Th
              titulo="Aproximação do HLTV Rating 1.0: combina kills/round, sobrevivência/round e multi-kills (2K/3K/4K/5K) num único número — acima de 1.00 é acima da média"
              className="px-3 sm:px-4"
            >
              Rating
            </Th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {jogadores.map((p) => {
            const adr = p.roundsPlayed ? Math.round((p.damage / p.roundsPlayed) * 10) / 10 : 0
            const hs = p.kills ? Math.round((p.headshotKills / p.kills) * 100) : 0
            const aberto = expandido === p.steamId
            return (
              <Fragment key={p.steamId}>
                <tr className={`border-t border-borda transition-colors hover:bg-superficie-alta ${aberto ? 'bg-superficie-alta/60' : ''}`}>
                  <td className="px-3 py-2 sm:px-4">
                    <span className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandido(aberto ? null : p.steamId)}
                        title="Ver kills por arma nessa partida"
                        aria-expanded={aberto}
                        className="-m-2 p-2 text-texto-fraco transition-colors hover:text-destaque lg:m-0 lg:p-0"
                      >
                        <SetaExpandir aberto={aberto} />
                      </button>
                      <NomeJogador p={p} />
                      <MultiKills p={p} />
                      {!p.isTracked && podePromover && (
                        <Button
                          variante="fantasma"
                          tamanho="xs"
                          onClick={() => onPromover(p.steamId)}
                          carregando={promovendo === p.steamId}
                        >
                          {promovendo === p.steamId ? null : '+ grupo'}
                        </Button>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-texto">
                    <ComEstrela valor={p.kills} melhor={melhores?.kills ?? 0}>{p.kills}</ComEstrela>
                  </td>
                  <td className={`hidden px-2 py-2 text-right tabular-nums sm:table-cell ${p.teamKills > 0 ? 'text-perigo' : 'text-texto-fraco/60'}`}>
                    {p.teamKills || 0}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-texto-fraco">{p.deaths}</td>
                  <td className="hidden px-2 py-2 text-right tabular-nums text-texto-fraco sm:table-cell">
                    <ComEstrela valor={p.assists} melhor={melhores?.assists ?? 0}>{p.assists}</ComEstrela>
                  </td>
                  <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">
                    <ComEstrela valor={adr} melhor={melhores?.adr ?? 0}>{adr}</ComEstrela>
                  </td>
                  <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">
                    <ComEstrela valor={hs} melhor={melhores?.hsPct ?? 0}>{hs}%</ComEstrela>
                  </td>
                  <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">
                    {p.kastPct != null ? (
                      <ComEstrela valor={p.kastPct} melhor={melhores?.kastPct ?? 0}>{p.kastPct}%</ComEstrela>
                    ) : '–'}
                  </td>
                  {temMvps && (
                    <td className="hidden px-2 py-2 text-right tabular-nums text-texto-fraco sm:table-cell">{p.mvps ?? '–'}</td>
                  )}
                  {temPontos && (
                    <td className="hidden px-2 py-2 text-right sm:table-cell">
                      {(() => {
                        const antes = p.premierBefore ?? p.faceitEloBefore
                        const depois = p.premierAfter ?? p.faceitEloAfter
                        if (antes == null) return null
                        return (
                          <>
                            <span className="text-xs tabular-nums text-texto-fraco">{Math.round(antes)}</span>
                            {depois != null && (
                              <span className={`ml-1 text-xs font-semibold tabular-nums ${depois >= antes ? 'text-sucesso' : 'text-perigo'}`}>
                                {depois >= antes ? '▲' : '▼'}{Math.abs(Math.round(depois - antes))}
                              </span>
                            )}
                          </>
                        )
                      })()}
                    </td>
                  )}
                  <td className={`px-3 py-2 text-right font-display text-base font-semibold tabular-nums sm:px-4 ${corRating(p.rating)}`}>
                    {p.rating != null ? (
                      <ComEstrela valor={p.rating} melhor={melhores?.rating ?? 0}>{p.rating.toFixed(2)}</ComEstrela>
                    ) : '–'}
                  </td>
                </tr>
                {aberto && (
                  <tr className="border-t border-borda/60 bg-fundo/40">
                    <td colSpan={temPontos ? 10 : 9}>
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
      ? 'panel-cut absolute left-0 top-full z-10 mt-1 w-56 border border-sucesso/40 bg-superficie p-3 text-xs text-sucesso shadow-flutuante'
      : 'panel-cut mt-3 w-full border border-sucesso/40 bg-superficie p-3 text-xs text-sucesso sm:w-72'
  const classesForm =
    variante === 'absoluta'
      ? 'panel-cut absolute left-0 top-full z-10 mt-1 w-72 space-y-2.5 border border-borda-forte bg-superficie p-3 text-left shadow-flutuante'
      : 'panel-cut mt-3 w-full space-y-2.5 border border-borda-forte bg-superficie p-3 text-left sm:w-72'
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
      <p className="rotulo">Sugerir tática · round {roundNumber}</p>
      <Input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Nome curto"
        aria-label="Nome da tática"
        required
      />
      <Textarea
        value={descricao}
        onChange={(e) => setDescricao(e.target.value)}
        placeholder="Descrição"
        aria-label="Descrição da tática"
        rows={2}
      />
      {erro && <p className="text-xs text-perigo">{erro}</p>}
      <div className="flex justify-end gap-2">
        <Button variante="fantasma" tamanho="sm" onClick={onFechar}>
          Cancelar
        </Button>
        <Button type="submit" variante="primario" tamanho="sm" carregando={enviando}>
          Sugerir
        </Button>
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
    <div className="panel-cut border border-borda bg-superficie p-3 realce-topo sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rotulo">Rounds</span>
        {timeDoGrupo && (
          <span className="flex items-center gap-3 font-mono text-[11px] text-texto-fraco">
            <span className="flex items-center gap-1"><span className="text-sucesso" aria-hidden="true">▲</span>vencido</span>
            <span className="flex items-center gap-1"><span className="text-perigo" aria-hidden="true">▼</span>perdido</span>
            <span className="flex items-center gap-1"><span className="text-destaque" aria-hidden="true">●</span>highlight</span>
          </span>
        )}
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible">
        {rounds.map((r) => {
          const hs = porRound.get(r.roundNumber) ?? []
          const vencedorGrupo = timeDoGrupo ? r.winnerTeam === timeDoGrupo : null
          const cor =
            vencedorGrupo === true
              ? 'border-sucesso/50 bg-sucesso/10'
              : vencedorGrupo === false
                ? 'border-perigo/40 bg-perigo/5'
                : 'border-borda bg-superficie-alta'
          const conteudo = (
            <div className={`panel-cut-tr relative flex h-10 w-10 flex-shrink-0 flex-col items-center justify-center border ${cor} font-mono text-[11px] tabular-nums transition-colors hover:border-texto-fraco/60`}>
              <span className="text-texto">{r.roundNumber}</span>
              <span className="flex h-2 items-center gap-0.5 text-[8px] leading-none">
                {vencedorGrupo === true && <span className="text-sucesso" aria-label="vencido">▲</span>}
                {vencedorGrupo === false && <span className="text-perigo" aria-label="perdido">▼</span>}
                {hs.length > 0 && <span className="text-destaque">●</span>}
              </span>
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
      <p className="mt-3 text-xs leading-relaxed text-texto-fraco">
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
      <span className={`font-display text-base font-semibold ${cor}`}>Time {time}</span>
      {timeDoGrupo === time && (
        <span className="rounded-full border border-borda-forte bg-superficie-alta px-2 py-0.5 text-[11px] font-medium text-texto-fraco">
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
  // Bem maior que antes (era 44px) — o gráfico ficava "pequeno e confuso" (feedback
  // direto de uso) com tanto espaço do card sobrando ao redor de barras minúsculas.
  const ALTURA_MAX = 108 // px — precisa bater com h-27/[108px] das caixas abaixo
  const altura = (equip) => (equip ? Math.max(6, (equip / maiorEquip) * ALTURA_MAX) : 6)
  const rounds = [...porRound.keys()].sort((a, b) => a - b)

  return (
    <div className="panel-cut border border-borda bg-superficie p-3 realce-topo sm:p-4">
      <div className="mb-3">
        <CabecalhoTimeEconomia time="A" jogadores={timeA} timeDoGrupo={timeDoGrupo} />
      </div>

      {/* flex-1 (não largura fixa): com poucos rounds, cada coluna estica pra preencher
          o card inteiro em vez de deixar um vão vazio do lado — só volta a scrollar
          horizontal quando o mínimo (min-w) não cabe mais (partida com muitos rounds). */}
      <div className="flex items-stretch gap-1.5 overflow-x-auto py-1">
        {rounds.map((rn) => {
          const r = porRound.get(rn)
          const a = r.A
          const b = r.B
          return (
            <div key={rn} className="flex min-w-[40px] flex-1 flex-col items-center">
              <span className="whitespace-nowrap font-mono text-[11px] font-semibold tabular-nums text-time-a">
                {a ? fmtEquip(a.equipValue) : '–'}
              </span>
              <div className="flex w-full items-end justify-center" style={{ height: ALTURA_MAX }}>
                <div
                  title={
                    a
                      ? `Round ${rn} · Time A: $${a.equipValue} (${TIPO_COMPRA[a.buyType]?.label ?? a.buyType})`
                      : `Round ${rn} · Time A: sem dado`
                  }
                  className={`w-6 border-2 ${a ? `${COR_BARRA_COMPRA[a.buyType]} border-time-a/70` : 'border-borda bg-borda'}`}
                  style={{ height: altura(a?.equipValue) }}
                />
              </div>
              <div className="relative my-1 w-full border-t border-borda text-center font-mono text-[11px] font-semibold text-texto-fraco">
                <span className="relative -top-[9px] bg-superficie px-1.5">{rn}</span>
              </div>
              <div className="flex w-full items-start justify-center" style={{ height: ALTURA_MAX }}>
                <div
                  title={
                    b
                      ? `Round ${rn} · Time B: $${b.equipValue} (${TIPO_COMPRA[b.buyType]?.label ?? b.buyType})`
                      : `Round ${rn} · Time B: sem dado`
                  }
                  className={`w-6 border-2 ${b ? `${COR_BARRA_COMPRA[b.buyType]} border-time-b/70` : 'border-borda bg-borda'}`}
                  style={{ height: altura(b?.equipValue) }}
                />
              </div>
              <span className="whitespace-nowrap font-mono text-[11px] font-semibold tabular-nums text-time-b">
                {b ? fmtEquip(b.equipValue) : '–'}
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-3">
        <CabecalhoTimeEconomia time="B" jogadores={timeB} timeDoGrupo={timeDoGrupo} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-borda pt-2 font-mono text-[11px] text-texto-fraco">
        {Object.entries(TIPO_COMPRA).map(([tipo, info]) => (
          <span key={tipo} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 ${COR_BARRA_COMPRA[tipo]}`} />
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
  const fundoTime = time === 'A' ? 'bg-time-a' : 'bg-time-b'
  return (
    <div className="panel-cut overflow-x-auto border border-borda bg-superficie realce-topo">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-borda text-left">
            {/* Abaixo de 640px "Cegou aliado"/"Flash assist" somem (hidden sm:table-cell),
                então a tabela tem só 5 colunas — a super-linha precisa de um colSpan
                diferente por breakpoint, senão descasa da grade real. */}
            <th className="px-3 py-2.5 sm:hidden" colSpan={5}>
              <span className={`flex items-center gap-2.5 font-display text-lg font-semibold ${cor}`}><span className={`h-2.5 w-2.5 ${fundoTime}`} aria-hidden="true" />Time {time}</span>
            </th>
            <th className="hidden px-3 py-2.5 sm:table-cell" colSpan={7}>
              <span className={`flex items-center gap-2.5 font-display text-lg font-semibold ${cor}`}><span className={`h-2.5 w-2.5 ${fundoTime}`} aria-hidden="true" />Time {time}</span>
            </th>
          </tr>
          <tr className="bg-superficie-alta/60 text-left font-mono text-[11px] text-texto-fraco [&>th]:font-medium">
            <th className="px-3 py-2">Jogador</th>
            <th className="px-2 py-2 text-right" title="Smokes / Flashes / HEs / Molotovs jogadas">Granadas</th>
            <th className="px-2 py-2 text-right" title="Inimigos cegados por mais de 1.1s (vezes) e segundos totais — cegueira rápida/de raspão não conta">Cegou inimigo</th>
            <th className="hidden px-2 py-2 text-right sm:table-cell" title="Aliados cegados por mais de 1.1s (vezes) e segundos totais — inclui auto-flash">Cegou aliado</th>
            <th className="hidden px-2 py-2 text-right sm:table-cell" title="Flash que cegou um inimigo morto por um colega logo em seguida, ainda cego (crédito pra quem jogou a flash)">Flash assist</th>
            <th className="px-2 py-2 text-right" title="Dano de HE em inimigo (fogo amigo à parte, entre parênteses)">Dano HE</th>
            <th className="px-2 py-2 text-right" title="Dano de molotov/incendiary em inimigo (fogo amigo à parte, entre parênteses)">Dano fogo</th>
          </tr>
        </thead>
        <tbody className="font-mono">
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
              <td colSpan={7} className="px-3 py-4 text-center text-xs text-texto-fraco">
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
      <p className="max-w-4xl text-xs leading-relaxed text-texto-fraco">
        Granadas = smokes/flashes/HEs/molotovs jogadas (não necessariamente acertaram alguém).{' '}
        Cegou = vezes que a flash pegou alguém por mais de 1.1s (cegueira de raspão não conta — mesmo critério do Leetify), com o total de segundos causados. Auto-flash conta como "cegou aliado".{' '}
        Dano HE/fogo = só em inimigo; número em <span className="text-perigo">vermelho entre parênteses</span> é fogo amigo.
      </p>
    </div>
  )
}

// Seletor de jogador pro clipe (estilo Allstar.gg "Your Moments" — avatar + nick,
// clicável, time A/B lado a lado). Um ✓ pequeno indica que esse jogador já tem
// clipe pronto (Processed), pra não precisar clicar em todos pra descobrir.
function BotaoJogadorClipe({ p, selecionado, onClick }) {
  const temClipeProcessado = p.allstarClip?.status === 'Processed'
  return (
    <button
      onClick={onClick}
      aria-pressed={selecionado}
      className={`panel-cut-tr flex min-h-10 items-center gap-2 border px-2.5 py-1.5 font-mono text-xs transition-colors lg:min-h-9 ${
        selecionado
          ? 'border-destaque/70 bg-destaque/10 text-texto'
          : 'border-borda bg-superficie text-texto-fraco hover:border-borda-forte hover:bg-superficie-alta hover:text-texto'
      }`}
    >
      <Avatar p={p} size={20} />
      <span className="max-w-[7rem] truncate">{p.nick || p.steamId}</span>
      {temClipeProcessado && (
        <span title="Já tem clipe pronto" className="h-1.5 w-1.5 rounded-full bg-sucesso">
          <span className="sr-only">Já tem clipe pronto</span>
        </span>
      )}
    </button>
  )
}

function IconePlay({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M7 5v14l12-7z" />
    </svg>
  )
}

// Painel do jogador selecionado na aba Clipes: sem clipe ainda -> botão "gerar";
// Submitted -> "gerando…"; Error -> permite tentar de novo; Processed -> player
// embutido do Allstar, mesmo layout (vídeo + info ao lado) do resto do sistema.
function PainelClipeJogador({ jogador, clip, pedindo, erro, aberto, onAbrir, onGerar, viewerSteamId, m, placar, podeEnviarCompeticao, onAbrirSeletorCompeticao }) {
  // demo_url nulo (cleanup de 14 dias, ou Partida que nunca teve .dem): o servidor
  // responde 404. Esconde a ação em vez de deixar o clique falhar.
  const semDemo = !m.demoUrl
  const nome = jogador.nick || jogador.steamId
  const avisoSemDemo = (
    <span className="text-xs text-texto-fraco">
      Demo não arquivada — não dá pra gerar clipe nem baixar o .dem.
    </span>
  )
  const casca = 'mt-4 panel-cut border border-borda bg-superficie p-4 realce-topo'
  if (!clip) {
    return (
      <div className={casca}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-mono text-sm text-texto"><Avatar p={jogador} size={24} />{nome}</span>
          {semDemo ? avisoSemDemo : (
            <Button variante="primario" onClick={onGerar} carregando={pedindo}>
              gerar melhor clipe da partida
            </Button>
          )}
        </div>
        {erro && <EstadoErro mensagem={erro} className="mt-3" />}
      </div>
    )
  }
  if (clip.status === 'Submitted') {
    return (
      <div className={`${casca} flex items-center gap-3 text-sm text-texto-fraco`} role="status">
        <span className="h-2 w-2 shrink-0 animate-pulso-sinal rounded-full bg-destaque" aria-hidden="true" />
        Gerando o melhor clipe de {nome}… pode levar alguns minutos.
      </div>
    )
  }
  if (clip.status === 'Error') {
    return (
      <div className={`${casca} space-y-3`}>
        <EstadoErro
          mensagem={`Falha ao gerar o clipe de ${nome}.`}
          acao={semDemo ? null : (
            <Button variante="secundario" tamanho="sm" onClick={onGerar} carregando={pedindo}>
              tentar de novo
            </Button>
          )}
        />
        {semDemo && <p>{avisoSemDemo}</p>}
        {erro && <p className="text-xs text-perigo">{erro}</p>}
      </div>
    )
  }
  // Processed
  return (
    <div className={casca}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-mono text-sm text-texto">
          <Avatar p={jogador} size={24} />
          {nome}{clip.roundNumber ? <span className="text-texto-fraco"> · round {clip.roundNumber}</span> : ''}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {podeEnviarCompeticao && (
            <Button variante="fantasma" tamanho="sm" onClick={onAbrirSeletorCompeticao}>
              Enviar pra competição →
            </Button>
          )}
          <Button variante={aberto ? 'secundario' : 'contorno'} tamanho="sm" onClick={onAbrir} icone={aberto ? null : <IconePlay />}>
            {aberto ? 'fechar' : 'assistir'}
          </Button>
        </span>
      </div>
      {aberto && (
        <div className="mt-4 flex flex-col gap-4 lg:flex-row">
          <div className="aspect-video w-full lg:max-w-xl">
            <iframe
              src={`${clip.clipUrl}&UID=${viewerSteamId ?? ''}&location=matchResults`}
              allow="autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"
              allowFullScreen
              className="h-full w-full border border-borda"
              title={`Melhor clipe de ${nome}`}
            />
          </div>
          <div className="flex-1 space-y-3 border-t border-borda pt-4 lg:max-w-xs lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <div>
              <Badge tom="destaque">MELHOR MOMENTO</Badge>
              <p className="mt-2 font-mono text-sm text-texto">
                {nome}{clip.roundNumber ? ` · round ${clip.roundNumber}` : ''}
              </p>
            </div>
            <div className="space-y-1 font-mono text-xs text-texto-fraco">
              <p>{nomeMapa(m.map)} · {placar.a}-{placar.b}</p>
              <p>{dataHora(m.playedAt)}</p>
            </div>
            <a
              href={clip.clipUrl}
              target="_blank"
              rel="noreferrer"
              className={classesBotao({ variante: 'fantasma', tamanho: 'sm', className: '-ml-3' })}
            >
              Abrir no Allstar.gg ↗
            </a>
          </div>
        </div>
      )}
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
    <form onSubmit={enviar} className="panel-cut space-y-3 border border-borda bg-superficie p-4 realce-topo">
      <p className="rotulo">Anexar clipe externo</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={steamId} onChange={(e) => setSteamId(e.target.value)}>
          {doGrupo.map((p) => (
            <option key={p.steamId} value={p.steamId}>{p.nick || p.steamId}</option>
          ))}
        </Select>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Link do Allstar/Medal/YouTube"
          aria-label="Link do clipe"
          className="min-w-0 flex-1 basis-56"
        />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título (opcional)"
          aria-label="Título do clipe"
          className="sm:w-44"
        />
        <Button type="submit" variante="primario">
          Anexar clipe
        </Button>
      </div>
      {erro && <p className="text-sm text-perigo">{erro}</p>}
    </form>
  )
}

const ABAS = [
  { id: 'geral', label: 'Visão Geral' },
  { id: 'h2h', label: 'Head to Head' },
  { id: 'duelos', label: 'Duelos' },
  { id: 'replay', label: 'Replay 2D' },
  { id: 'economia', label: 'Economia' },
  { id: 'utilitaria', label: 'Utilitária' },
  { id: 'clipes', label: 'Clipes' },
]
const ITENS_ABAS = ABAS.map((a) => ({ valor: a.id, rotulo: a.label }))

const LADOS_PLACAR = [
  { valor: 'all', rotulo: 'Ambos' },
  { valor: 'T', rotulo: 'T' },
  { valor: 'CT', rotulo: 'CT' },
]

// Resultado do grupo no hero: ícone + rótulo + cor (Regra do Sinal Duplo — nunca só cor).
const RESULTADO_HERO = {
  vitoria: { rotulo: 'Vitória', texto: 'text-sucesso', path: 'M12 19V5M6 11l6-6 6 6' },
  derrota: { rotulo: 'Derrota', texto: 'text-perigo', path: 'M12 5v14M6 13l6 6 6-6' },
  empate: { rotulo: 'Empate', texto: 'text-texto-fraco', path: 'M5 12h14' },
  misto: { rotulo: 'Grupo dividido', texto: 'text-texto-fraco', path: null },
}

// Hero da Partida: mapa, placar grande do ponto de vista do grupo, resultado, plataforma
// e data. Abaixo, uma faixa com o MVP e o placar por time (cores de time).
function HeroPartida({ m, resultadoGrupo, placar }) {
  const r = RESULTADO_HERO[resultadoGrupo]
  const origem = origemPartida(m.source, m.temDemo)
  const temMvp = m.mvp && m.mvp.rating != null
  return (
    <section className="panel-cut relative overflow-hidden border border-borda bg-superficie">
      <div className="relative flex flex-col gap-6 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <Link to="/" className="rotulo inline-flex items-center gap-1.5 transition-colors hover:text-texto">
            <span aria-hidden="true">←</span> Partidas
          </Link>
          <div className="mt-3 flex items-center gap-4">
            <MapIcon map={m.map} size={56} />
            <div className="min-w-0">
              <h2 className="truncate font-display text-4xl font-semibold leading-none text-texto sm:text-5xl">
                {nomeMapa(m.map)}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <PlataformaBadge source={m.source} plataformaManual={m.plataformaManual} />
                <span
                  title={origem.title}
                  className="panel-cut-tr border border-borda bg-superficie-alta px-1.5 py-0.5 font-mono text-[11px] text-texto-fraco"
                >
                  {origem.label}
                </span>
                <span className="font-mono text-xs text-texto-fraco">{dataHora(m.playedAt)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start sm:items-end" title={r?.rotulo === 'Grupo dividido' ? 'O grupo jogou dividido nos dois times' : undefined}>
          {r && (
            <span className={`flex items-center gap-1.5 font-mono text-xs font-bold ${r.texto}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                {r.path ? <path d={r.path} /> : <circle cx="12" cy="12" r="6" />}
              </svg>
              {r.rotulo}
            </span>
          )}
          <div className="mt-1 font-display text-6xl font-semibold leading-none tabular-nums sm:text-7xl" aria-label={`Placar ${placar.a} a ${placar.b}`}>
            <span className={r?.texto === 'text-texto-fraco' || !r ? 'text-texto' : r.texto}>{placar.a ?? '–'}</span>
            <span className="mx-1.5 text-texto-fraco/50">:</span>
            <span className="text-texto-fraco">{placar.b ?? '–'}</span>
          </div>
        </div>
      </div>

      <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-borda bg-fundo/40 px-4 py-3 sm:px-6">
        {temMvp ? <DestaqueMvp mvp={m.mvp} /> : <span className="rotulo">Sem MVP do grupo</span>}
        <div className="flex items-center gap-4 font-mono text-xs">
          <span className="flex items-center gap-2 text-texto-fraco">
            <span className="h-2 w-2 bg-time-a" aria-hidden="true" />Time A
            <span className="font-display text-xl font-semibold leading-none tabular-nums text-time-a">{m.scoreA ?? '–'}</span>
          </span>
          <span className="flex items-center gap-2 text-texto-fraco">
            <span className="font-display text-xl font-semibold leading-none tabular-nums text-time-b">{m.scoreB ?? '–'}</span>
            Time B<span className="h-2 w-2 bg-time-b" aria-hidden="true" />
          </span>
        </div>
      </div>
    </section>
  )
}

function SkeletonPartida() {
  return (
    <div role="status" aria-label="Carregando partida" className="space-y-6">
      <Skeleton className="panel-cut h-48 w-full sm:h-44" />
      <Skeleton className="h-11 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="panel-cut h-72 w-full" />
        <Skeleton className="panel-cut h-72 w-full" />
      </div>
      <span className="sr-only">Carregando…</span>
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
  // Filtro T/CT dentro da Partida (estilo scope.gg/Leetify): recalcula K/D/A/ADR/
  // Rating/KAST só nos rounds daquele lado. 'all' usa o que já vem em m.players
  // (nenhum fetch extra); T/CT busca /lado/:filtro e sobrescreve por steamId.
  const [ladoFiltro, setLadoFiltro] = useState('all')
  const [statsLado, setStatsLado] = useState(null)
  // Clipe de vídeo real do Allstar (ADR-0004, teste restrito) — por JOGADOR, não mais
  // por highlight (só POTG/BP habilitados na nossa conta, e nenhum mira um round
  // específico; BP mira o jogador, então virou "gerar o melhor clipe da partida pra
  // esse jogador" — ver allstarClip.js e a aba Clipes abaixo).
  const [jogadorClipeSelecionado, setJogadorClipeSelecionado] = useState(null) // steamId em foco na aba Clipes
  const [clipeAbertoId, setClipeAbertoId] = useState(null) // steamId cujo player está expandido
  const [pedindoClipeJogador, setPedindoClipeJogador] = useState(null) // steamId com pedido em voo
  const [erroClipeJogador, setErroClipeJogador] = useState(null)
  // Atalho "Enviar pra competição →" na aba Clipes: só aparece quando existe uma
  // competição ativa e a partida caiu dentro do período dela (ver JSX da aba Clipes).
  const [competicaoAtiva, setCompeticaoAtiva] = useState(null)
  const [seletorCompeticaoAberto, setSeletorCompeticaoAberto] = useState(false)

  // SOB DEMANDA: só chama o Allstar quando o jogador clica — nada automático. Qualquer
  // Jogador pode gerar o PRÓPRIO clipe; gerar o de outro é restrito ao dono do sistema
  // do lado do servidor — 403 pra quem não pode vira mensagem de erro aqui.
  async function pedirClipeAllstar(steamId) {
    setPedindoClipeJogador(steamId)
    setErroClipeJogador(null)
    try {
      const res = await fetch(`/api/matches/${id}/jogador/${steamId}/clipe`, { method: 'POST' })
      const corpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErroClipeJogador(corpo.erro || 'Falha ao pedir o clipe')
        return
      }
      setM((atual) => atual && ({
        ...atual,
        players: atual.players.map((p) => (
          p.steamId === steamId ? { ...p, allstarClip: { ...(p.allstarClip ?? {}), status: corpo.status } } : p
        )),
      }))
    } catch {
      setErroClipeJogador('Falha ao pedir o clipe')
    } finally {
      setPedindoClipeJogador(null)
    }
  }
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
    setLadoFiltro('all')
    setStatsLado(null)
    setClipeAbertoId(null)
    setJogadorClipeSelecionado(null)
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Busca uma vez (independe da partida) só pra saber se há competição ativa e qual o
  // período dela — decide se o atalho "Enviar pra competição →" aparece na aba Clipes.
  useEffect(() => {
    fetch('/api/competicoes')
      .then((res) => (res.ok ? res.json() : { ativa: null }))
      .then((d) => setCompeticaoAtiva(d.ativa))
      .catch(() => setCompeticaoAtiva(null))
  }, [])

  useEffect(() => {
    if (ladoFiltro === 'all') { setStatsLado(null); return }
    let vivo = true
    setStatsLado(null)
    fetch(`/api/matches/${id}/lado/${ladoFiltro}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((lista) => { if (vivo) setStatsLado(new Map(lista.map((p) => [p.steamId, p]))) })
      .catch(() => { if (vivo) setStatsLado(new Map()) })
    return () => { vivo = false }
  }, [id, ladoFiltro])

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

  // Veio de "?round=<n>&tick=<t>[&frame=<f>]" (Granadas: "Ver no Replay 2D") — abre o
  // Replay 2D no round e no frame da granada (o viewer recua uns segundos pra mostrar o
  // arremesso). Sem frame (Demo antiga), cai no começo do round.
  useEffect(() => {
    const round = Number.parseInt(searchParams.get('round') ?? '', 10)
    if (!m || !Number.isFinite(round) || autoJumpFeito.current || searchParams.get('highlight')) return
    autoJumpFeito.current = true
    const frame = Number.parseInt(searchParams.get('frame') ?? '', 10)
    irParaMomento(round, Number.isFinite(frame) && frame >= 0 ? frame : 0)
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

  if (erro && !m) {
    return (
      <EstadoVazio
        titulo="Partida não encontrada."
        acao={<Button as={Link} to="/" variante="secundario">← Partidas</Button>}
      />
    )
  }
  if (!m) return <SkeletonPartida />

  // Aplica o filtro de lado (se ativo e já carregado) por cima dos dados base da
  // Partida — mantém nick/avatar/weapons/isTracked/premier (só o /lado/:filtro não
  // tem) e sobrescreve K/D/A/ADR/HS%/KAST/rating/roundsPlayed com o recalculado.
  const jogadoresExibidos =
    ladoFiltro === 'all' || !statsLado
      ? m.players
      : m.players.map((p) => (statsLado.has(p.steamId) ? { ...p, ...statsLado.get(p.steamId) } : p))
  const carregandoLado = ladoFiltro !== 'all' && !statsLado
  // Partida ainda não reprocessada depois do FIL-51b não tem side_a — o filtro T/CT
  // devolve roundsPlayed=0 pra todo mundo (não é bug, é dado que não existe ainda).
  const semDadoDeLado =
    ladoFiltro !== 'all' && statsLado && jogadoresExibidos.length > 0 && jogadoresExibidos.every((p) => !p.roundsPlayed)

  const timeA = jogadoresExibidos.filter((p) => p.team === 'A')
  const timeB = jogadoresExibidos.filter((p) => p.team === 'B')
  // Melhor valor de cada coluna na partida INTEIRA (os dois times) — vira a estrela
  // ao lado do valor, estilo Leetify/scope.gg. 0 nunca ganha estrela (evita destacar
  // "melhor" quando todo mundo empata em zero, ex.: assists numa partida sem trade).
  const melhorDe = (campo) => Math.max(0, ...jogadoresExibidos.map((p) => p[campo] ?? 0))
  const melhores = {
    kills: melhorDe('kills'), assists: melhorDe('assists'),
    hsPct: jogadoresExibidos.length ? Math.max(0, ...jogadoresExibidos.map((p) => (p.kills ? Math.round((p.headshotKills / p.kills) * 100) : 0))) : 0,
    adr: jogadoresExibidos.length ? Math.max(0, ...jogadoresExibidos.map((p) => (p.roundsPlayed ? Math.round((p.damage / p.roundsPlayed) * 10) / 10 : 0))) : 0,
    kastPct: melhorDe('kastPct'), rating: melhorDe('rating'),
  }

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
  const placar = orientarPlacar(m.scoreA, m.scoreB, resultadoGrupo)

  return (
    <div className="space-y-6">
      <HeroPartida m={m} resultadoGrupo={resultadoGrupo} placar={placar} />

      {m.endedEarly && (
        <EstadoErro
          mensagem={
            <>
              Partida encerrada antes do fim — nenhum time chegou a 13 rounds, então isso não foi uma vitória normal.
              {m.abandonedBy
                ? ` Provável motivo: ${m.abandonedBy.nick || m.abandonedBy.steamId} desconectou e não voltou.`
                : ' Provavelmente por desistência/desconexão de algum jogador (não deu pra identificar quem com certeza).'}
            </>
          }
        />
      )}

      <AvisoPartidaSemDemo partida={m} euSteamId={jogador?.steamId} onEnviado={carregar} />

      <Abas variante="sublinhado" rotulo="Seções da partida" itens={ITENS_ABAS} valor={abaAtiva} onChange={setAbaAtiva} larguraTotal />

      {abaAtiva === 'geral' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rotulo">Lado</span>
            <Abas rotulo="Filtrar por lado" itens={LADOS_PLACAR} valor={ladoFiltro} onChange={setLadoFiltro} />
            {carregandoLado && <span className="font-mono text-xs text-texto-fraco">recalculando…</span>}
            {semDadoDeLado && (
              <span className="text-xs text-texto-fraco">
                Essa partida ainda não tem o dado de lado (processada antes do fix) — precisa reprocessar.
              </span>
            )}
          </div>

          <div className="grid gap-4">
            <Scoreboard time="A" placar={m.scoreA} doGrupo={timeDoGrupo === 'A'} jogadores={timeA} matchId={m.id} podePromover={jogador?.isSuperAdmin} onPromover={promover} promovendo={promovendo} melhores={melhores} carregando={carregandoLado} />
            <Scoreboard time="B" placar={m.scoreB} doGrupo={timeDoGrupo === 'B'} jogadores={timeB} matchId={m.id} podePromover={jogador?.isSuperAdmin} onPromover={promover} promovendo={promovendo} melhores={melhores} carregando={carregandoLado} />
          </div>
        </>
      )}
      {abaAtiva === 'h2h' && (
        <section>
          <AbaHeadToHead matchId={m.id} jogadores={m.players} jogadorLogado={jogador} />
        </section>
      )}

      {abaAtiva === 'duelos' && <DuelosPartida matchId={m.id} />}

      {abaAtiva === 'replay' && (
        <>
          <section ref={replayRef}>
            <SecaoReplay
              replayUrl={m.replayUrl}
              seek={seek}
              matchId={m.id}
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

          {m.highlights.length > 0 && (
            <section>
              <SectionHeader titulo="Highlights" />
              <div className="flex flex-wrap gap-2">
                {m.highlights.map((h) => {
                  const podeAssistir = h.frame != null && m.replayUrl
                  const conteudo = (
                    <>
                      <span className="font-display font-semibold text-destaque">{h.kind}</span>{' '}
                      <span className="text-texto">{h.nick || h.steamId}</span>{' '}
                      <span className="text-texto-fraco">round {h.roundNumber}</span>
                      {podeAssistir && <span className="ml-1.5 text-texto-fraco">▶</span>}
                    </>
                  )
                  return podeAssistir ? (
                    <button
                      key={h.id}
                      onClick={() => irParaHighlight(h)}
                      className="border border-borda bg-superficie px-3 py-2 font-mono text-sm transition-colors hover:border-borda-forte hover:bg-superficie-alta"
                      title="Assistir nesse momento"
                    >
                      {conteudo}
                    </button>
                  ) : (
                    <div key={h.id} className="border border-borda bg-superficie px-3 py-2 font-mono text-sm">
                      {conteudo}
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}

      {abaAtiva === 'economia' && (
        <section>
          {m.economia?.length > 0 ? (
            <LinhaDoTempoEconomia economia={m.economia} timeDoGrupo={timeDoGrupo} timeA={timeA} timeB={timeB} />
          ) : (
            <EstadoVazio titulo="Sem dados de economia" descricao="Sem dados de economia pra essa Partida (demo antiga)." />
          )}
        </section>
      )}

      {abaAtiva === 'utilitaria' && (
        <section>
          <TabelaUtilitaria timeA={timeA} timeB={timeB} />
        </section>
      )}

      {abaAtiva === 'clipes' && (
        <section className="space-y-6">
          <div>
            <SectionHeader titulo="Clipe do jogo (Allstar, escolhe a melhor jogada)" margem="pequena" />
            <p className="mb-3 text-sm text-texto-fraco">
              A Allstar escolhe sozinha o melhor momento do jogador na partida inteira — não dá
              pra escolher um round específico. Selecione um jogador:
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-2">
                {timeA.map((p) => (
                  <BotaoJogadorClipe
                    key={p.steamId} p={p}
                    selecionado={jogadorClipeSelecionado === p.steamId}
                    onClick={() => setJogadorClipeSelecionado(p.steamId)}
                  />
                ))}
              </div>
              <span className="font-mono text-xs text-texto-fraco">vs</span>
              <div className="flex flex-wrap gap-2">
                {timeB.map((p) => (
                  <BotaoJogadorClipe
                    key={p.steamId} p={p}
                    selecionado={jogadorClipeSelecionado === p.steamId}
                    onClick={() => setJogadorClipeSelecionado(p.steamId)}
                  />
                ))}
              </div>
            </div>

            {(() => {
              const jogadorSel = m.players.find((p) => p.steamId === jogadorClipeSelecionado)
              if (!jogadorSel) return null
              return (
                <PainelClipeJogador
                  jogador={jogadorSel}
                  clip={jogadorSel.allstarClip}
                  pedindo={pedindoClipeJogador === jogadorSel.steamId}
                  erro={jogadorClipeSelecionado === jogadorSel.steamId ? erroClipeJogador : null}
                  aberto={clipeAbertoId === jogadorSel.steamId}
                  onAbrir={() => setClipeAbertoId(clipeAbertoId === jogadorSel.steamId ? null : jogadorSel.steamId)}
                  onGerar={() => pedirClipeAllstar(jogadorSel.steamId)}
                  viewerSteamId={jogador?.steamId}
                  m={m}
                  placar={placar}
                  // Atalho "Enviar pra competição →": só quando existe competição ativa e
                  // essa partida caiu dentro do período dela (mesma checagem que o servidor
                  // faz em GET /api/competicoes/:id/elegiveis — aqui é só pra decidir se o
                  // botão aparece).
                  podeEnviarCompeticao={Boolean(
                    competicaoAtiva && m.playedAt &&
                    new Date(m.playedAt) >= new Date(competicaoAtiva.dataInicio) &&
                    new Date(m.playedAt) <= new Date(competicaoAtiva.dataFim),
                  )}
                  onAbrirSeletorCompeticao={() => setSeletorCompeticaoAberto(true)}
                />
              )
            })()}
          </div>

          <SecaoClipeReal
            matchId={m.id}
            jogadores={m.players}
            viewerSteamId={jogador?.steamId}
          />

          <div>
            <div className="mb-3 space-y-2">
              {m.clips.length === 0 && (
                <EstadoVazio titulo="Nenhum clipe anexado ainda." descricao="Cole abaixo um link do Allstar, Medal ou YouTube." />
              )}
              {m.clips.map((c) => (
                <a
                  key={c.id}
                  href={hrefSeguro(c.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="panel-cut-sm flex items-center gap-3 border border-borda bg-superficie p-3 font-mono text-sm transition-colors hover:border-destaque/60"
                >
                  <span className="panel-cut-sm flex-shrink-0 bg-fundo px-2 py-1 text-xs text-destaque">{c.provider}</span>
                  <span className="min-w-0 flex-1 truncate text-texto">{c.title || c.url}</span>
                </a>
              ))}
            </div>
            <FormClipe matchId={m.id} jogadores={m.players} onAdicionado={carregar} />
          </div>
        </section>
      )}
      {seletorCompeticaoAberto && competicaoAtiva && (
        <SeletorClipesCompeticao
          competicaoId={competicaoAtiva.id}
          onFechar={() => setSeletorCompeticaoAberto(false)}
          onEnviado={() => setSeletorCompeticaoAberto(false)}
        />
      )}
    </div>
  )
}
