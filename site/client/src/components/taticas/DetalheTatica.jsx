import { useEffect, useMemo, useState } from 'react'
import RadarGranadas from '../granadas/RadarGranadas.jsx'
import DetalheGranada from '../granadas/DetalheGranada.jsx'
import { thumbYoutube } from '../../lib/youtube.js'
import { ROTULO_TIPO_TATICA, ROTULO_ARMAS } from './CardTatica.jsx'
import { ROTULO_TECNICA, ROTULO_BOTAO } from '../../lib/rotulos.js'
import { Card, Badge } from '../ui'

// Bloco compacto de uma granada linkada a um papel: título + badges técnica/botão
// + thumb do YouTube, clicável — abre o DetalheGranada por cima (z-[60]).
function BlocoGranada({ granada, onAbrir }) {
  return (
    <button
      onClick={() => onAbrir(granada)}
      className="panel-cut-sm flex w-full items-center gap-3 border border-borda bg-fundo p-2 text-left transition-colors hover:border-destaque"
    >
      {thumbYoutube(granada.videoUrl) && (
        <img src={thumbYoutube(granada.videoUrl)} alt="" className="h-12 w-20 shrink-0 rounded object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-semibold text-texto">{granada.titulo}</p>
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

  useEffect(() => {
    setAba('overview')
    setGranadaAberta(null)
  }, [tatica])

  const papelAtivo = aba === 'overview' ? null : papeis.find((p) => p.id === aba)
  const granadasOverview = useMemo(() => papeis.flatMap((p) => p.granadas ?? []), [papeis])
  const granadasVisiveis = aba === 'overview' ? granadasOverview : (papelAtivo?.granadas ?? [])

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-fundo/80 p-0 lg:p-4" onClick={onFechar}>
        <div
          className="flex h-full w-full flex-col overflow-y-hidden border border-borda bg-superficie lg:panel-cut lg:h-auto lg:max-h-[90vh] lg:w-full lg:max-w-4xl lg:overflow-y-auto lg:p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-borda bg-superficie px-4 py-3 lg:static lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
            <div className="min-w-0">
              <h3 className="font-display text-xl font-bold text-texto">{tatica.titulo}</h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge tom="destaque">{ROTULO_TIPO_TATICA[tatica.tipo] ?? tatica.tipo}</Badge>
                <Badge tom="neutro">{ROTULO_ARMAS[tatica.armas] ?? tatica.armas}</Badge>
                <Badge tom="neutro">{tatica.lado} · {tatica.local}</Badge>
                <Badge tom="neutro">{papeis.length} {papeis.length === 1 ? 'jogador' : 'jogadores'}</Badge>
              </div>
            </div>
            <button
              onClick={onFechar}
              className="flex min-h-10 min-w-10 shrink-0 items-center justify-center font-mono text-sm uppercase text-texto-fraco hover:text-texto"
            >fechar</button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4 lg:overflow-visible lg:px-0 lg:pb-0">
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button
                onClick={() => setAba('overview')}
                className={`min-h-10 rounded border px-3 py-1.5 font-mono text-xs uppercase transition-colors ${
                  aba === 'overview' ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco hover:text-texto'
                }`}
              >Overview</button>
              {papeis.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setAba(p.id)}
                  className={`min-h-10 rounded border px-3 py-1.5 font-mono text-xs uppercase transition-colors ${
                    aba === p.id ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco hover:text-texto'
                  }`}
                >Jogador {i + 1}</button>
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-4 lg:flex-row">
              <div className="lg:w-[55%] lg:shrink-0">
                <RadarGranadas
                  mapa={tatica.map}
                  lineups={granadasVisiveis}
                  selecionadaId={granadaAberta?.id}
                  onSelecionar={setGranadaAberta}
                />
              </div>

              <div className="min-w-0 flex-1">
                {aba === 'overview' ? (
                  <>
                    {tatica.descricao
                      ? <p className="font-mono text-sm text-texto-fraco">{tatica.descricao}</p>
                      : <p className="font-mono text-sm text-texto-fraco/60">Sem descrição.</p>}
                    <div className="mt-4 space-y-2">
                      {papeis.map((p, i) => (
                        <Card key={p.id} className="bg-fundo p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-display text-sm font-semibold uppercase text-texto">Jogador {i + 1}</p>
                            <Badge tom={p.obrigatorio ? 'destaque' : 'neutro'}>
                              {p.obrigatorio ? 'necessário' : 'opcional'}
                            </Badge>
                          </div>
                          <p className="mt-1 font-mono text-xs text-texto-fraco">{p.descricao}</p>
                        </Card>
                      ))}
                      {papeis.length === 0 && (
                        <p className="font-mono text-xs text-texto-fraco">Nenhum papel cadastrado ainda.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {papelAtivo?.descricao
                      ? <p className="font-mono text-sm text-texto-fraco">{papelAtivo.descricao}</p>
                      : <p className="font-mono text-sm text-texto-fraco/60">Sem descrição.</p>}
                    <div className="mt-4 space-y-2">
                      {(papelAtivo?.granadas ?? []).map((g) => (
                        <BlocoGranada key={g.id} granada={g} onAbrir={setGranadaAberta} />
                      ))}
                      {(papelAtivo?.granadas ?? []).length === 0 && (
                        <p className="font-mono text-xs text-texto-fraco">Nenhuma granada linkada nesse papel.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {acoesAdmin}
          </div>
        </div>
      </div>

      {/* Fora da árvore do backdrop de DetalheTatica de propósito: se estivesse
          aninhado, um clique no backdrop do DetalheGranada (que só para propagação
          no painel interno) borbulharia até o onClick={onFechar} do backdrop desta
          tática e fecharia os dois modais juntos. Como irmão, cada backdrop só
          fecha o seu próprio modal. */}
      {granadaAberta && (
        <DetalheGranada granada={granadaAberta} onFechar={() => setGranadaAberta(null)} />
      )}
    </>
  )
}
