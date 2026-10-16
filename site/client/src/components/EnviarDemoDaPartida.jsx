import { useEffect, useState } from 'react'
import { mapaDoCabecalho, cabecalhoDivergeDoMapa } from '../lib/demoHeader.js'
import { nomeMapa } from '../lib/format.js'
import { Button, EstadoErro, Campo, classeEntrada } from './ui'

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

  // O servidor só emite a URL pré-assinada quando source === 'faceit' (única
  // origem stats-only sem demo hoje — ver site/server/src/routes/upload.js); sem
  // essa checagem aqui, o Jogador via o botão numa Partida Premier e só tomava o
  // 409 depois de escolher o arquivo inteiro.
  if (!joguei || partida.temDemo || partida.source !== 'faceit') return null

  if (emAndamento || aguardandoRefetch) {
    return (
      <div role="status" className="border border-borda bg-superficie px-3 py-2 text-sm text-texto-fraco">
        {aguardandoRefetch && !emAndamento
          ? 'Envio recebido! Processando em até 30 minutos — os dados completos aparecem no Feed quando terminar.'
          : 'Demo em processamento — os dados completos aparecem em até 30 minutos.'}
      </div>
    )
  }

  // `input` é o elemento do <input type="file">: recebido à parte da FileList pra
  // podermos limpar o value nos caminhos de rejeição. Sem isso, escolher de novo o
  // MESMO arquivo (mesmo path) não muda o value do input, o browser não dispara
  // change, e a tela trava na mensagem de erro anterior mesmo depois de trocar de
  // arquivo no seletor do SO e voltar a escolher o original.
  async function escolher(lista, input) {
    setErro(null)
    const f = lista?.[0]
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.dem')) {
      setErro('Só arquivos .dem são aceitos.')
      setArquivo(null)
      if (input) input.value = ''
      return
    }
    if (await cabecalhoDivergeDoMapa(f, partida.map)) {
      const mapa = await mapaDoCabecalho(f)
      setErro(`Essa demo é de ${nomeMapa(mapa)} e esta partida foi em ${nomeMapa(partida.map)}.`)
      setArquivo(null)
      if (input) input.value = ''
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
        <EstadoErro mensagem={`O envio anterior foi recusado: ${envio.erro}. Você pode enviar outra demo.`} />
      )}

      {!aberto ? (
        <Button variante="secundario" tamanho="sm" onClick={() => setAberto(true)}>
          Enviar demo desta partida
        </Button>
      ) : (
        <div className="space-y-3 border border-borda bg-superficie p-4">
          <p className="text-sm text-texto-fraco">
            Baixe a demo desta partida na FACEIT e envie aqui. O processamento roda a cada ~30
            minutos e destrava KAST, rating, economia, replay e clipes.
          </p>
          <Campo rotulo="Arquivo .dem" htmlFor="demo-da-partida" erro={erro}>
            <input
              id="demo-da-partida"
              type="file"
              accept=".dem"
              onChange={(e) => escolher(e.target.files, e.target)}
              className={`${classeEntrada} font-mono text-xs file:mr-3 file:border-0 file:bg-superficie-alta file:px-2 file:py-1 file:text-texto`}
            />
          </Campo>
          {arquivo && <p className="font-mono text-xs text-texto-fraco">{arquivo.name}</p>}
          <div className="flex gap-2">
            <Button variante="primario" tamanho="sm" onClick={enviar} disabled={!arquivo || enviando}>
              {enviando ? 'Enviando…' : 'Enviar'}
            </Button>
            <Button variante="fantasma" tamanho="sm" onClick={() => { setAberto(false); setArquivo(null); setErro(null) }}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
