import { Link } from 'react-router-dom'
import { Card, Badge, RatingBadge, ResultChip, MapIcon, Avatar, SteamIcon } from '../components/ui'
import { nomeArma } from '../lib/format.js'

// Corte só nos 4 cantos externos da viewport (mesmo motivo do /entrar: assinatura visual
// mesmo numa tela sem panel-cut geral, já que o corte "de verdade" vive nos containers).
function CornerMark({ className }) {
  return <div className={`pointer-events-none absolute h-10 w-10 border-destaque/25 ${className}`} />
}

// --- Dados fictícios das seções (mockups estilizados, não screenshots reais). ---------

const PARTIDA_MOCK = {
  map: 'de_mirage',
  scoreA: 13,
  scoreB: 9,
  jogadores: [
    { nick: 'kaiser', team: 'A', k: 24, d: 14, adr: 88.2, rating: 1.34 },
    { nick: 'nofrio', team: 'A', k: 19, d: 16, adr: 71.5, rating: 1.08 },
    { nick: 'zota', team: 'B', k: 15, d: 19, adr: 63.0, rating: 0.84 },
  ],
  rounds: [
    'A', 'A', 'B', 'A', 'B', 'A', 'A*', 'B', 'A', 'B', 'A~', 'A', 'A',
  ],
}

const ROUND_DETALHE = {
  numero: 7,
  tag: 'ACE',
  autor: 'kaiser',
  arma: nomeArma('ak47'),
  compra: 'Kevlar + Capacete, AK-47',
}

const COMPARAR_MOCK = {
  a: { nick: 'kaiser', rating: 1.34 },
  b: { nick: 'nofrio', rating: 1.08 },
  linhas: [
    { rotulo: 'Rating', va: 1.34, vb: 1.08 },
    { rotulo: 'ADR', va: 88.2, vb: 71.5 },
    { rotulo: 'HS%', va: 61, vb: 44 },
    { rotulo: 'Clutch %', va: 38, vb: 22 },
  ],
}

function BarraComparacaoMock({ va, vb }) {
  const total = va + vb
  const pctA = total ? (va / total) * 100 : 50
  return (
    <div className="mt-1 flex h-1 w-full overflow-hidden bg-fundo">
      <div className="bg-time-a" style={{ width: `${pctA}%` }} />
      <div className="bg-time-b" style={{ width: `${100 - pctA}%` }} />
    </div>
  )
}

// --- Mockup 1: Partida — placar geral + detalhe round a round ------------------------

function MockPartida() {
  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <MapIcon map={PARTIDA_MOCK.map} size={40} />
        <span className="font-display text-base font-bold uppercase tracking-wide text-texto">
          Mirage
        </span>
        <div className="ml-auto">
          <ResultChip resultado="vitoria" a={PARTIDA_MOCK.scoreA} b={PARTIDA_MOCK.scoreB} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="font-mono uppercase tracking-wide text-texto-fraco">
              <th className="pb-1.5 text-left font-normal">Jogador</th>
              <th className="pb-1.5 text-right font-normal">K</th>
              <th className="pb-1.5 text-right font-normal">D</th>
              <th className="hidden pb-1.5 pr-2 text-right font-normal sm:table-cell">ADR</th>
              <th className="pb-1.5 text-right font-normal">Rating</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borda">
            {PARTIDA_MOCK.jogadores.map((p) => (
              <tr key={p.nick}>
                <td className="py-1.5">
                  <span className="flex items-center gap-2">
                    <Avatar p={p} size={20} />
                    <span className="truncate text-texto">{p.nick}</span>
                  </span>
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums text-texto">{p.k}</td>
                <td className="py-1.5 text-right font-mono tabular-nums text-texto-fraco">{p.d}</td>
                <td className="hidden py-1.5 pr-2 text-right font-mono tabular-nums text-texto-fraco sm:table-cell">{p.adr.toFixed(1)}</td>
                <td className="py-1.5 text-right"><RatingBadge valor={p.rating} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-texto-fraco">
          Round a round
        </p>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {PARTIDA_MOCK.rounds.map((r, i) => {
            const lado = r[0]
            const marcado = r.length > 1
            return (
              <div
                key={i}
                title={marcado ? `Round ${i + 1}: momento notável` : `Round ${i + 1}`}
                className={`panel-cut-sm relative flex h-7 w-6 shrink-0 items-center justify-center border font-mono text-[10px] font-bold ${
                  lado === 'A'
                    ? 'border-time-a/40 bg-time-a/10 text-time-a'
                    : 'border-time-b/40 bg-time-b/10 text-time-b'
                }`}
              >
                {i + 1}
                {marcado && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-destaque" aria-hidden="true" />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="panel-cut-sm border border-destaque/30 bg-destaque-fraco/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tom="destaque">{ROUND_DETALHE.tag}</Badge>
          <span className="font-mono text-xs text-texto-fraco">Round {ROUND_DETALHE.numero}</span>
        </div>
        <p className="mt-1.5 font-mono text-xs leading-relaxed text-texto-fraco">
          <span className="text-texto">{ROUND_DETALHE.autor}</span> fechou o round sozinho ·
          comprou {ROUND_DETALHE.compra}
        </p>
      </div>
    </Card>
  )
}

// --- Mockup 2: Replay 2D — radar tático estilizado (sem vídeo renderizado) -----------

function MockReplay2D() {
  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-texto-fraco">
          Replay 2D · Mirage
        </span>
        <span className="font-mono text-[10px] text-texto-fraco">Round 7</span>
      </div>

      <div className="panel-cut-sm relative aspect-square w-full overflow-hidden border border-borda bg-fundo">
        <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <pattern id="grade-radar" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            </pattern>
            <linearGradient id="tracado-bala" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ff2e43" stopOpacity="0" />
              <stop offset="100%" stopColor="#ff2e43" stopOpacity="0.85" />
            </linearGradient>
          </defs>
          <rect width="200" height="200" fill="url(#grade-radar)" />

          <g stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" fill="none">
            <rect x="18" y="18" width="52" height="40" />
            <rect x="130" y="140" width="52" height="42" />
            <rect x="80" y="82" width="40" height="36" />
          </g>
          <g className="font-mono" fill="rgba(255,255,255,0.35)" fontSize="7">
            <text x="22" y="14">A SITE</text>
            <text x="134" y="136">B SITE</text>
            <text x="84" y="78">MID</text>
          </g>

          <line x1="34" y1="40" x2="98" y2="96" stroke="url(#tracado-bala)" strokeWidth="1.5" />
          <line x1="150" y1="160" x2="100" y2="100" stroke="url(#tracado-bala)" strokeWidth="1.5" />

          <circle cx="34" cy="40" r="4" fill="#f5a524" stroke="#0a0a0c" strokeWidth="1.5" />
          <circle cx="44" cy="52" r="4" fill="#f5a524" stroke="#0a0a0c" strokeWidth="1.5" />
          <circle cx="150" cy="160" r="4" fill="#4fb6ff" stroke="#0a0a0c" strokeWidth="1.5" />
          <circle cx="162" cy="150" r="4" fill="#4fb6ff" stroke="#0a0a0c" strokeWidth="1.5" />
          <circle cx="100" cy="100" r="4" fill="#4fb6ff" stroke="#0a0a0c" strokeWidth="1.5" opacity="0.5" />
        </svg>

        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-sm bg-fundo/80 px-2 py-1 font-mono text-[10px] text-texto-fraco">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3 text-destaque" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
          0:42
        </div>
      </div>
      <p className="font-mono text-[11px] leading-relaxed text-texto-fraco">
        Arraste a linha do tempo e veja o posicionamento de todo mundo, direto no navegador, sem baixar vídeo nenhum.
      </p>
    </Card>
  )
}

// --- Mockup 3: Comparar / Head to Head ------------------------------------------------

function MockComparar() {
  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Avatar p={{ nick: COMPARAR_MOCK.a.nick, team: 'A' }} size={32} />
          <div className="min-w-0">
            <div className="truncate font-display text-sm font-semibold uppercase tracking-wide text-texto">
              {COMPARAR_MOCK.a.nick}
            </div>
            <RatingBadge valor={COMPARAR_MOCK.a.rating} />
          </div>
        </div>
        <span className="shrink-0 font-display text-xs uppercase tracking-widest text-texto-fraco">vs</span>
        <div className="flex min-w-0 flex-1 flex-row-reverse items-center gap-2 text-right">
          <Avatar p={{ nick: COMPARAR_MOCK.b.nick, team: 'B' }} size={32} />
          <div className="min-w-0">
            <div className="truncate font-display text-sm font-semibold uppercase tracking-wide text-texto">
              {COMPARAR_MOCK.b.nick}
            </div>
            <RatingBadge valor={COMPARAR_MOCK.b.rating} />
          </div>
        </div>
      </div>

      <div className="divide-y divide-borda border-t border-borda">
        {COMPARAR_MOCK.linhas.map((l) => (
          <div key={l.rotulo} className="py-2.5">
            <div className="flex items-center justify-between font-mono text-xs">
              <span className="tabular-nums text-time-a">{l.va}</span>
              <span className="uppercase tracking-wide text-texto-fraco">{l.rotulo}</span>
              <span className="tabular-nums text-time-b">{l.vb}</span>
            </div>
            <BarraComparacaoMock va={l.va} vb={l.vb} />
          </div>
        ))}
      </div>
    </Card>
  )
}

// --- Mockup 4: Highlights automáticos + Clipes ----------------------------------------

function MockHighlights() {
  return (
    <div className="space-y-3">
      <Card className="p-4 sm:p-5">
        <p className="font-mono text-xs leading-relaxed text-texto-fraco">
          <span className="text-texto-fraco/70">no grupo:</span> "jura que eu só joguei de Deagle a partida inteira"
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Badge tom="sucesso">Resolvido</Badge>
          <span className="font-mono text-xs text-texto-fraco">
            Desert Eagle: <span className="text-texto">3 kills</span> · AK-47: <span className="text-texto">17 kills</span>
          </span>
        </div>
      </Card>

      <Card className="flex items-center gap-3 p-4 sm:p-5">
        <div className="panel-cut-sm flex h-12 w-12 shrink-0 items-center justify-center border border-destaque/40 bg-destaque-fraco/40 text-destaque">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
            <path d="M12 2l2.4 7.2H22l-6 4.4 2.3 7.1L12 16.3l-6.3 4.4 2.3-7.1-6-4.4h7.6z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tom="destaque">Momento notável</Badge>
            <span className="font-mono text-xs text-texto-fraco">Round 14 · Mirage</span>
          </div>
          <p className="mt-1 font-display text-sm font-semibold uppercase tracking-wide text-texto">
            ACE · kaiser
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-texto-fraco">
          Clipe anexado
        </span>
      </Card>
    </div>
  )
}

// --- Layout de seção: copy de um lado, mockup do outro, alternando -------------------

function Secao({ titulo, corpo, mockup, inverter = false, className = '' }) {
  return (
    <section className={`border-t border-borda py-16 sm:py-20 ${className}`}>
      <div className={`mx-auto grid max-w-5xl items-center gap-10 px-6 lg:grid-cols-2 lg:gap-16 ${inverter ? 'lg:[&>*:first-child]:order-2' : ''}`}>
        <div className="min-w-0">
          <h2 className="text-2xl font-bold uppercase tracking-wide text-texto sm:text-3xl [text-wrap:balance]">
            {titulo}
          </h2>
          <p className="mt-4 max-w-md font-mono text-sm leading-relaxed text-texto-fraco">
            {corpo}
          </p>
        </div>
        <div className="min-w-0">{mockup}</div>
      </div>
    </section>
  )
}

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <CornerMark className="left-6 top-6 border-l border-t" />
      <CornerMark className="right-6 top-6 border-r border-t" />

      {/* Barra superior mínima — âncora fixa pro CTA sem depender de rolar até o topo. */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="font-display text-lg font-bold uppercase tracking-widest text-texto">
          Resenha<span className="text-destaque">.</span>
        </span>
        <Link
          to="/entrar"
          className="panel-cut-sm border border-borda px-4 py-2 font-mono text-xs uppercase tracking-wide text-texto-fraco transition-colors duration-200 hover:border-destaque hover:text-destaque"
        >
          Entrar
        </Link>
      </header>

      {/* Hero */}
      <div className="relative flex flex-col items-center px-6 pb-20 pt-8 text-center sm:pb-28">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[600px] -translate-x-1/2 rounded-full bg-destaque/10 blur-[130px]" />
        <p className="animate-surgir relative font-mono text-xs uppercase tracking-[0.35em] text-destaque" style={{ animationDelay: '0ms' }}>
          Stats de CS2 por grupo
        </p>
        <h1
          className="animate-surgir relative mt-4 max-w-3xl text-4xl font-bold uppercase tracking-widest text-texto [text-wrap:balance] sm:text-6xl lg:text-7xl"
          style={{ animationDelay: '90ms' }}
        >
          A resenha pós-partida,<br className="hidden sm:block" /> com dado de verdade<span className="text-destaque">.</span>
        </h1>
        <p
          className="animate-surgir relative mt-5 max-w-lg font-mono text-sm leading-relaxed text-texto-fraco sm:text-base"
          style={{ animationDelay: '180ms' }}
        >
          Descoberta automática das Partidas, replay 2D, economia por round e comparativos entre
          Jogadores, pra parar de discutir quem carregou e ir direto no dado.
        </p>
        <Link
          to="/entrar"
          className="animate-surgir panel-cut relative mt-9 flex items-center gap-3 border border-destaque bg-destaque px-7 py-3.5 font-display text-sm font-semibold uppercase tracking-wider text-fundo shadow-[0_0_40px_-10px_rgba(255,46,67,0.6)] transition-shadow hover:shadow-[0_0_60px_-8px_rgba(255,46,67,0.8)]"
          style={{ animationDelay: '280ms' }}
        >
          <SteamIcon className="h-5 w-5" />
          Entrar com Steam
        </Link>
        <p className="animate-surgir relative mt-6 font-mono text-[11px] uppercase tracking-widest text-texto-fraco/60" style={{ animationDelay: '360ms' }}>
          Fechado pro grupo, feito pra resenha, não pra internet
        </p>
      </div>

      <Secao
        titulo="Do placar geral ao round que decidiu tudo"
        corpo="Cada Partida abre com a visão de quem jogou bem e desce até o detalhe: o que cada um comprou, quem morreu pra quê, round a round."
        mockup={<MockPartida />}
      />

      <Secao
        titulo="Reveja a jogada, não só o resultado"
        corpo="Replay 2D interativo direto no navegador: posicionamento, tiros e rotações de qualquer round, sem precisar baixar ou renderizar vídeo nenhum."
        mockup={<MockReplay2D />}
        inverter
      />

      <Secao
        titulo="Compare dois Jogadores, direto"
        corpo="Rating, ADR, clutch, headshot%: Head to Head lado a lado entre qualquer dupla do grupo, pra saber de verdade quem é melhor em quê."
        mockup={<MockComparar />}
      />

      <Secao
        titulo="Toda discussão tem um Highlight que resolve"
        corpo="ACE, clutch, multi-kill: a plataforma detecta o Momento Notável sozinha e guarda o Clipe anexado do jogo, pronto pra encerrar a discussão do grupo."
        mockup={<MockHighlights />}
        inverter
      />

      {/* CTA final */}
      <div className="relative flex flex-col items-center border-t border-borda px-6 py-20 text-center sm:py-24">
        <h2 className="max-w-md text-2xl font-bold uppercase tracking-wide text-texto [text-wrap:balance] sm:text-3xl">
          Entra e chama a resenha
        </h2>
        <Link
          to="/entrar"
          className="panel-cut mt-8 flex items-center gap-3 border border-destaque bg-destaque px-7 py-3.5 font-display text-sm font-semibold uppercase tracking-wider text-fundo shadow-[0_0_40px_-10px_rgba(255,46,67,0.6)] transition-shadow hover:shadow-[0_0_60px_-8px_rgba(255,46,67,0.8)]"
        >
          <SteamIcon className="h-5 w-5" />
          Entrar com Steam
        </Link>
      </div>

      <footer className="border-t border-borda px-6 py-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-widest text-texto-fraco/60">
          Resenha, feito pro grupo, não pra internet
        </p>
      </footer>

      <CornerMark className="bottom-6 left-6 border-b border-l" />
      <CornerMark className="bottom-6 right-6 border-b border-r" />
    </div>
  )
}
