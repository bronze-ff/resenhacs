import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, SectionHeader } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'
import { setGrupoAtivo } from '../lib/grupoAtivo.js'

export default function AceitarConvite() {
  const { token } = useParams()
  const { carregando, jogador } = useAuth()
  const [info, setInfo] = useState(null)
  const [erro, setErro] = useState(null)
  const [aceitando, setAceitando] = useState(false)

  useEffect(() => {
    if (!jogador) return
    fetch(`/api/convites/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).erro ?? 'Convite inválido')
        return res.json()
      })
      .then(setInfo)
      .catch((e) => setErro(e.message))
  }, [token, jogador])

  async function aceitar() {
    setAceitando(true)
    const res = await fetch(`/api/convites/${token}/aceitar`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setAceitando(false)
      return setErro(body.erro ?? 'Erro ao aceitar convite')
    }
    setGrupoAtivo(body.groupId)
    window.location.href = '/'
  }

  if (carregando) return <p className="p-8 text-texto-fraco">Carregando…</p>
  if (!jogador) {
    window.location.href = `/api/auth/steam?returnTo=${encodeURIComponent(`/convite/${token}`)}`
    return <p className="p-8 text-texto-fraco">Redirecionando pro login…</p>
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <SectionHeader titulo="Convite de grupo" />
      <Card className="mt-4 p-4 sm:p-5">
        {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
        {!erro && !info && <p className="font-mono text-sm text-texto-fraco">Carregando convite…</p>}
        {info && (
          <div className="space-y-3">
            <p className="font-mono text-sm text-texto">
              Você foi convidado pro grupo <span className="text-destaque">{info.grupoNome}</span>.
            </p>
            <button
              onClick={aceitar}
              disabled={aceitando}
              className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo disabled:opacity-40"
            >
              Entrar no grupo
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
