import { useEffect, useState } from 'react'
import { Card, SectionHeader } from '../components/ui'

const CURSO_VIDEOS = [
  { slug: 'introducao', titulo: 'Introdução' },
  { slug: 'modulo-1-aimbotz', titulo: 'Módulo 1 — AimBotz' },
  { slug: 'modulo-2-dm', titulo: 'Módulo 2 — Deathmatch' },
  { slug: 'modulo-3-mecanicas', titulo: 'Módulo 3 — Mecânicas' },
  { slug: 'consideracoes-finais', titulo: 'Considerações finais' },
]

export default function Admin() {
  const [steamId, setSteamId] = useState('')
  const [mensagem, setMensagem] = useState(null)
  const [taticasPendentes, setTaticasPendentes] = useState(null)
  const [statusUpload, setStatusUpload] = useState({})

  async function enviarVideoCurso(slug, arquivo) {
    setStatusUpload((s) => ({ ...s, [slug]: 'enviando' }))
    try {
      const resUrl = await fetch('/api/curso/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })
      if (!resUrl.ok) {
        setStatusUpload((s) => ({ ...s, [slug]: 'erro' }))
        return
      }
      const { uploadUrl } = await resUrl.json()
      const resPut = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
        body: arquivo,
      })
      setStatusUpload((s) => ({ ...s, [slug]: resPut.ok ? 'ok' : 'erro' }))
    } catch {
      setStatusUpload((s) => ({ ...s, [slug]: 'erro' }))
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
          {CURSO_VIDEOS.map((v) => (
            <Card key={v.slug} className="flex items-center justify-between gap-3 px-3 py-2">
              <div>
                <p className="font-display text-sm font-semibold uppercase text-texto">{v.titulo}</p>
                <p className="font-mono text-[10px] uppercase text-texto-fraco/70">{v.slug}.mp4</p>
              </div>
              <label className="panel-cut-sm flex min-h-10 shrink-0 cursor-pointer items-center border border-borda px-3 py-1 font-mono text-xs uppercase tracking-wide text-texto-fraco transition-colors hover:border-destaque/50 hover:text-destaque lg:min-h-0">
                {statusUpload[v.slug] === 'enviando'
                  ? 'Enviando…'
                  : statusUpload[v.slug] === 'ok'
                    ? 'Enviado ✓'
                    : statusUpload[v.slug] === 'erro'
                      ? 'Erro, tentar de novo'
                      : 'Escolher arquivo'}
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
