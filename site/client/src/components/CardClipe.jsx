// site/client/src/components/CardClipe.jsx
// Card de clipe da Allstar — extraído de Clipes.jsx pra reuso na seção de clipes do
// perfil do jogador (mesma interface, mesmo comportamento nas duas telas).
import { Link } from 'react-router-dom'
import { Card, Badge } from './ui'
import { nomeMapa, dataHora } from '../lib/format.js'

const NOME_KIND = {
  ace: 'ACE', quad: 'QUAD KILL', triple: 'TRIPLE KILL',
  clutch_1v5: 'CLUTCH 1v5', clutch_1v4: 'CLUTCH 1v4', clutch_1v3: 'CLUTCH 1v3',
  clutch_1v2: 'CLUTCH 1v2', clutch_1v1: 'CLUTCH 1v1',
}

// kind vem null quando o round que a Allstar escolheu (gerar clipe por JOGADOR, não
// mais por highlight) não bate com nenhum highlight nosso pra esse jogador/round — só
// afeta o rótulo exibido, a pontuação (clipesScore.js) não depende de kind.
function nomeDoKind(kind) {
  if (!kind) return 'MOMENTO'
  return NOME_KIND[kind] ?? kind
}

function SnapshotPlaceholder() {
  return (
    <div className="mt-3 flex aspect-video w-full items-center justify-center border border-borda bg-superficie-alta text-texto-fraco">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8">
        <rect x="3" y="5" width="18" height="14" rx="1" />
        <path d="M9 9L15 12L9 15V9Z" fill="currentColor" stroke="none" />
      </svg>
    </div>
  )
}

function PlayerClipe({ clipUrl, viewerSteamId, titulo }) {
  return (
    <div className="mt-3 aspect-video w-full">
      <iframe
        src={`${clipUrl}&UID=${viewerSteamId ?? ''}&location=melhoresClipes`}
        allow="autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"
        allowFullScreen
        className="h-full w-full border border-borda"
        title={titulo ?? 'Clipe Allstar'}
      />
    </div>
  )
}

// Tooltip explica o calculo — mesma logica de transparencia da spec (Competicoes
// tambem mostra o detalhamento), aqui e so leitura sobre o clipe.
function tituloPontuacao(p) {
  const partes = [`${p.kills} kills (${p.pontosKills})`]
  if (p.headshots > 0) partes.push(`${p.headshots} headshots (+${p.pontosHeadshots})`)
  if (p.clutch) partes.push(`clutch ${p.clutch} (+${p.pontosClutch})`)
  if (p.armas > 0) partes.push(`${p.armas} armas distintas (+${p.pontosArmas})`)
  return `${partes.join(' + ')} = ${p.total}`
}

export default function CardClipe({ clipe, aberto, onAbrir, viewerSteamId }) {
  const { pontuacao } = clipe
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {clipe.avatarUrl && (
            <img src={clipe.avatarUrl} alt="" className="panel-cut-sm h-8 w-8 shrink-0 border border-borda object-cover" />
          )}
          <div className="min-w-0">
            <Badge tom="destaque">{nomeDoKind(clipe.kind)}</Badge>
            <p className="mt-1 truncate font-mono text-sm text-texto">
              <span>{clipe.nick}</span> · round {clipe.roundNumber} · {clipe.map}
            </p>
            <Link
              to={`/partida/${clipe.matchId}`}
              className="mt-0.5 block truncate font-mono text-xs text-texto-fraco underline-offset-2 hover:text-destaque hover:underline"
            >
              Ver partida — {nomeMapa(clipe.map)} · {dataHora(clipe.playedAt)}
            </Link>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-lg font-bold text-destaque" title={tituloPontuacao(pontuacao)}>
            {pontuacao.total}
          </div>
        </div>
      </div>
      {!aberto && (clipe.clipSnapshotUrl
        ? <img src={clipe.clipSnapshotUrl} alt="" className="mt-3 aspect-video w-full border border-borda object-cover" />
        : <SnapshotPlaceholder />)}
      <button
        type="button"
        onClick={() => onAbrir(aberto ? null : clipe.id)}
        className="panel-cut-sm mt-3 min-h-10 w-full border border-borda px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-texto-fraco hover:border-destaque/50 hover:text-destaque lg:min-h-0"
      >
        {aberto ? 'Fechar' : '▶ Assistir'}
      </button>
      {aberto && (
        <PlayerClipe
          clipUrl={clipe.clipUrl}
          viewerSteamId={viewerSteamId}
          titulo={`Clipe Allstar de ${clipe.nick} — ${nomeDoKind(clipe.kind)} round ${clipe.roundNumber}`}
        />
      )}
    </Card>
  )
}
