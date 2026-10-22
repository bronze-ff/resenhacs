import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, EstadoErro, EstadoVazio, SectionHeader, Skeleton } from './ui'

// Lições da Partida (F1): o que o Jogador logado pode rever na própria Partida. Dados:
// GET /api/matches/:id/licoes/:steamId (I8, site/server/src/routes/matches.js).
// Só aparece para quem jogou a Partida, e só com as Lições dele (v1). Texto neutro, sem
// nota: a contagem e os rounds para rever.
// Direção A "Placar" só aqui: contagem grande em mono tabular, um bloco por Lição, rounds
// como fichas. Tokens e fontes são os globais.

function fmtSegundos(s) {
  return `${Number(s ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`
}

function vezes(n) {
  return `${n} ${n === 1 ? 'vez' : 'vezes'}`
}

// Clique comum fica na página e pula o Replay 2D (o link para a mesma Partida não remonta
// a tela, então o ?round= sozinho não pularia). Ctrl/Cmd/meio abrem a URL em outra aba.
function LinkRound({ matchId, r, onVerRound, semReplay }) {
  if (semReplay) {
    return (
      <li className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-pequeno)] border border-borda px-3 font-mono text-sm tabular-nums text-texto-fraco">
        <span aria-hidden="true">R{r.round}</span>
        <span className="sr-only">Round {r.round}</span>
      </li>
    )
  }
  function aoClicar(e) {
    if (!onVerRound || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    onVerRound({ round: r.round, tick: r.tick })
  }
  return (
    <li>
      <Link
        to={`/partida/${matchId}?round=${r.round}&tick=${r.tick}`}
        onClick={aoClicar}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-pequeno)] border border-borda bg-superficie-alta px-3 font-mono text-sm tabular-nums text-texto transition-colors hover:border-destaque/60 hover:text-destaque focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destaque"
      >
        <span aria-hidden="true">R{r.round}</span>
        <span className="sr-only">Round {r.round}, ver no Replay 2D</span>
      </Link>
    </li>
  )
}

function BlocoLicao({ id, titulo, contagem, texto, rounds = null, total = 0, matchId, onVerRound, semReplay }) {
  return (
    <section aria-labelledby={id} className="panel-cut-sm flex flex-col gap-3 border border-borda bg-superficie px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <h3 id={id} className="text-sm font-semibold text-texto">{titulo}</h3>
        <span className={`font-mono text-4xl font-semibold leading-none tabular-nums ${contagem ? 'text-texto' : 'text-texto-fraco'}`}>
          {contagem}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-texto-fraco">{texto}</p>
      {rounds?.length > 0 && (
        <div className="mt-auto">
          <p className="mb-1.5 font-mono text-xs tabular-nums text-texto-fraco">
            {rounds.length < total ? `Rounds para rever (${rounds.length} de ${total})` : 'Rounds para rever'}
          </p>
          <ul className="flex flex-wrap gap-2">
            {rounds.map((r) => <LinkRound key={`${r.round}-${r.tick}`} matchId={matchId} r={r} onVerRound={onVerRound} semReplay={semReplay} />)}
          </ul>
        </div>
      )}
    </section>
  )
}

// semReplay: Partida sem Replay 2D lista os rounds sem link (não há o que abrir).
// temDemo false: sem Demo parseada não há kills nem flashes, e a I8 responderia tudo zero
// ("Nada pra rever" seria falso). A seção some e a I8 não é chamada.
export default function SecaoLicoes({ matchId, jogadores, jogadorLogado, temDemo = false, onVerRound = null, semReplay = false }) {
  const steamId = jogadorLogado?.steamId ?? null
  const jogou = Boolean(steamId) && (jogadores ?? []).some((p) => p.steamId === steamId)
  const mostrar = jogou && temDemo === true
  const [estado, setEstado] = useState({ fase: 'carregando' })
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (!mostrar) return undefined
    let vivo = true
    setEstado({ fase: 'carregando' })
    fetch(`/api/matches/${matchId}/licoes/${steamId}`)
      .then((res) => {
        if (!res.ok) throw new Error('licoes')
        return res.json()
      })
      .then((dados) => { if (vivo) setEstado({ fase: 'pronto', dados }) })
      .catch(() => { if (vivo) setEstado({ fase: 'erro' }) })
    return () => { vivo = false }
  }, [mostrar, matchId, steamId, tentativa])

  if (!mostrar) return null

  let conteudo
  if (estado.fase === 'erro') {
    conteudo = (
      <EstadoErro
        mensagem="Não deu para carregar as Lições."
        acao={<Button variante="secundario" tamanho="lg" onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</Button>}
      />
    )
  } else if (estado.fase === 'carregando') {
    conteudo = (
      <div role="status" aria-label="Carregando Lições" className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="panel-cut-sm h-36 w-full" />)}
      </div>
    )
  } else {
    const { mortesSemTrade, primeirasMortes, flashAliado } = estado.dados
    const semTrade = mortesSemTrade?.quantidade ?? 0
    const primeiras = primeirasMortes?.quantidade ?? 0
    const flashes = flashAliado?.vezes ?? 0
    if (!semTrade && !primeiras && !flashes) {
      conteudo = <EstadoVazio titulo="Nada pra rever nessa Partida." descricao="Nenhuma morte sem trade, nenhuma primeira morte e nenhuma flash em colegas." />
    } else {
      conteudo = (
        <div className="grid gap-3 md:grid-cols-3">
          <BlocoLicao
            id="licao-sem-trade"
            titulo="Morte sem trade"
            contagem={semTrade}
            texto={`Você morreu ${vezes(semTrade)} sem um colega devolver o abate em até 5 s.`}
            rounds={mortesSemTrade?.rounds}
            total={semTrade}
            matchId={matchId}
            onVerRound={onVerRound}
            semReplay={semReplay}
          />
          <BlocoLicao
            id="licao-primeira-morte"
            titulo="Primeira morte do round"
            contagem={primeiras}
            texto={`Você foi o primeiro a cair em ${primeiras} ${primeiras === 1 ? 'round' : 'rounds'}.`}
            rounds={primeirasMortes?.rounds}
            total={primeiras}
            matchId={matchId}
            onVerRound={onVerRound}
            semReplay={semReplay}
          />
          <BlocoLicao
            id="licao-flash-aliado"
            titulo="Flash em aliado"
            contagem={flashes}
            texto={`Suas flashes pegaram em colegas ${vezes(flashes)}, ${fmtSegundos(flashAliado?.segundos)} de cegueira no total.`}
          />
        </div>
      )
    }
  }

  return (
    <section aria-labelledby="licoes-titulo" className="space-y-3">
      <SectionHeader titulo={<span id="licoes-titulo">Lições</span>} margem="nenhuma" />
      {conteudo}
    </section>
  )
}
