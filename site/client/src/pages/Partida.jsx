import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { DOMINIOS_IFRAME_CLIPE, hostPermitido, hrefSeguro } from '../lib/urlSegura.js'
import { nomeMapa, dataHora, origemPartida, nomeArma, corRating, rotuloHighlight } from '../lib/format.js'
import { orientarPlacar } from '../lib/resultado.js'
import {
  Avatar, MapIcon, SectionHeader, Select, PlataformaBadge, Badge, Button, Modal, Abas,
  Skeleton, SkeletonLista, EstadoVazio, EstadoErro, Input, Textarea, classesBotao, PlayerClipe,
} from '../components/ui'
import ReplayViewer, { useReplayPorRound } from '../components/ReplayViewer.jsx'
import MapaCalor from '../components/MapaCalor.jsx'
import SeletorClipesCompeticao from '../components/SeletorClipesCompeticao.jsx'
import SecaoClipeReal from '../components/clipes/SecaoClipeReal.jsx'
import Espelho from '../components/partida/Espelho.jsx'
import FaixaRounds from '../components/partida/FaixaRounds.jsx'
import { useAuth } from '../auth/AuthContext.jsx'
import SecaoLicoes from '../components/SecaoLicoes.jsx'
import { useTransicaoModal } from '../lib/useTransicaoModal.js'

// Carregamento (índice + /round/:n, streaming por round — FIL-54b) mora no
// useReplayPorRound, compartilhado com o CardTaticaReplay. Erro de um round fica só nele.
export function SecaoReplay({ replayUrl, seek, onSelecionarPonto, matchId = null, onRoundChange = null, painelExtra = null }) {
  const { replay, erro, roundsComErro, tentarRound, tentarDeNovo } = useReplayPorRound(replayUrl)
  const [aba, setAba] = useState('replay') // replay | calor

  // Deep link de um Highlight sempre volta pra aba do replay animado.
  useEffect(() => {
    if (seek) setAba('replay')
  }, [seek?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!replayUrl) {
    return (
      <EstadoVazio
        titulo="Replay 2D indisponível"
        descricao="O Replay 2D é gerado pelo Coletor quando a Demo da Partida é processada."
      />
    )
  }
  if (erro) {
    return (
      <EstadoErro
        mensagem="Não foi possível carregar o replay."
        acao={<Button variante="secundario" tamanho="sm" onClick={tentarDeNovo}>Tentar de novo</Button>}
      />
    )
  }
  if (!replay) {
    return (
      <div role="status" aria-label="Carregando replay" className="space-y-3">
        <Skeleton className="panel-cut-tr h-10 w-64" />
        <Skeleton className="panel-cut mx-auto aspect-square w-full max-w-[min(100%,calc(100vh-11rem))]" />
        <span className="sr-only">Carregando replay…</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Abas
        rotulo="Visualização do replay"
        itens={[{ valor: 'replay', rotulo: 'Animação' }, { valor: 'calor', rotulo: 'Mapa de calor' }]}
        valor={aba}
        onChange={setAba}
      />
      {aba === 'replay' ? (
        <ReplayViewer
          replay={replay} seek={seek} matchId={matchId} palco onRoundChange={onRoundChange} painelExtra={painelExtra}
          roundsComErro={roundsComErro} onTentarRound={tentarRound}
        />
      ) : (
        <MapaCalor replay={replay} onSelecionarPonto={onSelecionarPonto} />
      )}
    </div>
  )
}


// Destaque do MVP da Partida — mesmo dado (e mesmo critério) do chip que o card dessa
// Partida mostra no Feed: melhor rating entre os Jogadores do grupo, desempate por kills.
// Sem MVP (nenhum jogador rastreado) ou sem rating (partida antiga, sem o dado): não
// renderiza nada — nada de espaço vazio nem de "—" pra um destaque que não existe.
function DestaqueMvp({ mvp }) {
  if (!mvp || mvp.rating == null) return null
  return (
    <div className="flex min-w-0 items-center gap-2.5 font-mono text-sm">
      <span className="panel-cut-tr border border-ouro/40 bg-ouro/10 px-1.5 py-0.5 text-[11px] font-bold text-ouro">MVP</span>
      <Avatar p={mvp} size={28} />
      <Link to={`/jogador/${mvp.steamId}`} className="min-w-0 truncate text-texto transition-colors hover:text-destaque">
        {mvp.nick || mvp.steamId}
      </Link>
      <span className={`font-display text-lg font-semibold leading-none tabular-nums ${corRating(mvp.rating)}`} title="Rating na partida">
        {mvp.rating.toFixed(2)}
      </span>
    </div>
  )
}

// Modal separado (aberto sob demanda): timeline round-a-round de UM Jogador — o que
// comprou, quando matou/morreu e com quê. Busca lazy (só quando abre pra esse Jogador).
function ModalDetalhePartida({ matchId, jogador, onFechar }) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(false)
  const { visivel, iniciarSaida } = useTransicaoModal()
  const fechar = () => iniciarSaida(onFechar)

  useEffect(() => {
    setDados(null)
    setErro(false)
    fetch(`/api/matches/${matchId}/jogador/${jogador.steamId}/detalhe`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setDados)
      .catch(() => setErro(true))
  }, [matchId, jogador.steamId])

  return (
    <Modal
      visivel={visivel}
      onFechar={fechar}
      tamanho="md"
      titulo={
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar p={jogador} size={32} />
          <span className="min-w-0 truncate">{jogador.nick || jogador.steamId}</span>
        </span>
      }
      subtitulo={
        jogador.duelWinPct !== null ? (
          <span title="Kills ÷ (kills + mortes). As mortes incluem queda, bomba e fogo amigo, não só duelos.">

            Duelos vencidos: <span className="text-texto">{jogador.duelWinPct}%</span> ({jogador.kills}V/{jogador.deaths}D)
          </span>
        ) : null
      }
    >
      {erro && <EstadoErro mensagem="Não foi possível carregar o detalhe." />}
      {!erro && !dados && <SkeletonLista linhas={6} altura="h-10" rotulo="Carregando detalhe" />}
      {dados && dados.rounds.length === 0 && (
        <EstadoVazio titulo="Sem dados round a round" descricao="Sem dados round-a-round pra essa partida (demo antiga)." />
      )}
      {dados && dados.rounds.length > 0 && (
        <>
          {/* Legenda fixa: explica de cara o que cada coluna/cor significa, sem
              precisar perguntar — mesma dúvida que já apareceu uma vez. */}
          <p className="mb-4 text-xs leading-relaxed text-texto-fraco">
            Cada linha é um round: o valor do equipamento dele naquele round (com o
            detalhe de cada item), e do lado direito, em{' '}
            <span className="text-sucesso">verde</span> as kills (arma e se foi
            headshot) e em <span className="text-perigo">vermelho</span> a morte dele
            — arma de quem matou e, entre parênteses, a arma que ELE estava segurando
            na hora — quando ele sobrevive o round, não aparece nada em vermelho.
          </p>
          <div className="space-y-1">
            {dados.rounds.map((r) => (
              <div key={r.roundNumber} className="panel-cut-tr flex flex-wrap items-center gap-x-3 gap-y-1 border border-borda bg-superficie-alta px-3 py-2 font-mono text-xs">
                <span className="w-16 shrink-0 font-display text-sm font-semibold text-texto">Round {r.roundNumber}</span>
                {/* Só o valor: o buy_type por jogador vem do limiar de TIME (coletor parse.py),
                    então uma compra cheia individual sairia como "Eco". */}
                {r.equipValue != null && (
                  <span className="tabular-nums text-texto-fraco">${r.equipValue}</span>
                )}
                {r.compras.length > 0 && (
                  <span className="text-texto-fraco/80">
                    · comprou: {r.compras.map((c, i) => (
                      <span key={i}>
                        {i > 0 && ', '}
                        {nomeArma(c.item)}{c.cost != null ? ` ($${c.cost})` : ''}
                      </span>
                    ))}
                  </span>
                )}
                <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3">
                  {r.matou.map((k, i) => (
                    <span key={i} className="text-sucesso">▲ matou: {nomeArma(k.weapon)}{k.headshot ? ' (HS)' : ''}</span>
                  ))}
                  {r.morreu && (
                    <span className="text-perigo">
                      ▼ morreu: {nomeArma(r.morreu.weapon)}
                      {r.morreu.victimWeapon && r.morreu.victimWeapon !== r.morreu.weapon && (
                        <> (segurando: {nomeArma(r.morreu.victimWeapon)})</>
                      )}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

// Popover local (nome + descrição) pra sugerir um round como Tática — abre ao clicar num
// round sem highlight na linha do tempo. Fica pendente de aprovação (Task 10/14 cuidam do
// fluxo de aprovação); aqui só dispara o POST e mostra confirmação.
// `variante` escolhe o posicionamento: "absoluta" (desktop, ancorado no round clicado —
// como era antes do M3) ou "bloco" (mobile, abaixo da faixa inteira de rounds).
function SugerirTatica({ matchId, map, roundNumber, onFechar, variante = 'bloco' }) {
  const classesSucesso =
    variante === 'absoluta'
      ? 'panel-cut absolute left-0 top-full z-10 mt-1 w-56 border border-sucesso/40 bg-superficie p-3 text-xs text-sucesso shadow-flutuante'
      : 'panel-cut mt-3 w-full border border-sucesso/40 bg-superficie p-3 text-xs text-sucesso sm:w-72'
  const classesForm =
    variante === 'absoluta'
      ? 'panel-cut absolute left-0 top-full z-10 mt-1 w-72 space-y-2.5 border border-borda-forte bg-superficie p-3 text-left shadow-flutuante'
      : 'panel-cut mt-3 w-full space-y-2.5 border border-borda-forte bg-superficie p-3 text-left sm:w-72'
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(null)
  const [sucesso, setSucesso] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    try {
      const res = await fetch('/api/taticas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, descricao, map, matchId, roundNumber }),
      })
      if (res.ok) {
        setSucesso(true)
      } else {
        const b = await res.json().catch(() => ({}))
        setErro(b.erro ?? 'Erro ao sugerir tática.')
      }
    } finally {
      setEnviando(false)
    }
  }

  if (sucesso) {
    return (
      <div className={classesSucesso}>
        Tática sugerida! Aguardando aprovação.
      </div>
    )
  }

  return (
    <form
      onSubmit={enviar}
      onClick={(e) => e.stopPropagation()}
      className={classesForm}
    >
      <p className="rotulo">Sugerir tática · round {roundNumber}</p>
      <Input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Nome curto"
        aria-label="Nome da tática"
        required
      />
      <Textarea
        value={descricao}
        onChange={(e) => setDescricao(e.target.value)}
        placeholder="Descrição"
        aria-label="Descrição da tática"
        rows={2}
      />
      {erro && <p className="text-xs text-perigo">{erro}</p>}
      <div className="flex justify-end gap-2">
        <Button variante="fantasma" tamanho="sm" onClick={onFechar}>
          Cancelar
        </Button>
        <Button type="submit" variante="primario" tamanho="sm" carregando={enviando}>
          Sugerir
        </Button>
      </div>
    </form>
  )
}

// Embaixo da lista de kills do Replay 2D: quem venceu o round, os Highlights dele e a
// ação secundária de sugerir o round como Tática (antes era o clique no próprio round).
function PainelRound({ matchId, map, rodada, highlights, onHighlight }) {
  const [sugerindo, setSugerindo] = useState(false)
  const numero = rodada?.roundNumber
  useEffect(() => { setSugerindo(false) }, [numero])
  if (!rodada) return null
  const momentos = highlights.filter((h) => h.roundNumber === numero)
  return (
    <div className="space-y-3 border-t border-borda pt-3">
      {rodada.winnerTeam && (
        <p className="text-xs text-texto-fraco">
          Round <span className="font-mono tabular-nums">{numero}</span> vencido pelo{' '}
          <span className={rodada.winnerTeam === 'A' ? 'text-time-a' : 'text-time-b'}>Time {rodada.winnerTeam}</span>
          {rodada.winReason ? ` · ${rodada.winReason}` : ''}
        </p>
      )}
      {momentos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {momentos.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => onHighlight(h)}
              disabled={h.frame == null}
              title={h.frame == null ? 'Sem o momento exato gravado' : 'Assistir esse Highlight'}
              className="rounded-[var(--radius-pequeno)] border border-borda bg-superficie-alta px-2 py-1 font-mono text-xs text-texto transition-colors hover:border-borda-forte disabled:cursor-default disabled:opacity-60"
            >
              <span className="font-semibold">{rotuloHighlight(h.kind)}</span> {h.nick || h.steamId}
            </button>
          ))}
        </div>
      )}
      {sugerindo ? (
        <SugerirTatica matchId={matchId} map={map} roundNumber={numero} onFechar={() => setSugerindo(false)} />
      ) : (
        <Button
          variante="secundario"
          tamanho="sm"
          onClick={() => setSugerindo(true)}
          icone={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          )}
        >
          Sugerir esse round como tática
        </Button>
      )}
    </div>
  )
}

// Seletor de jogador pro clipe (estilo Allstar.gg "Your Moments" — avatar + nick,
// clicável, time A/B lado a lado). Um ✓ pequeno indica que esse jogador já tem
// clipe pronto (Processed), pra não precisar clicar em todos pra descobrir.
function BotaoJogadorClipe({ p, selecionado, onClick }) {
  const temClipeProcessado = p.allstarClip?.status === 'Processed'
  return (
    <button
      onClick={onClick}
      aria-pressed={selecionado}
      className={`panel-cut-tr flex min-h-10 items-center gap-2 border px-2.5 py-1.5 font-mono text-xs transition-colors lg:min-h-9 ${
        selecionado
          ? 'border-destaque/70 bg-destaque/10 text-texto'
          : 'border-borda bg-superficie text-texto-fraco hover:border-borda-forte hover:bg-superficie-alta hover:text-texto'
      }`}
    >
      <Avatar p={p} size={20} />
      <span className="max-w-[7rem] truncate">{p.nick || p.steamId}</span>
      {temClipeProcessado && (
        <span title="Já tem clipe pronto" className="h-1.5 w-1.5 rounded-full bg-sucesso">
          <span className="sr-only">Já tem clipe pronto</span>
        </span>
      )}
    </button>
  )
}

function IconePlay({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M7 5v14l12-7z" />
    </svg>
  )
}

// Painel do jogador selecionado na aba Clipes: sem clipe ainda -> botão "gerar";
// Submitted -> "gerando…"; Error -> permite tentar de novo; Processed -> player
// embutido do Allstar, mesmo layout (vídeo + info ao lado) do resto do sistema.
function PainelClipeJogador({ jogador, clip, pedindo, erro, aberto, onAbrir, onGerar, viewerSteamId, m, placar, podeEnviarCompeticao, onAbrirSeletorCompeticao }) {
  // demo_url nulo (cleanup de 14 dias, ou Partida que nunca teve .dem): o servidor
  // responde 404. Esconde a ação em vez de deixar o clique falhar.
  const semDemo = !m.demoUrl
  const nome = jogador.nick || jogador.steamId
  const avisoSemDemo = (
    <span className="text-xs text-texto-fraco">
      Demo não arquivada — não dá pra gerar clipe nem baixar o .dem.
    </span>
  )
  const casca = 'mt-4 panel-cut border border-borda bg-superficie p-4 realce-topo'
  if (!clip) {
    return (
      <div className={casca}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-mono text-sm text-texto"><Avatar p={jogador} size={24} />{nome}</span>
          {semDemo ? avisoSemDemo : (
            <Button variante="primario" onClick={onGerar} carregando={pedindo}>
              gerar melhor clipe da partida
            </Button>
          )}
        </div>
        {erro && <EstadoErro mensagem={erro} className="mt-3" />}
      </div>
    )
  }
  if (clip.status === 'Submitted') {
    return (
      <div className={`${casca} flex items-center gap-3 text-sm text-texto-fraco`} role="status">
        <span className="h-2 w-2 shrink-0 animate-pulso-sinal rounded-full bg-destaque" aria-hidden="true" />
        Gerando o melhor clipe de {nome}… pode levar alguns minutos.
      </div>
    )
  }
  if (clip.status === 'Error') {
    return (
      <div className={`${casca} space-y-3`}>
        <EstadoErro
          mensagem={`Falha ao gerar o clipe de ${nome}.`}
          acao={semDemo ? null : (
            <Button variante="secundario" tamanho="sm" onClick={onGerar} carregando={pedindo}>
              tentar de novo
            </Button>
          )}
        />
        {semDemo && <p>{avisoSemDemo}</p>}
        {erro && <p className="text-xs text-perigo">{erro}</p>}
      </div>
    )
  }
  // Processed
  return (
    <div className={casca}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-mono text-sm text-texto">
          <Avatar p={jogador} size={24} />
          {nome}{clip.roundNumber ? <span className="text-texto-fraco"> · round {clip.roundNumber}</span> : ''}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {podeEnviarCompeticao && (
            <Button variante="fantasma" tamanho="sm" onClick={onAbrirSeletorCompeticao}>
              Enviar pra competição →
            </Button>
          )}
          <Button variante={aberto ? 'secundario' : 'contorno'} tamanho="sm" onClick={onAbrir} icone={aberto ? null : <IconePlay />}>
            {aberto ? 'fechar' : 'assistir'}
          </Button>
        </span>
      </div>
      {aberto && (
        <div className="mt-4 flex flex-col gap-4 lg:flex-row">
          {/* PlayerClipe só abre iframe para host da Allstar; o resto vira link (I2). */}
          <div className="w-full lg:max-w-xl [&>*:first-child]:mt-0">
            <PlayerClipe clipUrl={clip.clipUrl} viewerSteamId={viewerSteamId} titulo={`Melhor clipe de ${nome}`} location="matchResults" />
          </div>
          <div className="flex-1 space-y-3 border-t border-borda pt-4 lg:max-w-xs lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <div>
              <Badge tom="destaque">MELHOR MOMENTO</Badge>
              <p className="mt-2 font-mono text-sm text-texto">
                {nome}{clip.roundNumber ? ` · round ${clip.roundNumber}` : ''}
              </p>
            </div>
            <div className="space-y-1 font-mono text-xs text-texto-fraco">
              <p>{nomeMapa(m.map)} · {placar.a}-{placar.b}</p>
              <p>{dataHora(m.playedAt)}</p>
            </div>
            {hrefSeguro(clip.clipUrl) && (
              <a
                href={hrefSeguro(clip.clipUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className={classesBotao({ variante: 'fantasma', tamanho: 'sm', className: '-ml-3' })}
              >
                {hostPermitido(clip.clipUrl, DOMINIOS_IFRAME_CLIPE) ? 'Abrir no Allstar.gg ↗' : 'Abrir clipe ↗'}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function FormClipe({ matchId, jogadores, onAdicionado }) {
  const doGrupo = jogadores.filter((p) => p.isTracked)
  const [steamId, setSteamId] = useState(doGrupo[0]?.steamId ?? '')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [erro, setErro] = useState(null)

  async function enviar(e) {
    e.preventDefault()
    setErro(null)
    const res = await fetch('/api/clips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, steamId, url, title }),
    })
    if (res.ok) {
      setUrl('')
      setTitle('')
      onAdicionado()
    } else {
      const b = await res.json().catch(() => ({}))
      setErro(b.erro ?? 'Erro ao anexar clipe.')
    }
  }

  return (
    <form onSubmit={enviar} className="panel-cut space-y-3 border border-borda bg-superficie p-4 realce-topo">
      <p className="rotulo">Anexar clipe externo</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={steamId} onChange={(e) => setSteamId(e.target.value)}>
          {doGrupo.map((p) => (
            <option key={p.steamId} value={p.steamId}>{p.nick || p.steamId}</option>
          ))}
        </Select>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Link do Allstar/Medal/YouTube"
          aria-label="Link do clipe"
          className="min-w-0 flex-1 basis-56"
        />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título (opcional)"
          aria-label="Título do clipe"
          className="sm:w-44"
        />
        <Button type="submit" variante="primario">
          Anexar clipe
        </Button>
      </div>
      {erro && <p className="text-sm text-perigo">{erro}</p>}
    </form>
  )
}

// Resultado do grupo no hero: ícone + rótulo + cor (Regra do Sinal Duplo — nunca só cor).
const RESULTADO_HERO = {
  vitoria: { rotulo: 'Vitória', texto: 'text-sucesso', path: 'M12 19V5M6 11l6-6 6 6' },
  derrota: { rotulo: 'Derrota', texto: 'text-perigo', path: 'M12 5v14M6 13l6 6 6-6' },
  empate: { rotulo: 'Empate', texto: 'text-texto-fraco', path: 'M5 12h14' },
  misto: { rotulo: 'Grupo dividido', texto: 'text-texto-fraco', path: null },
}

// Faixa de abertura: mapa e data à esquerda, placar no meio (Time A dourado à esquerda,
// Time B azul à direita, na mesma ordem do Frente a frente) e o MVP do grupo à direita.
function HeroPartida({ m, resultadoGrupo, timeDoGrupo }) {
  const r = RESULTADO_HERO[resultadoGrupo]
  const origem = origemPartida(m.source, m.temDemo)
  const temMvp = m.mvp && m.mvp.rating != null
  return (
    <section className="panel-cut border border-borda bg-superficie realce-topo">
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
        <div className="flex min-w-0 items-center gap-3.5">
          <MapIcon map={m.map} size={48} />
          <div className="min-w-0">
            <Link to="/" className="rotulo inline-flex items-center gap-1.5 transition-colors hover:text-texto">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
                <path d="M19 12H5M11 6l-6 6 6 6" />
              </svg>
              Partidas
            </Link>
            <h1 className="truncate font-display text-3xl font-semibold leading-tight tracking-[-0.02em] text-texto">{nomeMapa(m.map)}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <PlataformaBadge source={m.source} plataformaManual={m.plataformaManual} />
              <span title={origem.title} className="rounded-[var(--radius-pequeno)] border border-borda bg-superficie-alta px-1.5 py-0.5 font-mono text-[11px] text-texto-fraco">
                {origem.label}
              </span>
              <span className="font-mono text-xs text-texto-fraco">{dataHora(m.playedAt)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-start lg:items-center">
          <div className="flex items-baseline gap-3 font-mono text-5xl font-semibold leading-none tabular-nums" aria-label={`Placar: Time A ${m.scoreA ?? '–'}, Time B ${m.scoreB ?? '–'}`}>
            <span className="text-time-a">{m.scoreA ?? '–'}</span>
            <span className="text-3xl text-texto-fraco/40" aria-hidden="true">:</span>
            <span className="text-time-b">{m.scoreB ?? '–'}</span>
          </div>
          {r && (
            <span
              className={`mt-2 flex items-center gap-1.5 font-mono text-xs font-semibold ${r.texto}`}
              title={resultadoGrupo === 'misto' ? 'O grupo jogou dividido nos dois times' : undefined}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                {r.path ? <path d={r.path} /> : <circle cx="12" cy="12" r="6" />}
              </svg>
              {r.rotulo}
              {timeDoGrupo && <span className="font-normal text-texto-fraco">· seu time: Time {timeDoGrupo}</span>}
            </span>
          )}
        </div>

        <div className="flex min-w-0 lg:justify-end">
          {temMvp ? <DestaqueMvp mvp={m.mvp} /> : <span className="rotulo">Sem MVP do grupo</span>}
        </div>
      </div>
    </section>
  )
}

function SkeletonPartida() {
  return (
    <div role="status" aria-label="Carregando partida" className="space-y-6">
      <Skeleton className="panel-cut h-28 w-full" />
      <Skeleton className="panel-cut h-96 w-full" />
      <Skeleton className="panel-cut h-40 w-full" />
      <span className="sr-only">Carregando…</span>
    </div>
  )
}

export default function Partida() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { jogador } = useAuth()
  const [m, setM] = useState(null)
  const [erro, setErro] = useState(false)
  const requisicaoAtual = useRef(0)
  const [promovendo, setPromovendo] = useState(null)
  const [seek, setSeek] = useState(null)
  const [roundAtual, setRoundAtual] = useState(null) // round na tela do Replay 2D
  const [detalheAberto, setDetalheAberto] = useState(null) // jogador do modal "round a round"
  // Filtro T/CT dentro da Partida (estilo scope.gg/Leetify): recalcula K/D/A/ADR/
  // Rating/KAST só nos rounds daquele lado. 'all' usa o que já vem em m.players
  // (nenhum fetch extra); T/CT busca /lado/:filtro e sobrescreve por steamId.
  const [ladoFiltro, setLadoFiltro] = useState('all')
  const [statsLado, setStatsLado] = useState(null)
  // Clipe de vídeo real do Allstar (ADR-0004, teste restrito) — por JOGADOR, não mais
  // por highlight (só POTG/BP habilitados na nossa conta, e nenhum mira um round
  // específico; BP mira o jogador, então virou "gerar o melhor clipe da partida pra
  // esse jogador" — ver allstarClip.js e a aba Clipes abaixo).
  const [jogadorClipeSelecionado, setJogadorClipeSelecionado] = useState(null) // steamId em foco na aba Clipes
  const [clipeAbertoId, setClipeAbertoId] = useState(null) // steamId cujo player está expandido
  const [pedindoClipeJogador, setPedindoClipeJogador] = useState(null) // steamId com pedido em voo
  const [erroClipeJogador, setErroClipeJogador] = useState(null)
  // Atalho "Enviar pra competição →" na aba Clipes: só aparece quando existe uma
  // competição ativa e a partida caiu dentro do período dela (ver JSX da aba Clipes).
  const [competicaoAtiva, setCompeticaoAtiva] = useState(null)
  const [seletorCompeticaoAberto, setSeletorCompeticaoAberto] = useState(false)

  // SOB DEMANDA: só chama o Allstar quando o jogador clica — nada automático. Qualquer
  // Jogador pode gerar o PRÓPRIO clipe; gerar o de outro é restrito ao dono do sistema
  // do lado do servidor — 403 pra quem não pode vira mensagem de erro aqui.
  async function pedirClipeAllstar(steamId) {
    setPedindoClipeJogador(steamId)
    setErroClipeJogador(null)
    try {
      const res = await fetch(`/api/matches/${id}/jogador/${steamId}/clipe`, { method: 'POST' })
      const corpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErroClipeJogador(corpo.erro || 'Falha ao pedir o clipe')
        return
      }
      setM((atual) => atual && ({
        ...atual,
        players: atual.players.map((p) => (
          p.steamId === steamId ? { ...p, allstarClip: { ...(p.allstarClip ?? {}), status: corpo.status } } : p
        )),
      }))
    } catch {
      setErroClipeJogador('Falha ao pedir o clipe')
    } finally {
      setPedindoClipeJogador(null)
    }
  }
  const replayRef = useRef(null)
  const autoJumpFeito = useRef(false)

  // Usado pela faixa de Rounds, pelos Highlights (clicar num "ACE round 5") e pelo Mapa de
  // calor (clicar num ponto de morte/kill) — todos só precisam saber round + frame.
  function irParaMomento(round, frame) {
    setSeek({ round, frame, key: `${round}-${frame}-${Date.now()}` })
  }

  function irParaHighlight(h) {
    if (h.frame == null) return
    irParaMomento(h.roundNumber, h.frame)
  }

  function carregar() {
    // Reseta o erro a cada tentativa: um refetch falho (ex.: rede oscilou ao anexar
    // clipe) não pode transformar uma partida já carregada em "não encontrada".
    // 404 é "não existe"; 5xx e rede caída são "tente de novo" (antes tudo virava 404).
    // Só a requisição mais nova vale: trocar de :id (ou recarregar) com outra em voo não
    // deixa a resposta antiga sobrescrever a Partida da tela.
    const minha = ++requisicaoAtual.current
    const valer = (fn) => (...args) => { if (requisicaoAtual.current === minha) fn(...args) }
    setErro(false)
    fetch(`/api/matches/${id}`)
      .then((res) => {
        if (res.status === 404) return valer(setErro)('nao-encontrada')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json().then(valer(setM))
      })
      .catch(valer(() => setErro('falha')))
  }

  async function promover(steamId) {
    setPromovendo(steamId)
    try {
      await fetch('/api/players/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamId }),
      })
      carregar()
    } finally {
      setPromovendo(null)
    }
  }

  useEffect(() => {
    setM(null) // troca de :id via navegação client-side não deve mostrar a partida antiga
    autoJumpFeito.current = false
    setLadoFiltro('all')
    setStatsLado(null)
    setClipeAbertoId(null)
    setJogadorClipeSelecionado(null)
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Busca uma vez (independe da partida) só pra saber se há competição ativa e qual o
  // período dela — decide se o atalho "Enviar pra competição →" aparece na aba Clipes.
  useEffect(() => {
    fetch('/api/competicoes')
      .then((res) => (res.ok ? res.json() : { ativa: null }))
      .then((d) => setCompeticaoAtiva(d.ativa))
      .catch(() => setCompeticaoAtiva(null))
  }, [])

  useEffect(() => {
    if (ladoFiltro === 'all') { setStatsLado(null); return }
    let vivo = true
    setStatsLado(null)
    fetch(`/api/matches/${id}/lado/${ladoFiltro}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((lista) => { if (vivo) setStatsLado(new Map(lista.map((p) => [p.steamId, p]))) })
      .catch(() => { if (vivo) setStatsLado(new Map()) })
    return () => { vivo = false }
  }, [id, ladoFiltro])

  // Veio de "?highlight=<id>" (link do Perfil do Jogador: "em qual partida foi esse
  // clutch mesmo?") — assim que a partida carregar, pula sozinho pro momento certo.
  useEffect(() => {
    const highlightId = searchParams.get('highlight')
    if (!m || !highlightId || autoJumpFeito.current) return
    const h = m.highlights.find((x) => x.id === highlightId)
    if (h) {
      autoJumpFeito.current = true
      irParaHighlight(h)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m])

  // Veio de "?round=<n>&tick=<t>[&frame=<f>]" (Granadas: "Ver no Replay 2D") — abre o
  // Replay 2D no round e no frame da granada (o viewer recua uns segundos pra mostrar o
  // arremesso). Sem frame (Demo antiga), cai no começo do round.
  useEffect(() => {
    const round = Number.parseInt(searchParams.get('round') ?? '', 10)
    if (!m || !Number.isFinite(round) || autoJumpFeito.current || searchParams.get('highlight')) return
    autoJumpFeito.current = true
    const frame = Number.parseInt(searchParams.get('frame') ?? '', 10)
    irParaMomento(round, Number.isFinite(frame) && frame >= 0 ? frame : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m])

  // Todo pulo pra um momento rola a página até o Replay 2D.
  useEffect(() => {
    if (seek) replayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [seek?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (erro === 'nao-encontrada' && !m) {
    return (
      <EstadoVazio
        titulo="Partida não encontrada."
        acao={<Button as={Link} to="/" variante="secundario">← Partidas</Button>}
      />
    )
  }
  if (erro === 'falha' && !m) {
    return (
      <EstadoErro
        mensagem="Não deu para carregar a Partida. Confira a conexão e tente de novo."
        acao={<Button variante="secundario" tamanho="sm" onClick={carregar}>Tentar de novo</Button>}
      />
    )
  }
  if (!m) return <SkeletonPartida />

  // Aplica o filtro de lado (se ativo e já carregado) por cima dos dados base da
  // Partida — mantém nick/avatar/weapons/isTracked/premier (só o /lado/:filtro não
  // tem) e sobrescreve K/D/A/ADR/HS%/KAST/rating/roundsPlayed com o recalculado.
  const jogadoresExibidos =
    ladoFiltro === 'all' || !statsLado
      ? m.players
      : m.players.map((p) => (statsLado.has(p.steamId) ? { ...p, ...statsLado.get(p.steamId) } : p))
  const carregandoLado = ladoFiltro !== 'all' && !statsLado
  // Partida ainda não reprocessada depois do FIL-51b não tem side_a — o filtro T/CT
  // devolve roundsPlayed=0 pra todo mundo (não é bug, é dado que não existe ainda).
  const semDadoDeLado =
    ladoFiltro !== 'all' && statsLado && jogadoresExibidos.length > 0 && jogadoresExibidos.every((p) => !p.roundsPlayed)

  const timeA = jogadoresExibidos.filter((p) => p.team === 'A')
  const timeB = jogadoresExibidos.filter((p) => p.team === 'B')

  // Resultado do ponto de vista do grupo (Jogadores whitelistados na partida). won é
  // nullable (empate — placar igual — não tem vencedor); `!p.won` sozinho trataria
  // empate como derrota, por isso os 3 estados são checados explicitamente.
  const doGrupo = m.players.filter((p) => p.isTracked)
  // Time predominante do grupo nessa partida (pra colorir a linha do tempo de rounds).
  // null se não tem ninguém do grupo ou o grupo se dividiu igual nos dois times.
  const contagemTimes = doGrupo.reduce((acc, p) => ({ ...acc, [p.team]: (acc[p.team] ?? 0) + 1 }), {})
  const timeDoGrupo =
    (contagemTimes.A ?? 0) > (contagemTimes.B ?? 0) ? 'A' : (contagemTimes.B ?? 0) > (contagemTimes.A ?? 0) ? 'B' : null
  const resultadoGrupo =
    doGrupo.length === 0
      ? null
      : doGrupo.every((p) => p.won === true)
        ? 'vitoria'
        : doGrupo.every((p) => p.won === false)
          ? 'derrota'
          : doGrupo.every((p) => p.won === null)
            ? 'empate'
            : 'misto'
  const placar = orientarPlacar(m.scoreA, m.scoreB, resultadoGrupo)
  const rodadaAtual = m.rounds?.find((r) => r.roundNumber === roundAtual) ?? null
  const avisoLado = semDadoDeLado
    ? 'Essa Partida ainda não tem o dado de lado. Precisa reprocessar a Demo.'
    : ladoFiltro !== 'all'
      ? 'Filtro de lado ativo: K, D, A, ADR, HS%, KAST e Rating contam só os rounds desse lado. Fogo amigo, 3K/4K/5K e Pontos continuam da Partida inteira.'
      : null

  return (
    <div className="space-y-6">
      <HeroPartida m={m} resultadoGrupo={resultadoGrupo} timeDoGrupo={timeDoGrupo} />

      {/* 12x12 é empate normal do Competitivo (MR12 sem overtime), não abandono. */}
      {m.endedEarly && !(m.scoreA === 12 && m.scoreB === 12) && (
        <EstadoErro
          mensagem={
            <>
              Partida encerrada antes do fim — nenhum time chegou a 13 rounds, então isso não foi uma vitória normal.
              {m.abandonedBy
                ? ` Provável motivo: ${m.abandonedBy.nick || m.abandonedBy.steamId} desconectou e não voltou.`
                : ' Provavelmente por desistência/desconexão de algum jogador (não deu pra identificar quem com certeza).'}
            </>
          }
        />
      )}

      <Espelho
        matchId={m.id}
        timeA={timeA}
        timeB={timeB}
        timeDoGrupo={timeDoGrupo}
        jogadorLogado={jogador}
        lado={ladoFiltro}
        onLado={setLadoFiltro}
        carregandoLado={carregandoLado}
        avisoLado={avisoLado}
        podePromover={jogador?.isSuperAdmin}
        onPromover={promover}
        promovendo={promovendo}
        onDetalhe={setDetalheAberto}
      />

      {m.rounds?.length > 0 && (
        <section className="space-y-3">
          <SectionHeader titulo="Rounds" margem="nenhuma" />
          <FaixaRounds
            rounds={m.rounds}
            economia={m.economia}
            highlights={m.highlights}
            timeDoGrupo={timeDoGrupo}
            selecionado={m.replayUrl ? roundAtual : null}
            onSelecionar={(rn) => irParaMomento(rn, 0)}
            clicavel={Boolean(m.replayUrl)}
          />
          {m.highlights.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rotulo mr-1">Highlights</span>
              {m.highlights.map((h) => {
                const podeAssistir = h.frame != null && m.replayUrl
                const conteudo = (
                  <>
                    <span className="font-semibold text-texto">{rotuloHighlight(h.kind)}</span>{' '}
                    <span className="text-texto">{h.nick || h.steamId}</span>{' '}
                    <span className="text-texto-fraco">r{h.roundNumber}</span>
                  </>
                )
                return podeAssistir ? (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => irParaHighlight(h)}
                    title="Assistir no Replay 2D"
                    className="rounded-[var(--radius-pequeno)] border border-borda bg-superficie px-2 py-1 font-mono text-xs transition-colors hover:border-borda-forte hover:bg-superficie-alta"
                  >
                    {conteudo}
                  </button>
                ) : (
                  <span key={h.id} className="rounded-[var(--radius-pequeno)] border border-borda bg-superficie px-2 py-1 font-mono text-xs">
                    {conteudo}
                  </span>
                )
              })}
            </div>
          )}
        </section>
      )}

      <SecaoLicoes
        matchId={m.id}
        jogadores={m.players}
        jogadorLogado={jogador}
        temDemo={m.temDemo}
        onVerRound={m.replayUrl ? (rn) => irParaMomento(rn, 0) : null}
        semReplay={!m.replayUrl}
      />

      <section ref={replayRef} className="scroll-mt-20 space-y-3">
        <SectionHeader titulo="Replay 2D" margem="nenhuma" />
        <SecaoReplay
          replayUrl={m.replayUrl}
          seek={seek}
          matchId={m.id}
          onSelecionarPonto={({ round, frame }) => irParaMomento(round, frame)}
          onRoundChange={setRoundAtual}
          painelExtra={() => (
            <PainelRound matchId={m.id} map={m.map} rodada={rodadaAtual} highlights={m.highlights} onHighlight={irParaHighlight} />
          )}
        />
      </section>

      <section aria-label="Clipes" className="space-y-3">
        <SectionHeader titulo="Clipes" margem="nenhuma" />
        <div className="space-y-6">
          <div>
            <SectionHeader titulo="Clipe do jogo (Allstar, escolhe a melhor jogada)" margem="pequena" />
            <p className="mb-3 text-sm text-texto-fraco">
              A Allstar escolhe sozinha o melhor momento do jogador na partida inteira — não dá
              pra escolher um round específico. Selecione um jogador:
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-2">
                {timeA.map((p) => (
                  <BotaoJogadorClipe
                    key={p.steamId} p={p}
                    selecionado={jogadorClipeSelecionado === p.steamId}
                    onClick={() => setJogadorClipeSelecionado(p.steamId)}
                  />
                ))}
              </div>
              <span className="font-mono text-xs text-texto-fraco">vs</span>
              <div className="flex flex-wrap gap-2">
                {timeB.map((p) => (
                  <BotaoJogadorClipe
                    key={p.steamId} p={p}
                    selecionado={jogadorClipeSelecionado === p.steamId}
                    onClick={() => setJogadorClipeSelecionado(p.steamId)}
                  />
                ))}
              </div>
            </div>

            {(() => {
              const jogadorSel = m.players.find((p) => p.steamId === jogadorClipeSelecionado)
              if (!jogadorSel) return null
              return (
                <PainelClipeJogador
                  jogador={jogadorSel}
                  clip={jogadorSel.allstarClip}
                  pedindo={pedindoClipeJogador === jogadorSel.steamId}
                  erro={jogadorClipeSelecionado === jogadorSel.steamId ? erroClipeJogador : null}
                  aberto={clipeAbertoId === jogadorSel.steamId}
                  onAbrir={() => setClipeAbertoId(clipeAbertoId === jogadorSel.steamId ? null : jogadorSel.steamId)}
                  onGerar={() => pedirClipeAllstar(jogadorSel.steamId)}
                  viewerSteamId={jogador?.steamId}
                  m={m}
                  placar={placar}
                  // Atalho "Enviar pra competição →": só quando existe competição ativa e
                  // essa partida caiu dentro do período dela (mesma checagem que o servidor
                  // faz em GET /api/competicoes/:id/elegiveis — aqui é só pra decidir se o
                  // botão aparece).
                  podeEnviarCompeticao={Boolean(
                    competicaoAtiva && m.playedAt &&
                    new Date(m.playedAt) >= new Date(competicaoAtiva.dataInicio) &&
                    new Date(m.playedAt) <= new Date(competicaoAtiva.dataFim),
                  )}
                  onAbrirSeletorCompeticao={() => setSeletorCompeticaoAberto(true)}
                />
              )
            })()}
          </div>

          <SecaoClipeReal
            matchId={m.id}
            jogadores={m.players}
            viewerSteamId={jogador?.steamId}
            partida={m}
            onDemoEnviada={carregar}
          />

          <div>
            <div className="mb-3 space-y-2">
              {m.clips.length === 0 && (
                <EstadoVazio titulo="Nenhum clipe anexado ainda." descricao="Cole abaixo um link do Allstar, Medal ou YouTube." />
              )}
              {m.clips.map((c) => (
                <a
                  key={c.id}
                  href={hrefSeguro(c.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="panel-cut-sm flex items-center gap-3 border border-borda bg-superficie p-3 font-mono text-sm transition-colors hover:border-destaque/60"
                >
                  <span className="panel-cut-sm flex-shrink-0 bg-fundo px-2 py-1 text-xs text-destaque">{c.provider}</span>
                  <span className="min-w-0 flex-1 truncate text-texto">{c.title || c.url}</span>
                </a>
              ))}
            </div>
            <FormClipe matchId={m.id} jogadores={m.players} onAdicionado={carregar} />
          </div>
        </div>
      </section>

      {detalheAberto && (
        <ModalDetalhePartida matchId={m.id} jogador={detalheAberto} onFechar={() => setDetalheAberto(null)} />
      )}
      {seletorCompeticaoAberto && competicaoAtiva && (
        <SeletorClipesCompeticao
          competicaoId={competicaoAtiva.id}
          onFechar={() => setSeletorCompeticaoAberto(false)}
          onEnviado={() => setSeletorCompeticaoAberto(false)}
        />
      )}
    </div>
  )
}
