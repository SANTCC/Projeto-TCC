"""
Pacote NexusPort Python Suite (tools/nexus_api)
Interface 1:1 com o back-end e API da aplicação NexusPort (Terminal STS-01 Santos)
"""

from .config import load_config
from .client import NexusClient
from .auth import NexusAuth
from .cargas import CargasAPI
from .embarcacoes import EmbarcacoesAPI
from .inspecoes import InspecoesAPI
from .manutencao import ManutencaoAPI
from .tecnico import TecnicoAPI
from .delegacao import DelegacaoAPI
from .panic import PanicAPI
from .auditoria import AuditoriaAPI
from .kpis import KPIsAPI

class NexusPortApp:
    """
    Suíte Python unificada do NexusPort.
    Oferece acesso 1:1 a todas as funcionalidades do front-end e da API.
    """

    def __init__(self, supabase_url=None, supabase_key=None, config_path=None):
        self.client = NexusClient(supabase_url=supabase_url, supabase_key=supabase_key, config_path=config_path)
        self.auth = NexusAuth(self.client)
        self.cargas = CargasAPI(self.client)
        self.embarcacoes = EmbarcacoesAPI(self.client)
        self.inspecoes = InspecoesAPI(self.client)
        self.manutencao = ManutencaoAPI(self.client)
        self.tecnico = TecnicoAPI(self.client)
        self.delegacao = DelegacaoAPI(self.client)
        self.panic = PanicAPI(self.client)
        self.auditoria = AuditoriaAPI(self.client)
        self.kpis = KPIsAPI(self.client)

    def login(self, identificador, cargo_hint=None):
        return self.auth.login(identificador, cargo_hint=cargo_hint)

    def logout(self):
        self.auth.logout()

    def get_session(self):
        return self.auth.get_session()

__all__ = [
    "NexusPortApp",
    "NexusClient",
    "NexusAuth",
    "CargasAPI",
    "EmbarcacoesAPI",
    "InspecoesAPI",
    "ManutencaoAPI",
    "TecnicoAPI",
    "DelegacaoAPI",
    "PanicAPI",
    "AuditoriaAPI",
    "KPIsAPI",
    "load_config"
]
