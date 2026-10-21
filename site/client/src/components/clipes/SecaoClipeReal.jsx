import { useCallback, useEffect, useState } from 'react'
import { SectionHeader, EstadoVazio, EstadoErro, Button, Badge, SkeletonLista } from '../ui'
import SeletorKills from './SeletorKills.jsx'
import { dataHora } from '../../lib/format.js'

// Aba Clipes da Partida: clipe REAL (vídeo do CS2) das kills que o Jogador escolhe.
// Uma kill = um clipe; várias = montagem num vídeo só. Quem grava é a DEMO-SLAP
// (site/server/src/demoSlap.js); a lista é consultada de tempos em tempos enquanto
// algum clipe estiver em andamento, e cada consulta faz o servidor avançar o pedido.
const INTERVALO_MS = 10000

const ROTULO_STATUS = {
  analisando: 'Lendo a Demo…',
  enviando: 'Enviando…',
  renderizando: 'Gravando no CS2…',
  pronto: 'Pronto',
  erro: 'Falhou',
}

export function descreverClipe(c) {
  const n = c.kills?.length ?? 0
  const rounds = [...new Set((c.kills ?? []).map((k) => k.round))]
  const quais = rounds.length === 1 ? `round ${rounds[0]}` : `rounds ${rounds.join(', ')}`
  return n > 1 ? `Montagem de ${n} kills · ${quais}` : `Kill · ${quais}`
}

// Montagem = um trecho por kill, tocados em sequência no mesmo player (a DEMO-SLAP não
// junta trechos do render-custom num vídeo só).
function PlayerTrechos({ videos }) {
  const [atual, setAtual] = useState(0)
  const montagem = videos.length > 1
  return (
    <div className="mt-3 space-y-2">
      <video
        src={videos[atual]}
        controls
        playsInline
        preload="metadata"
        autoPlay={atual > 0}
        onEnded={() => setAtual((i) => (i + 1 < videos.length ? i + 1 : i))}
        className="aspect-video w-full rounded-[var(--radius-medio)] bg-black"
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-texto-fraco">
        {montagem && (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Trechos da montagem">
            {videos.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-pressed={i === atual}
                aria-label={`Trecho ${i + 1}`}
                onClick={() => setAtual(i)}
                className={`min-w-7 rounded-[var(--radius-pequeno)] border px-2 py-1 ${i === atual ? 'border-borda-forte bg-superficie-topo text-texto' : 'border-borda hover:text-texto'}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
        <a href={videos[atual]} download target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-texto hover:underline">
          {montagem ? `Baixar trecho ${atual + 1}` : 'Baixar vídeo'}
        </a>
      </div>
    </div>
  )
}

function ItemClipe({ clipe }) {
  const andamento = clipe.status !== 'pronto' && clipe.status !== 'erro'
  return (
    <li className="panel-cut border border-borda bg-superficie p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm text-texto">{descreverClipe(clipe)}</p>
          <p className="text-xs text-texto-fraco">
            {clipe.pedidoPor?.nick || 'Jogador'}{clipe.criadoEm ? ` · ${dataHora(clipe.criadoEm)}` : ''}
          </p>
        </div>
        <Badge tom={clipe.status === 'pronto' ? 'sucesso' : clipe.status === 'erro' ? 'perigo' : 'neutro'}>
          {andamento && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />}
          {ROTULO_STATUS[clipe.status] ?? clipe.status}
        </Badge>
      </div>
      {clipe.status === 'erro' && clipe.erro && (
        <p className="mt-2 text-xs text-perigo">{clipe.erro}</p>
      )}
      {clipe.status === 'pronto' && clipe.videos?.length > 0 && <PlayerTrechos videos={clipe.videos} />}
      {clipe.status === 'pronto' && !clipe.videos?.length && (
        <p className="mt-2 text-xs text-texto-fraco">O vídeo não carregou agora. Recarregue a página em instantes.</p>
      )}
    </li>
  )
}

export default function SecaoClipeReal({ matchId, jogadores, viewerSteamId }) {
  const [kills, setKills] = useState([])
  const [pov, setPov] = useState('killer')
  const [dados, setDados] = useState(null)
  const [erroLista, setErroLista] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erroPedido, setErroPedido] = useState(null)

  const url = `/api/matches/${encodeURIComponent(matchId)}/clipes-reais`

  const carregar = useCallback(() => {
    return fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setDados({ disponivel: Boolean(d?.disponivel), clipes: Array.isArray(d?.clipes) ? d.clipes : [] }); setErroLista(false) })
      .catch(() => setErroLista(true))
  }, [url])

  useEffect(() => { carregar() }, [carregar])

  const emAndamento = (dados?.clipes ?? []).some((c) => c.status !== 'pronto' && c.status !== 'erro')
  useEffect(() => {
    if (!emAndamento) return undefined
    const id = setInterval(carregar, INTERVALO_MS)
    return () => clearInterval(id)
  }, [emAndamento, carregar])

  async function gerar() {
    setEnviando(true)
    setErroPedido(null)
    try {
      const corpo = {
        kills: kills.map((k) => ({
          tick: k.tick,
          round: k.round,
          pov: pov === 'victim' ? k.victim?.steamId : k.killer?.steamId,
        })),
      }
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.erro || 'Não foi possível pedir o clipe.')
      setDados((atual) => ({ disponivel: true, ...atual, clipes: Array.isArray(d?.clipes) ? d.clipes : atual?.clipes ?? [] }))
    } catch (e) {
      setErroPedido(e.message)
    } finally {
      setEnviando(false)
    }
  }

  const montagem = kills.length > 1
  const rotuloBotao = montagem ? `Gerar montagem (${kills.length} kills)` : 'Gerar clipe'

  return (
    <div>
      <SectionHeader titulo="Clipe das kills que você escolher" margem="pequena" />
      <p className="mb-3 text-sm text-texto-fraco">
        Vídeo do próprio CS2, gravado a partir da Demo. Marque uma kill pra um clipe ou várias
        pra uma montagem. Leva alguns minutos com esta aba aberta; se sair, ele continua na
        próxima visita.
      </p>

      {/* O seletor só aparece depois de saber que o recurso está ligado: antes disso
          o Jogador podia marcar kills e só descobrir no clique que não ia funcionar. */}
      {!dados && !erroLista && <SkeletonLista linhas={3} altura="h-10" rotulo="Carregando clipes" />}
      {erroLista && <EstadoErro mensagem="Não foi possível carregar os clipes dessa Partida." />}
      {dados && !dados.disponivel && (
        <EstadoVazio
          titulo="Clipe de vídeo ainda não configurado"
          descricao="Falta a chave da DEMO-SLAP no servidor. Enquanto isso, use o clipe do jogo da Allstar acima."
        />
      )}
      {dados?.disponivel && (
        <div className="space-y-4">
          <SeletorKills
            matchId={matchId}
            jogadores={jogadores}
            viewerSteamId={viewerSteamId}
            onMudarSelecao={setKills}
          />

          <div className="flex flex-wrap items-center gap-3">
            <fieldset className="flex items-center gap-1 rounded-[var(--radius-medio)] border border-borda bg-superficie p-1 text-sm">
              <legend className="sr-only">Visão do clipe</legend>
              {[['killer', 'Visão de quem matou'], ['victim', 'Visão de quem morreu']].map(([valor, rotulo]) => (
                <label
                  key={valor}
                  className={`cursor-pointer rounded-[var(--radius-pequeno)] px-3 py-1.5 transition-colors ${pov === valor ? 'bg-superficie-topo text-texto' : 'text-texto-fraco hover:text-texto'}`}
                >
                  <input type="radio" name="pov-clipe" value={valor} checked={pov === valor} onChange={() => setPov(valor)} className="sr-only" />
                  {rotulo}
                </label>
              ))}
            </fieldset>
            <Button variante="primario" onClick={gerar} disabled={kills.length === 0} carregando={enviando}>
              {rotuloBotao}
            </Button>
            {kills.length === 0 && <span className="text-sm text-texto-fraco">Marque ao menos uma kill na tabela.</span>}
          </div>
          {erroPedido && <EstadoErro mensagem={erroPedido} />}
        </div>
      )}

      <div className="mt-5">
        {dados && dados.clipes.length > 0 && (
          <ul className="space-y-3" aria-label="Clipes gerados">
            {dados.clipes.map((c) => <ItemClipe key={c.id} clipe={c} />)}
          </ul>
        )}
      </div>
    </div>
  )
}
