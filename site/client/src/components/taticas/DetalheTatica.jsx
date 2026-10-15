import { useEffect, useMemo, useState } from 'react'
import RadarGranadas from '../granadas/RadarGranadas.jsx'
import DetalheGranada from '../granadas/DetalheGranada.jsx'
import { thumbYoutube } from '../../lib/youtube.js'
import { ROTULO_TIPO_TATICA, ROTULO_ARMAS } from './CardTatica.jsx'
import { ROTULO_TECNICA, ROTULO_BOTAO } from '../../lib/rotulos.js'
import { useTransicaoModal } from '../../lib/useTransicaoModal.js'
import { nomeMapa } from '../../lib/format.js'
import { Abas, Badge, Modal } from '../ui'

// Bloco compacto de uma granada linkada a um papel: título + badges técnica/botão
// + thumb do YouTube, clicável — abre o DetalheGranada por cima (z-[60]).
function BlocoGranada({ granada, onAbrir }) {
  return (
    <button
      type="button"
      onClick={() => onAbrir(granada)}
      className="panel-cut-sm flex w-full items-center gap-3 border border-borda bg-fundo/40 p-2 text-left transition-colors duration-200 hover:border-borda-forte hover:bg-superficie-alta"
    >
      {thumbYoutube(granada.videoUrl) && (
        <img src={thumbYoutube(granada.videoUrl)} alt="" className="panel-cut-sm h-12 w-20 shrink-0 object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-base font-semibold text-texto">{granada.titulo}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge tom="neutro">{ROTULO_BOTAO[granada.botao]}</Badge>
          {ROTULO_TECNICA[granada.tecnica] && (
            <Badge tom="neutro">{ROTULO_TECNICA[granada.tecnica]}</Badge>
          )}
        </div>
      </div>
    </button>
  )
}

// Modal de detalhe de uma tática curada: aba Overview (radar com TODAS as
// granadas + descrição + cards de papéis) e uma aba por jogador (radar filtrado
// às granadas daquele papel + descrição + granadas linkadas clicáveis).
// Reusa RadarGranadas em modo leitura (mesmo padrão de PaginaMapa.jsx) e abre o
// DetalheGranada existente por cima quando uma granada é clicada.
export default function DetalheTatica({ tatica, onFechar, acoesAdmin = null }) {
  const papeis = useMemo(
    () => [...(tatica.papeis ?? [])].sort((a, b) => a.ordem - b.ordem),
    [tatica],
  )
  const [aba, setAba] = useState('overview')
  const [granadaAberta, setGranadaAberta] = useState(null)
  const { visivel, iniciarSaida } = useTransicaoModal()
  const fechar = () => iniciarSaida(onFechar)

  useEffect(() => {
    setAba('overview')
    setGranadaAberta(null)
  }, [tatica])

  const papelAtivo = aba === 'overview' ? null : papeis.find((p) => p.id === aba)
  const granadasOverview = useMemo(() => papeis.flatMap((p) => p.granadas ?? []), [papeis])
  const granadasVisiveis = aba === 'overview' ? granadasOverview : (papelAtivo?.granadas ?? [])

  return (
    <>
      <Modal
        visivel={visivel}
        onFechar={fechar}
        tamanho="lg"
        titulo={tatica.titulo}
        subtitulo={`${nomeMapa(tatica.map)} · lado ${tatica.lado} · ${tatica.local}`}
        rodape={acoesAdmin || null}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            <Badge tom="destaque">{ROTULO_TIPO_TATICA[tatica.tipo] ?? tatica.tipo}</Badge>
            <Badge tom="neutro">{ROTULO_ARMAS[tatica.armas] ?? tatica.armas}</Badge>
            <Badge tom="neutro">{tatica.lado} · {tatica.local}</Badge>
            <Badge tom="neutro">{papeis.length} {papeis.length === 1 ? 'jogador' : 'jogadores'}</Badge>
          </div>

          <div className="max-w-full overflow-x-auto">
            <Abas
              rotulo="Visão da tática"
              valor={aba}
              onChange={setAba}
              itens={[
                { valor: 'overview', rotulo: 'Overview' },
                ...papeis.map((p, i) => ({ valor: p.id, rotulo: `Jogador ${i + 1}`, contagem: (p.granadas ?? []).length || null })),
              ]}
            />
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
            <div className="lg:w-[55%] lg:shrink-0">
              <RadarGranadas
                mapa={tatica.map}
                lineups={granadasVisiveis}
                selecionadaId={granadaAberta?.id}
                onSelecionar={setGranadaAberta}
              />
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {aba === 'overview' ? (
                <>
                  {tatica.descricao
                    ? <p className="text-sm leading-relaxed text-texto-fraco">{tatica.descricao}</p>
                    : <p className="text-sm text-texto-fraco/60">Sem descrição.</p>}
                  <div className="flex flex-col gap-2">
                    <p className="rotulo">Papéis</p>
                    {papeis.map((p, i) => (
                      <div key={p.id} className="panel-cut-sm flex flex-col gap-1 border border-borda bg-fundo/40 p-3">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-display text-base font-semibold text-texto">Jogador {i + 1}</span>
                          <Badge tom={p.obrigatorio ? 'destaque' : 'neutro'}>
                            {p.obrigatorio ? 'necessário' : 'opcional'}
                          </Badge>
                        </span>
                        <span className="text-sm text-texto-fraco">{p.descricao}</span>
                      </div>
                    ))}
                    {papeis.length === 0 && (
                      <p className="text-sm text-texto-fraco">Nenhum papel cadastrado ainda.</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {papelAtivo?.descricao
                    ? <p className="text-sm leading-relaxed text-texto-fraco">{papelAtivo.descricao}</p>
                    : <p className="text-sm text-texto-fraco/60">Sem descrição.</p>}
                  <div className="flex flex-col gap-2">
                    <p className="rotulo">Granadas</p>
                    {(papelAtivo?.granadas ?? []).map((g) => (
                      <BlocoGranada key={g.id} granada={g} onAbrir={setGranadaAberta} />
                    ))}
                    {(papelAtivo?.granadas ?? []).length === 0 && (
                      <p className="text-sm text-texto-fraco">Nenhuma granada linkada nesse papel.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* Fora da árvore do Modal desta tática de propósito: se estivesse aninhado,
          um clique no backdrop do DetalheGranada borbulharia (pela árvore React,
          mesmo com portal) até o backdrop desta tática e fecharia os dois modais
          juntos. Como irmão, cada backdrop só fecha o seu próprio modal. */}
      {granadaAberta && (
        <DetalheGranada granada={granadaAberta} onFechar={() => setGranadaAberta(null)} />
      )}
    </>
  )
}
