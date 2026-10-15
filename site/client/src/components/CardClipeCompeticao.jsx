// Card de um Clipe de Competição, compartilhado por três telas: a seleção de envio
// (com botão), o feed de enviados recentes e a expansão de um Jogador no
// leaderboard (as duas últimas com autor). Sem esta extração o mesmo card
// existiria em três variantes parecidas-mas-não-iguais.
import { PlayerClipe, SnapshotPlaceholder, nomeDoKind } from './ui/PlayerClipe.jsx'
import { nomeMapa, dataHora } from '../lib/format.js'
import { Badge, Button } from './ui'
import { IconeFechar } from './ui/Modal.jsx'

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
  clipe, autor = false, aberto, onAbrir, viewerSteamId, location = 'competicao', acao = null, chave = clipe.id,
}) {
  // `chave` qualifica o toggle por seção (ex.: `feed:${id}` vs `lb:${id}`) — o
  // mesmo Clipe de um Jogador bem colocado costuma aparecer tanto no feed quanto
  // na expansão da linha dele no leaderboard, e comparar só clipe.id fazia os
  // dois cards abrirem juntos (dois players tocando ao mesmo tempo). Default
  // cai em clipe.id pra não quebrar o SeletorClipesCompeticao, que não repete
  // o mesmo Clipe em duas listas simultâneas.
  const abrirOuFechar = () => onAbrir(aberto ? null : chave)
  const rotuloAssistir = `Assistir clipe de ${nomeMapa(clipe.map)} round ${clipe.roundNumber}`

  const partes = partesDaPontuacao(clipe.pontuacao)

  return (
    <div className="panel-cut-sm flex flex-col border border-borda bg-superficie-alta/30 p-3 transition-colors duration-200 hover:border-borda-forte">
      {autor && (
        <div className="mb-3 flex items-center gap-2">
          {clipe.avatarUrl && (
            <img src={clipe.avatarUrl} alt="" className="h-6 w-6 border border-borda object-cover" />
          )}
          <span className="min-w-0 truncate font-mono text-xs text-texto">{clipe.nick}</span>
        </div>
      )}

      {aberto ? (
        <>
          <div className="mb-2 flex justify-end">
            <Button variante="fantasma" tamanho="sm" icone={<IconeFechar className="h-3.5 w-3.5" />} onClick={abrirOuFechar}>
              Fechar
            </Button>
          </div>
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
          className="group relative block aspect-video w-full overflow-hidden border border-borda"
        >
          <img src={clipe.clipSnapshotUrl} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
          <span className="absolute inset-0 flex items-center justify-center bg-fundo/45 transition-colors duration-200 group-hover:bg-fundo/25">
            <span className="panel-cut-tr flex items-center gap-2 border border-texto/30 bg-fundo/70 px-3 py-1.5 font-display text-sm font-semibold text-texto">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>
              Assistir
            </span>
          </span>
        </button>
      ) : (
        <button type="button" onClick={abrirOuFechar} aria-label={rotuloAssistir} className="block w-full">
          <SnapshotPlaceholder />
        </button>
      )}

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Badge tom="destaque">{rotuloDaJogada(clipe)}</Badge>
          <p className="mt-1.5 truncate font-mono text-xs text-texto-fraco">
            {nomeMapa(clipe.map)} · {dataHora(clipe.playedAt)} · round {clipe.roundNumber}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="block font-display text-2xl font-semibold leading-none tabular-nums text-destaque">{clipe.pontuacao.total}</span>
          <span className="rotulo">pts</span>
        </div>
      </div>

      {partes.length > 0 && (
        <p className="mt-2 border-t border-borda pt-2 font-mono text-[11px] text-texto-fraco">
          {partes.join(' · ')}
        </p>
      )}

      {acao}
    </div>
  )
}
