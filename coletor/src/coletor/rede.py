"""Download HTTP do Coletor com checagem de host na URL inicial e em cada redirect (R120).

As URLs de Demo vêm de fora (Game Coordinator, HLTV, FACEIT). Sem esta checagem, um
redirect levaria o runner a abrir 169.254.169.254 (metadados da nuvem) ou a rede interna.
"""

import ipaddress
import socket
import urllib.parse
import urllib.request

MAX_REDIRECTS = 5


class HostNaoPermitidoError(Exception):
    """URL com esquema ou host recusado. Definitivo: tentar de novo não muda o resultado."""


def _resolver(host):
    return [info[4][0] for info in socket.getaddrinfo(host, None)]


# Testes trocam por handlers falsos (sem rede real).
_TRANSPORTE = ()


# is_global ainda deixa passar estas faixas; os prefixos de tradução levam IPv4 embutido.
_FAIXAS_RECUSADAS = (ipaddress.ip_network("100.64.0.0/10"), ipaddress.ip_network("fec0::/10"))
_NAT64 = ipaddress.ip_network("64:ff9b::/96")


def _ipv4_embutido(endereco):
    if endereco.version != 6:
        return None
    if endereco.ipv4_mapped:
        return endereco.ipv4_mapped
    if endereco in _NAT64:
        return ipaddress.IPv4Address(int(endereco) & 0xFFFFFFFF)
    return endereco.sixtofour


def _ip_recusado(ip):
    """Aceita só IP global. IPv4 embutido (::ffff:0:0/96, 64:ff9b::/96, 2002::/16)
    passa pela mesma regra."""
    endereco = ipaddress.ip_address(ip.split("%", 1)[0])
    embutido = _ipv4_embutido(endereco)
    if embutido is not None:
        endereco = embutido
    # Multicast conta como global no ipaddress; continua recusado.
    if not endereco.is_global or endereco.is_multicast:
        return True
    return any(endereco in faixa for faixa in _FAIXAS_RECUSADAS if faixa.version == endereco.version)


def _checar(url, dominios=None):
    # shortcut: DNS rebinding entre esta checagem e a conexão não está coberto; fixar o IP
    # resolvido na conexão se a origem das URLs deixar de ser Valve/HLTV/FACEIT.
    partes = urllib.parse.urlsplit(url)
    if partes.scheme not in ("http", "https"):
        raise HostNaoPermitidoError("esquema não permitido")
    host = (partes.hostname or "").rstrip(".")
    if not host:
        raise HostNaoPermitidoError("URL sem host")
    if dominios and not any(host == d or host.endswith("." + d) for d in dominios):
        raise HostNaoPermitidoError("domínio fora da lista")
    # Falha de DNS propaga como OSError: é transitória, não recusa.
    if any(_ip_recusado(ip) for ip in _resolver(host)):
        raise HostNaoPermitidoError("host resolve para IP interno")


class _Redirects(urllib.request.HTTPRedirectHandler):
    max_redirections = MAX_REDIRECTS

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _checar(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def abrir_url(url, timeout, dominios=None):
    """urlopen com a checagem de host. `dominios` vale só para a URL inicial."""
    _checar(url, dominios)
    opener = urllib.request.build_opener(_Redirects, *_TRANSPORTE)
    return opener.open(url, timeout=timeout)
