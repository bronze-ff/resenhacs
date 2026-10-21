import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Abas, Avatar, Button, EstadoErro, Explicacao, SkeletonLista, SteamIcon } from '../ui'
import { corRating, nomeArma } from '../../lib/format.js'
import { METRICAS } from '../../lib/metricas.js'

// "Frente a frente" da Partida: os 10 jogadores como colunas, Time A à esquerda e Time B
// à direita, e cada stat como uma linha cujo rótulo aparece uma vez só, no trilho do meio.
// A lente troca as linhas (Geral, Duelos, Utilitária, Armas, Contra fulano) e as duas
// metades respondem juntas. Abaixo de LARGURA_ESPELHO o espelho vira uma tabela rolável
// com o trilho fixo à esquerda (no celular não cabem 10 colunas lado a lado).
const LARGURA_ESPELHO = 880

function useLargura(ref) {
  const [largura, setLargura] = useState(Infinity)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const obs = new ResizeObserver(([e]) => setLargura(e.contentRect.width))
    obs.observe(el)
    return () => obs.disconnect()
  }, [ref])
  return largura
}

const soma = (js, f) => js.reduce((s, p) => s + (f(p) ?? 0), 0)
const media = (js, f) => {
  const v = js.map(f).filter((x) => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
const pct = (v) => (v == null ? '–' : `${Math.round(v)}%`)
const adr = (p) => (p.roundsPlayed ? Math.round((p.damage / p.roundsPlayed) * 10) / 10 : null)
const hsPct = (p) => (p.kills ? Math.round((p.headshotKills / p.kills) * 100) : null)
const util = (p) => p.utilitaria ?? {}

function Estrela({ className = 'h-3 w-3' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={`inline-block align-[-1px] ${className}`} aria-hidden="true">
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
    </svg>
  )
}

function Saldo({ v }) {
  if (v == null) return '–'
  if (v === 0) return <span className="text-texto-fraco">0</span>
  return <span className={v > 0 ? 'text-sucesso' : 'text-perigo'}>{v > 0 ? `+${v}` : `−${Math.abs(v)}`}</span>
}

function ComExtra({ v, extra, perigo = false }) {
  return (
    <>
      <span className={perigo && v > 0 ? 'text-perigo' : ''}>{v ?? 0}</span>
      {extra != null && <span className="ml-1 text-[11px] text-texto-fraco">{extra}</span>}
    </>
  )
}

function FogoAmigo({ v, amigo }) {
  return (
    <>
      {v ?? 0}
      {amigo > 0 && <span className="ml-1 text-[11px] text-perigo" title="Fogo amigo">({amigo})</span>}
    </>
  )
}

// Cada linha: valor(p) dá o número (pra estrela de melhor e pro zero apagado); celula(p, v)
// formata quando o número cru não basta; time(js) é o resumo do time no trilho (padrão: soma).
function linhasGeral(js) {
  const temPontos = js.some((p) => p.premierBefore != null || p.faceitEloBefore != null)
  return [
    {
      id: 'rating', rotulo: 'Rating', destaque: true, melhor: true,
      titulo: 'Aproximação do HLTV Rating 1.0: kills, sobrevivência e multi-kills por round. Acima de 1.00 é acima da média.',
      valor: (p) => p.rating,
      celula: (p, v) => (v == null ? '–' : <span className={corRating(v)}>{v.toFixed(2)}</span>),
      time: (t) => media(t, (p) => p.rating)?.toFixed(2),
    },
    { id: 'k', rotulo: 'Kills', melhor: true, titulo: 'Abates. Fogo amigo e suicídio não contam.', valor: (p) => p.kills },
    { id: 'd', rotulo: 'Mortes', titulo: 'Vezes que morreu, por qualquer causa (inclui queda e bomba).', valor: (p) => p.deaths },
    { id: 'a', rotulo: 'Assists', melhor: true, titulo: 'Ajudou no abate com dano ou flash, sem dar o tiro final.', valor: (p) => p.assists },
    {
      id: 'saldo', rotulo: '+/−', melhor: true, titulo: 'Kills menos mortes.',
      valor: (p) => (p.kills ?? 0) - (p.deaths ?? 0),
      celula: (p, v) => <Saldo v={v} />,
      time: (t) => <Saldo v={soma(t, (p) => p.kills) - soma(t, (p) => p.deaths)} />,
    },
    {
      id: 'adr', rotulo: 'ADR', melhor: true,
      titulo: 'Dano médio por round, contando rounds sem kill. Só dano em inimigo.',
      valor: adr, time: (t) => media(t, adr)?.toFixed(1),
    },
    {
      id: 'kast', rotulo: 'KAST', melhor: true,
      titulo: '% dos rounds com kill, assist, sobrevivência ou morte trocada.',
      valor: (p) => p.kastPct, celula: (p, v) => pct(v), time: (t) => pct(media(t, (p) => p.kastPct)),
    },
    {
      id: 'hs', rotulo: 'HS%', melhor: true, titulo: '% das kills que foram headshot.',
      valor: hsPct, celula: (p, v) => pct(v),
      time: (t) => pct(soma(t, (p) => p.kills) ? (soma(t, (p) => p.headshotKills) / soma(t, (p) => p.kills)) * 100 : null),
    },
    js.some((p) => p.tripleKills || p.quadroKills || p.pentaKills) && {
      id: 'multi', rotulo: '3K · 4K · 5K', titulo: 'Rounds com 3, 4 e 5 kills (dado da FACEIT).',
      valor: (p) => (p.tripleKills ?? 0) + (p.quadroKills ?? 0) + (p.pentaKills ?? 0),
      celula: (p) => `${p.tripleKills ?? 0}·${p.quadroKills ?? 0}·${p.pentaKills ?? 0}`,
      time: null,
    },
    js.some((p) => p.mvps != null) && {
      id: 'mvps', rotulo: 'MVPs', melhor: true, titulo: 'Rounds em que foi o MVP do time (dado da FACEIT).', valor: (p) => p.mvps,
    },
    js.some((p) => p.teamKills > 0) && {
      id: 'tk', rotulo: 'Fogo amigo (TK)', titulo: 'Colegas que ele matou. Não entra em Kills nem no Rating.',
      valor: (p) => p.teamKills ?? 0, celula: (p, v) => <ComExtra v={v} perigo />,
    },
    temPontos && {
      id: 'pontos', rotulo: 'Pontos', titulo: 'Premier ou ELO FACEIT antes da Partida, e quanto ganhou ou perdeu.',
      valor: (p) => p.premierBefore ?? p.faceitEloBefore,
      celula: (p) => {
        const antes = p.premierBefore ?? p.faceitEloBefore
        const depois = p.premierAfter ?? p.faceitEloAfter
        if (antes == null) return '–'
        if (depois == null) return Math.round(antes)
        const delta = Math.round(depois - antes)
        return (
          <>
            {Math.round(antes)}
            <span className={`ml-1 text-[11px] ${delta >= 0 ? 'text-sucesso' : 'text-perigo'}`}>{delta >= 0 ? '▲' : '▼'}{Math.abs(delta)}</span>
          </>
        )
      },
      time: null,
    },
  ].filter(Boolean)
}

const GRANADAS = [
  { campo: 'smokesThrown', icone: 'smokegrenade', rotulo: 'Smokes' },
  { campo: 'flashesThrown', icone: 'flashbang', rotulo: 'Flashes' },
  { campo: 'heThrown', icone: 'hegrenade', rotulo: 'HEs' },
  { campo: 'molotovsThrown', icone: 'molotov', rotulo: 'Molotovs' },
]

function linhasUtilitaria() {
  return [
    ...GRANADAS.map((g) => ({
      id: g.campo, rotulo: g.rotulo, icone: g.icone, titulo: `${g.rotulo} jogadas (não quer dizer que acertaram alguém).`,
      valor: (p) => util(p)[g.campo] ?? 0,
    })),
    {
      id: 'cego', rotulo: 'Cegou inimigo', melhor: true,
      titulo: 'Inimigos cegados por mais de 1.1s, e o total de segundos. Cegueira de raspão não conta.',
      valor: (p) => util(p).enemiesFlashed ?? 0,
      celula: (p, v) => <ComExtra v={v} extra={`${(util(p).enemyFlashDuration ?? 0).toFixed(0)}s`} />,
      time: (t) => <ComExtra v={soma(t, (p) => util(p).enemiesFlashed)} extra={`${soma(t, (p) => util(p).enemyFlashDuration).toFixed(0)}s`} />,
    },
    {
      id: 'cegoAliado', rotulo: 'Cegou aliado', titulo: 'Aliados cegados por mais de 1.1s, e o total de segundos. Inclui cegar a si mesmo.',
      valor: (p) => util(p).teammatesFlashed ?? 0,
      celula: (p, v) => <ComExtra v={v} perigo extra={`${(util(p).teammateFlashDuration ?? 0).toFixed(0)}s`} />,
    },
    {
      id: 'flashAssist', rotulo: 'Flash assist', melhor: true,
      titulo: 'Flash que cegou um inimigo morto logo depois, ainda cego, por alguém do time. Conta também quando quem jogou a flash fez o abate.',
      valor: (p) => util(p).flashAssists ?? 0,
    },
    {
      id: 'danoHe', rotulo: 'Dano de HE', melhor: true, titulo: 'Dano de HE em inimigo. Entre parênteses, fogo amigo.',
      valor: (p) => util(p).heDamage ?? 0, celula: (p, v) => <FogoAmigo v={v} amigo={util(p).heTeamDamage} />,
    },
    {
      id: 'danoFogo', rotulo: 'Dano de fogo', melhor: true, titulo: 'Dano de molotov e incendiária em inimigo. Entre parênteses, fogo amigo.',
      valor: (p) => util(p).molotovDamage ?? 0, celula: (p, v) => <FogoAmigo v={v} amigo={util(p).molotovTeamDamage} />,
    },
  ]
}

function linhasDuelos(porJogador) {
  const d = (p) => porJogador.get(p.steamId)
  return [
    {
      id: 'aberturas', rotulo: 'Aberturas', melhor: true,
      titulo: 'Duelo de abertura é a primeira kill do round. ↑ ganhou, ↓ perdeu.',
      valor: (p) => d(p)?.aberturasGanhas ?? null,
      celula: (p) => (d(p) ? (
        <>
          <span className="text-sucesso"><span aria-hidden="true">↑</span>{d(p).aberturasGanhas}</span>
          <span className="text-texto-fraco"> </span>
          <span className="text-perigo"><span aria-hidden="true">↓</span>{d(p).aberturasPerdidas}</span>
          <span className="sr-only"> ganhas e perdidas</span>
        </>
      ) : '–'),
      time: (t) => `↑${soma(t, (p) => d(p)?.aberturasGanhas)} ↓${soma(t, (p) => d(p)?.aberturasPerdidas)}`,
    },
    {
      id: 'aberturasPct', rotulo: '% abertura', titulo: '% dos duelos de abertura que ele ganhou.',
      valor: (p) => d(p)?.aberturasPct ?? null, celula: (p, v) => pct(v),
      time: (t) => {
        const ab = soma(t, (p) => d(p)?.aberturas)
        return pct(ab ? (soma(t, (p) => d(p)?.aberturasGanhas) / ab) * 100 : null)
      },
    },
    { id: 'abCt', rotulo: 'Abertura de CT', titulo: '% de aberturas ganhas jogando de CT.', valor: (p) => d(p)?.porLado?.CT?.pct ?? null, celula: (p, v) => pct(v), time: null },
    { id: 'abT', rotulo: 'Abertura de T', titulo: '% de aberturas ganhas jogando de T.', valor: (p) => d(p)?.porLado?.T?.pct ?? null, celula: (p, v) => pct(v), time: null },
    {
      id: 'trocadas', rotulo: 'Mortes trocadas', titulo: 'Um colega matou quem te matou em até 5 s.',
      valor: (p) => d(p)?.mortesTrocadas ?? null,
      celula: (p) => (d(p) ? <ComExtra v={d(p).mortesTrocadas} extra={`de ${d(p).mortes}`} /> : '–'),
    },
    { id: 'semTroca', rotulo: 'Mortes sem troca', titulo: 'Morreu e ninguém do time devolveu em até 5 s.', valor: (p) => d(p)?.mortesSemTroca ?? null },
    {
      id: 'trocas', rotulo: 'Trocas feitas', melhor: true,
      titulo: 'Matou quem tinha acabado de matar um colega, em até 5 s. Team-kill não conta.',
      valor: (p) => d(p)?.trocasFeitas ?? null,
    },
  ]
}

function linhasArmas(js) {
  const totais = new Map()
  for (const p of js) for (const w of p.weapons ?? []) totais.set(w.weapon, (totais.get(w.weapon) ?? 0) + w.kills)
  return [...totais.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([arma]) => {
      const w = (p) => p.weapons?.find((x) => x.weapon === arma)
      return {
        id: arma, rotulo: nomeArma(arma), icone: arma, melhor: true, titulo: `Kills de ${nomeArma(arma)} nessa Partida`,
        valor: (p) => w(p)?.kills ?? 0,
        celula: (p, v) => <ComExtra v={v} extra={w(p)?.hsKills ? `${w(p).hsKills} HS` : null} />,
      }
    })
}

// Lente "Contra fulano": cada coluna adversária mostra o duelo do focado contra aquele
// jogador; a coluna do focado mostra o total; os colegas dele ficam com "·".
function linhasContra(focado, dados) {
  const op = new Map(dados.oponentes.map((o) => [o.steamId, o]))
  const rel = (f) => (p) => {
    if (p.steamId === focado.steamId) return dados.oponentes.reduce((s, o) => s + (f(o) ?? 0), 0)
    const o = op.get(p.steamId)
    return o ? f(o) : null
  }
  const categorias = [...new Set(dados.oponentes.flatMap((o) => [
    ...Object.keys(o.killsPorCategoria ?? {}), ...Object.keys(o.killsPorCategoriaRecebido ?? {}),
  ]))]
  return [
    { id: 'matou', rotulo: 'Matou', titulo: `Quantas vezes ${focado.nick} matou cada adversário`, valor: rel((o) => o.kills) },
    { id: 'morreu', rotulo: 'Morreu para', titulo: `Quantas vezes ${focado.nick} morreu para cada adversário`, valor: rel((o) => o.deaths) },
    { id: 'dano', rotulo: 'Dano causado', titulo: `Dano de ${focado.nick} em cada adversário`, valor: rel((o) => o.dano) },
    { id: 'danoRecebido', rotulo: 'Dano recebido', titulo: `Dano que ${focado.nick} levou de cada adversário`, valor: rel((o) => o.danoRecebido) },
    { id: 'cegou', rotulo: 'Cegou', titulo: `Vezes que ${focado.nick} cegou cada adversário`, valor: rel((o) => o.flashes?.porMim?.vezes) },
    { id: 'foiCegado', rotulo: 'Foi cegado', titulo: `Vezes que cada adversário cegou ${focado.nick}`, valor: rel((o) => o.flashes?.porEle?.vezes) },
    ...categorias.map((c) => ({
      id: `cat-${c}`, rotulo: c, titulo: `Kills de ${c}: ${focado.nick} matou / morreu`,
      valor: rel((o) => o.killsPorCategoria?.[c] ?? 0),
      celula: (p) => {
        if (p.steamId === focado.steamId) return null
        const o = op.get(p.steamId)
        return o ? `${o.killsPorCategoria?.[c] ?? 0}/${o.killsPorCategoriaRecebido?.[c] ?? 0}` : null
      },
    })),
  ].map((l) => ({ ...l, time: null }))
}

const ordenar = (js) => [...js].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.kills ?? 0) - (a.kills ?? 0))
const cacheContra = new Map()

function useBusca(url) {
  const [estado, setEstado] = useState({ url: null, dados: null, erro: false })
  useEffect(() => {
    if (!url) return undefined
    if (cacheContra.has(url)) { setEstado({ url, dados: cacheContra.get(url), erro: false }); return undefined }
    let vivo = true
    setEstado({ url, dados: null, erro: false })
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { cacheContra.set(url, j); if (vivo) setEstado({ url, dados: j, erro: false }) })
      .catch(() => { if (vivo) setEstado({ url, dados: null, erro: true }) })
    return () => { vivo = false }
  }, [url])
  return estado.url === url ? estado : { url, dados: null, erro: false }
}

function CabecalhoTime({ time, doGrupo, alinhar }) {
  const cor = time === 'A' ? 'text-time-a' : 'text-time-b'
  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${alinhar === 'direita' ? 'flex-row-reverse text-right' : ''}`}>
      <span className={`h-2.5 w-2.5 shrink-0 ${time === 'A' ? 'bg-time-a' : 'bg-time-b'}`} aria-hidden="true" />
      <span className={`font-display text-base font-semibold ${cor}`}>Time {time}</span>
      {doGrupo && (
        <span className="rounded-full border border-borda-forte px-2 py-0.5 text-[11px] font-medium text-texto-fraco">seu time</span>
      )}
    </div>
  )
}

export default function Espelho({
  matchId, timeA, timeB, timeDoGrupo, jogadorLogado,
  lado, onLado, carregandoLado, avisoLado, podePromover, onPromover, promovendo, onDetalhe,
}) {
  const ref = useRef(null)
  const espelhado = useLargura(ref) >= LARGURA_ESPELHO
  const todos = [...timeA, ...timeB]
  const jogouAqui = todos.find((p) => p.steamId === jogadorLogado?.steamId)
  const [lente, setLente] = useState('geral')
  const [focadoId, setFocadoId] = useState(jogouAqui?.steamId ?? null)
  const focado = todos.find((p) => p.steamId === focadoId) ?? null

  const duelos = useBusca(lente === 'duelos' ? `/api/matches/${matchId}/duelos` : null)
  const contra = useBusca(lente === 'contra' && focado ? `/api/matches/${matchId}/head-to-head/${focado.steamId}` : null)

  const lentes = [
    { valor: 'geral', rotulo: 'Geral' },
    { valor: 'duelos', rotulo: 'Duelos' },
    { valor: 'utilitaria', rotulo: 'Utilitária' },
    { valor: 'armas', rotulo: 'Armas' },
    ...(focado ? [{ valor: 'contra', rotulo: `Contra ${focado.nick || 'jogador'}`, title: 'Duelo do jogador escolhido contra cada adversário' }] : []),
  ]
  const lenteAtiva = lentes.some((l) => l.valor === lente) ? lente : 'geral'

  let linhas = []
  let estado = null
  if (lenteAtiva === 'geral') linhas = linhasGeral(todos)
  else if (lenteAtiva === 'utilitaria') linhas = linhasUtilitaria()
  else if (lenteAtiva === 'armas') {
    linhas = linhasArmas(todos)
    if (linhas.length === 0) estado = <p className="px-4 py-6 text-center text-sm text-texto-fraco">Sem kills por arma registradas nessa Partida.</p>
  } else if (lenteAtiva === 'duelos') {
    if (duelos.erro) estado = <EstadoErro mensagem="Não deu pra carregar os duelos dessa partida." />
    else if (!duelos.dados) estado = <SkeletonLista linhas={4} altura="h-8" rotulo="Carregando duelos" />
    else {
      const lista = duelos.dados.jogadores ?? []
      if (lista.every((j) => j.aberturas === 0 && j.mortes === 0)) {
        estado = <p className="px-4 py-6 text-center text-sm text-texto-fraco">Essa Partida não tem as kills por round gravadas.</p>
      } else linhas = linhasDuelos(new Map(lista.map((j) => [j.steamId, j])))
    }
  } else if (lenteAtiva === 'contra' && focado) {
    if (contra.erro) estado = <EstadoErro mensagem="Não foi possível carregar o confronto." />
    else if (!contra.dados) estado = <SkeletonLista linhas={4} altura="h-8" rotulo="Carregando confronto" />
    else linhas = linhasContra(focado, contra.dados)
  }

  // Melhor valor de cada linha na Partida inteira (os 10). Zero nunca ganha estrela.
  const melhor = new Map(linhas.filter((l) => l.melhor).map((l) => [l.id, Math.max(0, ...todos.map((p) => l.valor(p) ?? 0))]))

  const a = ordenar(timeA)
  const b = ordenar(timeB)
  // Desktop: o melhor de cada time fica colado no trilho, os outros se afastam pra fora.
  const colunas = [...[...a].reverse(), 'trilho', ...b]
  const filtroLado = (
    <Abas rotulo="Filtrar por lado" itens={[{ valor: 'all', rotulo: 'Ambos' }, { valor: 'T', rotulo: 'T' }, { valor: 'CT', rotulo: 'CT' }]} valor={lado} onChange={onLado} />
  )
  const pontoDeVista = focado && (
    <span className="text-[11px] font-medium text-texto-fraco">do ponto de vista de <span className="text-texto">{focado.nick}</span></span>
  )

  function celula(l, p) {
    const v = l.valor(p)
    const conteudo = l.celula ? l.celula(p, v) : v
    const vazio = conteudo == null
    const zero = v === 0 && !l.celula
    const estrela = l.melhor && v != null && v > 0 && v === melhor.get(l.id)
    return (
      <>
        <span className={vazio ? 'text-texto-fraco/40' : zero ? 'text-texto-fraco/40' : ''}>{vazio ? '·' : conteudo}</span>
        {estrela && <span className="ml-0.5 text-ouro" title="Melhor da partida"><Estrela /><span className="sr-only">melhor da partida</span></span>}
      </>
    )
  }

  function resumo(l, time) {
    const js = time === 'A' ? a : b
    if (l.time === null) return null
    const v = l.time ? l.time(js) : soma(js, l.valor)
    return v == null ? null : <span className={time === 'A' ? 'text-time-a/80' : 'text-time-b/80'}>{v}</span>
  }

  return (
    <section ref={ref} aria-label="Frente a frente" className="panel-cut overflow-hidden border border-borda bg-superficie realce-topo">
      {/* O placar já está no hero; aqui só o nome de cada time, de cada lado do seletor de lente. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borda px-3 py-2.5 sm:px-4 lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <CabecalhoTime time="A" doGrupo={timeDoGrupo === 'A'} />
        <Abas rotulo="Lente do frente a frente" itens={lentes} valor={lenteAtiva} onChange={setLente} className="order-last max-w-full overflow-x-auto lg:order-none [&>button]:shrink-0 [&>button]:whitespace-nowrap" />
        <CabecalhoTime time="B" doGrupo={timeDoGrupo === 'B'} alinhar="direita" />
      </div>
      {!espelhado && (lenteAtiva === 'geral' || (lenteAtiva === 'contra' && focado)) && (
        <div className="border-b border-borda px-3 py-2">{lenteAtiva === 'geral' ? filtroLado : pontoDeVista}</div>
      )}

      <div className={`overflow-x-auto transition-opacity ${carregandoLado && lenteAtiva === 'geral' ? 'opacity-50' : ''}`}>
        {espelhado ? (
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Frente a frente, lente {lentes.find((l) => l.valor === lenteAtiva)?.rotulo}</caption>
          <colgroup>
            {colunas.map((c) => <col key={c === 'trilho' ? 'trilho' : c.steamId} style={{ width: c === 'trilho' ? '13rem' : undefined }} />)}
          </colgroup>
          <thead>
            <tr className="border-b border-borda">
              {colunas.map((c) => {
                if (c === 'trilho') {
                  return (
                    <th key="trilho" scope="col" className="bg-superficie-alta px-2 py-2 text-center align-middle">
                      {lenteAtiva === 'geral' ? filtroLado : lenteAtiva === 'contra' && focado ? pontoDeVista : (
                        <span className="sr-only">Stat</span>
                      )}
                    </th>
                  )
                }
                const ativo = c.steamId === focadoId
                const voce = c.steamId === jogadorLogado?.steamId
                return (
                  <th
                    key={c.steamId}
                    scope="col"
                    className={`border-t-2 px-1 py-2 font-normal ${c.team === 'A' ? 'border-t-time-a' : 'border-t-time-b'} ${ativo ? 'bg-superficie-topo' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => setFocadoId(ativo ? null : c.steamId)}
                      aria-pressed={ativo}
                      title={ativo ? 'Tirar o foco' : `Focar em ${c.nick || c.steamId}: confronto, perfil e round a round`}
                      className="flex w-full flex-col items-center gap-1 rounded-[var(--radius-pequeno)] px-1 py-1 transition-colors hover:bg-superficie-alta"
                    >
                      <Avatar p={c} size={28} />
                      <span className="block w-full truncate text-center font-mono text-xs text-texto">{c.nick || c.steamId}</span>
                      <span className="h-4 text-[10px] leading-4 text-texto-fraco">{voce ? 'você' : c.isTracked ? 'grupo' : ''}</span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          {estado ? (
            <tbody>
              <tr><td colSpan={colunas.length} className="p-3">{estado}</td></tr>
            </tbody>
          ) : (
            <tbody className="font-mono">
              {linhas.map((l) => (
                <tr key={l.id} className="group border-t border-borda/70 transition-colors hover:bg-superficie-alta/50">
                  {colunas.map((c) => {
                    if (c === 'trilho') {
                      return (
                        <th
                          key="trilho"
                          scope="row"
                          className="bg-superficie-alta px-2 py-2 text-[11px] font-medium text-texto-fraco"
                        >
                          <span className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 tabular-nums">
                            <span className="truncate text-left">{resumo(l, 'A')}</span>
                            <RotuloLinha l={l} />
                            <span className="truncate text-right">{resumo(l, 'B')}</span>
                          </span>
                        </th>
                      )
                    }
                    return (
                      <td
                        key={c.steamId}
                        className={`px-1 text-center tabular-nums ${l.destaque ? 'py-2.5 text-base font-semibold' : 'py-2'} ${c.steamId === focadoId ? 'bg-superficie-topo/50' : ''}`}
                      >
                        {celula(l, c)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          )}
        </table>
        ) : (
        // Celular: o espelho vira lista. Cada jogador é uma linha com o nick fixo à
        // esquerda (Time A em cima, Time B embaixo); os stats rolam na horizontal.
        <table className="w-full text-sm" style={{ minWidth: `calc(9.5rem + ${Math.max(linhas.length, 1)} * 4.75rem)` }}>
          <caption className="sr-only">Frente a frente, lente {lentes.find((l) => l.valor === lenteAtiva)?.rotulo}</caption>
          <thead>
            <tr className="border-b border-borda bg-superficie-alta font-mono text-[11px] text-texto-fraco">
              <th scope="col" className="sticky left-0 z-10 w-[9.5rem] bg-superficie-alta px-3 py-2 text-left font-medium">Jogador</th>
              {!estado && linhas.map((l) => (
                <th key={l.id} scope="col" className="px-2 py-2 text-center font-medium">
                  <RotuloLinha l={l} />
                </th>
              ))}
            </tr>
          </thead>
          {estado ? (
            <tbody>
              <tr><td colSpan={2} className="p-3">{estado}</td></tr>
            </tbody>
          ) : (
            [['A', a], ['B', b]].map(([time, js]) => (
              <tbody key={time} className="font-mono">
                <tr className="border-t-2 border-borda-forte bg-superficie-alta/40 text-xs">
                  <th scope="rowgroup" className="sticky left-0 z-10 bg-superficie px-3 py-2 text-left">
                    <span className={`flex items-center gap-2 font-display text-sm font-semibold ${time === 'A' ? 'text-time-a' : 'text-time-b'}`}>
                      <span className={`h-2 w-2 ${time === 'A' ? 'bg-time-a' : 'bg-time-b'}`} aria-hidden="true" />
                      Time {time}
                    </span>
                  </th>
                  {linhas.map((l) => (
                    <td key={l.id} className="px-2 py-2 text-center tabular-nums">{resumo(l, time)}</td>
                  ))}
                </tr>
                {js.map((p) => {
                  const ativo = p.steamId === focadoId
                  const voce = p.steamId === jogadorLogado?.steamId
                  return (
                    <tr key={p.steamId} className="border-t border-borda/70">
                      <th scope="row" className={`sticky left-0 z-10 px-2 py-1 text-left font-normal ${ativo ? 'bg-superficie-topo' : 'bg-superficie'}`}>
                        <button
                          type="button"
                          onClick={() => setFocadoId(ativo ? null : p.steamId)}
                          aria-pressed={ativo}
                          title={ativo ? 'Tirar o foco' : `Focar em ${p.nick || p.steamId}`}
                          className="flex min-h-10 w-full items-center gap-2 rounded-[var(--radius-pequeno)] px-1 text-left"
                        >
                          <Avatar p={p} size={22} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-xs text-texto">{p.nick || p.steamId}</span>
                            <span className="block text-[10px] leading-3 text-texto-fraco">{voce ? 'você' : p.isTracked ? 'grupo' : ''}</span>
                          </span>
                        </button>
                      </th>
                      {linhas.map((l) => (
                        <td key={l.id} className={`px-2 text-center tabular-nums ${l.destaque ? 'py-2 text-base font-semibold' : 'py-2'} ${ativo ? 'bg-superficie-topo/50' : ''}`}>
                          {celula(l, p)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            ))
          )}
        </table>
        )}
      </div>

      {avisoLado && lenteAtiva === 'geral' && (
        <p className="border-t border-borda px-4 py-2 text-xs text-texto-fraco">{avisoLado}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-borda px-3 py-2 sm:px-4">
        {focado ? (
          <>
            <span className="flex min-w-0 items-center gap-2 font-mono text-sm text-texto">
              <Avatar p={focado} size={20} />
              <span className="truncate">{focado.nick || focado.steamId}</span>
            </span>
            {lenteAtiva !== 'contra' && (
              <Button variante="secundario" tamanho="sm" onClick={() => setLente('contra')}>Contra cada adversário</Button>
            )}
            <Button variante="fantasma" tamanho="sm" onClick={() => onDetalhe(focado)}>Round a round</Button>
            <Button as={Link} variante="fantasma" tamanho="sm" to={`/jogador/${focado.steamId}`}>Perfil</Button>
            <a
              href={`https://steamcommunity.com/profiles/${focado.steamId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-texto-fraco transition-colors hover:text-texto"
            >
              <SteamIcon className="h-3.5 w-3.5" /> Steam
            </a>
            {!(focado.temConta ?? focado.isTracked) && podePromover && (
              <Button variante="fantasma" tamanho="sm" onClick={() => onPromover(focado.steamId)} carregando={promovendo === focado.steamId}>
                {promovendo === focado.steamId ? null : 'Adicionar ao grupo'}
              </Button>
            )}
          </>
        ) : (
          <p className="text-xs text-texto-fraco">Clique num jogador para ver o duelo dele contra cada adversário, o round a round e o perfil.</p>
        )}
        <span className="ml-auto hidden items-center gap-1 text-[11px] text-texto-fraco sm:flex">
          <span className="text-ouro"><Estrela /></span> melhor da partida
        </span>
      </div>
    </section>
  )
}

// Rótulo do trilho: clique abre a explicação do dicionário (lib/metricas.js); arma e
// categoria de arma, que não estão no dicionário, usam o título da própria linha.
function RotuloLinha({ l }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {l.icone && <img src={`/weapons/${l.icone}.svg`} alt="" className="h-3.5 w-auto max-w-6 opacity-60" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
      <Explicacao metrica={METRICAS[l.id] ?? { nome: l.rotulo, texto: l.titulo }}>{l.rotulo}</Explicacao>
    </span>
  )
}
