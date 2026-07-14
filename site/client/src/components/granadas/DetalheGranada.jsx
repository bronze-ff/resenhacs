import { useState } from 'react'
import { embedYoutube, linkBuscaYoutube } from '../../lib/youtube.js'
import { nomeMapa } from '../../lib/format.js'
import { ROTULO_TECNICA, ROTULO_BOTAO } from '../../lib/rotulos.js'
import { Card, Badge } from '../ui'

export default function DetalheGranada({ granada, onFechar, acoesAdmin = null }) {
  const [aba, setAba] = useState('video')
  const embed = embedYoutube(granada.videoUrl)
  const temPassos = (granada.passos ?? []).length > 0

  return (
    // z-[60]: precisa abrir POR CIMA de outros modais (ex.: DetalheTatica, z-50,
    // que linka granadas da biblioteca e abre este componente sobreposto).
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-fundo/80 p-0 lg:p-4" onClick={onFechar}>
      <Card
        className="flex h-full w-full flex-col overflow-y-hidden lg:block lg:h-auto lg:max-h-[90vh] lg:w-full lg:max-w-2xl lg:overflow-y-auto lg:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-borda bg-superficie px-4 py-3 lg:static lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
          <h3 className="font-display text-xl font-bold text-texto">{granada.titulo}</h3>
          <button
            onClick={onFechar}
            className="flex min-h-10 min-w-10 items-center justify-center font-mono text-sm uppercase text-texto-fraco hover:text-texto lg:inline-block lg:min-h-0 lg:min-w-0"
          >fechar</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 lg:overflow-visible lg:px-0 lg:pb-0">
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tom="neutro">{ROTULO_BOTAO[granada.botao]}</Badge>
            <Badge tom="neutro">{ROTULO_TECNICA[granada.tecnica]}</Badge>
          </div>
          {granada.descricao && <p className="mt-3 font-mono text-sm text-texto-fraco">{granada.descricao}</p>}

          <div className="mt-4 flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
            {[['video', 'Vídeo'], ['passos', 'Passos']].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setAba(v)}
                className={`min-h-10 flex-1 px-3 py-1.5 transition-colors lg:min-h-0 ${aba === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {aba === 'video' && (
            embed ? (
              <div className="mt-3 aspect-video w-full">
                <iframe
                  src={embed}
                  title={granada.titulo}
                  className="h-full w-full rounded border border-borda"
                  allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="mt-3 space-y-1">
                <p className="font-mono text-sm text-texto-fraco">Sem vídeo cadastrado pra esse lineup ainda.</p>
                <a
                  href={linkBuscaYoutube(`${nomeMapa(granada.map)} ${granada.tipo} ${granada.titulo}`)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block font-mono text-xs uppercase text-destaque hover:brightness-125"
                >
                  Buscar vídeo no YouTube
                </a>
              </div>
            )
          )}
          {aba === 'passos' && (
            temPassos ? (
              <ol className="mt-3 list-inside list-decimal space-y-1 font-mono text-sm text-texto">
                {granada.passos.map((p, i) => <li key={i}>{p}</li>)}
              </ol>
            ) : (
              <p className="mt-3 font-mono text-sm text-texto-fraco">Sem passos cadastrados.</p>
            )
          )}

          {acoesAdmin}
        </div>
      </Card>
    </div>
  )
}
