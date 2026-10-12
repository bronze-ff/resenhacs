"""Lista única de palavras sensíveis do Coletor.

O texto de PADRAO é o mesmo de site/server/src/observabilidade/palavras.js.
O teste compara os dois. Não duplique o padrão em observabilidade.py.
"""

import re

PADRAO = (
    r"(?<![a-z0-9])(?:passwords?|passwds?|pwds?|secrets?|api[-_\s]*keys?"
    r"|authorizations?|bearers?|cookies?|sessions?|credentials?|private[-_\s]*keys?"
    r"|access[-_\s]*tokens?|refresh[-_\s]*tokens?|senhas?|tokens?|chaves?|segredos?)(?![a-z0-9])"
)
PALAVRA = re.compile(PADRAO, re.IGNORECASE)


def chave_sensivel(chave):
    return isinstance(chave, str) and PALAVRA.search(chave) is not None
