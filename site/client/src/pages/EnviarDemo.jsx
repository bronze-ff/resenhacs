import { useState, useCallback } from 'react'
import { Card, SectionHeader } from '../components/ui'

function formatarTamanho(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Plataformas sem integração oficial — rótulo informativo escolhido no upload, vira
// badge na Partida/Feed (matches.plataforma_manual). Lista fixa, igual à do servidor
// (PLATAFORMAS_MANUAIS em site/server/src/routes/upload.js).
const PLATAFORMAS = [
  { valor: '', label: 'Nenhuma / não sei' },
  { valor: 'faceit', label: 'FACEIT' },
  { valor: 'gamers_club', label: 'Gamers Club' },
  { valor: 'xplay_gg', label: 'XPLAY.GG' },
]

export default function EnviarDemo() {
  const [arquivo, setArquivo] = useState(null)
  const [shareCode, setShareCode] = useState('')
  const [playedAt, setPlayedAt] = useState('')
  const [plataforma, setPlataforma] = useState('')
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
    try {
      const resUrl = await fetch('/api/upload/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: arquivo.name, tamanho: arquivo.size, shareCode, playedAt, plataformaManual: plataforma }),
      })
      const bodyUrl = await resUrl.json().catch(() => ({}))
      if (!resUrl.ok) {
        setErro(bodyUrl.erro ?? 'Erro ao preparar o envio')
        return
      }
      const resPut = await fetch(bodyUrl.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: arquivo,
      })
      if (!resPut.ok) {
        setErro('Falha ao enviar o arquivo pro armazenamento')
        return
      }
      setResultado(true)
    } catch {
      setErro('Falha de rede ao enviar')
    } finally {
      setEnviando(false)
    }
  }

  const PASSOS = [
    { titulo: 'Envie o .dem', feito: true },
    { titulo: 'Fila de processamento', feito: resultado },
    { titulo: 'Parseado pelo Coletor (~30min)', feito: false },
    { titulo: 'Aparece no Feed', feito: false },
  ]

  return (
    <div className="max-w-3xl space-y-4">
      <SectionHeader
        titulo="Enviar demo"
        subtitulo="Baixe o .dem em CS2 → Assistir → Suas Partidas (ou do Faceit/GC) e envie aqui. O processamento roda a cada ~30 minutos — a Partida aparece no Feed quando terminar."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
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
            <span className="block w-full truncate px-2 text-center font-display text-sm font-semibold uppercase tracking-wide text-texto" title={arquivo?.name}>
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
              className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0"
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
              className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0"
            />
          </div>
          <div>
            <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="plataforma">
              Onde foi jogada (opcional — vira o badge da plataforma na Partida)
            </label>
            <select
              id="plataforma"
              value={plataforma}
              onChange={(e) => setPlataforma(e.target.value)}
              className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0"
            >
              {PLATAFORMAS.map((p) => (
                <option key={p.valor} value={p.valor}>{p.label}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={!arquivo || enviando}
            className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo transition-opacity disabled:opacity-40 lg:min-h-0 lg:w-auto"
          >
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </form>

        {erro && <p className="mt-4 font-mono text-sm text-perigo">{erro}</p>}
        {resultado && (
          <p className="mt-4 font-mono text-sm text-sucesso">
            Envio recebido! Processando em até 30 minutos — a Partida aparece no Feed quando terminar.
          </p>
        )}
      </Card>

      <Card className="h-fit w-full p-4 sm:p-5 lg:w-60">
        <p className="mb-3 font-mono text-xs uppercase tracking-wide text-texto-fraco">O que acontece depois</p>
        <ol className="space-y-3">
          {PASSOS.map((p, i) => (
            <li key={p.titulo} className="flex items-start gap-2.5">
              <span
                className={`panel-cut-sm mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border font-mono text-[10px] font-bold ${
                  p.feito ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco'
                }`}
              >
                {i + 1}
              </span>
              <span className={`font-mono text-xs leading-snug ${p.feito ? 'text-texto' : 'text-texto-fraco'}`}>{p.titulo}</span>
            </li>
          ))}
        </ol>
      </Card>
      </div>
    </div>
  )
}
