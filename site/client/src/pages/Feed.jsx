import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { nomeMapa, dataHora, origemPartida, corRating } from '../lib/format.js'
import { orientarPlacar } from '../lib/resultado.js'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'
import { Avatar, Card, SectionHeader, Badge, MapIcon, Select, ResultChip, PlataformaBadge } from '../components/ui'

const MAPAS = ['de_anubis', 'de_ancient', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_train', 'de_vertigo']

// Resultado do ponto de vista do GRUPO (não do "Time A"): vitória/derrota quando todo
// mundo do grupo estava no mesmo lado; 'misto' quando o grupo se dividiu nos dois times.
// won é nullable no banco (empate — placar igual, ex.: 12:12 — não tem vencedor); só
// checar `!x.won` trataria empate como derrota, então os 3 estados são explícitos.
function resultadoDoGrupo(m) {
  const t = m.tracked ?? []
  if (t.length === 0) return null
  if (t.every((x) => x.won === true)) return 'vitoria'
  if (t.every((x) => x.won === false)) return 'derrota'
  if (t.every((x) => x.won === null)) return 'empate'
  return 'misto'
}

// Linha de contexto: nomes dos times (partida pro) ou jogadores rastreados, com o MVP
// destacado por um mini-avatar (dá "rosto" ao dado, igual à referência do Faceit) — mesmo
// dado nos dois casos, um jeito só de montar.
function contextoPartida(m) {
  const mvpChip = m.mvp && (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <Avatar p={m.mvp} size={16} />
      <span className="text-texto">{m.mvp.nick}</span>
    </span>
  )
  if (m.source === 'pro' && m.teamAName && m.teamBName) {
    return (
      <>
        {m.teamAName} x {m.teamBName}
        {mvpChip && <span> · {mvpChip}</span>}
      </>
    )
  }
  if (m.tracked?.length > 0) {
    const outros = m.tracked.filter((t) => t.steamId !== m.mvp?.steamId)
    return (
      <>
        {outros.map((t) => t.nick).join(', ')}
        {mvpChip && <span>{outros.length > 0 && ', '}{mvpChip}</span>}
      </>
    )
  }
  return null
}

// Uma linha por Partida — layout único que reflui (não duas árvores JSX mobile/desktop
// separadas): mapa+nome+badges numa ponta, chip de resultado sempre grudado na outra,
// e a linha inteira quebra pro card empilhar em telas estreitas sem duplicar código.
// Sem side-stripe colorido pra indicar vitória/derrota (ver DESIGN.md, Don't) — o chip
// preenchido + ícone já comunicam isso sozinhos.
function CardPartida({ m }) {
  const resultado = resultadoDoGrupo(m)
  const origem = origemPartida(m.source)
  const { a, b } = orientarPlacar(m.scoreA, m.scoreB, resultado)
  const contexto = contextoPartida(m)

  return (
    <Card as={Link} interativo to={`/partida/${m.id}`} className="block p-4 hover:bg-superficie-alta">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <MapIcon map={m.map} size={44} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="w-full truncate font-display text-lg font-bold uppercase tracking-wide text-texto lg:w-auto">
            {nomeMapa(m.map)}
          </span>
          {m.source === 'pro' && <Badge tom="destaque" className="shrink-0">PRO</Badge>}
          <PlataformaBadge source={m.source} className="shrink-0" />
          <Badge tom="neutro" title={origem.title} className="shrink-0">{origem.label}</Badge>
        </div>
        <div className="ml-auto">
          <ResultChip resultado={resultado} a={a} b={b} />
        </div>
      </div>
      {(dataHora(m.playedAt) || contexto) && (
        <div className="mt-2 truncate pl-[60px] font-mono text-xs text-texto-fraco">
          {dataHora(m.playedAt)}
          {contexto && <span> · {contexto}</span>}
        </div>
      )}
    </Card>
  )
}

// Quantas Partidas descobertas ainda faltam baixar/parsear (o Coletor roda de hora
// em hora sozinho — isto é só visibilidade, não dispara nada). Atualiza a cada 30s
// enquanto a aba estiver aberta, pra acompanhar um backfill grande em andamento.
function SincStatus() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let vivo = true
    function carregar() {
      fetch('/api/matches/sync-status')
        .then((res) => (res.ok ? res.json() : null))
        .then((s) => { if (vivo) setStatus(s) })
        .catch(() => {})
    }
    carregar()
    const t = setInterval(carregar, 30000)
    return () => { vivo = false; clearInterval(t) }
  }, [])

  if (!status || (status.pending === 0 && status.failed === 0)) return null
  return (
    <div className="panel-cut-sm mb-4 flex flex-wrap items-center gap-2 border border-borda bg-superficie px-3 py-2 font-mono text-xs text-texto-fraco">
      <span className="inline-block h-1.5 w-1.5 animate-pulso-sinal rounded-full bg-destaque" />
      {status.pending > 0 && (
        <span>
          <span className="text-texto">{status.pending}</span> partida{status.pending === 1 ? '' : 's'} pra sincronizar
        </span>
      )}
      {status.failed > 0 && (
        <span title="Demo expirado na Valve ou falha de download — sem solução automática">
          · <span className="text-perigo">{status.failed}</span> com falha
        </span>
      )}
    </div>
  )
}

// Um card de sessão — layout único (sem duplicar mobile/desktop): largura fixa que
// funciona bem tanto no carrossel touch do celular quanto na fileira do desktop.
// Clicável: filtra a lista de Partidas abaixo pra só as dessa Resenha (ver Feed()).
function CardResenha({ s, ativo, onClick }) {
  return (
    <Card
      as="button"
      interativo
      onClick={onClick}
      className={`w-60 shrink-0 snap-start p-3 text-left ${ativo ? 'border-destaque' : ''}`}
    >
      <div className="flex items-center justify-between font-mono text-xs text-texto-fraco">
        <span>{dataHora(s.inicio)}</span>
        <span>{s.partidas} partida{s.partidas === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 font-display text-lg font-bold">
        {s.vitorias > 0 && <span className="text-sucesso">{s.vitorias}V</span>}
        {s.derrotas > 0 && <span className="text-perigo">{s.derrotas}D</span>}
        {s.empates > 0 && <span className="text-texto-fraco">{s.empates}E</span>}
        {s.mistos > 0 && <span className="text-texto-fraco">{s.mistos} misto</span>}
      </div>
      {s.destaque && (
        <div className="mt-2 flex items-center gap-2 border-t border-borda pt-2 font-mono text-xs">
          <Avatar p={s.destaque} size={22} />
          <div className="min-w-0">
            <Link to={`/jogador/${s.destaque.steamId}`} className="truncate text-texto hover:text-destaque">
              {s.destaque.nick}
            </Link>{' '}
            <span className={corRating(s.destaque.ratingMedio)}>{s.destaque.ratingMedio.toFixed(2)}</span>
            {s.destaque.aces > 0 && <span className="ml-1 text-texto-fraco">· {s.destaque.aces} ace{s.destaque.aces > 1 ? 's' : ''}</span>}
          </div>
        </div>
      )}
    </Card>
  )
}

// "Resenhas": partidas jogadas seguidas (gap < 3h) resumidas — quem se destacou,
// quantas venceu/perdeu, sem precisar abrir partida por partida. Clicar num card
// filtra a lista de Partidas abaixo pra só as dessa Resenha (clicar de novo limpa).
function Resenhas({ sessaoAtiva, onEscolher }) {
  const [sessoes, setSessoes] = useState(null)

  useEffect(() => {
    fetch('/api/sessions?limit=5')
      .then((res) => (res.ok ? res.json() : []))
      .then(setSessoes)
      .catch(() => setSessoes([]))
  }, [])

  if (!sessoes || sessoes.length === 0) return null

  return (
    <section className="mb-6">
      <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
        Resenhas recentes
      </h3>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1">
        {sessoes.map((s) => (
          <CardResenha
            key={s.matchIds[0]}
            s={s}
            ativo={sessaoAtiva?.matchIds[0] === s.matchIds[0]}
            onClick={() => onEscolher(sessaoAtiva?.matchIds[0] === s.matchIds[0] ? null : s)}
          />
        ))}
      </div>
    </section>
  )
}

const TAMANHO_PAGINA = 20

export default function Feed() {
  const [partidas, setPartidas] = useState(null)
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [mapa, setMapa] = useState('')
  const [origem, setOrigem] = useState('')
  const [resultado, setResultado] = useState('')
  const [mvp, setMvp] = useState('')
  const [jogadores, setJogadores] = useState([])
  const [temMais, setTemMais] = useState(false)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [sessaoAtiva, setSessaoAtiva] = useState(null)

  // Guard de corrida: cada busca (troca de filtro ou "carregar mais") incrementa
  // este contador; só a resposta da requisição mais recente pode aplicar estado.
  const requisicaoAtual = useRef(0)

  useEffect(() => {
    fetch('/api/players')
      .then((res) => (res.ok ? res.json() : []))
      // guarda: só array vira lista; resposta inesperada (objeto/erro) não pode
      // derrubar a home no jogadores.map do filtro de MVP.
      .then((data) => setJogadores(Array.isArray(data) ? data : []))
      .catch(() => setJogadores([]))
  }, [])

  function montarQs(offset) {
    const qs = new URLSearchParams()
    if (de) qs.set('from', de)
    if (ate) qs.set('to', ate)
    if (mapa) qs.set('map', mapa)
    if (origem) qs.set('source', origem)
    if (mvp) qs.set('mvp', mvp)
    qs.set('limit', String(TAMANHO_PAGINA))
    qs.set('offset', String(offset))
    return qs
  }

  // Ao montar ou trocar qualquer filtro: reseta a lista e busca a 1ª página.
  // Com uma Resenha selecionada, ignora os filtros normais e busca só as Partidas
  // dela (ids fixos, sem paginação — uma Resenha nunca tem tantas partidas assim).
  useEffect(() => {
    const minhaRequisicao = ++requisicaoAtual.current
    setPartidas(null)
    setTemMais(false)
    const qs = sessaoAtiva ? new URLSearchParams({ ids: sessaoAtiva.matchIds.join(',') }) : montarQs(0)
    fetch(`/api/matches?${qs}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (requisicaoAtual.current !== minhaRequisicao) return
        const lista = Array.isArray(data) ? data : []
        setPartidas(lista)
        setTemMais(!sessaoAtiva && lista.length === TAMANHO_PAGINA)
      })
      .catch(() => {
        if (requisicaoAtual.current !== minhaRequisicao) return
        setPartidas([])
        setTemMais(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate, mapa, origem, mvp, sessaoAtiva])

  function carregarMais() {
    if (carregandoMais || !partidas || sessaoAtiva) return
    const minhaRequisicao = ++requisicaoAtual.current
    setCarregandoMais(true)
    fetch(`/api/matches?${montarQs(partidas.length)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (requisicaoAtual.current !== minhaRequisicao) return
        const lista = Array.isArray(data) ? data : []
        setPartidas((atual) => [...(atual ?? []), ...lista])
        setTemMais(lista.length === TAMANHO_PAGINA)
      })
      .catch(() => {
        if (requisicaoAtual.current !== minhaRequisicao) return
        setTemMais(false)
      })
      .finally(() => {
        if (requisicaoAtual.current === minhaRequisicao) setCarregandoMais(false)
      })
  }

  // Resultado (V/D) é do ponto de vista do grupo — filtrado no client.
  const visiveis = useMemo(() => {
    if (!partidas) return null
    if (!resultado) return partidas
    return partidas.filter((m) => resultadoDoGrupo(m) === resultado)
  }, [partidas, resultado])

  return (
    <div>
      <SectionHeader titulo="Partidas" className="mb-4" />
      <SincStatus />
      <Resenhas sessaoAtiva={sessaoAtiva} onEscolher={setSessaoAtiva} />

      {sessaoAtiva && (
        <div className="panel-cut-sm mb-4 flex items-center gap-3 border border-destaque/60 bg-superficie px-3 py-2 font-mono text-xs">
          <span className="text-texto-fraco">
            Mostrando a Resenha de <span className="text-texto">{dataHora(sessaoAtiva.inicio)}</span> ({sessaoAtiva.partidas} partida{sessaoAtiva.partidas === 1 ? '' : 's'})
          </span>
          <button onClick={() => setSessaoAtiva(null)} className="ml-auto uppercase text-destaque hover:underline">
            Limpar
          </button>
        </div>
      )}

      <div className={`panel-cut-sm mb-4 flex flex-col gap-3 border border-borda bg-superficie p-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-5 lg:gap-y-3 ${sessaoAtiva ? 'hidden' : ''}`}>
        <div className="flex flex-wrap items-center gap-3">
          <FiltroPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />
          <Select value={mapa} onChange={(e) => setMapa(e.target.value)} className="w-auto" selectClassName="py-1.5 text-xs">
            <option value="">Todos os mapas</option>
            {MAPAS.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
          </Select>
          <Select value={mvp} onChange={(e) => setMvp(e.target.value)} className="w-auto" selectClassName="py-1.5 text-xs">
            <option value="">Todos os MVPs</option>
            {jogadores.map((j) => <option key={j.steamId} value={j.steamId}>{j.nick}</option>)}
          </Select>
        </div>
        <div className="flex flex-col gap-2 lg:ml-auto lg:flex-row lg:flex-wrap lg:items-center lg:gap-3">
          <div className="panel-cut-sm flex w-full overflow-hidden border border-borda font-mono text-xs uppercase lg:w-auto">
            {[['', 'Tudo'], ['vitoria', 'Vitórias'], ['derrota', 'Derrotas']].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setResultado(v)}
                className={`flex-1 min-h-10 px-3 py-1.5 transition-colors lg:min-h-0 lg:flex-none ${resultado === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="panel-cut-sm flex w-full overflow-hidden border border-borda font-mono text-xs uppercase lg:w-auto">
            {[['', 'Todas'], ['valve_mm', 'Auto'], ['upload', 'Manual']].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setOrigem(v)}
                className={`flex-1 min-h-10 px-3 py-1.5 transition-colors lg:min-h-0 lg:flex-none ${origem === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {visiveis === null && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
      {visiveis?.length === 0 && (
        <p className="font-mono text-sm text-texto-fraco">
          Nenhuma Partida encontrada com esses filtros.
        </p>
      )}
      <div className="space-y-2">
        {visiveis?.map((m) => <CardPartida key={m.id} m={m} />)}
      </div>

      {temMais && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={carregarMais}
            disabled={carregandoMais}
            className="panel-cut-sm min-h-10 border border-borda bg-superficie px-5 py-2 font-mono text-sm uppercase tracking-wide text-texto transition-colors hover:border-destaque hover:text-destaque disabled:cursor-not-allowed disabled:opacity-60"
          >
            {carregandoMais ? 'Carregando…' : 'Carregar mais'}
          </button>
        </div>
      )}
    </div>
  )
}
