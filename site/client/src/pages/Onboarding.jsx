import { useState } from 'react'
import { Card, SectionHeader } from '../components/ui'
import { setGrupoAtivo } from '../lib/grupoAtivo.js'

export default function Onboarding() {
  const [nome, setNome] = useState('')
  const [tokenConvite, setTokenConvite] = useState('')
  const [erro, setErro] = useState(null)
  const [enviando, setEnviando] = useState(false)

  async function criar(e) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome }),
    })
    const body = await res.json().catch(() => ({}))
    setEnviando(false)
    if (!res.ok) return setErro(body.erro ?? 'Erro ao criar grupo')
    setGrupoAtivo(body.id)
    window.location.href = '/'
  }

  function irParaConvite(e) {
    e.preventDefault()
    const token = tokenConvite.trim().split('/').pop()
    if (token) window.location.href = `/convite/${token}`
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-10">
      <SectionHeader titulo="Bem-vindo ao Resenha" />
      <p className="font-mono text-sm text-texto-fraco">
        Você ainda não faz parte de nenhum grupo. Crie o seu ou entre com um link de convite.
      </p>

      <Card className="p-4 sm:p-5">
        <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-texto">
          Criar um grupo
        </h3>
        <form onSubmit={criar} className="space-y-3">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do grupo"
            className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0"
          />
          <button
            type="submit"
            disabled={!nome.trim() || enviando}
            className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo disabled:opacity-40"
          >
            Criar grupo
          </button>
        </form>
      </Card>

      <Card className="p-4 sm:p-5">
        <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-texto">
          Tenho um convite
        </h3>
        <form onSubmit={irParaConvite} className="space-y-3">
          <input
            value={tokenConvite}
            onChange={(e) => setTokenConvite(e.target.value)}
            placeholder="Cole o link do convite"
            className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0"
          />
          <button
            type="submit"
            disabled={!tokenConvite.trim()}
            className="panel-cut-sm min-h-10 w-full border border-borda px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-texto disabled:opacity-40"
          >
            Continuar
          </button>
        </form>
      </Card>

      {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
    </div>
  )
}
