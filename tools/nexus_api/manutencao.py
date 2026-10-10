"""
Módulo de Gestão de Manutenção e Ordens de Serviço (tools/nexus_api/manutencao.py)
Aplica o ciclo de vida de OS e a busca unificada de preventiva sugerida (> 3 anos)
"""

from datetime import datetime

from .uuid_utils import is_valid_uuid, uuid_or_none

class ManutencaoAPI:
    def __init__(self, client):
        self.client = client

    def get_manutencoes(self):
        return self.client.request("GET", "manutencoes", params={"select": "*"}) or []

    def get_manutencao(self, os_id):
        os_list = self.get_manutencoes()
        target_id = str(os_id)
        for o in os_list:
            if str(o.get("id")) == target_id:
                return o
        return None

    def solicitar_manutencao(self, entidade_tipo, entidade_id, descricao, solicitado_por=None):
        # Chaves estrangeiras da OS são uuid: entidade inválida é recusada antes de chegar ao banco
        if entidade_tipo in ("NAVIO", "CONTAINER", "GUINDASTE") and not is_valid_uuid(entidade_id):
            raise ValueError(f"ID de {entidade_tipo.lower()} inválido (esperado UUID): {entidade_id!r}")

        payload = {
            "entidade_tipo": entidade_tipo,
            "descricao": descricao,
            "status": "SOLICITADA",
            "data_solicitacao": datetime.now().isoformat(),
            "solicitado_por": uuid_or_none(solicitado_por)
        }
        if entidade_tipo == "NAVIO":
            payload["navio_id"] = str(entidade_id)
        elif entidade_tipo == "CONTAINER":
            payload["container_id"] = str(entidade_id)
        elif entidade_tipo == "GUINDASTE":
            payload["guindaste_id"] = str(entidade_id)

        res = self.client.request("POST", "manutencoes", body=payload)
        if isinstance(res, list) and len(res) > 0:
            return res[0]
        return res

    def aprovar_manutencao(self, os_id, aprovado_por=None):
        if not is_valid_uuid(os_id):
            return None
        payload = {
            "status": "APROVADA",
            "data_aprovacao": datetime.now().isoformat(),
            "aprovado_por": uuid_or_none(aprovado_por)
        }
        return self.client.request("PATCH", f"manutencoes?id=eq.{os_id}", body=payload)

    def recusar_manutencao(self, os_id, aprovado_por=None, motivo=None):
        if not is_valid_uuid(os_id):
            return None
        payload = {
            "status": "RECUSADA",
            "data_aprovacao": datetime.now().isoformat(),
            "aprovado_por": uuid_or_none(aprovado_por)
        }
        return self.client.request("PATCH", f"manutencoes?id=eq.{os_id}", body=payload)

    def concluir_manutencao(self, os_id):
        if not is_valid_uuid(os_id):
            return None
        payload = {
            "status": "CONCLUIDA",
            "data_conclusao": datetime.now().isoformat()
        }
        return self.client.request("PATCH", f"manutencoes?id=eq.{os_id}", body=payload)

    def solicitar_manutencao_guindaste(self, guindaste_id, solicitado_por=None):
        if not is_valid_uuid(guindaste_id):
            return None
        self.client.request("PATCH", f"guindastes?id=eq.{guindaste_id}", body={"estado": "EM_MANUTENCAO"})
        return self.solicitar_manutencao("GUINDASTE", guindaste_id, "Manutenção de guindaste", solicitado_por)

    def concluir_manutencao_guindaste(self, guindaste_id):
        if not is_valid_uuid(guindaste_id):
            return None
        self.client.request("PATCH", f"guindastes?id=eq.{guindaste_id}", body={"estado": "OPERANTE"})
        os_list = self.get_manutencoes()
        for o in os_list:
            if str(o.get("guindaste_id")) == str(guindaste_id) and o.get("status") in ("SOLICITADA", "APROVADA"):
                self.concluir_manutencao(o.get("id"))

    def buscar_equipamentos_preventiva_sugerida(self):
        """
        Função unificada que busca contêineres, guindastes e navios
        com data de última manutenção ou fabricação com mais de 3 anos (> 1095 dias).
        """
        agora = datetime.now()
        limite_dias = 3 * 365
        equipamentos = []

        conts = self.client.request("GET", "containers", params={"select": "*"}) or []
        for c in conts:
            d_str = c.get("data_ultima_manutencao") or c.get("data_fabricacao")
            if d_str:
                try:
                    d_dt = datetime.fromisoformat(str(d_str).replace("Z", "").split("+")[0])
                    diff_dias = (agora - d_dt).days
                    if diff_dias >= limite_dias:
                        equipamentos.append({
                            "tipo": "CONTAINER",
                            "identificacao": c.get("numero_identificacao") or f"CONT-{c.get('id')}",
                            "dataReferencia": d_str,
                            "motivo": f"Última manutenção/fabricação em {d_dt.strftime('%d/%m/%Y')} (> 3 anos de uso)",
                            "rawObj": c
                        })
                except Exception:
                    pass

        guindastes = self.client.request("GET", "guindastes", params={"select": "*"}) or []
        for g in guindastes:
            d_str = g.get("data_ultima_manutencao")
            if d_str:
                try:
                    d_dt = datetime.fromisoformat(str(d_str).replace("Z", "").split("+")[0])
                    diff_dias = (agora - d_dt).days
                    if diff_dias >= limite_dias:
                        equipamentos.append({
                            "tipo": "GUINDASTE",
                            "identificacao": g.get("numero_identificacao") or f"GND-{g.get('id')}",
                            "dataReferencia": d_str,
                            "motivo": f"Última manutenção em {d_dt.strftime('%d/%m/%Y')} (> 3 anos)",
                            "rawObj": g
                        })
                except Exception:
                    pass

        navios = self.client.request("GET", "navios", params={"select": "*"}) or []
        for n in navios:
            d_str = n.get("data_registro_sistema") or n.get("data_saida") or n.get("created_at")
            if d_str:
                try:
                    d_dt = datetime.fromisoformat(str(d_str).replace("Z", "").split("+")[0])
                    diff_dias = (agora - d_dt).days
                    if diff_dias >= limite_dias:
                        equipamentos.append({
                            "tipo": "NAVIO",
                            "identificacao": n.get("nome"),
                            "dataReferencia": d_str,
                            "motivo": f"Registro/reforma em {d_dt.strftime('%d/%m/%Y')} (> 3 anos)",
                            "rawObj": n
                        })
                except Exception:
                    pass

        return {
            "equipamentos": equipamentos,
            "total": len(equipamentos)
        }
