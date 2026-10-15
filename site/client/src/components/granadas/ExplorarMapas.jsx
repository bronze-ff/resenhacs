import { nomeMapa } from '../../lib/format.js'
import { Card, Badge, CabecalhoPagina, MapIcon } from '../ui'

export const MAPAS_POOL = ['de_mirage', 'de_dust2', 'de_inferno', 'de_nuke', 'de_overpass', 'de_vertigo', 'de_ancient', 'de_anubis', 'de_train', 'de_cache']

const ROTULO_TIPO = { smoke: 'Smoke', flash: 'Flash', molotov: 'Molotov', he: 'HE' }

// `badges` e `subtitulo` são opcionais (usados por Táticas pra reusar esse mesmo
// grid mapa-first com contagem "N táticas" no canto em vez dos badges por tipo de
// granada). Quando ausentes o componente se comporta exatamente como antes — Granadas
// não muda em nada. `eyebrow` é só o rótulo curto acima do título da página.
export default function ExplorarMapas({ contagens, onEscolher, badges, subtitulo, eyebrow = null }) {
  // contagens: [{map, tipo, total}] -> {map: {tipo: total}}
  const porMapa = {}
  for (const c of contagens ?? []) {
    porMapa[c.map] = { ...(porMapa[c.map] ?? {}), [c.tipo]: c.total }
  }

  return (
    <div>
      <CabecalhoPagina
        eyebrow={eyebrow}
        titulo="Explorar por mapa"
        descricao={subtitulo ?? 'Escolha um mapa pra ver os lineups do grupo.'}
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {MAPAS_POOL.map((m) => {
          const tipos = porMapa[m] ?? {}
          const vazio = contagens != null && Object.keys(tipos).length === 0
          return (
            <Card
              key={m}
              as="button"
              interativo
              onClick={() => onEscolher(m)}
              className="group relative flex aspect-[4/3] flex-col justify-between overflow-hidden p-3 text-left sm:aspect-[16/10] sm:p-4"
            >
              {/* Arte do radar esmaecida ao fundo: identifica o mapa sem competir com o nome. */}
              <div
                aria-hidden="true"
                className={`absolute inset-0 bg-cover bg-center transition-[opacity,transform] duration-300 group-hover:scale-[1.04] ${vazio ? 'opacity-15 grayscale' : 'opacity-35 group-hover:opacity-55'}`}
                style={{ backgroundImage: `url(/radars/${m}.png)` }}
              />
              <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-fundo via-fundo/40 to-transparent" />

              <div className="relative flex items-start justify-between gap-2">
                <MapIcon map={m} size={36} className={`sm:h-11 sm:w-11 ${vazio ? 'opacity-50' : ''}`} />
                <div className="flex flex-wrap justify-end gap-1">
                  {badges ? badges(m) : Object.entries(tipos).map(([tipo, total]) => (
                    <Badge key={tipo} tom="neutro" className="!bg-fundo/80 tabular-nums">
                      {ROTULO_TIPO[tipo]} <span className="text-texto">{total}</span>
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="relative">
                <p className={`font-display text-xl font-semibold leading-none sm:text-2xl ${vazio ? 'text-texto-fraco' : 'text-texto'}`}>
                  {nomeMapa(m)}
                </p>
                {vazio && !badges && <p className="rotulo mt-1.5">Sem lineups ainda</p>}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
