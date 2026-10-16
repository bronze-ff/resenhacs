import { useEffect, useRef, useState } from 'react'
import { Button, EstadoErro, classesBotao } from '../ui'
import { montarTimeline } from '../../lib/timelineClipe2D.js'
import {
  ALTURA, LARGURA, carregarImagem, carregarReplayParaClipe, extensaoDoMime, gravarClipe2D, suportaGravacao,
} from '../../lib/gravadorClipe2D.js'

// Grava o Clipe 2D (1 kill) ou a montagem (várias) a partir do Replay 2D, no próprio
// navegador. `opcoesGravacao` repassa relógio/loop pro gravador (só teste usa).
export default function GravadorClipe({ replayUrl, kills, nomeArquivo = 'clipe-2d', opcoesGravacao }) {
  const canvasRef = useRef(null)
  const controleRef = useRef(null)
  const [estado, setEstado] = useState('parado') // parado | preparando | gravando | pronto | erro
  const [progresso, setProgresso] = useState(0)
  const [erro, setErro] = useState(null)
  const [video, setVideo] = useState(null) // { url, ext }
  const [aviso, setAviso] = useState(null)

  // Libera o vídeo anterior da memória quando sai da tela ou quando grava outro.
  useEffect(() => () => { if (video?.url) URL.revokeObjectURL?.(video.url) }, [video])
  useEffect(() => () => controleRef.current?.abort(), [])

  const quantidade = kills.length
  const montagem = quantidade > 1
  const suportado = suportaGravacao()

  async function gravar() {
    const controle = new AbortController()
    controleRef.current = controle
    setEstado('preparando')
    setErro(null)
    setAviso(null)
    setProgresso(0)
    setVideo(null)
    try {
      const numeros = [...new Set(kills.map((k) => k.round))]
      const { replay, rounds } = await carregarReplayParaClipe(replayUrl, numeros)
      const timeline = montarTimeline(kills, { tickRate: replay.tickRate, rounds })
      if (timeline.ignoradas.length) {
        setAviso(`${timeline.ignoradas.length} kill(s) ficaram de fora: não aparecem no Replay 2D.`)
      }
      if (!timeline.itens.length) throw new Error('Nenhuma das kills marcadas aparece no Replay 2D.')
      const radar = await carregarImagem(`/radars/${replay.map}.png`)
      if (controle.signal.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' })
      setEstado('gravando')
      const { blob, mime } = await gravarClipe2D({
        canvas: canvasRef.current, timeline, replay, rounds, radar,
        sinal: controle.signal, onProgresso: setProgresso, ...opcoesGravacao,
      })
      setVideo({ url: URL.createObjectURL(blob), ext: extensaoDoMime(mime) })
      setProgresso(1)
      setEstado('pronto')
    } catch (e) {
      if (e?.name === 'AbortError') { setEstado('parado'); setProgresso(0); return }
      setErro(e?.message && !/fetch|replay indispon/i.test(e.message) ? e.message : 'Não foi possível gravar o Clipe 2D.')
      setEstado('erro')
    } finally {
      controleRef.current = null
    }
  }

  const ocupado = estado === 'preparando' || estado === 'gravando'
  const pct = Math.round(progresso * 100)

  if (!suportado) {
    return <EstadoErro mensagem="Este navegador não grava vídeo a partir do Replay 2D. Tente no Chrome, Edge ou Firefox no computador." />
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!ocupado && (
          <Button variante="primario" onClick={gravar} disabled={quantidade === 0}>
            {montagem ? `Gravar montagem 2D (${quantidade} kills)` : 'Gravar clipe 2D'}
          </Button>
        )}
        {ocupado && (
          <Button variante="secundario" onClick={() => controleRef.current?.abort()}>
            Cancelar
          </Button>
        )}
        {estado === 'pronto' && video && (
          <a
            href={video.url}
            download={`${nomeArquivo}.${video.ext}`}
            className={classesBotao({ variante: 'secundario' })}
          >
            Baixar vídeo
          </a>
        )}
        {quantidade === 0 && <span className="text-sm text-texto-fraco">Marque ao menos uma kill na tabela.</span>}
      </div>

      {ocupado && (
        <div className="space-y-1">
          <div
            role="progressbar"
            aria-label="Progresso da gravação"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-1.5 w-full overflow-hidden rounded-full bg-superficie-alta"
          >
            <div className="h-full bg-destaque transition-[width] duration-150" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-texto-fraco">
            {estado === 'preparando' ? 'Carregando o Replay 2D…' : <>Gravando… <span className="tabular-nums">{pct}%</span>. Mantenha esta aba aberta: o navegador pausa a animação em aba de fundo.</>}
          </p>
        </div>
      )}
      {aviso && <p className="text-xs text-aviso">{aviso}</p>}
      {estado === 'erro' && erro && <EstadoErro mensagem={erro} />}

      <canvas
        ref={canvasRef}
        width={LARGURA}
        height={ALTURA}
        aria-label="Prévia do Clipe 2D"
        className={`panel-cut block aspect-video w-full max-w-3xl border border-borda bg-fundo ${estado === 'parado' || estado === 'erro' ? 'hidden' : ''}`}
      />
    </div>
  )
}
