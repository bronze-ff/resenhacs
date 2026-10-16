import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, classesBotao } from '../ui'

// "Primeiros passos" do Início: o que falta pra o site funcionar sozinho pra este
// jogador. Some quando tudo obrigatório está feito (FACEIT é opcional) ou quando ele
// dispensa (lembrado só neste navegador).
const CHAVE_DISPENSADO = 'resenha_primeiros_passos_dispensado'

export function montarPassos(estado) {
  return [
    {
      id: 'steam', feito: true, obrigatorio: true,
      titulo: 'Entrar com a Steam', desc: 'Feito.',
    },
    {
      id: 'amigos', feito: estado.amigos > 0, obrigatorio: true,
      titulo: 'Adicionar amigos',
      desc: estado.amigos > 0 ? `${estado.amigos} amigo${estado.amigos === 1 ? '' : 's'} no grupo.` : 'Você vê as partidas dos seus amigos aceitos e eles veem as suas.',
      acao: 'Adicionar', para: '/jogadores',
    },
    {
      id: 'codigo', feito: estado.codigoHistorico, obrigatorio: true,
      titulo: 'Colar o código de histórico da Steam',
      desc: estado.codigoHistorico ? 'Configurado — o Coletor busca suas partidas de Premier sozinho.' : 'Sem ele o site não acha suas partidas de Premier sozinho. Leva 1 minuto.',
      acao: 'Configurar', para: '/conta',
    },
    {
      id: 'faceit', feito: estado.faceit, obrigatorio: false,
      titulo: 'Vincular a FACEIT (opcional)',
      desc: estado.faceit ? 'Vinculada.' : 'Pra importar também suas partidas da FACEIT.',
      acao: 'Vincular', para: '/conta',
    },
  ]
}

function lerDispensado() {
  try {
    return localStorage.getItem(CHAVE_DISPENSADO) === '1'
  } catch {
    return false
  }
}

export function usePrimeirosPassos() {
  const [estado, setEstado] = useState(null)
  useEffect(() => {
    fetch('/api/primeiros-passos')
      .then((res) => (res.ok ? res.json() : null))
      .then(setEstado)
      .catch(() => setEstado(null))
  }, [])
  if (!estado) return null
  const passos = montarPassos(estado)
  const feitos = passos.filter((p) => p.feito).length
  const completo = passos.filter((p) => p.obrigatorio).every((p) => p.feito)
  return { passos, feitos, total: passos.length, completo }
}

export default function PrimeirosPassos() {
  const dados = usePrimeirosPassos()
  const [dispensado, setDispensado] = useState(lerDispensado)
  if (!dados || dados.completo || dispensado) return null

  function dispensar() {
    setDispensado(true)
    try {
      localStorage.setItem(CHAVE_DISPENSADO, '1')
    } catch {
      // só nesta visita
    }
  }

  return (
    <Card as="section" aria-labelledby="titulo-primeiros-passos" className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="titulo-primeiros-passos" className="font-display text-base font-semibold text-texto">Primeiros passos</h2>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-texto-fraco">{dados.feitos} de {dados.total}</span>
          <button type="button" onClick={dispensar} className="text-xs text-texto-fraco hover:text-texto">Dispensar</button>
        </div>
      </div>
      <ol className="mt-2">
        {dados.passos.map((p, i) => (
          <li key={p.id} className="flex items-center gap-4 border-t border-borda py-3 first:border-t-0">
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] ${p.feito ? 'border border-sucesso/40 bg-sucesso/10 text-sucesso' : 'border border-borda-forte text-texto-fraco'}`}
            >
              {p.feito ? '✓' : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${p.feito ? 'text-texto-fraco line-through' : 'text-texto'}`}>
                {p.titulo}
                <span className="sr-only">{p.feito ? ' — feito' : ' — pendente'}</span>
              </p>
              <p className="text-[13px] text-texto-fraco">{p.desc}</p>
            </div>
            {!p.feito && p.para && (
              <Link
                to={p.para}
                className={classesBotao({ variante: p.obrigatorio && dados.passos.find((x) => !x.feito)?.id === p.id ? 'primario' : 'secundario', tamanho: 'sm' })}
              >
                {p.acao}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}
