import { nomeMapa } from '../../lib/format.js'
import { Card, Badge, SectionHeader } from '../ui'

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
        <SectionHeader titulo="Explorar por mapa" className="mb-1" />
        <p className="font-mono text-sm text-texto-fraco">{subtitulo ?? 'Escolha um mapa pra ver os lineups do grupo.'}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MAPAS_POOL.map((m) => {
          const tipos = porMapa[m] ?? {}
          const vazio = Object.keys(tipos).length === 0
          return (
            <Card
              key={m}
              as="button"
              interativo
              onClick={() => onEscolher(m)}
              className={`group relative overflow-hidden text-left ${vazio ? 'opacity-60' : ''}`}
            >
              <div
                className="h-36 bg-cover bg-center opacity-50 transition-opacity group-hover:opacity-70"
                style={{ backgroundImage: `url(/radars/${m}.png)` }}
              />
              <div className="absolute right-2 top-2 flex gap-1">
                {badges ? badges(m) : Object.entries(tipos).map(([tipo, total]) => (
                  <Badge key={tipo} tom="destaque" className="!bg-fundo/80">
                    {ROTULO_TIPO[tipo]} {total}
                  </Badge>
                ))}
              </div>
              <p className="absolute bottom-2 left-3 font-display text-lg font-bold uppercase tracking-wide text-texto">
                {nomeMapa(m)}
              </p>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
