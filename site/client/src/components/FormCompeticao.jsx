// site/client/src/components/FormCompeticao.jsx
import { useState } from 'react'

// Mesmo padrão de modal já usado em granadas/FormGranada.jsx e
// SeletorClipesCompeticao.jsx — fixed inset-0 com backdrop clicável fechando o form.

const MERCADO_STEAM_PREFIXO = 'https://steamcommunity.com/market/'

export default function FormCompeticao({ inicial = null, onSalvo, onCancelar }) {
  const [nome, setNome] = useState(inicial?.nome ?? '')
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '')
  const [premioDescricao, setPremioDescricao] = useState(inicial?.premioDescricao ?? '')
  const [premioImagemUrl, setPremioImagemUrl] = useState(inicial?.premioImagemUrl ?? '')
  const [premioMercadoUrl, setPremioMercadoUrl] = useState(inicial?.premioMercadoUrl ?? '')
  const [imagemComErro, setImagemComErro] = useState(false)
  const [dataInicio, setDataInicio] = useState(inicial?.dataInicio?.slice(0, 16) ?? '')
  const [dataFim, setDataFim] = useState(inicial?.dataFim?.slice(0, 16) ?? '')
  const [limiteDiario, setLimiteDiario] = useState(inicial?.limiteDiario ?? 2)
  const [limiteTotal, setLimiteTotal] = useState(inicial?.limiteTotal ?? 10)
  const [minimoParaRankear, setMinimoParaRankear] = useState(inicial?.minimoParaRankear ?? 3)
  const [erro, setErro] = useState(null)
  const [salvando, setSalvando] = useState(false)

  async function salvar(e) {
    e.preventDefault()
    setErro(null)
    // Obrigatório só na criação: o PUT no servidor trata esses campos como opcionais
    // (coalesce pra update parcial) — editar só o nome de uma competição legada (com
    // esses campos null) não pode ser bloqueado por exigir link válido de novo.
    if (!inicial && (!premioImagemUrl.trim() || !premioMercadoUrl.trim())) {
      setErro('Link da imagem e link do mercado da Steam são obrigatórios.')
      return
    }
    if (premioMercadoUrl && !premioMercadoUrl.startsWith(MERCADO_STEAM_PREFIXO)) {
      setErro(`O link do mercado precisa começar com ${MERCADO_STEAM_PREFIXO}`)
      return
    }
    setSalvando(true)
    const corpo = {
      nome, descricao, premioDescricao, premioImagemUrl, premioMercadoUrl,
      // datetime-local pode vir vazio (campo ainda não preenchido) — new Date('').toISOString()
      // lança RangeError, então só convertemos quando há valor; o servidor valida o resto.
      dataInicio: dataInicio ? new Date(dataInicio).toISOString() : dataInicio,
      dataFim: dataFim ? new Date(dataFim).toISOString() : dataFim,
      limiteDiario: Number(limiteDiario), limiteTotal: Number(limiteTotal), minimoParaRankear: Number(minimoParaRankear),
    }
    const res = await fetch(inicial ? `/api/competicoes/admin/${inicial.id}` : '/api/competicoes/admin', {
      method: inicial ? 'PUT' : 'POST',
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
      {/* Mobile: form ocupa a tela inteira, backdrop clicável some; X fixo é o único
          jeito de fechar sem rolar até o fim. Desktop fecha pelo clique fora também. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCancelar() }}
        aria-label="Fechar"
        className="panel-cut-sm fixed right-3 top-3 z-[60] flex min-h-10 min-w-10 items-center justify-center border border-borda bg-superficie font-mono text-sm text-texto-fraco hover:text-texto lg:hidden"
      >✕</button>
      <form
        onSubmit={salvar}
        onClick={(e) => e.stopPropagation()}
        className="panel-cut h-full w-full space-y-3 overflow-y-auto border border-borda bg-superficie p-5 lg:h-auto lg:max-h-[90vh] lg:w-full lg:max-w-lg"
      >
        <h2 className="font-display text-lg font-bold text-texto">{inicial ? 'Editar' : 'Nova'} competição</h2>
        {erro && <p className="mt-2 font-mono text-xs text-perigo">{erro}</p>}
        <label className="mt-3 block font-mono text-xs text-texto-fraco">
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
        </label>
        <label className="mt-3 block font-mono text-xs text-texto-fraco">
          Descrição
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} className="mt-1 w-full border border-borda bg-fundo px-2 py-1 font-mono text-sm text-texto" />
        </label>
        <label className="mt-3 block font-mono text-xs text-texto-fraco">
          Prêmio
          <input value={premioDescricao} onChange={(e) => setPremioDescricao(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
        </label>
        <label className="mt-3 block font-mono text-xs text-texto-fraco">
          Link da imagem da skin
          <input
            type="url"
            value={premioImagemUrl}
            onChange={(e) => { setPremioImagemUrl(e.target.value); setImagemComErro(false) }}
            className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto"
          />
        </label>
        {premioImagemUrl && !imagemComErro && (
          <img
            src={premioImagemUrl}
            alt="Prévia da skin"
            className="mt-2 h-20 w-20 border border-borda object-cover"
            onError={() => setImagemComErro(true)}
          />
        )}
        {premioImagemUrl && imagemComErro && (
          <p className="mt-2 font-mono text-xs text-perigo">Não foi possível carregar essa imagem.</p>
        )}
        <label className="mt-3 block font-mono text-xs text-texto-fraco">
          Link no mercado da Steam
          <input
            type="url"
            value={premioMercadoUrl}
            onChange={(e) => setPremioMercadoUrl(e.target.value)}
            className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto"
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block font-mono text-xs text-texto-fraco">
            Início
            <input type="datetime-local" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
          </label>
          <label className="block font-mono text-xs text-texto-fraco">
            Fim
            <input type="datetime-local" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
          </label>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <label className="block font-mono text-xs text-texto-fraco">
            Limite/dia
            <input type="number" min="1" value={limiteDiario} onChange={(e) => setLimiteDiario(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
          </label>
          <label className="block font-mono text-xs text-texto-fraco">
            Limite total
            <input type="number" min="1" value={limiteTotal} onChange={(e) => setLimiteTotal(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
          </label>
          <label className="block font-mono text-xs text-texto-fraco">
            Mínimo p/ rankear
            <input type="number" min="1" value={minimoParaRankear} onChange={(e) => setMinimoParaRankear(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancelar} className="panel-cut-sm min-h-10 border border-borda px-3 font-mono text-xs uppercase text-texto-fraco">cancelar</button>
          <button type="submit" disabled={salvando} className="panel-cut-sm min-h-10 border border-destaque bg-destaque/10 px-3 font-mono text-xs uppercase text-destaque disabled:opacity-50">
            {salvando ? '…' : 'salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}
