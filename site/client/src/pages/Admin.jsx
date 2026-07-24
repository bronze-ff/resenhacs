import { useEffect, useState } from 'react'
import { Card, SectionHeader } from '../components/ui'
import FormCompeticao from '../components/FormCompeticao.jsx'

// Pedaços de 100 MiB: um PUT único do arquivo inteiro estoura a memória da aba (um vídeo de
// 2 GB matava o processo do Chrome com STATUS_BREAKPOINT).
const TAMANHO_PARTE = 100 * 1024 * 1024
const TENTATIVAS_POR_PARTE = 3

async function enviarParte(url, pedaco) {
  for (let tentativa = 1; tentativa <= TENTATIVAS_POR_PARTE; tentativa++) {
    try {
      const res = await fetch(url, { method: 'PUT', body: pedaco })
      if (res.ok) return
    } catch {
      // rede caiu no meio da parte — cai no retry abaixo
    }
    if (tentativa === TENTATIVAS_POR_PARTE) throw new Error('parte falhou após as tentativas')
  }
}

function rotuloUpload(status, disponivel) {
  if (status?.estado === 'enviando') {
    const pct = status.total ? Math.round((status.atual / status.total) * 100) : 0
    return `Parte ${status.atual}/${status.total} — ${pct}%`
  }
  if (status?.estado === 'ok') return 'Enviado ✓'
  if (status?.estado === 'erro') return 'Erro, tentar de novo'
  return disponivel ? 'Enviado ✓ — trocar' : 'Escolher arquivo'
}

export default function Admin() {
  const [steamId, setSteamId] = useState('')
  const [mensagem, setMensagem] = useState(null)
  const [taticasPendentes, setTaticasPendentes] = useState(null)
  const [statusUpload, setStatusUpload] = useState({})
  const [videosCurso, setVideosCurso] = useState(null)
  const [competicoes, setCompeticoes] = useState(null)
  const [formCompeticaoAberto, setFormCompeticaoAberto] = useState(false)
  const [competicaoEditando, setCompeticaoEditando] = useState(null)

  function carregarCompeticoes() {
    fetch('/api/competicoes')
      .then((r) => r.json())
      // Achado do review final: sem `agendadas`, uma competicao criada pro futuro
      // sumia da tela do admin assim que ele fechava o formulario - inclusive pra ele
      // mesmo editar ou confirmar o que acabou de criar.
      .then((d) => setCompeticoes([d.ativa, ...d.agendadas, ...d.encerradas].filter(Boolean)))
      .catch(() => setCompeticoes([]))
  }

  async function confirmarVencedor(id) {
    const res = await fetch(`/api/competicoes/${id}/confirmar-vencedor`, { method: 'PUT' })
    if (res.ok) carregarCompeticoes()
  }

  async function enviarVideoCurso(slug, arquivo) {
    const partes = Math.ceil(arquivo.size / TAMANHO_PARTE)
    setStatusUpload((s) => ({ ...s, [slug]: { estado: 'enviando', atual: 0, total: partes } }))
    let uploadId = null
    try {
      const resIniciar = await fetch('/api/curso/upload/iniciar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, partes }),
      })
      if (!resIniciar.ok) throw new Error('iniciar falhou')
      const { uploadId: id, urls } = await resIniciar.json()
      uploadId = id

      for (let i = 0; i < partes; i++) {
        await enviarParte(urls[i], arquivo.slice(i * TAMANHO_PARTE, (i + 1) * TAMANHO_PARTE))
        setStatusUpload((s) => ({ ...s, [slug]: { estado: 'enviando', atual: i + 1, total: partes } }))
      }

      const resConcluir = await fetch('/api/curso/upload/concluir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, uploadId }),
      })
      if (!resConcluir.ok) throw new Error('concluir falhou')
      setStatusUpload((s) => ({ ...s, [slug]: { estado: 'ok' } }))
      setVideosCurso((atual) => atual?.map((v) => (v.slug === slug ? { ...v, disponivel: true } : v)))
    } catch {
      if (uploadId) {
        await fetch('/api/curso/upload/abortar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, uploadId }),
        }).catch(() => {})
      }
      setStatusUpload((s) => ({ ...s, [slug]: { estado: 'erro' } }))
    }
  }

  async function adicionar(e) {
    e.preventDefault()
    const res = await fetch('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steamId }),
    })
    if (res.ok) {
      setMensagem('Jogador adicionado à whitelist.')
      setSteamId('')
    } else {
      const body = await res.json().catch(() => ({}))
      setMensagem(body.erro ?? 'Erro ao adicionar.')
    }
  }

  useEffect(() => {
    fetch('/api/taticas?status=sugerida')
      .then((r) => r.json())
      .then(setTaticasPendentes)
      .catch(() => setTaticasPendentes([]))
    fetch('/api/curso')
      .then((r) => r.json())
      .then(setVideosCurso)
      .catch(() => setVideosCurso([]))
    carregarCompeticoes()
  }, [])

  async function revisar(id, status) {
    const res = await fetch(`/api/taticas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setTaticasPendentes((atual) => atual.filter((t) => t.id !== id))
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <SectionHeader titulo="Admin" subtitulo="Controle de acesso, conteúdo do curso e competições do grupo." />
      <Card className="p-4 sm:p-5">
      <form onSubmit={adicionar} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="steamId">
          SteamID64 do novo Jogador (17 dígitos)
        </label>
        <input
          id="steamId"
          value={steamId}
          onChange={(e) => setSteamId(e.target.value)}
          className="panel-cut-sm mt-1 min-h-10 w-full border border-borda bg-fundo px-3 py-2 font-mono text-sm lg:min-h-0"
          placeholder="76561198…"
        />
        <button
          type="submit"
          className="panel-cut-sm min-h-10 border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo transition-colors duration-200 hover:bg-destaque/85 lg:min-h-0"
        >
          Adicionar à whitelist
        </button>
      </form>
      </Card>
      {mensagem && <p className="font-mono text-sm text-texto-fraco">{mensagem}</p>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.9fr)]">
      <div className="space-y-3">
        <SectionHeader titulo="Curso de mira" subtitulo="Biblioteca de vídeos do grupo" />
        <div className="overflow-hidden border border-borda bg-superficie">
          {videosCurso?.map((v, index) => (
            <div key={v.slug} className={`flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between ${index > 0 ? 'border-t border-borda' : ''}`}>
              <div className="min-w-0">
                <p className="truncate font-display text-base font-semibold uppercase text-texto">{v.titulo}</p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-texto-fraco/70">{v.slug}.mp4</p>
              </div>
              <label className={`panel-cut-sm flex min-h-10 shrink-0 cursor-pointer items-center justify-center border px-3 py-1 font-mono text-xs uppercase tracking-wide transition-colors duration-200 lg:min-h-0 ${statusUpload[v.slug]?.estado === 'erro' ? 'border-perigo text-perigo' : v.disponivel ? 'border-sucesso/50 text-sucesso hover:border-destaque hover:text-destaque' : 'border-borda text-texto-fraco hover:border-destaque/50 hover:text-destaque'}`}>
                {rotuloUpload(statusUpload[v.slug], v.disponivel)}
                <input
                  type="file"
                  accept="video/mp4"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) enviarVideoCurso(v.slug, f)
                  }}
                />
              </label>
            </div>
          ))}
          {videosCurso?.length === 0 && <p className="p-4 font-mono text-sm text-texto-fraco">Nenhum vídeo cadastrado.</p>}
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeader titulo="Táticas pendentes" subtitulo="Fila de revisão" />
        {taticasPendentes?.length === 0 && (
          <p className="font-mono text-sm text-texto-fraco">Nenhuma tática aguardando revisão.</p>
        )}
        {taticasPendentes?.map((t) => (
          <Card key={t.id} className="space-y-3 p-4">
            <p className="font-display text-sm font-semibold uppercase text-texto">{t.nome}</p>
            <p className="font-mono text-xs text-texto-fraco">{t.descricao}</p>
            <p className="font-mono text-[10px] uppercase text-texto-fraco/70">sugerida por {t.criadoPorNick || t.criadoPor}</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => revisar(t.id, 'aprovada')}
                className="panel-cut-sm min-h-10 border border-sucesso px-3 py-1 font-mono text-xs uppercase tracking-wide text-sucesso lg:min-h-0"
              >
                Aprovar
              </button>
              <button
                onClick={() => revisar(t.id, 'rejeitada')}
                className="panel-cut-sm min-h-10 border border-perigo px-3 py-1 font-mono text-xs uppercase tracking-wide text-perigo lg:min-h-0"
              >
                Rejeitar
              </button>
            </div>
          </Card>
        ))}
      </div>
      </div>

      <div className="space-y-3">
        <SectionHeader
          titulo="Competições"
          subtitulo="Crie, acompanhe e confirme os resultados."
          acao={<button
            onClick={() => { setCompeticaoEditando(null); setFormCompeticaoAberto(true) }}
            className="panel-cut-sm min-h-10 border border-destaque px-3 font-mono text-xs uppercase text-destaque transition-colors duration-200 hover:bg-destaque/10 lg:min-h-0"
          >
            Nova competição
          </button>}
        />
        {competicoes?.length === 0 && (
          <p className="font-mono text-sm text-texto-fraco">Nenhuma competição cadastrada.</p>
        )}
        {competicoes?.map((c) => {
          const vencedorNick = c.leaderboard?.find((l) => l.steamId === c.vencedorSteamId)?.nick
          return (
            <Card key={c.id} className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-sm font-semibold uppercase text-texto">{c.nome}</p>
                  <p className="font-mono text-[10px] uppercase text-texto-fraco/70">
                    {new Date(c.dataInicio).toLocaleDateString('pt-BR')} – {new Date(c.dataFim).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <button
                  onClick={() => { setCompeticaoEditando(c); setFormCompeticaoAberto(true) }}
                  className="panel-cut-sm min-h-10 shrink-0 border border-borda px-3 py-1 font-mono text-xs uppercase tracking-wide text-texto-fraco hover:border-destaque/50 hover:text-destaque lg:min-h-0"
                >
                  Editar
                </button>
              </div>
              {c.vencedorSteamId && !c.vencedorConfirmado && (
                <div className="panel-cut-sm border border-destaque bg-destaque/10 p-3">
                  <p className="font-mono text-sm text-destaque">
                    Vencedor: {vencedorNick ?? c.vencedorSteamId} — confira os clipes antes de confirmar.
                  </p>
                  <div className="mt-2 space-y-1">
                    {c.vencedorSubmissoes?.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 font-mono text-xs text-texto-fraco">
                        <a href={s.clipUrl} target="_blank" rel="noreferrer" className="truncate hover:text-destaque">
                          clipe · {s.pontuacao.total} pts
                        </a>
                        {s.origemNaoVerificada && (
                          <span className="shrink-0 text-perigo">
                            ⚠️ upload manual{s.plataformaManual ? ` — ${s.plataformaManual}` : ''} — data não verificada
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => confirmarVencedor(c.id)}
                    className="panel-cut-sm mt-2 min-h-10 border border-destaque px-3 font-mono text-xs uppercase text-destaque lg:min-h-0"
                  >
                    Confirmar vencedor
                  </button>
                </div>
              )}
            </Card>
          )
        })}
        {formCompeticaoAberto && (
          <FormCompeticao
            inicial={competicaoEditando}
            onSalvo={() => { setFormCompeticaoAberto(false); carregarCompeticoes() }}
            onCancelar={() => setFormCompeticaoAberto(false)}
          />
        )}
      </div>
    </div>
  )
}
