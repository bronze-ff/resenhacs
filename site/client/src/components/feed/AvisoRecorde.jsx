import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { nomeMapa, dataHora } from '../../lib/format.js'
import { Button } from '../ui'

// Aviso "você bateu seu recorde pessoal" no topo do Feed (referência: Leetify). Mostra o
// recorde mais recente dos últimos 14 dias que o Jogador ainda não dispensou. Dispensar
// fica só neste navegador (localStorage) — é conveniência, não estado do produto.
const CHAVE_DISPENSADOS = 'resenha_recordes_dispensados'

function lerDispensados() {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_DISPENSADOS) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function formatar(r) {
  if (r.metrica === 'rating') return r.valor.toFixed(2)
  if (r.metrica === 'adr') return r.valor.toFixed(1)
  return String(r.valor)
}

export default function AvisoRecorde() {
  const [recordes, setRecordes] = useState(null)
  const [dispensados, setDispensados] = useState(lerDispensados)

  useEffect(() => {
    fetch('/api/recordes/pessoais')
      .then((res) => (res.ok ? res.json() : []))
      .then((d) => setRecordes(Array.isArray(d) ? d : []))
      .catch(() => setRecordes([]))
  }, [])

  const chave = (r) => `${r.matchId}:${r.metrica}`
  const r = recordes?.find((x) => !dispensados.includes(chave(x)))
  if (!r) return null

  function dispensar() {
    const novo = [...dispensados, chave(r)].slice(-50)
    setDispensados(novo)
    try {
      localStorage.setItem(CHAVE_DISPENSADOS, JSON.stringify(novo))
    } catch {
      // storage indisponível: some só nesta visita
    }
  }

  const outros = recordes.filter((x) => x.matchId === r.matchId && x.metrica !== r.metrica)
  return (
    <div role="status" className="flex flex-wrap items-center gap-4 rounded-[var(--radius-grande)] border border-ouro/30 bg-ouro/5 px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-medio)] bg-ouro/10 text-ouro" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className="h-5 w-5">
          <path d="M12 2l3 6.5 7 .8-5.2 4.7 1.5 7L12 17.5 5.7 21l1.5-7L2 9.3l7-.8z" />
        </svg>
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-medium text-texto">
          Você bateu seu recorde pessoal de {r.nome}: <span className="font-mono text-ouro">{formatar(r)}</span>
        </p>
        <p className="mt-0.5 text-[13px] text-texto-fraco">
          Antes era {formatar({ ...r, valor: r.anterior })} · {nomeMapa(r.map)} · {dataHora(r.playedAt)}
          {outros.length > 0 && ` · e também ${outros.map((o) => o.nome).join(', ')}`}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button as={Link} to={`/partida/${r.matchId}`} variante="secundario" tamanho="sm">Ver partida</Button>
        <Button variante="fantasma" tamanho="sm" onClick={dispensar}>Dispensar</Button>
      </div>
    </div>
  )
}
