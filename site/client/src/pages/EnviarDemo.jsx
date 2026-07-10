import { useState } from 'react'
import { Link } from 'react-router-dom'

export default function EnviarDemo() {
  const [arquivo, setArquivo] = useState(null)
  const [shareCode, setShareCode] = useState('')
  const [playedAt, setPlayedAt] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState(null)

  async function enviar(e) {
    e.preventDefault()
    if (!arquivo) return
    setEnviando(true)
    setErro(null)
    setResultado(null)
    const form = new FormData()
    form.append('demo', arquivo)
    if (shareCode) form.append('shareCode', shareCode)
    if (playedAt) form.append('playedAt', playedAt)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setResultado(body)
      } else {
        setErro(body.erro ?? 'Erro ao processar o demo')
      }
    } catch {
      setErro('Falha de rede ao enviar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="max-w-lg">
      <h2 className="mb-2 font-display text-xl font-semibold uppercase tracking-wide text-texto">Enviar demo</h2>
      <p className="mb-4 font-mono text-sm leading-relaxed text-texto-fraco">
        Baixe o .dem em CS2 → Assistir → Suas Partidas (ou do Faceit/GC) e envie aqui.
        O processamento roda no Coletor local e pode levar até um minuto.
      </p>

      <form onSubmit={enviar} className="space-y-3">
        <div>
          <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="arquivo">
            Arquivo .dem
          </label>
          <input
            id="arquivo"
            type="file"
            accept=".dem"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
          />
        </div>
        <div>
          <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="shareCode">
            Share code (opcional, evita duplicar se descoberto automaticamente)
          </label>
          <input
            id="shareCode"
            value={shareCode}
            onChange={(e) => setShareCode(e.target.value)}
            placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
            className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
          />
        </div>
        <div>
          <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="playedAt">
            Quando foi jogada (opcional — sem isso, a data pode sair aproximada)
          </label>
          <input
            id="playedAt"
            type="datetime-local"
            value={playedAt}
            onChange={(e) => setPlayedAt(e.target.value)}
            className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={!arquivo || enviando}
          className="panel-cut-sm border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo transition-opacity disabled:opacity-40"
        >
          {enviando ? 'Processando… (pode levar até 1 min)' : 'Enviar'}
        </button>
      </form>

      {erro && <p className="mt-4 font-mono text-sm text-perigo">{erro}</p>}
      {resultado && (
        <p className="mt-4 font-mono text-sm text-sucesso">
          Partida gravada!{' '}
          {resultado.matchId && (
            <Link to={`/partida/${resultado.matchId}`} className="underline">
              Ver partida
            </Link>
          )}
        </p>
      )}
    </div>
  )
}
