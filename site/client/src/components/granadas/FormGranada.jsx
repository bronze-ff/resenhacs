import { useState } from 'react'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fundo/80 p-4" onClick={onCancelar}>
      <form
        onSubmit={salvar}
        onClick={(e) => e.stopPropagation()}
        className="panel-cut max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto border border-borda bg-superficie p-5"
      >
        <h3 className="font-display text-lg font-bold uppercase text-texto">
          {inicial ? 'Editar granada' : 'Nova granada'} — {lado}
        </h3>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título (ex.: Smoke janela da base)"
          className="w-full rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm" />
        <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição (opcional)" rows={2}
          className="w-full rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm" />
        <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="Link do YouTube (opcional)"
          className="w-full rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm" />
        <div className="grid grid-cols-3 gap-2">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded border border-borda bg-fundo px-2 py-1.5 font-mono text-xs">
            {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={tecnica} onChange={(e) => setTecnica(e.target.value)} className="rounded border border-borda bg-fundo px-2 py-1.5 font-mono text-xs">
            {TECNICAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={botao} onChange={(e) => setBotao(e.target.value)} className="rounded border border-borda bg-fundo px-2 py-1.5 font-mono text-xs">
            {BOTOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <textarea value={passosTexto} onChange={(e) => setPassosTexto(e.target.value)} rows={4}
          placeholder={'Passos, um por linha:\nFique colado na quina da caixa\nMire no pixel acima da antena\nJumpthrow'}
          className="w-full rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm" />
        {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancelar} className="px-4 py-2 font-mono text-xs uppercase text-texto-fraco hover:text-texto">Cancelar</button>
          <button type="submit" disabled={salvando}
            className="panel-cut-sm border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase text-fundo disabled:opacity-50">
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}
