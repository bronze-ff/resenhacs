import { useState } from 'react'
import ReplayViewer, { useReplayPorRound } from '../ReplayViewer.jsx'
import { Button, Card, EstadoErro, Skeleton } from '../ui'

// Movido de pages/Taticas.jsx (T2, Fase 3) sem mudar comportamento — era o único
// card da aba Táticas antes do playbook curado; agora vive na seção secundária
// "Do grupo (replays)" da página do mapa (PaginaMapaTaticas.jsx).
// Carrega o replay igual à Partida (índice + /replay/round/:n): o replay por round
// não traz `frames` no índice, e o viewer abria vazio.
export default function CardTaticaReplay({ t }) {
  const [aberta, setAberta] = useState(false)
  const { replay, erro, roundsComErro, tentarRound, tentarDeNovo } = useReplayPorRound(
    aberta ? `/api/matches/${t.matchId}/replay` : null,
  )

  return (
    <Card className="p-3">
      <button onClick={() => setAberta((v) => !v)} aria-expanded={aberta} className="w-full text-left">
        <p className="font-display text-sm font-semibold text-texto">{t.nome}</p>
        <p className="font-mono text-xs text-texto-fraco">{t.descricao}</p>
        <p className="mt-1 font-mono text-[11px] text-texto-fraco/70">sugerida por {t.criadoPorNick || t.criadoPor}</p>
      </button>
      {aberta && (
        <div className="mt-3">
          {erro ? (
            <EstadoErro
              mensagem="Não deu para carregar o Replay 2D."
              acao={<Button variante="secundario" tamanho="sm" onClick={tentarDeNovo}>Tentar de novo</Button>}
            />
          ) : replay ? (
            // key estável: o seek só re-dispara quando a tática muda, não a cada render.
            <ReplayViewer
              replay={replay}
              seek={{ round: t.roundNumber, frame: 0, key: t.id }}
              roundsComErro={roundsComErro}
              onTentarRound={tentarRound}
            />
          ) : (
            <div role="status" aria-label="Carregando replay">
              <Skeleton className="aspect-square w-full" />
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
