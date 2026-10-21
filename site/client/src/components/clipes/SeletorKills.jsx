import { useEffect, useMemo, useState } from 'react'
import { Select, Button, Badge, SkeletonLista, EstadoVazio, EstadoErro } from '../ui'
import { nomeArma } from '../../lib/format.js'
import {
  chaveKill, ehGranada, filtrarKills, killsDoJogador, marcasKill, mortesDoJogador, umaPorRound,
} from '../../lib/selecaoKills.js'

function jogadorPadrao(jogadores, viewerSteamId) {
  if (viewerSteamId && jogadores.some((p) => p.steamId === viewerSteamId)) return viewerSteamId
  return (jogadores.find((p) => p.isTracked) ?? jogadores[0])?.steamId ?? ''
}

function CelulaArma({ weapon }) {
  const granada = ehGranada(weapon)
  return (
    <span className="flex items-center gap-2">
      <img src={`/weapons/${weapon}.svg`} alt="" aria-hidden="true" className="h-4 w-8 object-contain opacity-80" />
      <span className={granada ? 'font-medium text-aviso' : 'text-texto'}>{nomeArma(weapon)}</span>
      {granada && <Badge tom="neutro" title="Kill de granada">granada</Badge>}
    </span>
  )
}

// Seletor de kills do clipe: escolhe o Jogador, lista as kills dele na Partida
// (papel 'killer') ou as mortes dele (papel 'victim') e devolve as marcadas por
// `onMudarSelecao(kills)` (ordem round/tick).
export default function SeletorKills({ matchId, jogadores, viewerSteamId, papel = 'killer', onMudarSelecao }) {
  const mortes = papel === 'victim'
  const [jogadorId, setJogadorId] = useState(() => jogadorPadrao(jogadores, viewerSteamId))
  const [kills, setKills] = useState(null)
  const [erro, setErro] = useState(false)
  const [soTkGranada, setSoTkGranada] = useState(false)
  const [selecionadas, setSelecionadas] = useState(() => new Set())

  useEffect(() => {
    if (!jogadorId) return
    let vivo = true
    setKills(null)
    setErro(false)
    setSelecionadas(new Set())
    fetch(`/api/matches/${encodeURIComponent(matchId)}/kills?${mortes ? 'vitima' : 'jogador'}=${encodeURIComponent(jogadorId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((lista) => {
        const doJogador = mortes ? mortesDoJogador : killsDoJogador
        if (vivo) setKills(doJogador(Array.isArray(lista) ? lista : [], jogadorId))
      })
      .catch(() => { if (vivo) setErro(true) })
    return () => { vivo = false }
  }, [matchId, jogadorId, mortes])

  const visiveis = useMemo(() => filtrarKills(kills ?? [], { soTkGranada }), [kills, soTkGranada])

  useEffect(() => {
    onMudarSelecao?.((kills ?? []).filter((k) => selecionadas.has(chaveKill(k))))
  }, [selecionadas, kills]) // eslint-disable-line react-hooks/exhaustive-deps

  function alternar(chave) {
    setSelecionadas((atual) => {
      const nova = new Set(atual)
      if (nova.has(chave)) nova.delete(chave)
      else nova.add(chave)
      return nova
    })
  }

  const todasMarcadas = visiveis.length > 0 && visiveis.every((k) => selecionadas.has(chaveKill(k)))
  const oQue = mortes ? 'mortes' : 'kills'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={jogadorId} onChange={(e) => setJogadorId(e.target.value)}>
          {jogadores.map((p) => (
            <option key={p.steamId} value={p.steamId}>{p.nick || p.steamId}</option>
          ))}
        </Select>
        <Button variante="secundario" tamanho="sm" disabled={!visiveis.length}
          onClick={() => setSelecionadas(new Set(umaPorRound(visiveis)))}>
          1 por round
        </Button>
        <Button variante="secundario" tamanho="sm" disabled={!visiveis.length}
          onClick={() => setSelecionadas(new Set(visiveis.map(chaveKill)))}>
          Todas
        </Button>
        <Button variante="fantasma" tamanho="sm" disabled={!selecionadas.size}
          onClick={() => setSelecionadas(new Set())}>
          Limpar
        </Button>
        <label className="ml-auto flex min-h-9 cursor-pointer items-center gap-2 text-sm text-texto-fraco">
          <input
            type="checkbox"
            checked={soTkGranada}
            onChange={(e) => setSoTkGranada(e.target.checked)}
            className="h-4 w-4 accent-[color:var(--color-destaque)]"
          />
          Só TK/granada
        </label>
      </div>

      {erro && <EstadoErro mensagem={`Não foi possível carregar as ${oQue} dessa Partida.`} />}
      {!erro && kills === null && <SkeletonLista linhas={4} altura="h-10" rotulo={`Carregando ${oQue}`} />}
      {!erro && kills !== null && visiveis.length === 0 && (
        <EstadoVazio
          titulo={soTkGranada ? `Nenhuma ${mortes ? 'morte' : 'kill'} de TK ou granada.` : `Nenhuma ${mortes ? 'morte' : 'kill'} nessa Partida.`}
          descricao={soTkGranada ? `Desligue o filtro pra ver todas as ${oQue} do Jogador.` : 'Escolha outro Jogador acima.'}
        />
      )}
      {!erro && visiveis.length > 0 && (
        <div className="panel-cut overflow-x-auto border border-borda bg-superficie">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-texto-fraco">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Marcar todas as ${oQue} visíveis`}
                    checked={todasMarcadas}
                    onChange={() => setSelecionadas(todasMarcadas ? new Set() : new Set(visiveis.map(chaveKill)))}
                    className="h-4 w-4 accent-[color:var(--color-destaque)]"
                  />
                </th>
                <th className="px-3 py-2 text-right font-medium">Round</th>
                <th className="px-3 py-2 font-medium">Arma</th>
                <th className="px-3 py-2 font-medium">{mortes ? 'Quem matou' : 'Vítima'}</th>
                <th className="px-3 py-2 font-medium">Marcas</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((k) => {
                const chave = chaveKill(k)
                const marcada = selecionadas.has(chave)
                const outro = mortes ? k.killer : k.victim
                const vitima = outro?.nick || outro?.steamId || 'Mundo'
                return (
                  <tr key={chave} className={`border-t border-borda transition-colors hover:bg-superficie-alta ${marcada ? 'bg-superficie-alta' : ''}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={() => alternar(chave)}
                        aria-label={`Round ${k.round}: ${vitima} com ${nomeArma(k.weapon)}`}
                        className="h-4 w-4 accent-[color:var(--color-destaque)]"
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-texto">{k.round}</td>
                    <td className="px-3 py-2"><CelulaArma weapon={k.weapon} /></td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-texto">{vitima}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {marcasKill(k).map((m) => (
                          <Badge key={m.id} tom={m.tom} title={m.titulo}>
                            {m.id === 'tk' && <span aria-hidden="true">⚠</span>}
                            {m.rotulo}
                          </Badge>
                        ))}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {kills !== null && kills.length > 0 && (
        <p className="text-xs text-texto-fraco">
          <span className="tabular-nums">{selecionadas.size}</span> de <span className="tabular-nums">{kills.length}</span> {oQue} marcadas
        </p>
      )}
    </div>
  )
}
