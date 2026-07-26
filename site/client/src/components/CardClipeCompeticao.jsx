// Card de um Clipe de Competição, compartilhado por três telas: a seleção de envio
// (com botão), o feed de enviados recentes e a expansão de um Jogador no
// leaderboard (as duas últimas com autor). Sem esta extração o mesmo card
// existiria em três variantes parecidas-mas-não-iguais.
import { PlayerClipe, SnapshotPlaceholder, nomeDoKind } from './ui/PlayerClipe.jsx'
import { nomeMapa, dataHora } from '../lib/format.js'

// Breakdown como TEXTO, não tooltip: a decisão "essa jogada foi boa?" é tomada
// olhando o card, e no celular não existe hover. Só entram os componentes que
// somaram. Aguenta a forma reduzida { total } dos Clipes antigos sem detalhe.
export function partesDaPontuacao(p) {
  const partes = []
  if (p.kills > 0) partes.push(`${p.kills} kills ${p.pontosKills}`)
  if (p.headshots > 0) partes.push(`${p.headshots} hs ${p.pontosHeadshots}`)
  if (p.armas > 0) partes.push(`${p.armas} armas ${p.pontosArmas}`)
  if (p.clutch) partes.push(`clutch ${p.clutch} ${p.pontosClutch}`)
  return partes
}

// Sem Highlight correspondente (kind nulo) o rótulo cai pro número de kills, que
// diz mais que o "MOMENTO" genérico pra quem está julgando a jogada.
export function rotuloDaJogada(clipe) {
  if (clipe.kind) return nomeDoKind(clipe.kind)
  const kills = clipe.pontuacao?.kills
  return kills > 0 ? `${kills} KILLS` : 'MOMENTO'
}

export default function CardClipeCompeticao({
  clipe, autor = false, aberto, onAbrir, viewerSteamId, location = 'competicao', acao = null,
}) {
  const abrirOuFechar = () => onAbrir(aberto ? null : clipe.id)
  const rotuloAssistir = `Assistir clipe de ${nomeMapa(clipe.map)} round ${clipe.roundNumber}`

  return (
    <div className="panel-cut-sm border border-borda p-3">
      {autor && (
        <div className="flex items-center gap-2">
          {clipe.avatarUrl && (
            <img src={clipe.avatarUrl} alt="" className="panel-cut-sm h-6 w-6 border border-borda object-cover" />
          )}
          <span className="min-w-0 truncate font-mono text-xs text-texto">{clipe.nick}</span>
        </div>
      )}

      {aberto ? (
        <>
          <button
            type="button"
            onClick={abrirOuFechar}
            className="mt-3 font-mono text-xs uppercase text-texto-fraco hover:text-texto"
          >
            fechar
          </button>
          <PlayerClipe
            clipUrl={clipe.clipUrl}
            viewerSteamId={viewerSteamId}
            titulo={`${nomeMapa(clipe.map)} round ${clipe.roundNumber}`}
            location={location}
          />
        </>
      ) : clipe.clipSnapshotUrl ? (
        <button
          type="button"
          onClick={abrirOuFechar}
          aria-label={rotuloAssistir}
          className="relative mt-3 block aspect-video w-full border border-borda"
        >
          <img src={clipe.clipSnapshotUrl} alt="" className="h-full w-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center bg-fundo/40 font-mono text-xs uppercase tracking-widest text-texto">
            ▶ assistir
          </span>
        </button>
      ) : (
        <button type="button" onClick={abrirOuFechar} aria-label={rotuloAssistir} className="block w-full">
          <SnapshotPlaceholder />
        </button>
      )}

      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="panel-cut-sm border border-destaque/40 bg-destaque/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-destaque">
            {rotuloDaJogada(clipe)}
          </span>
          <p className="mt-1 font-mono text-xs text-texto-fraco">
            {nomeMapa(clipe.map)} · {dataHora(clipe.playedAt)} · round {clipe.roundNumber}
          </p>
        </div>
        <span className="font-display text-lg font-bold text-destaque">{clipe.pontuacao.total}</span>
      </div>

      {partesDaPontuacao(clipe.pontuacao).length > 0 && (
        <p className="mt-1 font-mono text-[11px] text-texto-fraco">
          {partesDaPontuacao(clipe.pontuacao).join(' · ')}
        </p>
      )}

      {acao}
    </div>
  )
}
