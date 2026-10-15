import { useState, useCallback } from 'react'
import { Button, CabecalhoPagina, Card, Campo, EstadoErro, Input, Select } from '../components/ui'

function IconeUpload({ className = 'h-7 w-7' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </svg>
  )
}

function IconeArquivo({ className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </svg>
  )
}

function formatarTamanho(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const TOLERANCIA_DIAS = 3

// Plataformas sem integração oficial — rótulo informativo escolhido no upload, vira
// badge na Partida/Feed (matches.plataforma_manual). Lista fixa, igual à do servidor
// (PLATAFORMAS_MANUAIS em site/server/src/routes/upload.js).
const PLATAFORMAS = [
  { valor: '', label: 'Nenhuma / não sei' },
  { valor: 'faceit', label: 'FACEIT' },
  { valor: 'gamers_club', label: 'Gamers Club' },
  { valor: 'xplay_gg', label: 'XPLAY.GG' },
]

export default function EnviarDemo() {
  const [arquivo, setArquivo] = useState(null)
  const [shareCode, setShareCode] = useState('')
  const [playedAt, setPlayedAt] = useState('')
  const [plataforma, setPlataforma] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState(null)
  const [arrastando, setArrastando] = useState(false)

  function escolherArquivo(lista) {
    const f = lista?.[0]
    if (f && f.name.toLowerCase().endsWith('.dem')) setArquivo(f)
  }

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setArrastando(false)
    escolherArquivo(e.dataTransfer?.files)
  }, [])

  async function enviar(e) {
    e.preventDefault()
    if (!arquivo) return
    if (playedAt) {
      const dataInformada = new Date(playedAt)
      const agora = new Date()
      const limiteAntigo = new Date(agora.getTime() - TOLERANCIA_DIAS * 24 * 60 * 60 * 1000)
      if (dataInformada > agora || dataInformada < limiteAntigo) {
        setErro(`A data informada precisa estar entre ${TOLERANCIA_DIAS} dias atrás e agora.`)
        return
      }
    }
    setEnviando(true)
    setErro(null)
    setResultado(null)
    try {
      const resUrl = await fetch('/api/upload/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: arquivo.name, tamanho: arquivo.size, shareCode, playedAt, plataformaManual: plataforma }),
      })
      const bodyUrl = await resUrl.json().catch(() => ({}))
      if (!resUrl.ok) {
        setErro(bodyUrl.erro ?? 'Erro ao preparar o envio')
        return
      }
      const resPut = await fetch(bodyUrl.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: arquivo,
      })
      if (!resPut.ok) {
        setErro('Falha ao enviar o arquivo pro armazenamento')
        return
      }
      setResultado(true)
    } catch {
      setErro('Falha de rede ao enviar')
    } finally {
      setEnviando(false)
    }
  }

  const PASSOS = [
    { titulo: 'Envie o .dem', feito: true },
    { titulo: 'Fila de processamento', feito: resultado },
    { titulo: 'Parseado pelo Coletor (~30min)', feito: false },
    { titulo: 'Aparece no Feed', feito: false },
  ]

  return (
    <div className="max-w-5xl">
      <CabecalhoPagina
        eyebrow="Upload manual"
        titulo="Enviar demo"
        descricao="Baixe o .dem em CS2 → Assistir → Suas Partidas (ou do Faceit/GC) e envie aqui. O processamento roda a cada ~30 minutos — a Partida aparece no Feed quando terminar."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.48fr)]">
        <Card className="p-4 sm:p-6">
          <form onSubmit={enviar} className="flex flex-col gap-6">
            <label
              htmlFor="arquivo"
              onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
              onDragLeave={() => setArrastando(false)}
              onDrop={onDrop}
              className={`group flex min-h-56 cursor-pointer flex-col items-center justify-center gap-4 border-2 border-dashed px-4 py-10 text-center transition-colors duration-200 ${
                arrastando
                  ? 'border-destaque bg-destaque/10'
                  : arquivo
                    ? 'border-sucesso/50 bg-sucesso/5'
                    : 'border-borda-forte bg-fundo/40 hover:border-destaque/60 hover:bg-destaque/5'
              }`}
            >
              <span
                className={`panel-cut-sm flex h-14 w-14 items-center justify-center border transition-colors duration-200 ${
                  arquivo
                    ? 'border-sucesso/50 bg-sucesso/10 text-sucesso'
                    : arrastando
                      ? 'border-destaque bg-destaque/15 text-destaque'
                      : 'border-borda bg-superficie-alta text-texto-fraco group-hover:text-destaque'
                }`}
              >
                {arquivo ? <IconeArquivo /> : <IconeUpload />}
              </span>
              <span className="block w-full truncate px-2 text-center font-display text-lg font-semibold text-texto" title={arquivo?.name}>
                {arquivo ? arquivo.name : arrastando ? 'Solte pra anexar' : 'Arraste o .dem aqui ou clique pra escolher'}
              </span>
              {!arquivo && <span className="text-sm text-texto-fraco">Arquivos de demo do Counter-Strike 2</span>}
              {arquivo && (
                <span className="flex items-center gap-3 font-mono text-xs text-texto-fraco">
                  <span className="tabular-nums text-texto">{formatarTamanho(arquivo.size)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="underline-offset-2 group-hover:text-destaque group-hover:underline">Trocar arquivo</span>
                </span>
              )}
              <input
                id="arquivo"
                type="file"
                accept=".dem"
                onChange={(e) => escolherArquivo(e.target.files)}
                className="hidden"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id="shareCode"
                rotulo="Share code (opcional)"
                ajuda="Evita duplicar se descoberto automaticamente."
                value={shareCode}
                onChange={(e) => setShareCode(e.target.value)}
                placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
                className="font-mono"
              />
              <Input
                id="playedAt"
                type="datetime-local"
                rotulo="Quando foi jogada (opcional)"
                ajuda="Sem isso, a data pode sair aproximada."
                value={playedAt}
                onChange={(e) => setPlayedAt(e.target.value)}
                className="font-mono [color-scheme:dark]"
              />
            </div>
            <Campo rotulo="Onde foi jogada (opcional)" ajuda="Vira o badge da plataforma na Partida.">
              <div role="group" aria-label="Onde foi jogada">
                <Select value={plataforma} onChange={(e) => setPlataforma(e.target.value)}>
                  {PLATAFORMAS.map((p) => (
                    <option key={p.valor} value={p.valor}>{p.label}</option>
                  ))}
                </Select>
              </div>
            </Campo>

            {erro && <EstadoErro mensagem={erro} />}
            {resultado && (
              <div role="status" className="panel-cut-sm flex items-start gap-3 border border-sucesso/40 bg-sucesso/5 px-4 py-3 text-sm text-texto">
                <span aria-hidden="true" className="text-sucesso">✓</span>
                <span>Envio recebido! Processando em até 30 minutos — a Partida aparece no Feed quando terminar.</span>
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 border-t border-borda pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-texto-fraco">{arquivo ? 'Pronto pra enviar.' : 'Escolha um arquivo .dem pra liberar o envio.'}</p>
              <Button type="submit" variante="primario" tamanho="lg" carregando={enviando} disabled={!arquivo}>
                {enviando ? 'Enviando…' : 'Enviar'}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="h-fit p-5">
          <h3 className="font-display text-lg font-semibold text-texto">Rota da demo</h3>
          <p className="mt-1 text-sm leading-relaxed text-texto-fraco">Depois do envio, o Coletor processa o arquivo e entrega a partida pronta no seu feed.</p>
          <p className="rotulo mb-4 mt-5">Acompanhamento</p>
          <ol className="relative">
            {PASSOS.map((p, i) => (
              <li key={p.titulo} className="relative flex items-start gap-3 pb-4 last:pb-0">
                {i < PASSOS.length - 1 && (
                  <span className={`absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-px ${p.feito ? 'bg-destaque/60' : 'bg-borda'}`} aria-hidden="true" />
                )}
                <span
                  className={`relative flex h-6 w-6 shrink-0 items-center justify-center border font-mono text-[10px] font-bold ${
                    p.feito ? 'border-destaque bg-destaque/15 text-destaque' : 'border-borda bg-superficie text-texto-fraco'
                  }`}
                >
                  {p.feito ? '✓' : i + 1}
                </span>
                <span className={`pt-0.5 text-sm leading-snug ${p.feito ? 'text-texto' : 'text-texto-fraco'}`}>{p.titulo}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  )
}
