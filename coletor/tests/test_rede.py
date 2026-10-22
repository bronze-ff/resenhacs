import email.message
import io
import sys
import urllib.error
import urllib.response
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import rede
from coletor.rede import HostNaoPermitidoError

# host -> IP; o resolver falso nunca toca DNS de verdade.
DNS = {
    "replay.valve.net": "155.133.226.1",
    "www.hltv.org": "104.16.1.1",
    "cdn.hltv.org": "104.16.1.2",
    "demos.faceit.com": "34.120.1.1",
    "outro.com": "93.184.216.34",
    "interno.local": "10.0.0.5",
    "cdn.demos-teste.example": "34.120.2.1",
    "sub.cdn.demos-teste.example": "34.120.2.2",
}


class _Transporte(urllib.request.HTTPHandler, urllib.request.HTTPSHandler):
    """Responde sem rede: URL em `rotas` vira redirect 302; o resto, 200 com corpo."""

    def __init__(self, rotas):
        super().__init__()
        self.rotas = rotas
        self.abertas = []

    def _responder(self, req):
        url = req.full_url
        self.abertas.append(url)
        cabecalhos = email.message.Message()
        if url in self.rotas:
            cabecalhos["Location"] = self.rotas[url]
            resp = urllib.response.addinfourl(io.BytesIO(b""), cabecalhos, url, 302)
            resp.msg = "Found"
            return resp
        resp = urllib.response.addinfourl(io.BytesIO(b"ok"), cabecalhos, url, 200)
        resp.msg = "OK"
        return resp

    http_open = _responder
    https_open = _responder


@pytest.fixture
def transporte(monkeypatch):
    monkeypatch.setattr(rede, "_resolver", lambda host: [DNS.get(host) or host])
    t = _Transporte({})
    monkeypatch.setattr(rede, "_TRANSPORTE", (t,))
    return t


def test_redirect_publico_e_aceito(transporte):
    transporte.rotas["https://replay.valve.net/a.dem.bz2"] = "https://outro.com/b.dem.bz2"
    with rede.abrir_url("https://replay.valve.net/a.dem.bz2", timeout=5) as resp:
        assert resp.read() == b"ok"
    assert transporte.abertas == ["https://replay.valve.net/a.dem.bz2", "https://outro.com/b.dem.bz2"]


@pytest.mark.parametrize("destino", [
    "http://127.0.0.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.1.2.3/x",
    "http://interno.local/x",
    "http://[::1]/x",
    "http://[::ffff:127.0.0.1]/x",
    "http://0.0.0.0/x",
    "http://224.0.0.1/x",
])
def test_redirect_para_ip_interno_e_recusado(transporte, destino):
    transporte.rotas["https://replay.valve.net/a.dem.bz2"] = destino
    with pytest.raises(HostNaoPermitidoError):
        rede.abrir_url("https://replay.valve.net/a.dem.bz2", timeout=5)
    assert transporte.abertas == ["https://replay.valve.net/a.dem.bz2"]


def test_url_inicial_interna_e_recusada_sem_abrir(transporte):
    with pytest.raises(HostNaoPermitidoError):
        rede.abrir_url("http://127.0.0.1:8080/x", timeout=5)
    assert transporte.abertas == []


def test_esquema_que_nao_e_http_e_recusado(transporte):
    with pytest.raises(HostNaoPermitidoError):
        rede.abrir_url("file:///etc/passwd", timeout=5)
    transporte.rotas["https://replay.valve.net/a"] = "ftp://outro.com/x"
    with pytest.raises((HostNaoPermitidoError, urllib.error.HTTPError)):
        rede.abrir_url("https://replay.valve.net/a", timeout=5)


def test_dominios_valem_so_na_url_inicial(transporte):
    with pytest.raises(HostNaoPermitidoError):
        rede.abrir_url("https://outro.com/x.rar", timeout=5, dominios=("hltv.org",))
    with pytest.raises(HostNaoPermitidoError):
        rede.abrir_url("https://hltv.org.outro.com/x.rar", timeout=5, dominios=("hltv.org",))
    transporte.rotas["https://www.hltv.org/download/demo/1"] = "https://outro.com/1.rar"
    with rede.abrir_url("https://www.hltv.org/download/demo/1", timeout=5, dominios=("hltv.org",)) as resp:
        assert resp.read() == b"ok"


def test_redirect_de_hltv_para_ip_interno_e_recusado(transporte):
    transporte.rotas["https://www.hltv.org/download/demo/1"] = "http://169.254.169.254/"
    with pytest.raises(HostNaoPermitidoError):
        rede.abrir_url("https://www.hltv.org/download/demo/1", timeout=5, dominios=("hltv.org",))


def test_mais_de_5_redirects_e_recusado(transporte):
    for i in range(6):
        transporte.rotas[f"https://outro.com/{i}"] = f"https://outro.com/{i + 1}"
    with pytest.raises(urllib.error.HTTPError):
        rede.abrir_url("https://outro.com/0", timeout=5)
    assert len(transporte.abertas) == 6


def test_5_redirects_passam(transporte):
    for i in range(5):
        transporte.rotas[f"https://outro.com/{i}"] = f"https://outro.com/{i + 1}"
    with rede.abrir_url("https://outro.com/0", timeout=5) as resp:
        assert resp.read() == b"ok"


# Codex P1 no PR #110: só IP global; IPv4 embutido em IPv6 passa pela mesma regra.
@pytest.mark.parametrize("ip", [
    "100.64.0.1", "100.127.255.254",          # 100.64.0.0/10 (RFC 6598)
    "fec0::1",                                # site-local
    "::ffff:10.0.0.1", "::ffff:169.254.169.254",  # ::ffff:0:0/96
    "64:ff9b::a9fe:a9fe", "64:ff9b::7f00:1",  # 64:ff9b::/96 (169.254.169.254, 127.0.0.1)
    "2002:a9fe:a9fe::1", "2002:0a00:0001::1",  # 2002::/16 (169.254.169.254, 10.0.0.1)
    "192.0.0.8", "198.18.0.1", "fc00::1",    # não globais
    "::7f00:1", "::a9fe:a9fe", "::a00:1",     # IPv4-compatível ::/96 (127.0.0.1, 169.254.169.254, 10.0.0.1)
])
def test_ip_fora_do_global_e_recusado(ip):
    assert rede._ip_recusado(ip)


@pytest.mark.parametrize("ip", [
    "155.133.226.1", "2606:4700::1111",
    "::ffff:155.133.226.1", "64:ff9b::9b85:e201", "2002:9b85:e201::1",
])
def test_ip_global_e_aceito(ip):
    assert not rede._ip_recusado(ip)


# X-COL: hosts_exatos (allowlist do CDN da FACEIT) vale em TODO salto, por igualdade.
HOSTS = ("cdn.demos-teste.example",)


def test_hosts_exatos_aceita_o_host_igual_e_o_redirect_para_ele(transporte):
    transporte.rotas["https://cdn.demos-teste.example/a.dem.gz"] = "https://cdn.demos-teste.example/b.dem.gz"
    with rede.abrir_url("https://cdn.demos-teste.example/a.dem.gz", timeout=5, hosts_exatos=HOSTS) as resp:
        assert resp.read() == b"ok"


@pytest.mark.parametrize("url", [
    "https://outro.com/a.dem.gz",
    "https://sub.cdn.demos-teste.example/a.dem.gz",  # sufixo não vale
    "http://cdn.demos-teste.example/a.dem.gz",       # só https
])
def test_hosts_exatos_recusa_url_inicial_fora_da_lista_sem_abrir(transporte, url):
    with pytest.raises(HostNaoPermitidoError):
        rede.abrir_url(url, timeout=5, hosts_exatos=HOSTS)
    assert transporte.abertas == []


@pytest.mark.parametrize("destino", [
    "https://outro.com/b.dem.gz",
    "https://sub.cdn.demos-teste.example/b.dem.gz",
    "http://cdn.demos-teste.example/b.dem.gz",
])
def test_hosts_exatos_recusa_redirect_para_fora_da_lista(transporte, destino):
    transporte.rotas["https://cdn.demos-teste.example/a.dem.gz"] = destino
    with pytest.raises(HostNaoPermitidoError):
        rede.abrir_url("https://cdn.demos-teste.example/a.dem.gz", timeout=5, hosts_exatos=HOSTS)
    assert transporte.abertas == ["https://cdn.demos-teste.example/a.dem.gz"]


def test_hosts_exatos_vazio_recusa_tudo(transporte):
    with pytest.raises(HostNaoPermitidoError):
        rede.abrir_url("https://cdn.demos-teste.example/a.dem.gz", timeout=5, hosts_exatos=())
    assert transporte.abertas == []


def test_hosts_exatos_mantem_a_regra_de_ip(transporte, monkeypatch):
    monkeypatch.setattr(rede, "_resolver", lambda host: ["10.0.0.9"])
    with pytest.raises(HostNaoPermitidoError):
        rede.abrir_url("https://cdn.demos-teste.example/a.dem.gz", timeout=5, hosts_exatos=HOSTS)


def test_sem_hosts_exatos_o_redirect_segue_so_a_regra_de_ip(transporte):
    transporte.rotas["https://outro.com/a"] = "https://sub.cdn.demos-teste.example/b"
    with rede.abrir_url("https://outro.com/a", timeout=5) as resp:
        assert resp.read() == b"ok"
