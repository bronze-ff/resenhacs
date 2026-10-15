import { useState } from 'react'
import { embedYoutube, linkBuscaYoutube } from '../../lib/youtube.js'
import { nomeMapa } from '../../lib/format.js'
import { ROTULO_TECNICA, ROTULO_BOTAO } from '../../lib/rotulos.js'
import { useTransicaoModal } from '../../lib/useTransicaoModal.js'
import { Abas, Badge, Button, Modal } from '../ui'

const ROTULO_TIPO = { smoke: 'Smoke', flash: 'Flash', molotov: 'Molotov', he: 'HE' }

export default function DetalheGranada({ granada, onFechar, acoesAdmin = null }) {
  const [aba, setAba] = useState('video')
  const embed = embedYoutube(granada.videoUrl)
  const passos = granada.passos ?? []
  const temPassos = passos.length > 0
  const { visivel, iniciarSaida } = useTransicaoModal()
  const fechar = () => iniciarSaida(onFechar)

  return (
    // z-[60]: precisa abrir POR CIMA de outros modais (ex.: DetalheTatica, z-50,
    // que linka granadas da biblioteca e abre este componente sobreposto).
    <Modal
      visivel={visivel}
      onFechar={fechar}
      camada="z-[60]"
      tamanho="md"
      titulo={granada.titulo}
      subtitulo={[nomeMapa(granada.map), granada.lado, ROTULO_TIPO[granada.tipo]].filter(Boolean).join(' · ')}
      rodape={acoesAdmin || null}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tom="neutro">{ROTULO_BOTAO[granada.botao]}</Badge>
          <Badge tom="neutro">{ROTULO_TECNICA[granada.tecnica]}</Badge>
        </div>
        {granada.descricao && <p className="text-sm leading-relaxed text-texto-fraco">{granada.descricao}</p>}

        <Abas
          rotulo="Conteúdo do lineup"
          larguraTotal
          valor={aba}
          onChange={setAba}
          itens={[
            { valor: 'video', rotulo: 'Vídeo' },
            { valor: 'passos', rotulo: 'Passos', contagem: temPassos ? passos.length : null },
          ]}
        />

        {aba === 'video' && (
          embed ? (
            <div className="aspect-video w-full">
              <iframe
                src={embed}
                title={granada.titulo}
                className="panel-cut-sm h-full w-full border border-borda bg-fundo"
                allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="panel-cut-sm flex flex-col items-center gap-3 border border-dashed border-borda-forte bg-fundo/40 px-4 py-8 text-center">
              <p className="text-sm text-texto-fraco">Sem vídeo cadastrado pra esse lineup ainda.</p>
              <Button
                as="a"
                variante="contorno"
                tamanho="sm"
                href={linkBuscaYoutube(`${nomeMapa(granada.map)} ${granada.tipo} ${granada.titulo}`)}
                target="_blank"
                rel="noreferrer"
              >
                Buscar vídeo no YouTube
              </Button>
            </div>
          )
        )}
        {aba === 'passos' && (
          temPassos ? (
            <ol className="flex flex-col gap-2">
              {passos.map((p, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="panel-cut-tr flex h-7 w-7 shrink-0 items-center justify-center border border-borda bg-superficie-alta font-display text-sm font-semibold tabular-nums text-destaque">
                    {i + 1}
                  </span>
                  <span className="pt-1 text-sm leading-relaxed text-texto">{p}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-texto-fraco">Sem passos cadastrados.</p>
          )
        )}
      </div>
    </Modal>
  )
}
