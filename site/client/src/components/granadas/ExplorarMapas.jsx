import { nomeMapa } from '../../lib/format.js'

export const MAPAS_POOL = ['de_mirage', 'de_dust2', 'de_inferno', 'de_nuke', 'de_overpass', 'de_vertigo', 'de_ancient', 'de_anubis', 'de_train', 'de_cache']

const ROTULO_TIPO = { smoke: 'Smoke', flash: 'Flash', molotov: 'Molotov', he: 'HE' }

// `badges` e `subtitulo` são opcionais (usados por Táticas pra reusar esse mesmo
// grid mapa-first com contagem "N táticas" no canto em vez dos badges por tipo de
// granada). Quando ausentes o componente se comporta exatamente como antes — Granadas
// não muda em nada.
export default function ExplorarMapas({ contagens, onEscolher, badges, subtitulo }) {
  // contagens: [{map, tipo, total}] -> {map: {tipo: total}}
  const porMapa = {}
  for (const c of contagens ?? []) {
    porMapa[c.map] = { ...(porMapa[c.map] ?? {}), [c.tipo]: c.total }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">Explorar por mapa</h2>
        <p className="font-mono text-sm text-texto-fraco">{subtitulo ?? 'Escolha um mapa pra ver os lineups do grupo.'}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MAPAS_POOL.map((m) => {
          const tipos = porMapa[m] ?? {}
          const vazio = Object.keys(tipos).length === 0
          return (
            <button
              key={m}
              onClick={() => onEscolher(m)}
              className={`panel-cut group relative overflow-hidden border border-borda bg-superficie text-left transition-colors hover:border-destaque ${vazio ? 'opacity-60' : ''}`}
            >
              <div
                className="h-36 bg-cover bg-center opacity-50 transition-opacity group-hover:opacity-70"
                style={{ backgroundImage: `url(/radars/${m}.png)` }}
              />
              <div className="absolute right-2 top-2 flex gap-1">
                {badges ? badges(m) : Object.entries(tipos).map(([tipo, total]) => (
                  <span key={tipo} className="panel-cut-sm border border-destaque/40 bg-fundo/80 px-1.5 py-0.5 font-mono text-[10px] uppercase text-destaque">
                    {ROTULO_TIPO[tipo]} {total}
                  </span>
                ))}
              </div>
              <p className="absolute bottom-2 left-3 font-display text-lg font-bold uppercase tracking-wide text-texto">
                {nomeMapa(m)}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
