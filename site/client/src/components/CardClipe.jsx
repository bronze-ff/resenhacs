// site/client/src/components/CardClipe.jsx
// Card de clipe da Allstar — extraído de Clipes.jsx pra reuso na seção de clipes do
// perfil do jogador (mesma interface, mesmo comportamento nas duas telas).
import { Link } from 'react-router-dom'
import { Card, Badge, Button } from './ui'
import { IconeFechar } from './ui/Modal.jsx'
import { PlayerClipe, SnapshotPlaceholder, nomeDoKind } from './ui/PlayerClipe.jsx'
import { nomeMapa, dataHora } from '../lib/format.js'

// Tooltip explica o calculo — mesma logica de transparencia da spec (Competicoes
// tambem mostra o detalhamento), aqui e so leitura sobre o clipe.
function tituloPontuacao(p) {
  const partes = []
  // pontuacao_detalhe nulo (fallback dos dois endpoints) chega como { total } só —
  // sem o guard aqui o tooltip mostrava "undefined kills (undefined)".
  if (p.kills != null) partes.push(`${p.kills} kills (${p.pontosKills})`)
  if (p.headshots > 0) partes.push(`${p.headshots} headshots (+${p.pontosHeadshots})`)
  if (p.clutch) partes.push(`clutch ${p.clutch} (+${p.pontosClutch})`)
  if (p.armas > 0) partes.push(`${p.armas} armas distintas (+${p.pontosArmas})`)
  return partes.length ? `${partes.join(' + ')} = ${p.total}` : `${p.total}`
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
          <div className="font-display text-2xl font-semibold leading-none tabular-nums text-destaque" title={tituloPontuacao(pontuacao)}>
            {pontuacao.total}
          </div>
          <span className="rotulo">pts</span>
        </div>
      </div>
      {!aberto && (clipe.clipSnapshotUrl
        ? <img src={clipe.clipSnapshotUrl} alt="" className="mt-3 aspect-video w-full border border-borda object-cover" />
        : <SnapshotPlaceholder />)}
      <Button
        variante={aberto ? 'fantasma' : 'secundario'}
        tamanho="sm"
        larguraTotal
        className="mt-3"
        icone={aberto
          ? <IconeFechar className="h-3.5 w-3.5" />
          : <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>}
        onClick={() => onAbrir(aberto ? null : clipe.id)}
      >
        {aberto ? 'Fechar' : 'Assistir'}
      </Button>
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
