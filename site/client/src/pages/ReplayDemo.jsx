import ReplayViewer, { useReplayPorRound } from '../components/ReplayViewer.jsx'
import { Button, CabecalhoPagina, EstadoErro, EstadoVazio, Skeleton } from '../components/ui'

// Rota pública só para mostrar a engine de Replay 2D com dados sintéticos,
// sem precisar de login nem de demo real. Aperte Play.
export default function ReplayDemo() {
  const { replay, erro, tentarDeNovo } = useReplayPorRound('/demo-replay.json')

  let conteudo
  if (erro) {
    conteudo = (
      <EstadoErro
        mensagem="Não deu para carregar o Replay 2D de exemplo."
        acao={<Button variante="secundario" tamanho="sm" onClick={tentarDeNovo}>Tentar de novo</Button>}
      />
    )
  } else if (!replay) {
    conteudo = (
      <div role="status" aria-label="Carregando replay" className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="aspect-square w-full" />
      </div>
    )
  } else if (!replay.rounds?.length) {
    conteudo = <EstadoVazio titulo="O replay de exemplo está vazio." descricao="Nenhum round para mostrar." />
  } else {
    conteudo = <ReplayViewer replay={replay} />
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <CabecalhoPagina
        eyebrow="Demonstração"
        titulo="Replay 2D — partida real"
        descricao="Posições reais de uma partida de vocês (de_anubis, 1º round), extraídas da Demo pelo Coletor."
      />
      {conteudo}
    </div>
  )
}
