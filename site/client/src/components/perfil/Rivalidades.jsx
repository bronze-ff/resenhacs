import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Card, DataTable, Explicacao, SectionHeader, SkeletonLista } from '../ui'
import { METRICAS } from '../../lib/metricas.js'

// Rivalidades do Jogador contra o resto do grupo (referência: duelos do FACEIT, "Best/
// Worst Friend" do Leetify). Dados de GET /api/rivalidades/:steamId — só Partidas
// visíveis ao viewer. Busca sozinho pra não pesar o payload do Perfil.

function valido(d) {
  return d && Array.isArray(d.duelos) && Array.isArray(d.duplas)
}

function CardRival({ titulo, legenda, jogador, valor, detalhe, bom, metrica }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-texto"><Explicacao metrica={metrica}>{titulo}</Explicacao></span>
        <span className="text-xs text-texto-fraco">{legenda}</span>
      </div>
      {jogador ? (
        <div className="flex items-center gap-3">
          <Avatar p={jogador} size={40} />
          <div className="min-w-0 flex-1">
            <Link to={`/jogador/${jogador.steamId}`} className="block truncate text-[15px] font-semibold text-texto hover:text-destaque-forte">
              {jogador.nick}
            </Link>
            <div className="font-mono text-xs tabular-nums text-texto-fraco">{detalhe}</div>
          </div>
          <span className={`font-mono text-xl tabular-nums ${bom ? 'text-sucesso' : 'text-perigo'}`}>
            <span aria-hidden="true" className="mr-1 text-xs">{bom ? '▲' : '▼'}</span>
            {valor}
          </span>
        </div>
      ) : (
        <p className="text-sm text-texto-fraco">Ainda sem partidas suficientes.</p>
      )}
    </Card>
  )
}

export default function Rivalidades({ steamId, proprio = false }) {
  const [dados, setDados] = useState(null)
  const [estado, setEstado] = useState('carregando')

  useEffect(() => {
    let vivo = true
    setEstado('carregando')
    fetch(`/api/rivalidades/${steamId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vivo) return
        if (valido(d)) {
          setDados(d)
          setEstado('ok')
        } else {
          setEstado('vazio')
        }
      })
      .catch(() => vivo && setEstado('vazio'))
    return () => { vivo = false }
  }, [steamId])

  if (estado === 'carregando') {
    return (
      <section>
        <SectionHeader titulo="Rivalidades" />
        <SkeletonLista linhas={2} altura="h-24" rotulo="Carregando rivalidades" />
      </section>
    )
  }
  if (estado !== 'ok' || (dados.duelos.length === 0 && dados.duplas.length === 0)) return null

  const { carrasco, fregues, melhorDupla, piorDupla, duelos } = dados
  const quem = proprio ? 'você' : 'ele'
  return (
    <section>
      <SectionHeader titulo="Rivalidades" subtitulo="Duelos e duplas com o grupo nas partidas que você vê" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CardRival
          titulo="Carrasco" metrica={METRICAS.carrasco} legenda={`quem mais mata ${quem}`} jogador={carrasco} bom={false}
          valor={carrasco?.morri} detalhe={carrasco && `${carrasco.matei} x ${carrasco.morri} nos duelos`}
        />
        <CardRival
          titulo="Freguês" metrica={METRICAS.fregues} legenda={`quem ${quem} mais mata`} jogador={fregues} bom
          valor={fregues && `${Math.round(fregues.dominio)}%`} detalhe={fregues && `${fregues.matei} x ${fregues.morri} nos duelos`}
        />
        <CardRival
          titulo="Melhor dupla" metrica={METRICAS.melhorDupla} legenda="winrate no mesmo time" jogador={melhorDupla} bom
          valor={melhorDupla && `${Math.round(melhorDupla.winrateJuntos)}%`}
          detalhe={melhorDupla && `${melhorDupla.vitoriasJuntos}/${melhorDupla.partidasJuntos} partidas`}
        />
        <CardRival
          titulo="Pé-frio" metrica={METRICAS.peFrio} legenda="pior dupla" jogador={piorDupla} bom={false}
          valor={piorDupla && `${Math.round(piorDupla.winrateJuntos)}%`}
          detalhe={piorDupla && `${piorDupla.vitoriasJuntos}/${piorDupla.partidasJuntos} partidas`}
        />
      </div>

      {duelos.length > 0 && (
        <Card className="mt-3 p-2">
          <DataTable
            head={
              <tr>
                <th className="px-3 py-2">Jogador</th>
                <th className="px-3 py-2 text-right"><Explicacao metrica={METRICAS.matouRival}>Matou</Explicacao></th>
                <th className="px-3 py-2 text-right"><Explicacao metrica={METRICAS.morreuRival}>Morreu</Explicacao></th>
                <th className="px-3 py-2 text-right"><Explicacao metrica={METRICAS.saldoRival}>Saldo</Explicacao></th>
                <th className="hidden px-3 py-2 text-right sm:table-cell"><Explicacao metrica={METRICAS.partidasContra}>Partidas contra</Explicacao></th>
                <th className="hidden px-3 py-2 text-right sm:table-cell"><Explicacao metrica={METRICAS.juntos}>Juntos</Explicacao></th>
              </tr>
            }
          >
            {duelos.map((d) => (
              <tr key={d.steamId}>
                <td className="px-3 py-2">
                  <Link to={`/jogador/${d.steamId}`} className="flex items-center gap-2 text-texto hover:text-destaque-forte">
                    <Avatar p={d} size={24} />
                    <span className="truncate">{d.nick}</span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{d.matei}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{d.morri}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${d.saldo > 0 ? 'text-sucesso' : d.saldo < 0 ? 'text-perigo' : 'text-texto-fraco'}`}>
                  {d.saldo > 0 && <span aria-hidden="true" className="mr-1 text-[11px]">▲</span>}
                  {d.saldo < 0 && <span aria-hidden="true" className="mr-1 text-[11px]">▼</span>}
                  {d.saldo > 0 ? `+${d.saldo}` : d.saldo}
                </td>
                <td className="hidden px-3 py-2 text-right font-mono tabular-nums text-texto-fraco sm:table-cell">{d.partidasContra}</td>
                <td className="hidden px-3 py-2 text-right font-mono tabular-nums text-texto-fraco sm:table-cell">{d.partidasJuntos}</td>
              </tr>
            ))}
          </DataTable>
        </Card>
      )}
    </section>
  )
}
