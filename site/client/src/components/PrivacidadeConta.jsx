import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, EstadoErro, Input, Modal } from './ui'
import { useTransicaoModal } from '../lib/useTransicaoModal.js'
import { definirMetricas, metricasDesligadas, esquecerJogador } from '../observabilidade/posthog.js'

// Direitos do titular na Minha conta (LGPD): baixar os dados, desligar métricas de uso e
// excluir a conta. O servidor faz o trabalho (routes/minhaConta.js); aqui só a interface.

function ModalExcluir({ onFechar }) {
  const { visivel, iniciarSaida } = useTransicaoModal()
  const fechar = () => iniciarSaida(onFechar)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(null)

  async function excluir() {
    setEnviando(true)
    setErro(null)
    try {
      const res = await fetch('/api/minha-conta', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmacao: texto.trim() }),
      })
      if (!res.ok) throw new Error()
      esquecerJogador()
      window.location.href = '/'
    } catch {
      setErro('Não deu pra excluir agora. Tente de novo em instantes.')
      setEnviando(false)
    }
  }

  return (
    <Modal
      visivel={visivel}
      onFechar={fechar}
      titulo="Excluir minha conta"
      tamanho="sm"
      rodape={
        <>
          <Button variante="fantasma" onClick={fechar}>Cancelar</Button>
          <Button variante="perigo" onClick={excluir} carregando={enviando} disabled={texto.trim() !== 'EXCLUIR'}>
            Excluir conta
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-texto-fraco">
        <p>
          Apagamos seu nick, avatar, códigos da Steam, vínculo FACEIT, amizades, clipes e envios, e você sai do site.
        </p>
        <p>
          As estatísticas das partidas continuam, sob “Jogador removido”, ligadas ao seu SteamID: elas vêm das demos e
          também são dos outros jogadores. Por isso, se você entrar de novo com a mesma conta Steam, suas partidas antigas
          voltam a aparecer pra você. Nick, amizades, códigos e vínculos não voltam.
        </p>
        <p>Isso não pode ser desfeito.</p>
        <Input rotulo="Digite EXCLUIR para confirmar" value={texto} onChange={(e) => setTexto(e.target.value)} autoComplete="off" />
        {erro && <EstadoErro mensagem={erro} />}
      </div>
    </Modal>
  )
}

export default function PrivacidadeConta() {
  const [metricas, setMetricas] = useState(() => !metricasDesligadas())
  const [excluindo, setExcluindo] = useState(false)

  function alternarMetricas() {
    const novo = !metricas
    definirMetricas(novo)
    setMetricas(novo)
  }

  return (
    <section className="space-y-3">
      <h3 className="rotulo">Privacidade e dados</h3>
      <Card className="divide-y divide-borda">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-texto">Baixar meus dados</p>
            <p className="text-sm text-texto-fraco">Um arquivo JSON com sua conta, partidas, amizades e clipes.</p>
          </div>
          <a href="/api/minha-conta/exportar" className="shrink-0 rounded-[var(--radius-pequeno)] border border-borda-forte bg-superficie-alta px-3 py-2 text-[13px] font-medium text-texto hover:bg-superficie-topo">
            Baixar
          </a>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-texto">Métricas de uso</p>
            <p className="text-sm text-texto-fraco">Contagem anônima de páginas vistas, sem cookie. Só neste navegador.</p>
          </div>
          <Button variante="secundario" tamanho="sm" onClick={alternarMetricas} aria-pressed={metricas}>
            {metricas ? 'Desligar' : 'Ligar'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-texto">Excluir minha conta</p>
            <p className="text-sm text-texto-fraco">
              Remove seus dados pessoais do Resenha. <Link to="/privacidade" className="text-destaque hover:underline">Como tratamos seus dados</Link>
            </p>
          </div>
          <Button variante="perigo" tamanho="sm" onClick={() => setExcluindo(true)}>Excluir conta</Button>
        </div>
      </Card>
      {excluindo && <ModalExcluir onFechar={() => setExcluindo(false)} />}
    </section>
  )
}
