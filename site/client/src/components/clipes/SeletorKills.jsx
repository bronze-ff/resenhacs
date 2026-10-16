import { useEffect, useMemo, useState } from 'react'
import { Select, Button, Badge, SkeletonLista, EstadoVazio, EstadoErro } from '../ui'
import { nomeArma } from '../../lib/format.js'
import {
  chaveKill, ehGranada, filtrarKills, killsDoJogador, marcasKill, umaPorRound,
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

// Seletor de kills do Clipe 2D: escolhe o Jogador, lista as kills dele na Partida e
// devolve as marcadas por `onMudarSelecao(kills)` (ordem round/tick).
export default function SeletorKills({ matchId, jogadores, viewerSteamId, onMudarSelecao }) {
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
    fetch(`/api/matches/${encodeURIComponent(matchId)}/kills?jogador=${encodeURIComponent(jogadorId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((lista) => { if (vivo) setKills(killsDoJogador(Array.isArray(lista) ? lista : [], jogadorId)) })
      .catch(() => { if (vivo) setErro(true) })
    return () => { vivo = false }
  }, [matchId, jogadorId])

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

      {erro && <EstadoErro mensagem="Não foi possível carregar as kills dessa Partida." />}
      {!erro && kills === null && <SkeletonLista linhas={4} altura="h-10" rotulo="Carregando kills" />}
      {!erro && kills !== null && visiveis.length === 0 && (
        <EstadoVazio
          titulo={soTkGranada ? 'Nenhuma kill de TK ou granada.' : 'Nenhuma kill nessa Partida.'}
          descricao={soTkGranada ? 'Desligue o filtro pra ver todas as kills do Jogador.' : 'Escolha outro Jogador acima.'}
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
                    aria-label="Marcar todas as kills visíveis"
                    checked={todasMarcadas}
                    onChange={() => setSelecionadas(todasMarcadas ? new Set() : new Set(visiveis.map(chaveKill)))}
                    className="h-4 w-4 accent-[color:var(--color-destaque)]"
                  />
                </th>
                <th className="px-3 py-2 text-right font-medium">Round</th>
                <th className="px-3 py-2 font-medium">Arma</th>
                <th className="px-3 py-2 font-medium">Vítima</th>
                <th className="px-3 py-2 font-medium">Marcas</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((k) => {
                const chave = chaveKill(k)
                const marcada = selecionadas.has(chave)
                const vitima = k.victim?.nick || k.victim?.steamId
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
          <span className="tabular-nums">{selecionadas.size}</span> de <span className="tabular-nums">{kills.length}</span> kills marcadas
        </p>
      )}
    </div>
  )
}
