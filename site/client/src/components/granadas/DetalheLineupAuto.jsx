import { useState } from 'react'
import { Link } from 'react-router-dom'
import { nomeMapa } from '../../lib/format.js'
import { useTransicaoModal } from '../../lib/useTransicaoModal.js'
import { Badge, Button, Modal, StatTile } from '../ui'
import { MarcadorTipo } from './RadarGranadas.jsx'
import { DICA_TREINO, ROTULO_TIPO, descreverPitch, enquadrar, linkReplay, vetorMira } from './lineupAuto.js'

// Mini-radar enquadrado no lineup: ponto de arremesso, alvo, e a seta da mira (yaw).
export function MiniRadarLineup({ mapa, cluster }) {
  const v = enquadrar(cluster)
  const ax = cluster.arremessoX * 100
  const ay = cluster.arremessoY * 100
  const { dx, dy } = vetorMira(cluster.yaw)
  const tam = v.lado * 0.14
  const fx = ax + dx * tam
  const fy = ay + dy * tam
  const traco = v.lado / 160
  return (
    <svg
      viewBox={`${v.x} ${v.y} ${v.lado} ${v.lado}`}
      className="panel-cut-sm block aspect-square w-full border border-borda bg-fundo"
      role="img"
      aria-label="Posição de arremesso, alvo e direção da mira"
    >
      <image href={`/radars/${mapa}.png`} width="100" height="100" opacity="0.9" />
      <line x1={ax} y1={ay} x2={cluster.alvoX * 100} y2={cluster.alvoY * 100}
        stroke="#ffd166" strokeWidth={traco * 2} strokeDasharray={`${traco * 6} ${traco * 6}`} opacity="0.85" />
      {/* mira: seta saindo do pé do jogador na direção do yaw */}
      <line x1={ax} y1={ay} x2={fx} y2={fy} stroke="#5aa9ff" strokeWidth={traco * 3} strokeLinecap="round" />
      <circle cx={fx} cy={fy} r={traco * 4} fill="#5aa9ff" />
      <circle cx={ax} cy={ay} r={traco * 7} fill="#ffd166" stroke="#0a0a0b" strokeWidth={traco} />
      <g transform={`translate(${cluster.alvoX * 100} ${cluster.alvoY * 100}) scale(${v.lado / 60}) translate(${-cluster.alvoX * 100} ${-cluster.alvoY * 100})`}>
        <MarcadorTipo tipo={cluster.tipo} x={cluster.alvoX * 100} y={cluster.alvoY * 100} ativo />
      </g>
    </svg>
  )
}

export default function DetalheLineupAuto({ cluster, mapa, titulo, onFechar }) {
  const { visivel, iniciarSaida } = useTransicaoModal()
  const fechar = () => iniciarSaida(onFechar)
  const [copiado, setCopiado] = useState(null) // null | 'ok' | 'erro'
  const link = linkReplay(cluster.exemplo)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(cluster.comando)
      setCopiado('ok')
    } catch {
      // clipboard indisponível (contexto não-HTTPS): o comando já está visível pra copiar à mão
      setCopiado('erro')
    }
  }

  return (
    <Modal
      visivel={visivel}
      onFechar={fechar}
      tamanho="lg"
      titulo={titulo}
      subtitulo={[nomeMapa(mapa), cluster.lado, ROTULO_TIPO[cluster.tipo]].filter(Boolean).join(' · ')}
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-2">
          <MiniRadarLineup mapa={mapa} cluster={cluster} />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-fraco">
            <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[#ffd166]" />de onde lança</li>
            <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-0.5 w-3 bg-[#5aa9ff]" />direção da mira</li>
            <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2 w-2 rotate-45 border border-texto-fraco" />onde cai</li>
          </ul>
        </div>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <StatTile rotulo="Usos do grupo" valor={cluster.usosGrupo} />
            <StatTile rotulo="Usos de pros" valor={cluster.usosPro} />
          </div>

          <div>
            <p className="rotulo mb-1.5">Mira</p>
            <p className="font-mono text-sm tabular-nums text-texto">
              yaw {Number(cluster.yaw).toFixed(1)}° · pitch {Number(cluster.pitch).toFixed(1)}° <span className="text-texto-fraco">({descreverPitch(cluster.pitch)})</span>
            </p>
          </div>

          {cluster.jogadores.length > 0 && (
            <div>
              <p className="rotulo mb-1.5">Quem do grupo mais usa</p>
              <ol className="flex flex-col gap-1">
                {cluster.jogadores.map((j) => (
                  <li key={j.steamId} className="flex items-center justify-between gap-2 text-sm">
                    <Link to={`/jogador/${j.steamId}`} className="truncate text-texto hover:text-destaque">{j.nick || 'Jogador'}</Link>
                    <span className="font-mono text-xs tabular-nums text-texto-fraco">{j.usos}×</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {cluster.pros.length > 0 && (
            <div>
              <p className="rotulo mb-1.5">Pros que usaram</p>
              <div className="flex flex-wrap gap-1.5">
                {cluster.pros.map((p) => (
                  <Badge key={p.nick} tom="neutro">{p.nick} <span className="tabular-nums text-texto">{p.usos}×</span></Badge>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="rotulo mb-1.5">Comando de treino</p>
            {cluster.comando ? (
              <>
                <code className="panel-cut-sm block break-all border border-borda bg-fundo px-3 py-2 font-mono text-xs text-texto">
                  {cluster.comando}
                </code>
                <p className="mt-1.5 text-xs text-texto-fraco">{DICA_TREINO}</p>
                <Button variante="primario" tamanho="sm" className="mt-2" onClick={copiar}>
                  Copiar comando de treino
                </Button>
                <p role="status" className="mt-1 min-h-4 text-xs text-texto-fraco">
                  {copiado === 'ok' && '✓ Copiado.'}
                  {copiado === 'erro' && 'Não deu pra copiar automaticamente. Selecione o texto acima.'}
                </p>
              </>
            ) : (
              <p className="text-sm text-texto-fraco">
                Sem coordenada de altura pra esse lineup: as Demos dele foram processadas antes dessa captura. Reprocessar a Demo resolve.
              </p>
            )}
          </div>

          {link ? (
            <Button as={Link} to={link} variante="contorno" tamanho="sm">
              Ver no Replay 2D (round {cluster.exemplo.roundNumber})
            </Button>
          ) : (
            <p className="text-xs text-texto-fraco">Só usado em partida de pro: sem Replay 2D pra abrir aqui.</p>
          )}
        </div>
      </div>
    </Modal>
  )
}
