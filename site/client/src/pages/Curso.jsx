import { useRef, useState, useEffect } from 'react'
import { Card, SectionHeader } from '../components/ui'

function formatarTempo(segundos) {
  const m = Math.floor(segundos / 60)
  const s = Math.floor(segundos % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function Curso() {
  const [videos, setVideos] = useState(null)
  const [slugAtivo, setSlugAtivo] = useState(null)
  const [urlAtivo, setUrlAtivo] = useState(null)
  const [erro, setErro] = useState(null)
  const ultimoEnvio = useRef(0)

  useEffect(() => {
    fetch('/api/curso')
      .then((r) => r.json())
      .then(setVideos)
      .catch(() => setVideos([]))
  }, [])

  async function abrir(video) {
    setErro(null)
    setUrlAtivo(null)
    setSlugAtivo(video.slug)
    ultimoEnvio.current = 0
    const res = await fetch(`/api/curso/${video.slug}/url`)
    if (!res.ok) {
      setErro('Vídeo indisponível, recarregue a página')
      return
    }
    const body = await res.json()
    setUrlAtivo(body.url)
  }

  function salvarProgresso(slug, posicaoSegundos, concluido) {
    fetch(`/api/curso/${slug}/progresso`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posicaoSegundos, concluido }),
    }).then(() => {
      setVideos((atual) =>
        atual?.map((v) => (v.slug === slug ? { ...v, posicaoSegundos, concluido } : v)),
      )
    })
  }

  function onTimeUpdate(e) {
    const agora = e.target.currentTime
    if (agora - ultimoEnvio.current >= 10) {
      ultimoEnvio.current = agora
      salvarProgresso(slugAtivo, Math.floor(agora), false)
    }
  }

  function onPause(e) {
    salvarProgresso(slugAtivo, Math.floor(e.target.currentTime), false)
  }

  function onEnded(e) {
    salvarProgresso(slugAtivo, Math.floor(e.target.duration), true)
  }

  function onLoadedMetadata(e) {
    const video = videos?.find((v) => v.slug === slugAtivo)
    if (video?.posicaoSegundos) e.target.currentTime = video.posicaoSegundos
  }

  const videoAtivo = videos?.find((v) => v.slug === slugAtivo)

  return (
    <div className="max-w-3xl space-y-4">
      <SectionHeader titulo="Curso de mira" />
      {urlAtivo && (
        <Card className="p-3">
          <p className="mb-2 font-display text-sm font-semibold uppercase text-texto">{videoAtivo?.titulo}</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- curso pessoal sem legendas */}
          <video
            key={slugAtivo}
            controls
            src={urlAtivo}
            className="w-full"
            onTimeUpdate={onTimeUpdate}
            onPause={onPause}
            onEnded={onEnded}
            onLoadedMetadata={onLoadedMetadata}
            onError={() => setErro('Vídeo indisponível, recarregue a página')}
          />
        </Card>
      )}
      {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
      <div className="space-y-2">
        {videos?.map((v) => (
          <Card
            key={v.slug}
            as="button"
            interativo
            onClick={() => abrir(v)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
          >
            <p className="font-display text-sm font-semibold uppercase text-texto">{v.titulo}</p>
            <span className="flex flex-col items-end gap-0.5 font-mono text-xs text-texto-fraco">
              {v.concluido && <span>✓ concluído</span>}
              {v.posicaoSegundos > 0 && !v.concluido && (
                <span>{`continuar de ${formatarTempo(v.posicaoSegundos)}`}</span>
              )}
            </span>
          </Card>
        ))}
      </div>
    </div>
  )
}
