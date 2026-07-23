import { useEffect, useState } from 'react'
import { Card, SectionHeader, Badge } from '../components/ui'

const TOM_STATUS = {
  pendente: 'neutro', baixando: 'destaque', processando: 'destaque',
  concluida: 'sucesso', falhou: 'perigo',
}

export default function PartidasPro() {
  const [fila, setFila] = useState(null)
  const [url, setUrl] = useState('')
  const [erro, setErro] = useState(null)
  const [enviando, setEnviando] = useState(false)

  function carregar() {
    fetch('/api/partidas-pro-fila').then((r) => r.json()).then(setFila).catch(() => setFila([]))
  }

  useEffect(carregar, [])

  async function tentarDeNovo(id) {
    const res = await fetch(`/api/partidas-pro-fila/${id}/retry`, { method: 'PATCH' })
    if (res.ok) carregar()
  }

  async function adicionar(e) {
    e.preventDefault()
    setErro(null)
    const res = await fetch('/api/partidas-pro-fila', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hltvUrl: url }),
    })
    if (res.ok) {
      setUrl('')
      carregar()
    } else {
      const body = await res.json().catch(() => ({}))
      setErro(body.erro ?? 'Erro ao adicionar.')
    }
  }

  async function enviarArquivo(e) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return
    setErro(null)
    setEnviando(true)
    try {
      const resUrl = await fetch('/api/partidas-pro-fila/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: arquivo.name }),
      })
      if (!resUrl.ok) {
        const body = await resUrl.json().catch(() => ({}))
        setErro(body.erro ?? 'Erro ao preparar envio.')
        return
      }
      const { uploadUrl } = await resUrl.json()
      const resPut = await fetch(uploadUrl, {
        method: 'PUT',
        body: arquivo,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
      if (!resPut.ok) {
        setErro('Erro ao enviar o arquivo.')
        return
      }
      carregar()
    } catch {
      setErro('Erro ao enviar o arquivo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader titulo="Partidas pro" />
      <form onSubmit={adicionar} className="flex flex-col gap-2 lg:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Link do demo no HLTV"
          className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0 lg:flex-1"
        />
        <button type="submit" className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase text-fundo lg:min-h-0 lg:w-auto">
          Adicionar
        </button>
      </form>
      <label className="panel-cut-sm flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 border border-borda bg-superficie px-4 py-2 font-display text-sm font-semibold uppercase text-texto-fraco hover:text-texto lg:min-h-0 lg:w-fit lg:justify-start">
        {enviando ? 'Enviando...' : 'Enviar arquivo (.rar/.dem)'}
        <input
          type="file"
          accept=".rar,.dem"
          disabled={enviando}
          onChange={enviarArquivo}
          className="hidden"
        />
      </label>
      {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
      <div className="space-y-2">
        {fila?.map((f) => (
          <Card key={f.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-texto-fraco">{f.hltvUrl}</span>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tom={TOM_STATUS[f.status]}>
                {f.matchIds?.length > 1 ? `${f.matchIds.length} mapas processados` : f.status}
              </Badge>
              {f.status === 'falhou' && (
                <button
                  onClick={() => tentarDeNovo(f.id)}
                  className="panel-cut-sm min-h-10 border border-borda px-2 py-1 font-mono text-[10px] uppercase text-texto-fraco hover:text-texto lg:min-h-0"
                >
                  Tentar de novo
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
