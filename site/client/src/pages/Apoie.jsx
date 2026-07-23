import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Card, SectionHeader } from '../components/ui'
import { montarPayloadPix } from '../lib/pix.js'

const CHAVE_PIX = '98dea706-4b3d-4ae4-b96d-e96a6669bb8a'
const NOME_PIX = 'Filippe Faria'
const CIDADE_PIX = 'Aparecida de Goiania'

export default function Apoie() {
  const payload = montarPayloadPix({ chave: CHAVE_PIX, nome: NOME_PIX, cidade: CIDADE_PIX })
  const [qrCodeUrl, setQrCodeUrl] = useState(null)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    let cancelado = false
    QRCode.toDataURL(payload).then((url) => {
      if (!cancelado) setQrCodeUrl(url)
    })
    return () => {
      cancelado = true
    }
  }, [payload])

  async function copiar() {
    try {
      await navigator.clipboard.writeText(payload)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // clipboard indisponível (ex.: contexto não-HTTPS) — o texto já fica visível na tela
      // pra seleção manual, então não precisa de tratamento além de não quebrar a página.
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <SectionHeader titulo="Apoie o Resenha" />
      <Card className="p-6 text-center">
        <p className="mb-6 text-sm text-texto-fraco">
          O Resenha é mantido de graça pro grupo. Se ele te ajuda e você quiser contribuir com o
          custo de manter tudo no ar, qualquer valor via PIX é bem-vindo, sem pressão nenhuma.
        </p>
        {qrCodeUrl && (
          <img
            src={qrCodeUrl}
            alt="QR code PIX para doação"
            className="mx-auto mb-6 h-56 w-56 border border-borda"
          />
        )}
        <p className="mb-2 text-xs uppercase tracking-wide text-texto-fraco">Chave PIX (aleatória)</p>
        <p className="mb-4 break-all font-mono text-sm text-texto">{CHAVE_PIX}</p>
        <button
          type="button"
          onClick={copiar}
          className="panel-cut-sm border border-borda px-4 py-2 text-xs uppercase tracking-wide text-texto-fraco transition-colors hover:border-destaque/50 hover:text-destaque"
        >
          {copiado ? 'Copiado!' : 'Copiar Pix Copia e Cola'}
        </button>
      </Card>
    </div>
  )
}
