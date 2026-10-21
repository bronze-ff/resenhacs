import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { nomeMapa, dataHora, corRating } from '../lib/format.js'
import { METRICAS } from '../lib/metricas.js'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'
import CardPartidaFeed from '../components/feed/CardPartidaFeed.jsx'
import SessaoDeHoje, { sessaoDeHoje } from '../components/feed/SessaoDeHoje.jsx'
import AvisoRecorde from '../components/feed/AvisoRecorde.jsx'
import PrimeirosPassos from '../components/inicio/PrimeirosPassos.jsx'
import {
  Abas, Avatar, Button, CabecalhoPagina, Card, EstadoVazio, Explicacao, Select, SkeletonLista,
} from '../components/ui'

const MAPAS = ['de_anubis', 'de_ancient', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_train', 'de_vertigo']

// Plataformas filtráveis — mesmo universo do PlataformaBadge: Premier (valve_mm) e
// FACEIT vêm da integração automática; Gamers Club e XPLAY.GG só existem como rótulo
// manual do Enviar Demo. O servidor resolve o cruzamento source × plataforma_manual.
const PLATAFORMAS = [
  ['premier', 'Premier'],
  ['faceit', 'FACEIT'],
  ['gamers_club', 'Gamers Club'],
  ['xplay_gg', 'XPLAY.GG'],
]

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
    <div className="panel-cut-sm flex flex-wrap items-center gap-2 border border-borda bg-superficie px-3 py-2 font-mono text-xs text-texto-fraco">
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
      aria-pressed={ativo}
      className={`w-64 shrink-0 snap-start p-4 text-left ${ativo ? '!border-destaque/70 !bg-superficie-alta' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 font-mono text-xs text-texto-fraco">
        <span>{dataHora(s.inicio)}</span>
        <span className="tabular-nums">{s.partidas} partida{s.partidas === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-3 font-display text-2xl font-semibold leading-none tabular-nums">
        {s.vitorias > 0 && <span className="text-sucesso">{s.vitorias}<span className="ml-0.5 text-sm">V</span></span>}
        {s.derrotas > 0 && <span className="text-perigo">{s.derrotas}<span className="ml-0.5 text-sm">D</span></span>}
        {s.empates > 0 && <span className="text-texto-fraco">{s.empates}<span className="ml-0.5 text-sm">E</span></span>}
        {s.mistos > 0 && <span className="text-texto-fraco">{s.mistos}<span className="ml-1 text-sm">misto</span></span>}
      </div>
      {s.destaque && (
        <div className="mt-3 flex items-center gap-2 border-t border-borda pt-3 font-mono text-xs">
          <Avatar p={s.destaque} size={22} />
          <div className="min-w-0">
            <Link to={`/jogador/${s.destaque.steamId}`} className="truncate text-texto hover:text-destaque">
              {s.destaque.nick}
            </Link>{' '}
            <span className={corRating(s.destaque.ratingMedio)}>{s.destaque.ratingMedio?.toFixed(2) ?? '–'}</span>
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
function Resenhas({ sessoes, sessaoAtiva, onEscolher }) {
  if (!sessoes || sessoes.length === 0) return null

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        {/* Explicação no título, não em cada card: o card é um <button> e não pode ter outro botão dentro. */}
        <h3 className="rotulo"><Explicacao metrica={METRICAS.resultadoSessao}>Resenhas recentes</Explicacao></h3>
        <span className="hidden font-mono text-[11px] text-texto-fraco sm:inline">clique pra filtrar as Partidas</span>
      </div>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1">
        {(sessoes ?? []).map((s) => (
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
  const [plataforma, setPlataforma] = useState('')
  const [resultado, setResultado] = useState('')
  // Filtro por participação (partidas em que o jogador jogou) — era "MVP", mas o nome e
  // a semântica confundiam: o usuário escolhia o próprio nick esperando as partidas dele.
  const [jogador, setJogador] = useState('')
  const [jogadores, setJogadores] = useState([])
  const [temMais, setTemMais] = useState(false)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [sessaoAtiva, setSessaoAtiva] = useState(null)
  // Resenhas (sessões) buscadas uma vez aqui: alimentam o carrossel E o card "Sessão de
  // hoje" da lateral.
  const [sessoes, setSessoes] = useState(null)

  useEffect(() => {
    fetch('/api/sessions?limit=5')
      .then((res) => (res.ok ? res.json() : []))
      .then((d) => setSessoes(Array.isArray(d) ? d : []))
      .catch(() => setSessoes([]))
  }, [])

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
    if (plataforma) qs.set('plataforma', plataforma)
    if (jogador) qs.set('jogador', jogador)
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
  }, [de, ate, mapa, origem, plataforma, jogador, sessaoAtiva])

  function carregarMais() {
    if (carregandoMais || !partidas || sessaoAtiva) return
    const minhaRequisicao = ++requisicaoAtual.current
    setCarregandoMais(true)
    fetch(`/api/matches?${montarQs(partidas.length)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (requisicaoAtual.current !== minhaRequisicao) return
        const lista = Array.isArray(data) ? data : []
        // Paginação por offset: uma Partida nova entrando no topo empurra a lista e a
        // última da página anterior volta repetida. Descarta o que já está na tela.
        setPartidas((atual) => {
          const vistas = new Set((atual ?? []).map((m) => m.id))
          return [...(atual ?? []), ...lista.filter((m) => !vistas.has(m.id))]
        })
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

  const resultados = useMemo(() => new Map((partidas ?? []).map((m) => [m.id, resultadoDoGrupo(m)])), [partidas])
  const hoje = sessaoDeHoje(sessoes)
  const avatares = useMemo(() => new Map(jogadores.filter((j) => j.avatarUrl).map((j) => [j.steamId, j.avatarUrl])), [jogadores])
  const temFiltro = Boolean(de || ate || mapa || origem || plataforma || resultado || jogador)
  function limparFiltros() {
    setDe('')
    setAte('')
    setMapa('')
    setOrigem('')
    setPlataforma('')
    setResultado('')
    setJogador('')
  }

  return (
    <div className="space-y-6">
      <CabecalhoPagina
        eyebrow="Início"
        titulo="Partidas"
        descricao="Toda Partida sua e dos seus amigos, da mais recente pra trás. Clique numa pra ver o placar, o Replay 2D e os clipes."
        className="!mb-0"
      />
      <PrimeirosPassos />
      <SincStatus />
      <AvisoRecorde />
      <Resenhas sessoes={sessoes} sessaoAtiva={sessaoAtiva} onEscolher={setSessaoAtiva} />

      {sessaoAtiva && (
        <div className="panel-cut-sm flex flex-wrap items-center gap-3 border border-destaque/50 bg-superficie px-4 py-2 font-mono text-xs">
          <span className="text-texto-fraco">
            Mostrando a Resenha de <span className="text-texto">{dataHora(sessaoAtiva.inicio)}</span> ({sessaoAtiva.partidas} partida{sessaoAtiva.partidas === 1 ? '' : 's'})
          </span>
          <Button variante="fantasma" tamanho="sm" onClick={() => setSessaoAtiva(null)} className="ml-auto">
            Limpar
          </Button>
        </div>
      )}

      <div className={`flex flex-col gap-3 border-y border-borda py-4 ${sessaoAtiva ? 'hidden' : ''}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-4">
          {/* No mobile os selects dividem a largura em grid (a quebra livre deixava
              cada um de um tamanho, visual quebrado); no desktop segue inline. */}
          <div className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:items-center">
            <Select value={mapa} onChange={(e) => setMapa(e.target.value)} className="w-full lg:w-44">
              <option value="">Todos os mapas</option>
              {MAPAS.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
            </Select>
            <Select value={jogador} onChange={(e) => setJogador(e.target.value)} className="w-full lg:w-48">
              <option value="">Todos os jogadores</option>
              {jogadores.map((j) => <option key={j.steamId} value={j.steamId}>{j.nick}</option>)}
            </Select>
            {/* col-span-2: terceiro select no grid mobile de 2 colunas — meia largura
                órfã na segunda linha ficava visualmente quebrada; no lg vira flex e
                o span é inerte. */}
            <Select value={plataforma} onChange={(e) => setPlataforma(e.target.value)} className="col-span-2 w-full lg:col-span-1 lg:w-48">
              <option value="">Todas as plataformas</option>
              {PLATAFORMAS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </Select>
          </div>
          <div className="lg:ml-auto">
            <FiltroPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
          <div className="flex items-center gap-3">
            <span className="rotulo w-16 shrink-0 sm:w-auto">Resultado</span>
            <Abas
              rotulo="Filtrar por resultado"
              valor={resultado}
              onChange={setResultado}
              larguraTotal
              className="sm:w-auto"
              itens={[
                { valor: '', rotulo: 'Tudo' },
                { valor: 'vitoria', rotulo: 'Vitórias' },
                { valor: 'derrota', rotulo: 'Derrotas' },
              ]}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="rotulo w-16 shrink-0 sm:w-auto">Origem</span>
            <Abas
              rotulo="Filtrar por origem"
              valor={origem}
              onChange={setOrigem}
              larguraTotal
              className="sm:w-auto"
              itens={[
                { valor: '', rotulo: 'Todas' },
                { valor: 'valve_mm', rotulo: 'Auto' },
                { valor: 'upload', rotulo: 'Manual' },
              ]}
            />
          </div>
          {temFiltro && (
            <Button variante="fantasma" tamanho="sm" onClick={limparFiltros} className="self-start sm:ml-auto sm:self-auto">
              Limpar filtros
            </Button>
          )}
        </div>
      </div>

      {visiveis === null && <SkeletonLista linhas={5} altura="h-24" rotulo="Carregando Partidas" />}
      {visiveis?.length === 0 && (
        <EstadoVazio
          titulo="Nenhuma Partida encontrada"
          descricao={temFiltro ? 'Nada bate com esses filtros. Ajuste o período, o mapa ou o jogador.' : 'Assim que o Coletor sincronizar uma Partida do grupo, ela aparece aqui.'}
          acao={temFiltro ? <Button variante="secundario" tamanho="sm" onClick={limparFiltros}>Limpar filtros</Button> : null}
        />
      )}
      <div className={hoje ? 'grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start' : ''}>
        <div className="min-w-0 space-y-3">
          {visiveis?.map((m, i) => <CardPartidaFeed key={m.id} m={m} resultado={resultadoDoGrupo(m)} avatares={avatares} explicar={i === 0} />)}
          {temMais && (
            <div className="flex justify-center pt-1">
              <Button variante="secundario" onClick={carregarMais} carregando={carregandoMais}>
                {carregandoMais ? 'Carregando…' : 'Carregar mais'}
              </Button>
            </div>
          )}
        </div>
        {hoje && (
          <aside className="order-first xl:sticky xl:top-20 xl:order-none">
            <SessaoDeHoje sessao={hoje} resultados={resultados} onVerSessao={setSessaoAtiva} />
          </aside>
        )}
      </div>
    </div>
  )
}
