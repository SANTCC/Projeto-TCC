"""
Módulo de Delegação de Substitutos Operacionais (tools/nexus_api/delegacao.py)
"""

import uuid
from datetime import datetime

def _is_valid_uuid(val):
    if not val:
        return False
    try:
        uuid.UUID(str(val))
        return True
    except ValueError:
        return False

class DelegacaoAPI:
    def __init__(self, client):
        self.client = client

    def get_delegacao_ativa(self):
        dels = self.client.request("GET", "delegacoes_supervisor", params={"select": "*"}) or []
        if isinstance(dels, list):
            for d in dels:
                if d.get("ativo") in (True, "true", "TRUE", 1):
                    return d
        elif isinstance(dels, dict) and dels.get("ativo") in (True, "true", "TRUE", 1):
            return dels
        return None

    def designar_substituto(self, supervisor_titular_id, substituto_id, substituto_cpf, substituto_nome, data_inicio, data_fim_previsto):
        # Revoga delegação ativa atual se houver
        ativa = self.get_delegacao_ativa()
        if ativa and ativa.get("id"):
            self.revogar_delegacao(ativa.get("id"))

        s_tit_id = supervisor_titular_id if _is_valid_uuid(supervisor_titular_id) else None
        sub_id = substituto_id if _is_valid_uuid(substituto_id) else None

        payload = {
            "supervisor_titular_id": s_tit_id,
            "substituto_id": sub_id,
            "substituto_cpf": substituto_cpf or "000.000.000-00",
            "substituto_nome": substituto_nome or "Substituto Operacional",
            "data_inicio": data_inicio,
            "data_fim_previsto": data_fim_previsto,
            "ativo": True
        }
        res = self.client.request("POST", "delegacoes_supervisor", body=payload)
        if isinstance(res, list) and len(res) > 0:
            return res[0]
        return res

    def revogar_delegacao(self, delegacao_id):
        if not _is_valid_uuid(delegacao_id):
            return None
        payload = {
            "ativo": False,
            "data_revogacao": datetime.now().isoformat()
        }
        return self.client.request("PATCH", f"delegacoes_supervisor?id=eq.{delegacao_id}", body=payload)
