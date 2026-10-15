import { Card, Badge, RatingBadge, ResultChip, MapIcon, Avatar, SteamIcon, Button } from '../components/ui'
import { nomeArma } from '../lib/format.js'

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
        <span className="font-display text-base font-semibold text-texto">
          Mirage
        </span>
        <div className="ml-auto">
          <ResultChip resultado="vitoria" a={PARTIDA_MOCK.scoreA} b={PARTIDA_MOCK.scoreB} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="font-mono text-texto-fraco">
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
        <p className="mb-1.5 font-mono text-[11px] text-texto-fraco">
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
        <span className="font-mono text-[11px] text-texto-fraco">
          Replay 2D · Mirage
        </span>
        <span className="font-mono text-[11px] text-texto-fraco">Round 7</span>
      </div>

      <div className="panel-cut-sm relative aspect-square w-full overflow-hidden border border-borda bg-fundo">
        <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <pattern id="grade-radar" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            </pattern>
            <linearGradient id="tracado-bala" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ff6a1a" stopOpacity="0" />
              <stop offset="100%" stopColor="#ff6a1a" stopOpacity="0.85" />
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

          <circle cx="34" cy="40" r="4" fill="#e9b949" stroke="#0a0a0b" strokeWidth="1.5" />
          <circle cx="44" cy="52" r="4" fill="#e9b949" stroke="#0a0a0b" strokeWidth="1.5" />
          <circle cx="150" cy="160" r="4" fill="#5aa9ff" stroke="#0a0a0b" strokeWidth="1.5" />
          <circle cx="162" cy="150" r="4" fill="#5aa9ff" stroke="#0a0a0b" strokeWidth="1.5" />
          <circle cx="100" cy="100" r="4" fill="#5aa9ff" stroke="#0a0a0b" strokeWidth="1.5" opacity="0.5" />
        </svg>

        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-sm bg-fundo/80 px-2 py-1 font-mono text-[11px] text-texto-fraco">
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
            <div className="truncate font-display text-sm font-semibold text-texto">
              {COMPARAR_MOCK.a.nick}
            </div>
            <RatingBadge valor={COMPARAR_MOCK.a.rating} />
          </div>
        </div>
        <span className="shrink-0 font-display text-xs text-texto-fraco">vs</span>
        <div className="flex min-w-0 flex-1 flex-row-reverse items-center gap-2 text-right">
          <Avatar p={{ nick: COMPARAR_MOCK.b.nick, team: 'B' }} size={32} />
          <div className="min-w-0">
            <div className="truncate font-display text-sm font-semibold text-texto">
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
              <span className="text-texto-fraco">{l.rotulo}</span>
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
          <p className="mt-1 font-display text-sm font-semibold text-texto">
            ACE · kaiser
          </p>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-texto-fraco">
          Clipe anexado
        </span>
      </Card>
    </div>
  )
}

// --- Layout de seção: copy de um lado, mockup do outro, alternando -------------------

function Secao({ numero, eyebrow, titulo, corpo, mockup, inverter = false, className = '' }) {
  return (
    <section className={`border-t border-borda py-16 sm:py-24 ${className}`}>
      <div className={`mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-2 lg:gap-20 ${inverter ? 'lg:[&>*:first-child]:order-2' : ''}`}>
        <div className="min-w-0">
          <div className="rotulo mb-4 flex items-center gap-3">
            <span className="font-display text-base font-semibold tracking-normal text-destaque">{numero}</span>
            <span className="h-px w-8 bg-borda-forte" aria-hidden="true" />
            {eyebrow}
          </div>
          <h2 className="text-3xl font-bold leading-[0.95] text-texto sm:text-5xl [text-wrap:balance]">
            {titulo}
          </h2>
          <p className="mt-5 max-w-md text-base leading-relaxed text-texto-fraco">
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

      {/* Barra superior mínima — âncora fixa pro CTA sem depender de rolar até o topo. */}
      <header className="sticky top-0 z-20 border-b border-borda/60 bg-fundo/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <span className="flex items-center gap-2.5">
            <span aria-hidden="true" className="panel-cut-sm flex h-8 w-8 items-center justify-center bg-destaque font-sans text-lg font-bold text-sobre-destaque">R</span>
            <span className="font-display text-xl font-semibold text-texto">
              Resenha
            </span>
          </span>
          <div className="flex items-center gap-2">
            <Button as="a" href="/replay-demo" variante="fantasma" tamanho="sm" className="hidden sm:inline-flex">
              Ver replay de exemplo
            </Button>
            <Button as="a" href="/api/auth/steam" variante="secundario" tamanho="sm">
              Entrar
            </Button>
          </div>
        </div>
      </header>

      {/* Hero: copy à esquerda, prévia real do produto à direita. */}
      <div className="relative">
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-14 sm:pb-28 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div className="min-w-0 text-center lg:text-left">
            <p className="animate-surgir rotulo inline-flex items-center gap-2 border border-destaque/30 bg-destaque/5 px-3 py-1.5 !text-destaque" style={{ animationDelay: '0ms' }}>
              <span className="h-1.5 w-1.5 animate-pulso-sinal rounded-full bg-destaque" aria-hidden="true" />
              Stats de CS2 por grupo
            </p>
            <h1
              className="animate-surgir mt-6 text-5xl font-extrabold leading-[0.9] text-texto [text-wrap:balance] sm:text-7xl lg:text-[88px]"
              style={{ animationDelay: '90ms' }}
            >
              A resenha pós-partida, com dado de verdade.
            </h1>
            <p
              className="animate-surgir mx-auto mt-6 max-w-lg text-base leading-relaxed text-texto-fraco sm:text-lg lg:mx-0"
              style={{ animationDelay: '180ms' }}
            >
              Descoberta automática das Partidas, replay 2D, economia por round e comparativos entre
              Jogadores, pra parar de discutir quem carregou e ir direto no dado.
            </p>
            <div className="animate-surgir mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start" style={{ animationDelay: '280ms' }}>
              <Button as="a" href="/api/auth/steam" variante="primario" tamanho="lg" icone={<SteamIcon className="h-5 w-5" />}>
                Entrar com Steam
              </Button>
              <Button as="a" href="/replay-demo" variante="secundario" tamanho="lg">
                Ver replay de exemplo
              </Button>
            </div>
            <dl className="animate-surgir mx-auto mt-10 grid max-w-md grid-cols-3 divide-x divide-borda border-y border-borda lg:mx-0" style={{ animationDelay: '360ms' }}>
              {[['Auto', 'Partidas'], ['2D', 'Replay'], ['1v1', 'Head to Head']].map(([valor, rotulo]) => (
                <div key={rotulo} className="px-3 py-3 text-center lg:text-left">
                  <dt className="rotulo">{rotulo}</dt>
                  <dd className="mt-0.5 font-display text-2xl font-semibold text-texto">{valor}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="animate-surgir relative min-w-0" style={{ animationDelay: '220ms' }}>
            <img
              src="/radars/de_mirage.png"
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute -right-10 -top-10 w-[115%] max-w-none opacity-[0.07] [mask-image:radial-gradient(closest-side,black,transparent)]"
            />
            <div className="relative shadow-flutuante">
              <MockPartida />
            </div>
          </div>
        </div>
      </div>

      <Secao
        numero="01"
        eyebrow="Partida"
        titulo="Do placar geral ao round que decidiu tudo"
        corpo="Cada Partida abre com a visão de quem jogou bem e desce até o detalhe: o que cada um comprou, quem morreu pra quê, round a round."
        mockup={<MockPartida />}
      />

      <Secao
        numero="02"
        eyebrow="Replay 2D"
        titulo="Reveja a jogada, não só o resultado"
        corpo="Replay 2D interativo direto no navegador: posicionamento, tiros e rotações de qualquer round, sem precisar baixar ou renderizar vídeo nenhum."
        mockup={<MockReplay2D />}
        inverter
      />

      <Secao
        numero="03"
        eyebrow="Head to Head"
        titulo="Compare dois Jogadores, direto"
        corpo="Rating, ADR, clutch, headshot%: Head to Head lado a lado entre qualquer dupla do grupo, pra saber de verdade quem é melhor em quê."
        mockup={<MockComparar />}
      />

      <Secao
        numero="04"
        eyebrow="Highlights"
        titulo="Toda discussão tem um Highlight que resolve"
        corpo="ACE, clutch, multi-kill: a plataforma detecta o Momento Notável sozinha e guarda o Clipe anexado do jogo, pronto pra encerrar a discussão do grupo."
        mockup={<MockHighlights />}
        inverter
      />

      {/* CTA final */}
      <div className="border-t border-borda px-6 py-20 sm:py-28">
        <div className="panel-cut relative mx-auto flex max-w-4xl flex-col items-center overflow-hidden border border-borda bg-superficie px-6 py-14 text-center">
          <h2 className="relative max-w-lg text-4xl font-extrabold leading-[0.95] text-texto [text-wrap:balance] sm:text-5xl">
            Entra e chama a resenha
          </h2>
          <p className="relative mt-4 max-w-sm text-sm text-texto-fraco">
            Login com a Steam. Quem já é seu amigo lá entra no grupo automático.
          </p>
          <Button as="a" href="/api/auth/steam" variante="primario" tamanho="lg" className="relative mt-8" icone={<SteamIcon className="h-5 w-5" />}>
            Entrar com Steam
          </Button>
        </div>
      </div>

      <footer className="border-t border-borda px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 sm:flex-row">
          <span className="font-display text-base font-semibold text-texto">
            Resenha
          </span>
          <p className="rotulo">
            Feito pro grupo, não pra internet · <a href="/privacidade" className="hover:text-texto">Privacidade</a>
          </p>
        </div>
      </footer>

    </div>
  )
}
