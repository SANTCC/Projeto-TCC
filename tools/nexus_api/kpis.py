"""
Módulo de KPIs e Indicadores Consolidados (tools/nexus_api/kpis.py)
Reutiliza a mesma lógica agregadora de NexusRepository.buscarIndicadoresOperacionais
"""

from .cargas import CargasAPI
from .embarcacoes import EmbarcacoesAPI
from .manutencao import ManutencaoAPI

class KPIsAPI:
    def __init__(self, client):
        self.client = client
        self.cargas_api = CargasAPI(client)
        self.embarcacoes_api = EmbarcacoesAPI(client)
        self.manutencao_api = ManutencaoAPI(client)

    def buscar_cargas_recusadas(self):
        cargas = self.cargas_api.get_cargas()
        recusadas = [c for c in cargas if c.get("status") == "RECUSADA"]
        canceladas = [c for c in cargas if c.get("status") == "CANCELADA"]

        return {
            "recusadas": recusadas,
            "canceladas": canceladas,
            "totalRecusadas": len(recusadas),
            "totalCanceladas": len(canceladas),
            "totalGeral": len(recusadas) + len(canceladas)
        }

    def calcular_kpis_edge_function(self, codigo_individual=None):
        """
        Calcula os KPIs através da Edge Function 'kpis-calculo'.
        """
        payload = {}
        if codigo_individual:
            payload["codigo_individual"] = codigo_individual
        res = self.client.invoke_edge_function("kpis-calculo", body=payload, method="POST")
        if res and isinstance(res, dict) and res.get("ok"):
            return res
        return None

    def buscar_indicadores_operacionais(self):
        cargas = self.cargas_api.get_cargas()
        navios = self.embarcacoes_api.get_navios()
        manutencoes = self.manutencao_api.get_manutencoes()

        recusadas_obj = self.buscar_cargas_recusadas()
        preventiva_obj = self.manutencao_api.buscar_equipamentos_preventiva_sugerida()

        navios_fora = [n for n in navios if n.get("localizacao") in ("FORA_DO_PORTO", "NO_PORTO_DE_DESTINO")]
        cargas_armazenagem = [c for c in cargas if c.get("status") == "ARMAZENAGEM"]
        cargas_prontas = [c for c in cargas if c.get("status") == "PRONTA_PARA_ENTREGA"]

        navios_manut = [n for n in navios if n.get("estado") in ("EM_MANUTENCAO", "AGENDADO_PARA_REFORMA")]
        os_em_manut = [m for m in manutencoes if m.get("status") in ("SOLICITADA", "APROVADA")]

        CAPACIDADE_MAXIMA_PATIO = 100
        taxa_ocupacao = min(100, round((len(cargas_armazenagem) / CAPACIDADE_MAXIMA_PATIO) * 100))

        return {
            "recusadas": recusadas_obj,
            "preventiva": preventiva_obj,
            "naviosFora": {"lista": navios_fora, "total": len(navios_fora)},
            "cargasArmazenagem": {"lista": cargas_armazenagem, "total": len(cargas_armazenagem)},
            "cargasProntas": {"lista": cargas_prontas, "total": len(cargas_prontas)},
            "manutencao": {
                "navios": navios_manut,
                "ordens": os_em_manut,
                "total": len(navios_manut) + len(os_em_manut)
            },
            "ocupacaoPatio": {
                "capacidade": CAPACIDADE_MAXIMA_PATIO,
                "ocupados": len(cargas_armazenagem),
                "taxa": taxa_ocupacao
            }
        }
