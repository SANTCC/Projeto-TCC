"""
Módulo de Auditoria, Trail de Decisões, Retificações e Scanner QR Code (tools/nexus_api/auditoria.py)
"""

from datetime import datetime

class AuditoriaAPI:
    def __init__(self, client):
        self.client = client

    def get_logs_alteracoes(self):
        return self.client.request("GET", "logs_alteracoes", params={"select": "*"}) or []

    def get_trail_decisoes(self):
        return self.client.request("GET", "trail_decisoes", params={"select": "*"}) or []

    def log_alteracao(self, entidade_tipo, entidade_id, tipo_alteracao, detalhes=None, funcionario_info=None):
        payload = {
            "data_hora": datetime.now().isoformat(),
            "entidade_tipo": entidade_tipo,
            "entidade_id": str(entidade_id),
            "tipo_alteracao": tipo_alteracao,
            "detalhes": detalhes or {}
        }
        if funcionario_info:
            payload["funcionario_id"] = funcionario_info.get("id")
            payload["cargo"] = funcionario_info.get("cargo")
            payload["codigo_individual"] = funcionario_info.get("codigo_individual")

        return self.client.request("POST", "logs_alteracoes", body=payload)

    def registrar_trail_decisao(self, tipo_decisao, entidade_tipo, entidade_id, motivo=None, detalhes=None, funcionario_info=None):
        payload = {
            "data_hora": datetime.now().isoformat(),
            "tipo_decisao": tipo_decisao,
            "entidade_tipo": entidade_tipo,
            "entidade_id": str(entidade_id),
            "motivo": motivo,
            "detalhes": detalhes or {}
        }
        if funcionario_info:
            payload["funcionario_id"] = funcionario_info.get("id")
            payload["cargo"] = funcionario_info.get("cargo")
            payload["codigo_individual"] = funcionario_info.get("codigo_individual")

        return self.client.request("POST", "trail_decisoes", body=payload)

    def adicionar_retificacao_trail(self, trail_id, retificacao, funcionario_id=None):
        payload = {
            "trail_id": trail_id,
            "retificacao": retificacao,
            "funcionario_id": funcionario_id,
            "data_hora": datetime.now().isoformat()
        }
        return self.client.request("POST", "retificacoes_trail", body=payload)

    def registrar_leitura_qr(self, entidade_tipo, entidade_id, funcionario_id=None):
        payload = {
            "entidade_tipo": entidade_tipo,
            "entidade_id": str(entidade_id),
            "funcionario_id": funcionario_id,
            "data_hora": datetime.now().isoformat()
        }
        return self.client.request("POST", "leituras_qr_code", body=payload)

    def processar_qr_code(self, qr_code_str):
        """
        Processa e identifica uma string lida de QR Code (ex: 'QR-CRG-123', 'QR-NV-456').
        Retorna o tipo de entidade, ID e os dados correspondentes.
        """
        qr_clean = str(qr_code_str).strip()
        if "CRG" in qr_clean or "CARGA" in qr_clean:
            entidade_tipo = "CARGA"
        elif "NV" in qr_clean or "NAVIO" in qr_clean:
            entidade_tipo = "NAVIO"
        elif "CONT" in qr_clean or "CONTAINER" in qr_clean:
            entidade_tipo = "CONTAINER"
        elif "GND" in qr_clean or "GUINDASTE" in qr_clean:
            entidade_tipo = "GUINDASTE"
        else:
            entidade_tipo = "CARGA"

        self.registrar_leitura_qr(entidade_tipo, qr_clean)

        return {
            "qr_code": qr_clean,
            "entidade_tipo": entidade_tipo,
            "entidade_id": qr_clean.replace("QR-", "").replace("CRG-", "")
        }
