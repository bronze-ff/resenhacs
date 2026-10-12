// A implementação mora no server: o deploy da API não empacota arquivo fora de
// site/server, e o Vite embute este reexport no bundle do client.
export {
  REDACTED,
  chaveSensivel,
  soOrigemCaminho,
  redigirString,
  scrubValor,
  minimizarEvento,
  minimizarSpan,
  minimizarBreadcrumb,
} from '../../../server/src/observabilidade/scrub.js'
