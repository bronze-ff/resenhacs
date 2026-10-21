import { useRef, useState, useEffect } from 'react'
import { Button, CabecalhoPagina, Card, EstadoErro, EstadoVazio, SkeletonLista } from '../components/ui'

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
  const [erroLista, setErroLista] = useState(false)
  const ultimoEnvio = useRef(0)
  const aberturaAtual = useRef(0)
  const revisoes = useRef({})
  const [progressoLocal, setProgressoLocal] = useState({})

  useEffect(() => {
    let vivo = true
    fetch('/api/curso')
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((lista) => {
        if (!Array.isArray(lista)) throw new Error()
        if (vivo) setVideos(lista)
      })
      .catch(() => {
        if (!vivo) return
        setVideos((atual) => atual ?? [])
        setErroLista(true)
      })
    return () => { vivo = false; aberturaAtual.current += 1 }
  }, [])

  async function abrir(video) {
    const abertura = ++aberturaAtual.current
    setErro(null)
    setUrlAtivo(null)
    setSlugAtivo(video.slug)
    ultimoEnvio.current = 0
    try {
      const res = await fetch(`/api/curso/${video.slug}/url`)
      if (!res.ok) throw new Error()
      const body = await res.json()
      if (abertura === aberturaAtual.current) setUrlAtivo(body.url)
    } catch {
      if (abertura === aberturaAtual.current) setErro('Vídeo indisponível, recarregue a página')
    }
  }

  async function salvarProgresso(slug, posicaoSegundos, concluido) {
    const revisao = (revisoes.current[slug] ?? 0) + 1
    revisoes.current[slug] = revisao
    const progresso = { posicaoSegundos, concluido }
    setProgressoLocal((atual) => ({ ...atual, [slug]: { ...progresso, erro: false } }))
    try {
      const res = await fetch(`/api/curso/${slug}/progresso`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(progresso),
      })
      if (!res.ok) throw new Error()
      if (revisoes.current[slug] !== revisao) return
      setVideos((atual) =>
        atual?.map((v) => (v.slug === slug ? { ...v, posicaoSegundos, concluido } : v)),
      )
      setProgressoLocal((atual) => {
        const proximo = { ...atual }
        delete proximo[slug]
        return proximo
      })
    } catch {
      if (revisoes.current[slug] !== revisao) return
      setProgressoLocal((atual) => ({ ...atual, [slug]: { ...progresso, erro: true } }))
    }
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
    const video = progressoLocal[slugAtivo] ?? videos?.find((v) => v.slug === slugAtivo)
    if (video?.posicaoSegundos) e.target.currentTime = video.posicaoSegundos
  }

  const videoAtivo = videos?.find((v) => v.slug === slugAtivo)

  return (
    <div className="max-w-3xl space-y-4">
      <CabecalhoPagina eyebrow="Treino" titulo="Curso de mira" descricao="Seu progresso fica salvo — volte de onde parou." className="mb-2" />
      {urlAtivo && (
        <Card className="p-3">
          <p className="mb-3 font-display text-lg font-semibold text-texto">{videoAtivo?.titulo}</p>
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
      {erro && <EstadoErro mensagem={erro} />}
      {erroLista && <EstadoErro mensagem="Não foi possível carregar os vídeos." />}
      {Object.entries(progressoLocal).filter(([, p]) => p.erro).map(([slug, p]) => (
        <EstadoErro
          key={slug}
          className="flex-wrap"
          mensagem={`Não foi possível salvar o progresso de ${videos?.find((v) => v.slug === slug)?.titulo ?? 'esta aula'}. A posição está guardada nesta página.`}
          acao={<Button tamanho="sm" onClick={() => salvarProgresso(slug, p.posicaoSegundos, p.concluido)}>Tentar de novo</Button>}
        />
      ))}
      {videos === null && <SkeletonLista linhas={5} altura="h-14" rotulo="Carregando vídeos" />}
      {!erroLista && videos?.length === 0 && <EstadoVazio titulo="Nenhum vídeo disponível ainda." />}
      <div className="space-y-2">
        {videos?.map((v) => (
          <Card
            key={v.slug}
            as="button"
            interativo={v.disponivel}
            disabled={!v.disponivel}
            onClick={() => abrir(v)}
            className={`flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left ${
              v.disponivel ? '' : 'opacity-50'
            }`}
          >
            <p className={`font-display text-base font-semibold ${slugAtivo === v.slug ? 'text-destaque' : 'text-texto'}`}>{v.titulo}</p>
            <span className="flex flex-col items-end gap-0.5 font-mono text-xs text-texto-fraco">
              {!v.disponivel && <span>ainda não disponível</span>}
              {v.disponivel && v.concluido && <span className="text-sucesso">✓ concluído</span>}
              {v.disponivel && v.posicaoSegundos > 0 && !v.concluido && (
                <span>{`continuar de ${formatarTempo(v.posicaoSegundos)}`}</span>
              )}
            </span>
          </Card>
        ))}
      </div>
    </div>
  )
}
