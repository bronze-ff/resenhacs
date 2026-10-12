// Lista única do JavaScript (client, server e PostHog).
// coletor/src/coletor/palavras.py repete o mesmo texto em PADRAO;
// o teste do Coletor compara os dois.
//
// Sem diferenciar maiúsculas. "_" "-" e espaço separam (api_key, api-key, api key,
// apikey). A fronteira alfanumérica deixa "resenha" fora de "senha" e "tokenizer"
// fora de "token". access_token ainda casa, porque "_" não é letra nem dígito.

export const PALAVRA =
  /(?<![a-z0-9])(?:passwords?|passwds?|pwds?|secrets?|api[-_\s]*keys?|authorizations?|bearers?|cookies?|sessions?|credentials?|private[-_\s]*keys?|access[-_\s]*tokens?|refresh[-_\s]*tokens?|senhas?|tokens?|chaves?|segredos?)(?![a-z0-9])/i

export function chaveSensivel(chave) {
  return typeof chave === 'string' && PALAVRA.test(chave)
}
