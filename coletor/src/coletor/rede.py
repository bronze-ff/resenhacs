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
    # 64:ff9b::/96 (NAT64) e ::/96 (IPv4-compatível, obsoleto) levam o IPv4 nos 32 bits finais.
    if endereco in _NAT64 or int(endereco) >> 32 == 0:
        return ipaddress.IPv4Address(int(endereco) & 0xFFFFFFFF)
    return endereco.sixtofour


def _ip_recusado(ip):
    """Aceita só IP global. IPv4 embutido (::ffff:0:0/96, ::/96, 64:ff9b::/96, 2002::/16)
    passa pela mesma regra."""
    endereco = ipaddress.ip_address(ip.split("%", 1)[0])
    embutido = _ipv4_embutido(endereco)
    if embutido is not None:
        endereco = embutido
    # Multicast conta como global no ipaddress; continua recusado.
    if not endereco.is_global or endereco.is_multicast:
        return True
    return any(endereco in faixa for faixa in _FAIXAS_RECUSADAS if faixa.version == endereco.version)


MAX_URL_HOST_EXATO = 2048


def validar_host_exato(url, hosts_exatos):
    """Allowlist exata (CDN da FACEIT), na URL inicial e em todo redirect: só https, até
    2048 caracteres, sem usuário/senha, porta padrão e host igual, sem sufixo. Vazia
    recusa tudo. A mensagem nunca traz a URL."""
    partes = urllib.parse.urlsplit(url)
    try:
        porta = partes.port
    except ValueError:
        porta = -1
    if (
        len(url) > MAX_URL_HOST_EXATO or partes.scheme != "https"
        or partes.username is not None or partes.password is not None
        or porta not in (None, 443) or partes.hostname not in hosts_exatos
    ):
        raise HostNaoPermitidoError("host fora da allowlist")


def _checar(url, dominios=None, hosts_exatos=None):
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
    if hosts_exatos is not None:
        validar_host_exato(url, hosts_exatos)
    # Falha de DNS propaga como OSError: é transitória, não recusa.
    if any(_ip_recusado(ip) for ip in _resolver(host)):
        raise HostNaoPermitidoError("host resolve para IP interno")


class _Redirects(urllib.request.HTTPRedirectHandler):
    max_redirections = MAX_REDIRECTS

    def __init__(self, hosts_exatos=None):
        super().__init__()
        self.hosts_exatos = hosts_exatos

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _checar(newurl, hosts_exatos=self.hosts_exatos)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def abrir_url(url, timeout, dominios=None, hosts_exatos=None):
    """urlopen com a checagem de host. `dominios` vale só para a URL inicial;
    `hosts_exatos` vale em todo salto."""
    _checar(url, dominios, hosts_exatos)
    opener = urllib.request.build_opener(_Redirects(hosts_exatos), *_TRANSPORTE)
    return opener.open(url, timeout=timeout)
