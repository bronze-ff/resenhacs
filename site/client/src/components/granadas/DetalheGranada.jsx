import { useState } from 'react'
import { embedYoutube } from '../../lib/youtube.js'

const ROTULO_TECNICA = {
  normal: 'lançar parado', jumpthrow: 'lançar com salto', walkthrow: 'andando',
  runthrow: 'correndo', run_jumpthrow: 'correr + saltar',
}
const ROTULO_BOTAO = { esquerdo: 'botão esquerdo', direito: 'botão direito', esquerdo_direito: 'os dois botões' }

export default function DetalheGranada({ granada, onFechar, acoesAdmin = null }) {
  const [aba, setAba] = useState('video')
  const embed = embedYoutube(granada.videoUrl)
  const temPassos = (granada.passos ?? []).length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fundo/80 p-4" onClick={onFechar}>
      <div
        className="panel-cut max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-borda bg-superficie p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-xl font-bold text-texto">{granada.titulo}</h3>
          <button onClick={onFechar} className="font-mono text-sm uppercase text-texto-fraco hover:text-texto">fechar</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="panel-cut-sm border border-borda px-1.5 py-0.5 font-mono text-[10px] uppercase text-texto-fraco">{ROTULO_BOTAO[granada.botao]}</span>
          <span className="panel-cut-sm border border-borda px-1.5 py-0.5 font-mono text-[10px] uppercase text-texto-fraco">{ROTULO_TECNICA[granada.tecnica]}</span>
        </div>
        {granada.descricao && <p className="mt-3 font-mono text-sm text-texto-fraco">{granada.descricao}</p>}

        <div className="mt-4 flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
          {[['video', 'Vídeo'], ['passos', 'Passos']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setAba(v)}
              className={`flex-1 px-3 py-1.5 transition-colors ${aba === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
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
            <p className="mt-3 font-mono text-sm text-texto-fraco">Sem vídeo cadastrado pra esse lineup ainda.</p>
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
    </div>
  )
}
