"""
Módulo de Inspeções Técnicas e Checklists - NexusPort (tools/nexus_api/inspecoes.py)
Garante a regra de integridade do banco: apenas uma inspeção ativa por carga_id (ativa = True),
desativando inspeções anteriores para histórico (ativa = False).
"""

from datetime import datetime

from .uuid_utils import uuid_or_none

class InspecoesAPI:
    def __init__(self, client):
        self.client = client

    def get_cargas_inspecao(self):
        """
        Retorna as cargas no fluxo RECEBIMENTO_INSPECAO ou pendentes.
        """
        cargas = self.client.request("GET", "cargas", params={"select": "*"}) or []
        return [c for c in cargas if c.get("status_fluxo") in ("RECEBIMENTO_INSPECAO", "AGENDAMENTO")]

    def get_checklist_modelo(self, tipo_carga_id=None):
        modelos = self.client.request("GET", "checklist_modelos", params={"select": "*"}) or []
        itens = self.client.request("GET", "checklist_itens", params={"select": "*"}) or []

        if tipo_carga_id:
            modelos = [m for m in modelos if str(m.get("tipo_carga_id")) == str(tipo_carga_id)]

        modelo = modelos[0] if modelos else {"id": "default-model-id", "nome": "Checklist Padrão De Inspeção"}
        mod_itens = [i for i in itens if str(i.get("checklist_modelo_id")) == str(modelo.get("id"))]

        return {
            "modelo": modelo,
            "itens": mod_itens
        }

    def inspecionar_carga(self, carga_id, resultado, observacoes=None, itens=None, inspetor_id=None, funcionario_info=None):
        """
        Registra a inspeção da carga.
        1. Desativa inspeções anteriores (ativa = False).
        2. Insere a nova inspeção (ativa = True).
        3. Insere itens de inspecao.
        4. Atualiza a carga (resultado_inspecao e status_fluxo).
        5. Registra trail de decisão.
        """
        # Resolve DB ID real da carga
        carga = self._resolver_carga(carga_id)
        if not carga:
            return None

        db_carga_id = carga.get("id")

        # 1. Marca inspeções ativas anteriores como ativa = False (histórico)
        self.client.request("PATCH", f"inspecoes?carga_id=eq.{db_carga_id}&ativa=eq.true", body={"ativa": False})

        # 2. Insere a nova inspeção ativa
        inspecao_payload = {
            "carga_id": db_carga_id,
            "inspetor_id": uuid_or_none(inspetor_id or (funcionario_info.get("id") if funcionario_info else None)),
            "data_inspecao": datetime.now().isoformat(),
            "resultado": resultado,
            "observacoes": observacoes or "",
            "ativa": True
        }
        resp_insp = self.client.request("POST", "inspecoes", body=inspecao_payload)
        new_insp_id = resp_insp[0].get("id") if isinstance(resp_insp, list) and resp_insp else None

        # 3. Insere itens
        if itens and new_insp_id:
            for item in itens:
                item_payload = {
                    "inspecao_id": new_insp_id,
                    "checklist_item_id": uuid_or_none(item.get("item_id")),
                    "conforme": item.get("conforme", True),
                    "observacao": item.get("observacao", "")
                }
                self.client.request("POST", "inspecao_itens", body=item_payload)

        # 4. Atualiza a carga
        novo_status = "ARMAZENAGEM" if resultado == "APROVADA" else "RECUSADA"
        carga_update = {
            "resultado_inspecao": resultado,
            "status_fluxo": novo_status
        }
        if resultado == "RECUSADA":
            carga_update["motivo_recusa"] = observacoes or "Recusada no checklist de inspeção"

        self.client.request("PATCH", f"cargas?id=eq.{db_carga_id}", body=carga_update)

        # 5. Trail
        if funcionario_info:
            dec_tipo = "APROVOU_CARGA" if resultado == "APROVADA" else "RECUSOU_CARGA"
            trail_payload = {
                "data_hora": datetime.now().isoformat(),
                "funcionario_id": uuid_or_none(funcionario_info.get("id")),
                "cargo": funcionario_info.get("cargo"),
                "codigo_individual": funcionario_info.get("codigo_individual"),
                "tipo_decisao": dec_tipo,
                "entidade_tipo": "CARGA",
                "entidade_id": str(carga.get("id")),
                "motivo": observacoes or f"Inspeção {resultado}",
                "detalhes": {"resultado": resultado, "observacoes": observacoes}
            }
            self.client.request("POST", "trail_decisoes", body=trail_payload)

        return resp_insp

    def recusar_carga(self, carga_id, motivo, inspetor_id=None, funcionario_info=None):
        return self.inspecionar_carga(
            carga_id=carga_id,
            resultado="RECUSADA",
            observacoes=motivo,
            inspetor_id=inspetor_id,
            funcionario_info=funcionario_info
        )

    def _resolver_carga(self, carga_id):
        cargas = self.client.request("GET", "cargas", params={"select": "*"}) or []
        for c in cargas:
            qr = c.get("qr_code_url", "")
            cid = qr.replace("QR-", "") if qr else f"CRG-{c.get('id')}"
            if str(c.get("id")) == str(carga_id) or cid == str(carga_id) or str(qr) == str(carga_id):
                return c
        return None
