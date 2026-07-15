import { useState } from 'react'
import { linkBuscaYoutube } from '../../lib/youtube.js'
import { nomeMapa } from '../../lib/format.js'
import { Card, Select } from '../ui'

const TIPOS = [['smoke', 'Smoke'], ['flash', 'Flash'], ['molotov', 'Molotov'], ['he', 'HE']]
const TECNICAS = [
  ['normal', 'Normal (parado)'], ['jumpthrow', 'Lançar com salto'], ['walkthrow', 'Andando'],
  ['runthrow', 'Correndo'], ['run_jumpthrow', 'Correr + saltar'],
]
const BOTOES = [['esquerdo', 'Esquerdo'], ['direito', 'Direito'], ['esquerdo_direito', 'Os dois']]

export default function FormGranada({ mapa, lado, posicoes, inicial = null, onSalvo, onCancelar }) {
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '')
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '')
  const [videoUrl, setVideoUrl] = useState(inicial?.videoUrl ?? '')
  const [tipo, setTipo] = useState(inicial?.tipo ?? 'smoke')
  const [tecnica, setTecnica] = useState(inicial?.tecnica ?? 'normal')
  const [botao, setBotao] = useState(inicial?.botao ?? 'esquerdo')
  const [passosTexto, setPassosTexto] = useState((inicial?.passos ?? []).join('\n'))
  const [erro, setErro] = useState(null)
  const [salvando, setSalvando] = useState(false)

  async function salvar(e) {
    e.preventDefault()
    setErro(null)
    setSalvando(true)
    const corpo = {
      map: mapa, lado, tipo, titulo, descricao, videoUrl, tecnica, botao,
      passos: passosTexto.split('\n').map((p) => p.trim()).filter(Boolean),
      arremessoX: posicoes.arremesso.x, arremessoY: posicoes.arremesso.y,
      alvoX: posicoes.alvo.x, alvoY: posicoes.alvo.y,
    }
    const res = await fetch(inicial ? `/api/granadas/${inicial.id}` : '/api/granadas', {
      method: inicial ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    }).catch(() => null)
    setSalvando(false)
    if (res?.ok) return onSalvo()
    const body = await res?.json().catch(() => ({}))
    setErro(body?.erro ?? 'Erro ao salvar.')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fundo/80 p-0 lg:p-4" onClick={onCancelar}>
      {/* Mobile: form ocupa a tela inteira, então o backdrop clicável some;
          esse X fixo é o único jeito de fechar sem rolar até o fim. Desktop
          continua fechando pelo clique fora ou pelo botão Cancelar de sempre. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCancelar() }}
        aria-label="Fechar"
        className="panel-cut-sm fixed right-3 top-3 z-[60] flex min-h-10 min-w-10 items-center justify-center border border-borda bg-superficie font-mono text-sm text-texto-fraco hover:text-texto lg:hidden"
      >✕</button>
      <Card
        corte={false}
        as="form"
        onSubmit={salvar}
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full space-y-3 overflow-y-auto p-5 lg:panel-cut lg:h-auto lg:max-h-[90vh] lg:w-full lg:max-w-lg"
      >
        <h3 className="font-display text-lg font-bold uppercase text-texto">
          {inicial ? 'Editar granada' : 'Nova granada'} — {lado}
        </h3>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título (ex.: Smoke janela da base)"
          className="panel-cut-sm min-h-10 w-full border border-borda bg-fundo px-3 py-2 font-mono text-sm lg:min-h-0" />
        <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição (opcional)" rows={2}
          className="panel-cut-sm w-full border border-borda bg-fundo px-3 py-2 font-mono text-sm" />
        <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="Link do YouTube (opcional)"
          className="panel-cut-sm min-h-10 w-full border border-borda bg-fundo px-3 py-2 font-mono text-sm lg:min-h-0" />
        <a
          href={linkBuscaYoutube(`${nomeMapa(mapa)} ${tipo} ${titulo}`)}
          target="_blank"
          rel="noreferrer"
          className="inline-block font-mono text-xs uppercase text-destaque hover:brightness-125"
        >
          Buscar vídeo no YouTube
        </a>
        <div className="grid grid-cols-3 gap-2">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-full" selectClassName="px-2 pl-2 pr-7 text-xs">
            {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select value={tecnica} onChange={(e) => setTecnica(e.target.value)} className="w-full" selectClassName="px-2 pl-2 pr-7 text-xs">
            {TECNICAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select value={botao} onChange={(e) => setBotao(e.target.value)} className="w-full" selectClassName="px-2 pl-2 pr-7 text-xs">
            {BOTOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
        <textarea value={passosTexto} onChange={(e) => setPassosTexto(e.target.value)} rows={4}
          placeholder={'Passos, um por linha:\nFique colado na quina da caixa\nMire no pixel acima da antena\nJumpthrow'}
          className="panel-cut-sm w-full border border-borda bg-fundo px-3 py-2 font-mono text-sm" />
        {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancelar} className="min-h-10 px-4 py-2 font-mono text-xs uppercase text-texto-fraco hover:text-texto lg:min-h-0">Cancelar</button>
          <button type="submit" disabled={salvando}
            className="panel-cut-sm min-h-10 border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase text-fundo disabled:opacity-50 lg:min-h-0">
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </Card>
    </div>
  )
}
