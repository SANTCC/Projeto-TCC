"""
Módulo do Botão de Pânico Global e Emergências (tools/nexus_api/panic.py)
Acessa a Edge Function panic-alert ou realiza fallback direto na tabela public.emergencias
"""

from datetime import datetime

class PanicAPI:
    def __init__(self, client):
        self.client = client

    def get_emergencia_ativa(self):
        res = self.client.request("GET", "emergencias", params={"estado": "eq.ATIVA", "select": "*"}) or []
        if isinstance(res, list) and len(res) > 0:
            for r in res:
                if r.get("estado") == "ATIVA":
                    return r
        elif isinstance(res, dict) and res.get("estado") == "ATIVA":
            return res
        return None

    def trigger_panic(self, motivo=None, acionado_por_nome=None, acionado_por_cargo=None, acionado_por_codigo=None):
        payload = {
            "motivo": motivo or "Acionamento de emergência operacional",
            "acionado_por_nome": acionado_por_nome or "Operador NexusPort",
            "acionado_por_cargo": acionado_por_cargo or "SUPERVISOR_GERENTE_OPERACOES",
            "acionado_por_codigo": acionado_por_codigo or "SUP-001"
        }

        # 1. Tenta chamar a Edge Function panic-alert
        try:
            edge_res = self.client.request("POST", "panic-alert", body=payload, is_edge_function=True)
            if edge_res and isinstance(edge_res, dict) and not edge_res.get("error"):
                return edge_res
        except Exception:
            pass

        # 2. Fallback direto na tabela emergencias
        db_payload = {
            "estado": "ATIVA",
            "motivo": payload["motivo"],
            "acionado_por_nome": payload["acionado_por_nome"],
            "acionado_por_cargo": payload["acionado_por_cargo"],
            "acionado_por_codigo": payload["acionado_por_codigo"],
            "data_hora": datetime.now().isoformat(),
            "origem": "CLIENT_FALLBACK"
        }
        res = self.client.request("POST", "emergencias", body=db_payload)
        if isinstance(res, list) and len(res) > 0:
            return res[0]
        return res

    def resolve_panic(self, emergencia_id, resolvido_por_nome=None, resolvido_por_cargo=None):
        payload = {
            "estado": "RESOLVIDA",
            "resolvido_por_nome": resolvido_por_nome or "Supervisor Responsável",
            "resolvido_por_cargo": resolvido_por_cargo or "SUPERVISOR_GERENTE_OPERACOES",
            "data_resolucao": datetime.now().isoformat()
        }
        return self.client.request("PATCH", f"emergencias?id=eq.{emergencia_id}", body=payload)
