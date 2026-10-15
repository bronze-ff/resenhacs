// site/client/src/components/FormCompeticao.jsx
import { useId, useState } from 'react'
import { datetimeLocalBrasiliaParaIso, paraDatetimeLocalBrasilia } from '../lib/format.js'
import { useTransicaoModal } from '../lib/useTransicaoModal.js'
import { Button, EstadoErro, Input, Modal, Textarea, classeEntrada } from './ui'

// Casca de modal padrão (ui/Modal): Escape, backdrop e X fecham; no mobile vira folha
// que sobe da base. Botões ficam no rodapé fixo, ligados ao <form> pelo atributo form.

const MERCADO_STEAM_PREFIXO = 'https://steamcommunity.com/market/'

export default function FormCompeticao({ inicial = null, onSalvo, onCancelar }) {
  const [nome, setNome] = useState(inicial?.nome ?? '')
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '')
  const [premioDescricao, setPremioDescricao] = useState(inicial?.premioDescricao ?? '')
  const [premioImagemUrl, setPremioImagemUrl] = useState(inicial?.premioImagemUrl ?? '')
  const [premioMercadoUrl, setPremioMercadoUrl] = useState(inicial?.premioMercadoUrl ?? '')
  const [imagemComErro, setImagemComErro] = useState(false)
  const [dataInicio, setDataInicio] = useState(paraDatetimeLocalBrasilia(inicial?.dataInicio))
  const [dataFim, setDataFim] = useState(paraDatetimeLocalBrasilia(inicial?.dataFim))
  const [limiteDiario, setLimiteDiario] = useState(inicial?.limiteDiario ?? 2)
  const [limiteTotal, setLimiteTotal] = useState(inicial?.limiteTotal ?? 10)
  const [minimoParaRankear, setMinimoParaRankear] = useState(inicial?.minimoParaRankear ?? 3)
  const [erro, setErro] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const { visivel, iniciarSaida } = useTransicaoModal()
  const fechar = () => iniciarSaida(onCancelar)

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
      dataInicio: dataInicio ? datetimeLocalBrasiliaParaIso(dataInicio) : dataInicio,
      dataFim: dataFim ? datetimeLocalBrasiliaParaIso(dataFim) : dataFim,
      limiteDiario: Number(limiteDiario), limiteTotal: Number(limiteTotal), minimoParaRankear: Number(minimoParaRankear),
    }
    const res = await fetch(inicial ? `/api/competicoes/admin/${inicial.id}` : '/api/competicoes/admin', {
      method: inicial ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    }).catch(() => null)
    setSalvando(false)
    if (res?.ok) return iniciarSaida(onSalvo)
    const body = await res?.json().catch(() => ({}))
    setErro(body?.erro ?? 'Erro ao salvar.')
  }

  const formId = useId()
  const classeData = `${classeEntrada} font-mono [color-scheme:dark]`

  return (
    <Modal
      visivel={visivel}
      onFechar={fechar}
      titulo={`${inicial ? 'Editar' : 'Nova'} competição`}
      subtitulo={inicial ? inicial.nome : 'Prêmio, prazo e limites de envio'}
      tamanho="md"
      rodape={
        <>
          <Button variante="fantasma" onClick={fechar}>Cancelar</Button>
          <Button variante="primario" type="submit" form={formId} carregando={salvando}>
            Salvar
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="flex flex-col gap-6">
        {erro && <EstadoErro mensagem={erro} />}

        <section className="flex flex-col gap-4">
          <h4 className="rotulo">Competição</h4>
          <Input rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <Textarea rotulo="Descrição" rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </section>

        <section className="flex flex-col gap-4 border-t border-borda pt-5">
          <h4 className="rotulo">Prêmio</h4>
          <Input rotulo="Prêmio" placeholder="Ex.: AK-47 | Redline (FT)" value={premioDescricao} onChange={(e) => setPremioDescricao(e.target.value)} />
          <div className="flex items-start gap-3">
            <Input
              type="url"
              rotulo="Link da imagem da skin"
              campoClassName="min-w-0 flex-1"
              className="font-mono"
              value={premioImagemUrl}
              onChange={(e) => { setPremioImagemUrl(e.target.value); setImagemComErro(false) }}
              erro={premioImagemUrl && imagemComErro ? 'Não foi possível carregar essa imagem.' : null}
            />
            <div className="panel-cut-sm mt-[22px] flex h-20 w-20 shrink-0 items-center justify-center border border-borda bg-fundo/70">
              {premioImagemUrl && !imagemComErro ? (
                <img
                  src={premioImagemUrl}
                  alt="Prévia da skin"
                  className="h-full w-full object-contain p-1"
                  onError={() => setImagemComErro(true)}
                />
              ) : (
                <span className="rotulo text-center">Prévia</span>
              )}
            </div>
          </div>
          <Input
            type="url"
            rotulo="Link no mercado da Steam"
            className="font-mono"
            placeholder={MERCADO_STEAM_PREFIXO}
            value={premioMercadoUrl}
            onChange={(e) => setPremioMercadoUrl(e.target.value)}
          />
        </section>

        <section className="flex flex-col gap-4 border-t border-borda pt-5">
          <h4 className="rotulo">Prazo e limites</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input type="datetime-local" rotulo="Início" ajuda="Horário de Brasília" className={classeData} value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            <Input type="datetime-local" rotulo="Fim" ajuda="Horário de Brasília" className={classeData} value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input type="number" min="1" rotulo="Limite/dia" className="font-mono tabular-nums" value={limiteDiario} onChange={(e) => setLimiteDiario(e.target.value)} />
            <Input type="number" min="1" rotulo="Limite total" className="font-mono tabular-nums" value={limiteTotal} onChange={(e) => setLimiteTotal(e.target.value)} />
            <Input type="number" min="1" rotulo="Mínimo p/ rankear" className="font-mono tabular-nums" value={minimoParaRankear} onChange={(e) => setMinimoParaRankear(e.target.value)} />
          </div>
        </section>
      </form>
    </Modal>
  )
}
