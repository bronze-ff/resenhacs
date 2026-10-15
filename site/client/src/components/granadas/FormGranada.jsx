import { useId, useState } from 'react'
import { linkBuscaYoutube } from '../../lib/youtube.js'
import { nomeMapa } from '../../lib/format.js'
import { useTransicaoModal } from '../../lib/useTransicaoModal.js'
import { Button, Campo, Input, Modal, Select, Textarea } from '../ui'

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
  const { visivel, iniciarSaida } = useTransicaoModal()
  const fechar = () => iniciarSaida(onCancelar)
  const formId = useId()

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
    if (res?.ok) return iniciarSaida(onSalvo)
    const body = await res?.json().catch(() => ({}))
    setErro(body?.erro ?? 'Erro ao salvar.')
  }

  return (
    <Modal
      visivel={visivel}
      onFechar={fechar}
      tamanho="md"
      titulo={inicial ? 'Editar granada' : 'Nova granada'}
      subtitulo={`${nomeMapa(mapa)} · lado ${lado}`}
      rodape={
        <>
          {erro && <p role="alert" className="mr-auto text-sm text-perigo">{erro}</p>}
          <Button variante="fantasma" onClick={fechar}>Cancelar</Button>
          {/* O botão fica no rodapé do Modal (fora do <form>): `form` liga ele ao formulário. */}
          <Button variante="primario" type="submit" form={formId} carregando={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="flex flex-col gap-4">
        <Input
          rotulo="Título"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Título (ex.: Smoke janela da base)"
        />
        <Textarea
          rotulo="Descrição"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Descrição (opcional)"
          rows={2}
          className="min-h-16"
        />
        <Campo rotulo="Vídeo">
          <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="Link do YouTube (opcional)" />
          <a
            href={linkBuscaYoutube(`${nomeMapa(mapa)} ${tipo} ${titulo}`)}
            target="_blank"
            rel="noreferrer"
            className="w-fit font-mono text-[11px] text-destaque transition-colors hover:text-destaque-forte"
          >
            Buscar vídeo no YouTube ↗
          </a>
        </Campo>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo rotulo="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-full" selectClassName="min-h-11 lg:min-h-10">
              {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Campo>
          <Campo rotulo="Técnica">
            <Select value={tecnica} onChange={(e) => setTecnica(e.target.value)} className="w-full" selectClassName="min-h-11 lg:min-h-10">
              {TECNICAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Campo>
          <Campo rotulo="Botão">
            <Select value={botao} onChange={(e) => setBotao(e.target.value)} className="w-full" selectClassName="min-h-11 lg:min-h-10">
              {BOTOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Campo>
        </div>
        <Textarea
          rotulo="Passos"
          ajuda="Um passo por linha."
          value={passosTexto}
          onChange={(e) => setPassosTexto(e.target.value)}
          rows={4}
          placeholder={'Fique colado na quina da caixa\nMire no pixel acima da antena\nJumpthrow'}
        />
      </form>
    </Modal>
  )
}
