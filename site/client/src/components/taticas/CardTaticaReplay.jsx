import { useState } from 'react'
import ReplayViewer from '../ReplayViewer.jsx'
import { Card } from '../ui'

// Movido de pages/Taticas.jsx (T2, Fase 3) sem mudar comportamento — era o único
// card da aba Táticas antes do playbook curado; agora vive na seção secundária
// "Do grupo (replays)" da página do mapa (PaginaMapaTaticas.jsx).
export default function CardTaticaReplay({ t }) {
  const [aberta, setAberta] = useState(false)
  const [replay, setReplay] = useState(null)

  function abrir() {
    setAberta((v) => !v)
    if (!replay) {
      fetch(`/api/matches/${t.matchId}/replay`).then((r) => r.json()).then(setReplay).catch(() => {})
    }
  }

  return (
    <Card className="p-3">
      <button onClick={abrir} className="w-full text-left">
        <p className="font-display text-sm font-semibold uppercase text-texto">{t.nome}</p>
        <p className="font-mono text-xs text-texto-fraco">{t.descricao}</p>
        <p className="mt-1 font-mono text-[10px] uppercase text-texto-fraco/70">sugerida por {t.criadoPorNick || t.criadoPor}</p>
      </button>
      {aberta && replay && (
        <div className="mt-3">
          <ReplayViewer replay={replay} seek={{ round: t.roundNumber, frame: 0, key: `${t.id}-${Date.now()}` }} />
        </div>
      )}
    </Card>
  )
}
