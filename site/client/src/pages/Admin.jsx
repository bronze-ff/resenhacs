import { useEffect, useState } from 'react'
import { Card, SectionHeader } from '../components/ui'

// Pedaços de 100 MiB: um PUT único do arquivo inteiro estoura a memória da aba (um vídeo de
// 2 GB matava o processo do Chrome com STATUS_BREAKPOINT).
const TAMANHO_PARTE = 100 * 1024 * 1024
const TENTATIVAS_POR_PARTE = 3

async function enviarParte(url, pedaco) {
  for (let tentativa = 1; tentativa <= TENTATIVAS_POR_PARTE; tentativa++) {
    try {
      const res = await fetch(url, { method: 'PUT', body: pedaco })
      if (res.ok) return
    } catch {
      // rede caiu no meio da parte — cai no retry abaixo
    }
    if (tentativa === TENTATIVAS_POR_PARTE) throw new Error('parte falhou após as tentativas')
  }
}

function rotuloUpload(status, disponivel) {
  if (status?.estado === 'enviando') {
    const pct = status.total ? Math.round((status.atual / status.total) * 100) : 0
    return `Parte ${status.atual}/${status.total} — ${pct}%`
  }
  if (status?.estado === 'ok') return 'Enviado ✓'
  if (status?.estado === 'erro') return 'Erro, tentar de novo'
  return disponivel ? 'Enviado ✓ — trocar' : 'Escolher arquivo'
}

export default function Admin() {
  const [steamId, setSteamId] = useState('')
  const [mensagem, setMensagem] = useState(null)
  const [taticasPendentes, setTaticasPendentes] = useState(null)
  const [statusUpload, setStatusUpload] = useState({})
  const [videosCurso, setVideosCurso] = useState(null)

  async function enviarVideoCurso(slug, arquivo) {
    const partes = Math.ceil(arquivo.size / TAMANHO_PARTE)
    setStatusUpload((s) => ({ ...s, [slug]: { estado: 'enviando', atual: 0, total: partes } }))
    let uploadId = null
    try {
      const resIniciar = await fetch('/api/curso/upload/iniciar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, partes }),
      })
      if (!resIniciar.ok) throw new Error('iniciar falhou')
      const { uploadId: id, urls } = await resIniciar.json()
      uploadId = id

      for (let i = 0; i < partes; i++) {
        await enviarParte(urls[i], arquivo.slice(i * TAMANHO_PARTE, (i + 1) * TAMANHO_PARTE))
        setStatusUpload((s) => ({ ...s, [slug]: { estado: 'enviando', atual: i + 1, total: partes } }))
      }

      const resConcluir = await fetch('/api/curso/upload/concluir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, uploadId }),
      })
      if (!resConcluir.ok) throw new Error('concluir falhou')
      setStatusUpload((s) => ({ ...s, [slug]: { estado: 'ok' } }))
      setVideosCurso((atual) => atual?.map((v) => (v.slug === slug ? { ...v, disponivel: true } : v)))
    } catch {
      if (uploadId) {
        await fetch('/api/curso/upload/abortar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, uploadId }),
        }).catch(() => {})
      }
      setStatusUpload((s) => ({ ...s, [slug]: { estado: 'erro' } }))
    }
  }

  async function adicionar(e) {
    e.preventDefault()
    const res = await fetch('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steamId }),
    })
    if (res.ok) {
      setMensagem('Jogador adicionado à whitelist.')
      setSteamId('')
    } else {
      const body = await res.json().catch(() => ({}))
      setMensagem(body.erro ?? 'Erro ao adicionar.')
    }
  }

  useEffect(() => {
    fetch('/api/taticas?status=sugerida')
      .then((r) => r.json())
      .then(setTaticasPendentes)
      .catch(() => setTaticasPendentes([]))
    fetch('/api/curso')
      .then((r) => r.json())
      .then(setVideosCurso)
      .catch(() => setVideosCurso([]))
  }, [])

  async function revisar(id, status) {
    const res = await fetch(`/api/taticas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setTaticasPendentes((atual) => atual.filter((t) => t.id !== id))
    }
  }

  return (
    <div className="max-w-md">
      <SectionHeader titulo="Admin" />
      <form onSubmit={adicionar} className="space-y-3">
        <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="steamId">
          SteamID64 do novo Jogador (17 dígitos)
        </label>
        <input
          id="steamId"
          value={steamId}
          onChange={(e) => setSteamId(e.target.value)}
          className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0"
          placeholder="76561198…"
        />
        <button
          type="submit"
          className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo lg:min-h-0 lg:w-auto"
        >
          Adicionar à whitelist
        </button>
      </form>
      {mensagem && <p className="mt-3 font-mono text-sm text-texto-fraco">{mensagem}</p>}

      <div className="mt-8 space-y-3">
        <SectionHeader titulo="Táticas pendentes" />
        {taticasPendentes?.length === 0 && (
          <p className="font-mono text-sm text-texto-fraco">Nenhuma tática aguardando revisão.</p>
        )}
        {taticasPendentes?.map((t) => (
          <Card key={t.id} className="space-y-2 px-3 py-2">
            <p className="font-display text-sm font-semibold uppercase text-texto">{t.nome}</p>
            <p className="font-mono text-xs text-texto-fraco">{t.descricao}</p>
            <p className="font-mono text-[10px] uppercase text-texto-fraco/70">sugerida por {t.criadoPorNick || t.criadoPor}</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => revisar(t.id, 'aprovada')}
                className="panel-cut-sm min-h-10 border border-sucesso px-3 py-1 font-mono text-xs uppercase tracking-wide text-sucesso lg:min-h-0"
              >
                Aprovar
              </button>
              <button
                onClick={() => revisar(t.id, 'rejeitada')}
                className="panel-cut-sm min-h-10 border border-perigo px-3 py-1 font-mono text-xs uppercase tracking-wide text-perigo lg:min-h-0"
              >
                Rejeitar
              </button>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-8 space-y-3">
        <SectionHeader titulo="Curso de mira — upload dos vídeos" />
        <div className="space-y-2">
          {videosCurso?.map((v) => (
            <Card key={v.slug} className="flex items-center justify-between gap-3 px-3 py-2">
              <div>
                <p className="font-display text-sm font-semibold uppercase text-texto">{v.titulo}</p>
                <p className="font-mono text-[10px] uppercase text-texto-fraco/70">{v.slug}.mp4</p>
              </div>
              <label className="panel-cut-sm flex min-h-10 shrink-0 cursor-pointer items-center border border-borda px-3 py-1 font-mono text-xs uppercase tracking-wide text-texto-fraco transition-colors hover:border-destaque/50 hover:text-destaque lg:min-h-0">
                {rotuloUpload(statusUpload[v.slug], v.disponivel)}
                <input
                  type="file"
                  accept="video/mp4"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) enviarVideoCurso(v.slug, f)
                  }}
                />
              </label>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
