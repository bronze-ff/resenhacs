import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Card, SectionHeader } from '../components/ui'

function formatarTamanho(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function EnviarDemo() {
  const [arquivo, setArquivo] = useState(null)
  const [shareCode, setShareCode] = useState('')
  const [playedAt, setPlayedAt] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState(null)
  const [arrastando, setArrastando] = useState(false)

  function escolherArquivo(lista) {
    const f = lista?.[0]
    if (f && f.name.toLowerCase().endsWith('.dem')) setArquivo(f)
  }

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setArrastando(false)
    escolherArquivo(e.dataTransfer?.files)
  }, [])

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
    <div className="max-w-lg space-y-4">
      <SectionHeader titulo="Enviar demo" />
      <p className="font-mono text-sm leading-relaxed text-texto-fraco">
        Baixe o .dem em CS2 → Assistir → Suas Partidas (ou do Faceit/GC) e envie aqui.
        O processamento roda no Coletor local e pode levar até um minuto.
      </p>

      <Card className="p-4 sm:p-5">
        <form onSubmit={enviar} className="space-y-4">
          <label
            htmlFor="arquivo"
            onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
            onDragLeave={() => setArrastando(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed px-4 py-10 text-center transition-colors ${
              arrastando ? 'border-destaque bg-destaque/5' : 'border-borda hover:border-destaque/60'
            }`}
          >
            <span className="font-display text-sm font-semibold uppercase tracking-wide text-texto">
              {arquivo ? arquivo.name : 'Arraste o .dem aqui ou clique pra escolher'}
            </span>
            {arquivo && (
              <span className="font-mono text-xs text-texto-fraco">{formatarTamanho(arquivo.size)}</span>
            )}
            <input
              id="arquivo"
              type="file"
              accept=".dem"
              onChange={(e) => escolherArquivo(e.target.files)}
              className="hidden"
            />
          </label>

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
            className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo transition-opacity disabled:opacity-40 lg:min-h-0 lg:w-auto"
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
      </Card>
    </div>
  )
}
