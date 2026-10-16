import { useEffect, useState } from 'react'
import { dataHora } from '../lib/format.js'

// Minha conta → Contas vinculadas → FACEIT: quando o Coletor varreu o histórico do
// Jogador pela última vez e quantas Partidas FACEIT dele já estão no Resenha. Dados só
// do próprio Jogador (GET /api/faceit-sincronizacao). Falha de rede some em silêncio:
// é informação de apoio, o vínculo em si aparece no card de qualquer jeito.
export default function SincronizacaoFaceit() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let vivo = true
    Promise.resolve()
      .then(() => fetch('/api/faceit-sincronizacao'))
      .then((r) => (r?.ok ? r.json() : null))
      .then((b) => { if (vivo) setStatus(b) })
      .catch(() => {})
    return () => { vivo = false }
  }, [])

  if (!status?.vinculada) return null
  const { ultimaSincronizacao, partidasImportadas, partidasSemDemo } = status
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-texto-fraco">
      <dt>Última sincronização</dt>
      <dd className="font-mono tabular-nums text-texto">
        {ultimaSincronizacao ? dataHora(ultimaSincronizacao) : 'ainda não rodou'}
      </dd>
      <dt>Partidas importadas</dt>
      <dd className="font-mono tabular-nums text-texto">
        {partidasImportadas}
        {partidasSemDemo > 0 && (
          <span className="font-sans text-texto-fraco">
            {' '}({partidasSemDemo} só com estatísticas básicas)
          </span>
        )}
      </dd>
    </dl>
  )
}
