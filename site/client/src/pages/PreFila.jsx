import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { nomeMapa } from '../lib/format.js'
import { Avatar, Button, CabecalhoPagina, EstadoErro, EstadoVazio, MapIcon, Skeleton, SkeletonLista, classesBotao } from '../components/ui'

// Pré-fila: o Jogador escolhe de 1 a 4 amigos e vê, antes de entrar na fila, em que
// mapa esse grupo ganha mais e qual dupla rende melhor. Dados: GET /api/amigos e
// GET /api/pre-fila (I7, site/server/src/routes/preFila.js).
// Direção A "Placar" só nesta página: número grande em mono tabular, linha de placar
// por mapa, acento laranja só na seleção. Tokens e fontes são os globais.

const MAX_AMIGOS = 4

const FONTE = { grupo: 'do grupo', individual: 'média individual' }

function fmtPct(v) {
  return v == null ? '–' : `${Math.round(v)}%`
}

function corWinrate(v) {
  if (v == null) return 'text-texto'
  return v > 50 ? 'text-sucesso' : v < 50 ? 'text-perigo' : 'text-texto'
}

function textoPartidas(n) {
  return `${n} ${n === 1 ? 'Partida' : 'Partidas'}`
}

function BotaoAmigo({ amigo, ordem, bloqueado, onAlternar }) {
  const escolhido = ordem > 0
  return (
    <li>
      <button
        type="button"
        aria-pressed={escolhido}
        disabled={bloqueado}
        onClick={() => onAlternar(amigo.steamId)}
        className={[
          'flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-pequeno)] border px-3 py-2 text-left',
          'transition-[background-color,border-color,color] duration-150',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destaque',
          'disabled:cursor-not-allowed disabled:opacity-45',
          escolhido
            ? 'border-destaque/60 bg-destaque/10 text-texto'
            : 'border-borda bg-superficie text-texto-fraco hover:border-borda-forte hover:text-texto',
        ].join(' ')}
      >
        <span aria-hidden="true"><Avatar p={amigo} size={28} /></span>
        <span className="min-w-0 flex-1 truncate font-medium">{amigo.nick || amigo.steamId}</span>
        {escolhido && (
          <span className="font-mono text-xs tabular-nums text-destaque">
            <span className="sr-only">, escolhido em </span>{ordem}º
          </span>
        )}
      </button>
    </li>
  )
}

function LinhaMapa({ m, posicao }) {
  const largura = `${Math.max(0, Math.min(100, m.winrate ?? 0))}%`
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-borda px-1 py-3 last:border-b-0 sm:grid-cols-[2rem_2.5rem_minmax(0,1fr)_auto]">
      <span aria-hidden="true" className="font-mono text-xs tabular-nums text-texto-fraco">{posicao}</span>
      <span aria-hidden="true" className="hidden sm:block"><MapIcon map={m.map} size={36} /></span>
      <div className="min-w-0">
        <p className="truncate font-display text-base font-semibold text-texto">{nomeMapa(m.map)}</p>
        <p className="flex flex-wrap gap-x-2 font-mono text-xs tabular-nums text-texto-fraco">
          <span>{textoPartidas(m.partidas)}</span>
          <span aria-hidden="true">·</span>
          <span className={m.fonte === 'grupo' ? 'text-texto' : ''}>{FONTE[m.fonte] ?? m.fonte}</span>
        </p>
      </div>
      <span className={`text-right font-mono text-3xl font-semibold leading-none tabular-nums sm:text-4xl ${corWinrate(m.winrate)}`}>
        {fmtPct(m.winrate)}
      </span>
      <div aria-hidden="true" className="col-span-full h-1 rounded-sm bg-superficie-alta sm:col-start-3">
        <div className="h-1 rounded-sm bg-texto/70" style={{ width: largura }} />
      </div>
    </li>
  )
}

function CardDupla({ titulo, dupla, nomes, semDupla }) {
  return (
    <section aria-label={titulo} className="panel-cut-sm border border-borda bg-superficie px-4 py-4">
      <h3 className="text-sm font-semibold text-texto-fraco">{titulo}</h3>
      {dupla ? (
        <>
          <p className="mt-2 truncate font-display text-base font-semibold text-texto">
            {nomes(dupla.a)} <span className="text-texto-fraco">+</span> {nomes(dupla.b)}
          </p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <span className={`font-mono text-3xl font-semibold leading-none tabular-nums ${corWinrate(dupla.winrate)}`}>{fmtPct(dupla.winrate)}</span>
            <span className="font-mono text-xs tabular-nums text-texto-fraco">{textoPartidas(dupla.partidas)} juntos</span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-texto-fraco">{semDupla}</p>
      )}
    </section>
  )
}

function Resultado({ dados }) {
  const porId = new Map(dados.jogadores.map((j) => [j.steamId, j.nick || j.steamId]))
  const nomes = (id) => porId.get(id) ?? id
  return (
    <div className="space-y-6">
      <section aria-labelledby="pre-fila-mapas">
        <h3 id="pre-fila-mapas" className="mb-2 font-display text-lg font-semibold text-texto">Mapas</h3>
        {dados.mapas.length ? (
          <ol className="panel-cut-sm border border-borda bg-superficie px-3">
            {dados.mapas.map((m, i) => <LinhaMapa key={m.map} m={m} posicao={i + 1} />)}
          </ol>
        ) : (
          <EstadoVazio
            titulo="Nenhum mapa com 3 Partidas ainda."
            descricao="Joguem mais algumas juntos (ou cada um no mapa) e a Pré-fila aparece aqui."
          />
        )}
      </section>
      {(dados.melhorDupla || dados.piorDupla) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <CardDupla titulo="Melhor dupla" dupla={dados.melhorDupla} nomes={nomes} semDupla="Nenhuma dupla com 3 Partidas decididas juntos." />
          <CardDupla titulo="Pior dupla" dupla={dados.piorDupla} nomes={nomes} semDupla="Nenhuma dupla abaixo da melhor: falta amostra de outra dupla ou todas empatam." />
        </div>
      )}
    </div>
  )
}

export default function PreFila() {
  const [amigos, setAmigos] = useState(null)
  const [erroAmigos, setErroAmigos] = useState(false)
  const [tentativaAmigos, setTentativaAmigos] = useState(0)
  const [escolhidos, setEscolhidos] = useState([])
  const [estado, setEstado] = useState({ fase: 'inicio' })
  const requisicao = useRef(0)

  useEffect(() => {
    let vivo = true
    setErroAmigos(false)
    setAmigos(null)
    fetch('/api/amigos')
      .then((res) => {
        if (!res.ok) throw new Error('amigos')
        return res.json()
      })
      .then((corpo) => { if (vivo) setAmigos(Array.isArray(corpo?.amigos) ? corpo.amigos : []) })
      .catch(() => { if (vivo) setErroAmigos(true) })
    return () => { vivo = false }
  }, [tentativaAmigos])

  // Trocar a escolha invalida o resultado e qualquer resposta ainda a caminho.
  function alternar(steamId) {
    requisicao.current += 1
    setEstado({ fase: 'inicio' })
    setEscolhidos((atual) => (atual.includes(steamId)
      ? atual.filter((id) => id !== steamId)
      : atual.length < MAX_AMIGOS ? [...atual, steamId] : atual))
  }

  async function montar() {
    const minha = ++requisicao.current
    setEstado({ fase: 'carregando' })
    try {
      const res = await fetch(`/api/pre-fila?jogadores=${escolhidos.join(',')}`)
      const corpo = await res.json().catch(() => ({}))
      if (minha !== requisicao.current) return
      if (res.status === 400 && corpo?.erro) setEstado({ fase: 'recusado', mensagem: corpo.erro })
      else if (!res.ok || !Array.isArray(corpo?.mapas)) setEstado({ fase: 'falha' })
      else setEstado({ fase: 'pronto', dados: corpo })
    } catch {
      if (minha === requisicao.current) setEstado({ fase: 'falha' })
    }
  }

  let lista
  if (erroAmigos) {
    lista = (
      <EstadoErro
        mensagem="Não deu para carregar seus amigos."
        acao={<Button variante="secundario" tamanho="lg" onClick={() => setTentativaAmigos((n) => n + 1)}>Tentar de novo</Button>}
      />
    )
  } else if (!amigos) {
    lista = <SkeletonLista linhas={3} altura="h-11" rotulo="Carregando amigos" />
  } else if (!amigos.length) {
    lista = (
      <EstadoVazio
        titulo="Você ainda não tem amigos no Resenha."
        descricao="A Pré-fila cruza as Partidas de quem vai jogar junto. Adicione quem joga com você."
        acao={<Link to="/jogadores" className={classesBotao({ variante: 'primario', tamanho: 'lg' })}>Adicionar amigos</Link>}
      />
    )
  } else {
    const cheio = escolhidos.length >= MAX_AMIGOS
    lista = (
      <section aria-labelledby="pre-fila-quem">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 id="pre-fila-quem" className="font-display text-lg font-semibold text-texto">Quem vai jogar</h3>
          <span aria-live="polite" className="font-mono text-xs tabular-nums text-texto-fraco">
            <span className={escolhidos.length ? 'text-destaque' : ''}>{escolhidos.length} de {MAX_AMIGOS}</span>
          </span>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {amigos.map((a) => {
            const ordem = escolhidos.indexOf(a.steamId) + 1
            return <BotaoAmigo key={a.steamId} amigo={a} ordem={ordem} bloqueado={cheio && ordem === 0} onAlternar={alternar} />
          })}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variante="primario" tamanho="lg" onClick={montar} disabled={!escolhidos.length || estado.fase === 'carregando'}>
            Montar Pré-fila
          </Button>
          <span className="text-xs text-texto-fraco">Você entra sempre. Escolha de 1 a {MAX_AMIGOS} amigos.</span>
        </div>
      </section>
    )
  }

  let resultado = null
  if (estado.fase === 'carregando') {
    resultado = (
      <div role="status" aria-label="Montando Pré-fila" className="space-y-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="panel-cut-sm h-40 w-full" />
      </div>
    )
  } else if (estado.fase === 'recusado') {
    resultado = <EstadoErro mensagem={estado.mensagem} />
  } else if (estado.fase === 'falha') {
    resultado = (
      <EstadoErro
        mensagem="Não deu para montar a Pré-fila."
        acao={<Button variante="secundario" tamanho="lg" onClick={montar}>Tentar de novo</Button>}
      />
    )
  } else if (estado.fase === 'pronto') {
    resultado = <Resultado dados={estado.dados} />
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
      <CabecalhoPagina
        titulo="Pré-fila"
        descricao="Antes de entrar na fila: em que mapa esse grupo ganha mais e qual dupla rende melhor junta."
        className="mb-0"
      />
      {lista}
      {resultado}
    </div>
  )
}
