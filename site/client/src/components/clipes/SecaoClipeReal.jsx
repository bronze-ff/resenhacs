import { useCallback, useEffect, useMemo, useState } from 'react'
import { SectionHeader, EstadoVazio, EstadoErro, Button, Badge, SkeletonLista } from '../ui'
import SeletorKills from './SeletorKills.jsx'
import AvisoPartidaSemDemo from '../AvisoPartidaSemDemo.jsx'
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
  juntando: 'Juntando os trechos…',
  pronto: 'Pronto',
  erro: 'Falhou',
}

// `papel`: de quem a tabela lista as kills (killer) ou as mortes (victim). O servidor
// decide a câmera de cada trecho pelo modo (site/server/src/routes/clipesReais.js).
export const MODOS = [
  { id: 'clipe', rotulo: 'Clipe', papel: 'killer', descricao: 'As kills que você marcar, na visão que escolher.' },
  { id: 'fails', rotulo: 'Fails', papel: 'victim', descricao: 'As mortes do Jogador, na visão dele. Pra zoar no grupo.' },
  { id: 'coaching', rotulo: 'Coaching', papel: 'victim', descricao: 'Cada morte duas vezes: na visão do Jogador e na de quem matou. Custa o dobro.' },
  { id: 'cheater', rotulo: 'Cheater analysis', papel: 'killer', descricao: 'As kills de um suspeito, na visão dele, com X-Ray (contorno dos jogadores através da parede).' },
]

function plural(n, um, varios) {
  return `${n} ${n === 1 ? um : varios}`
}

export function descreverClipe(c) {
  // Coaching guarda dois trechos por morte; conta a morte uma vez só.
  const n = new Set((c.kills ?? []).map((k) => `${k.round}:${k.tick}`)).size
  const rounds = [...new Set((c.kills ?? []).map((k) => k.round))]
  const quais = rounds.length === 1 ? `round ${rounds[0]}` : `rounds ${rounds.join(', ')}`
  if (c.modo === 'fails') return `Fails · ${plural(n, 'morte', 'mortes')} · ${quais}`
  if (c.modo === 'coaching') return `Coaching · ${plural(n, 'morte', 'mortes')} · ${quais}`
  if (c.modo === 'cheater') return `Cheater analysis · ${plural(n, 'kill', 'kills')} · ${quais}`
  return n > 1 ? `Montagem de ${n} kills · ${quais}` : `Kill · ${quais}`
}

// Cada consulta devolve URLs assinadas novas pro mesmo vídeo. Trocar o src do <video>
// recarrega o player e volta pro começo; então o clipe que já tinha vídeo fica com as
// URLs antigas, desde que sejam os mesmos vídeos (o vídeo único pode chegar depois).
// shortcut: a URL antiga expira em 1 h; com a aba aberta mais que isso, recarregar a página.
export function manterVideos(anteriores, novos) {
  const porId = new Map((anteriores ?? []).map((c) => [c.id, c]))
  return novos.map((c) => {
    const antes = porId.get(c.id)
    return antes?.videos?.length && antes.videos.length === c.videos?.length ? { ...c, videos: antes.videos } : c
  })
}

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function TextoEstimativa({ estimativa }) {
  if (estimativa === 'carregando') return <span className="text-sm text-texto-fraco">Calculando o custo…</span>
  if (estimativa === 'erro') return <span className="text-sm text-texto-fraco">Não deu pra calcular o custo agora.</span>
  if (!estimativa) return null
  const { trechos, total, analise, reais } = estimativa
  return (
    <span className="text-sm text-texto">
      {plural(trechos, 'trecho', 'trechos')} · <strong className="tabular-nums">{plural(total, 'crédito', 'créditos')}</strong>
      {analise > 0 && <span className="text-texto-fraco"> (inclui 1 da leitura da Demo)</span>}
      {' '}· ≈ <span className="tabular-nums">{REAIS.format(reais)}</span>
    </span>
  )
}

// Opção paga à parte: tirar a marca d'água da DEMO-SLAP. O custo extra vem da estimativa.
function OpcaoSemMarca({ marcado, onMudar, estimativa }) {
  const extra = typeof estimativa === 'object' && estimativa ? estimativa : null
  return (
    <label className="flex cursor-pointer flex-wrap items-center gap-2 text-sm text-texto">
      <input
        type="checkbox"
        checked={marcado}
        onChange={(e) => onMudar(e.target.checked)}
        className="h-4 w-4 accent-[color:var(--color-destaque)]"
      />
      Sem a marca d&apos;água da DEMO-SLAP
      <Badge tom="destaque">
        {extra?.extraSemMarca > 0
          ? `+${plural(extra.extraSemMarca, 'crédito', 'créditos')} (+${REAIS.format(extra.reaisExtraSemMarca)})`
          : 'mais caro'}
      </Badge>
    </label>
  )
}

// Montagem = um trecho por kill. O Coletor junta num vídeo só; se ele não conseguir, a
// aba toca os trechos em sequência. Largura igual à do player da Allstar na Partida.
function PlayerTrechos({ videos }) {
  const [atual, setAtual] = useState(0)
  const montagem = videos.length > 1
  return (
    <div className="mt-3 space-y-2 lg:max-w-xl">
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

export default function SecaoClipeReal({ matchId, jogadores, viewerSteamId, partida, onDemoEnviada }) {
  const semDemo = partida?.temDemo === false
  const [modoId, setModoId] = useState('clipe')
  const [kills, setKills] = useState([])
  const [pov, setPov] = useState('killer')
  const [semMarca, setSemMarca] = useState(false)
  const [dados, setDados] = useState(null)
  const [erroLista, setErroLista] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erroPedido, setErroPedido] = useState(null)
  const [estimativa, setEstimativa] = useState(null)

  const url = `/api/matches/${encodeURIComponent(matchId)}/clipes-reais`
  const modo = MODOS.find((m) => m.id === modoId)
  const papelPov = modoId === 'clipe' ? pov : modo.papel

  const carregar = useCallback(() => {
    return fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setDados((atual) => ({
          disponivel: Boolean(d?.disponivel),
          permitido: Boolean(d?.permitido),
          clipes: manterVideos(atual?.clipes, Array.isArray(d?.clipes) ? d.clipes : []),
        }))
        setErroLista(false)
      })
      .catch(() => setErroLista(true))
  }, [url])

  // Corpo do pedido e da estimativa. Em string pra servir de dependência estável.
  const corpo = useMemo(() => JSON.stringify({
    modo: modoId,
    semMarca,
    kills: kills.map((k) => ({
      tick: k.tick,
      round: k.round,
      pov: papelPov === 'victim' ? k.victim?.steamId : k.killer?.steamId,
    })),
  }), [modoId, semMarca, kills, papelPov])

  // Custo antes de pedir: a DEMO-SLAP calcula sem gastar crédito. Espera a seleção
  // parar de mudar pra não chamar a cada clique.
  const podeEstimar = !semDemo && Boolean(dados?.permitido) && kills.length > 0
  useEffect(() => {
    if (!podeEstimar) { setEstimativa(null); return undefined }
    let vivo = true
    setEstimativa('carregando')
    const id = setTimeout(() => {
      fetch(`${url}/estimativa`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => { if (vivo) setEstimativa(d) })
        .catch(() => { if (vivo) setEstimativa('erro') })
    }, 400)
    return () => { vivo = false; clearTimeout(id) }
  }, [podeEstimar, corpo, url])

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
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.erro || 'Não foi possível pedir o clipe.')
      setDados((atual) => ({
        disponivel: true, permitido: true, ...atual,
        clipes: Array.isArray(d?.clipes) ? manterVideos(atual?.clipes, d.clipes) : atual?.clipes ?? [],
      }))
    } catch (e) {
      setErroPedido(e.message)
    } finally {
      setEnviando(false)
    }
  }

  const oQue = modo.papel === 'victim' ? plural(kills.length, 'morte', 'mortes') : plural(kills.length, 'kill', 'kills')
  let rotuloBotao = `Gerar ${modo.rotulo} (${oQue})`
  if (modoId === 'clipe') rotuloBotao = kills.length > 1 ? `Gerar montagem (${kills.length} kills)` : 'Gerar clipe'

  return (
    <div>
      <SectionHeader titulo="Clipe das kills que você escolher" margem="pequena" />
      {!semDemo && <p className="mb-3 text-sm text-texto-fraco">
        Vídeo do próprio CS2, gravado a partir da Demo. Marque uma kill pra um clipe ou várias
        pra uma montagem. Leva alguns minutos com esta aba aberta; se sair, ele continua na
        próxima visita. A montagem só aparece depois de juntada num vídeo só, uns minutos
        depois de gravada.
      </p>}
      {semDemo && (partida.source === 'faceit'
        ? <AvisoPartidaSemDemo partida={partida} euSteamId={viewerSteamId} onEnviado={onDemoEnviada} />
        : <EstadoVazio titulo="Partida sem Demo: kills, mortes por round e clipes precisam do arquivo .dem" />)}

      {/* O seletor só aparece depois de saber que o recurso está ligado: antes disso
          o Jogador podia marcar kills e só descobrir no clique que não ia funcionar. */}
      {!dados && !erroLista && <SkeletonLista linhas={3} altura="h-10" rotulo="Carregando clipes" />}
      {erroLista && <EstadoErro mensagem="Não foi possível carregar os clipes dessa Partida." />}
      {!semDemo && dados && !dados.disponivel && (
        <EstadoVazio
          titulo="Clipe de vídeo ainda não configurado"
          descricao="Falta a chave da DEMO-SLAP no servidor. Enquanto isso, use o clipe do jogo da Allstar acima."
        />
      )}
      {!semDemo && dados?.disponivel && !dados.permitido && (
        <EstadoVazio
          titulo="Clipe de vídeo é para Jogador Premium"
          descricao="Cada clipe gasta crédito pago. Fale com o admin do grupo pra liberar. Os clipes já gerados continuam aqui embaixo."
        />
      )}
      {!semDemo && dados?.disponivel && dados.permitido && (
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm text-texto-fraco">Modo</legend>
            <div className="flex flex-wrap gap-2">
              {MODOS.map((m) => (
                <label
                  key={m.id}
                  className={`cursor-pointer rounded-[var(--radius-medio)] border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-destaque ${modoId === m.id ? 'border-borda-forte bg-superficie-topo text-texto' : 'border-borda text-texto-fraco hover:text-texto'}`}
                >
                  <input type="radio" name="modo-clipe" value={m.id} checked={modoId === m.id} onChange={() => setModoId(m.id)} className="sr-only" />
                  {m.rotulo}
                </label>
              ))}
            </div>
            <p className="mt-2 text-sm text-texto-fraco">{modo.descricao}</p>
          </fieldset>

          <SeletorKills
            matchId={matchId}
            jogadores={jogadores}
            viewerSteamId={viewerSteamId}
            papel={modo.papel}
            onMudarSelecao={setKills}
          />

          <div className="flex flex-wrap items-center gap-3">
            {modoId === 'clipe' && (
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
            )}
            <Button variante="primario" onClick={gerar} disabled={kills.length === 0} carregando={enviando}>
              {rotuloBotao}
            </Button>
            {kills.length === 0 && (
              <span className="text-sm text-texto-fraco">
                Marque ao menos {modo.papel === 'victim' ? 'uma morte' : 'uma kill'} na tabela.
              </span>
            )}
          </div>
          <OpcaoSemMarca marcado={semMarca} onMudar={setSemMarca} estimativa={estimativa} />
          <p aria-live="polite" className="min-h-5">
            <TextoEstimativa estimativa={estimativa} />
          </p>
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
