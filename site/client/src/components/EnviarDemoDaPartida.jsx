import { useEffect, useState } from 'react'
import { mapaDoCabecalho, cabecalhoDivergeDoMapa } from '../lib/demoHeader.js'
import { nomeMapa } from '../lib/format.js'

// Envio da Demo de uma Partida FACEIT stats-only, amarrado a ELA (matchId) — o
// servidor só emite a URL pré-assinada pra quem jogou, e o Coletor só grava se a
// Demo bater (mapa + os 10 Participantes). Ver
// docs/superpowers/specs/2026-07-25-enviar-demo-da-partida-faceit-design.md
export default function EnviarDemoDaPartida({ partida, euSteamId, onEnviado }) {
  const [aberto, setAberto] = useState(false)
  const [arquivo, setArquivo] = useState(null)
  const [erro, setErro] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [enviadoAgora, setEnviadoAgora] = useState(false)
  const [envioNoEnvio, setEnvioNoEnvio] = useState(null)

  const joguei = (partida.players ?? []).some((p) => p.steamId === euSteamId)
  const envio = partida.demoUpload
  const emAndamento = envio?.status === 'pendente' || envio?.status === 'processando'
  // Enquanto o refetch do detalhe (rota pesada) não chega, o servidor ainda reporta o
  // envio de ANTES do PUT — sem isso o botão "Enviar demo" reaparece como se o upload
  // de 100-300MB não tivesse ido a lugar nenhum, e o Jogador sobe de novo (o servidor
  // devolve 409, mas o segundo upload já aconteceu). Comparamos com o envio no momento
  // do sucesso: quando o refetch trouxer algo diferente, essa flag deixa de valer.
  const aguardandoRefetch = enviadoAgora && JSON.stringify(envio) === envioNoEnvio

  // Uma vez que o refetch trouxer um `envio` diferente do snapshot, a flag deixou de
  // valer pra sempre — sem isso, se o envio saísse da janela de status e voltasse a
  // ficar igual ao snapshot mais tarde (ex.: volta a `null` com `temDemo` ainda falso),
  // o banner "Envio recebido!" reapareceria e esconderia o botão pelo resto da visita.
  useEffect(() => {
    if (enviadoAgora && JSON.stringify(envio) !== envioNoEnvio) {
      setEnviadoAgora(false)
    }
  }, [envio, envioNoEnvio, enviadoAgora])

  if (!joguei || partida.temDemo) return null

  if (emAndamento || aguardandoRefetch) {
    return (
      <div className="panel-cut-sm border border-borda bg-superficie px-3 py-2 font-mono text-xs text-texto-fraco">
        {aguardandoRefetch && !emAndamento
          ? 'Envio recebido! Processando em até 30 minutos — os dados completos aparecem no Feed quando terminar.'
          : 'Demo em processamento — os dados completos aparecem em até 30 minutos.'}
      </div>
    )
  }

  async function escolher(lista) {
    setErro(null)
    const f = lista?.[0]
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.dem')) {
      setErro('Só arquivos .dem são aceitos.')
      setArquivo(null)
      return
    }
    if (await cabecalhoDivergeDoMapa(f, partida.map)) {
      const mapa = await mapaDoCabecalho(f)
      setErro(`Essa demo é de ${nomeMapa(mapa)} e esta partida foi em ${nomeMapa(partida.map)}.`)
      setArquivo(null)
      return
    }
    setArquivo(f)
  }

  async function enviar() {
    if (!arquivo) return
    setEnviando(true)
    setErro(null)
    try {
      const resUrl = await fetch('/api/upload/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: arquivo.name, tamanho: arquivo.size, matchId: partida.id }),
      })
      const body = await resUrl.json().catch(() => ({}))
      if (!resUrl.ok) {
        setErro(body.erro ?? 'Erro ao preparar o envio')
        return
      }
      const resPut = await fetch(body.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: arquivo,
      })
      if (!resPut.ok) {
        setErro('Falha ao enviar o arquivo pro armazenamento')
        return
      }
      setEnvioNoEnvio(JSON.stringify(envio))
      setEnviadoAgora(true)
      setAberto(false)
      setArquivo(null)
      onEnviado?.()
    } catch {
      setErro('Falha de rede ao enviar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-2">
      {envio?.status === 'falhou' && envio.enviadoPorVoce && (
        <div className="panel-cut-sm border border-perigo/40 bg-perigo/10 px-3 py-2 font-mono text-xs text-perigo">
          O envio anterior foi recusado: {envio.erro}. Você pode enviar outra demo.
        </div>
      )}

      {!aberto ? (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="panel-cut-sm border border-borda bg-superficie px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-texto-fraco hover:border-destaque hover:text-texto"
        >
          Enviar demo desta partida
        </button>
      ) : (
        <div className="panel-cut-sm space-y-3 border border-borda bg-superficie p-3">
          <p className="font-mono text-xs text-texto-fraco">
            Baixe a demo desta partida na FACEIT e envie aqui. O processamento roda a cada ~30
            minutos e destrava ADR, KAST, rating, replay e clipes.
          </p>
          <label htmlFor="demo-da-partida" className="block font-mono text-xs text-texto">
            Arquivo .dem
          </label>
          <input
            id="demo-da-partida"
            type="file"
            accept=".dem"
            onChange={(e) => escolher(e.target.files)}
            className="block w-full font-mono text-xs text-texto-fraco"
          />
          {arquivo && <p className="font-mono text-xs text-texto-fraco">{arquivo.name}</p>}
          {erro && <p className="font-mono text-xs text-perigo">{erro}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={enviar}
              disabled={!arquivo || enviando}
              className="panel-cut-sm border border-destaque bg-destaque/10 px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-destaque disabled:opacity-40"
            >
              {enviando ? 'Enviando…' : 'Enviar'}
            </button>
            <button
              type="button"
              onClick={() => { setAberto(false); setArquivo(null); setErro(null) }}
              className="panel-cut-sm border border-borda px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-texto-fraco"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
