"""
Módulo de Gestão de Cargas, Contêineres e Pátio - NexusPort (tools/nexus_api/cargas.py)
Suporte 1:1 ao fluxo operacional de cargas do front-end (cargas.html e js/cargas.js)
"""

from datetime import datetime

class CargasAPI:
    def __init__(self, client):
        self.client = client

    def get_cargas(self):
        """
        Retorna todas as cargas formatadas com navio e vínculo com estivador.
        """
        raw_cargas = self.client.request("GET", "cargas", params={"select": "*, navios(id, nome)"}) or []
        formatted = []
        for c in raw_cargas:
            qr_url = c.get("qr_code_url", "")
            cid = qr_url.replace("QR-", "") if qr_url else f"CRG-{c.get('id')}"
            navio_info = c.get("navios") or {}

            val_dec = c.get("valor_declarado", 0) or 0

            formatted.append({
                "id": cid,
                "rawDbId": c.get("id"),
                "tipo": c.get("natureza") or "Carga Geral",
                "peso": f"{c.get('peso', 0)} t",
                "volume": f"{c.get('volume', 0)} m³",
                "valor": f"R$ {val_dec:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."),
                "natureza": c.get("natureza") or "Geral",
                "portoDescarga": c.get("porto_descarga") or "Terminal STS-01",
                "destino": c.get("destino") or "Destino Geral",
                "status": c.get("status_fluxo") or "AGENDAMENTO",
                "container": c.get("container_id") or "",
                "navio": navio_info.get("nome", "") if isinstance(navio_info, dict) else "",
                "navioId": c.get("navio_id"),
                "qrCode": qr_url or f"QR-CRG-{c.get('id')}",
                "motivoCancelamento": c.get("motivo_recusa"),
                "created_at": c.get("created_at")
            })
        return formatted

    def get_carga(self, carga_id):
        cargas = self.get_cargas()
        for c in cargas:
            if c["id"] == carga_id or c["rawDbId"] == carga_id or c["qrCode"] == carga_id or f"QR-{c['id']}" == carga_id:
                return c
        return None

    def save_carga(self, carga_data):
        """
        Salva/atualiza uma carga na tabela 'cargas'.
        """
        raw_id = carga_data.get("rawDbId")
        val_raw = carga_data.get("valor", 0)
        if isinstance(val_raw, str):
            val_num = float(val_raw.replace("R$", "").replace(".", "").replace(",", ".").strip() or 0)
        else:
            val_num = float(val_raw or 0)

        db_payload = {
            "natureza": carga_data.get("natureza") or carga_data.get("tipo", "Geral"),
            "peso": float(str(carga_data.get("peso", 0)).replace("t", "").strip() or 0),
            "volume": float(str(carga_data.get("volume", 0)).replace("m³", "").strip() or 0),
            "valor_declarado": val_num,
            "porto_descarga": carga_data.get("portoDescarga", "Terminal STS-01"),
            "destino": carga_data.get("destino", "Destino Geral"),
            "status_fluxo": carga_data.get("status", "AGENDAMENTO"),
            "qr_code_url": carga_data.get("qrCode") or f"QR-{carga_data.get('id', 'NEW')}",
            "container_id": carga_data.get("container") or None,
            "navio_id": carga_data.get("navioId") or None,
            "motivo_recusa": carga_data.get("motivoCancelamento") or None
        }

        if raw_id:
            res = self.client.request("PATCH", f"cargas?id=eq.{raw_id}", body=db_payload)
        else:
            res = self.client.request("POST", "cargas", body=db_payload)

        return res

    def agendar_carga(self, data, funcionario_info=None):
        """
        Cria um novo agendamento de carga (Status = AGENDAMENTO).
        """
        cid = data.get("id") or f"CRG-{int(datetime.now().timestamp())}"
        data["id"] = cid
        data["status"] = "AGENDAMENTO"
        data["qrCode"] = f"QR-{cid}"
        saved = self.save_carga(data)

        # Registra log de alteracao e trail
        if funcionario_info:
            self._log_and_trail("CRIACAO", "CARGA", cid, "Agendamento de Carga", "APROVOU_CARGA", funcionario_info)

        return saved

    def receber_carga(self, id_or_qr, funcionario_info=None):
        """
        Atualiza o fluxo para RECEBIMENTO_INSPECAO.
        """
        carga = self.get_carga(id_or_qr)
        if not carga:
            return None
        carga["status"] = "RECEBIMENTO_INSPECAO"
        saved = self.save_carga(carga)

        if funcionario_info:
            self._log_and_trail("EDICAO", "CARGA", carga["id"], "Recebimento e Checklist de Avarias", "APROVOU_CARGA", funcionario_info)

        return saved

    def movimentar_carga(self, id_or_qr, guindaste_id=None, local=None, funcionario_info=None):
        """
        Movimenta a carga para ARMAZENAGEM.
        """
        carga = self.get_carga(id_or_qr)
        if not carga:
            return None
        carga["status"] = "ARMAZENAGEM"
        if local:
            carga["destino"] = local
        saved = self.save_carga(carga)

        if funcionario_info:
            self._log_and_trail("EDICAO", "CARGA", carga["id"], f"Movimentação no pátio (Guindaste {guindaste_id or 'N/A'})", "APROVOU_CARGA", funcionario_info)

        return saved

    def marcar_pronta_entrega(self, id_or_qr, funcionario_info=None):
        """
        Define status para PRONTA_PARA_ENTREGA.
        """
        carga = self.get_carga(id_or_qr)
        if not carga:
            return None
        carga["status"] = "PRONTA_PARA_ENTREGA"
        saved = self.save_carga(carga)

        if funcionario_info:
            self._log_and_trail("EDICAO", "CARGA", carga["id"], "Carga liberada para entrega", "APROVOU_CARGA", funcionario_info)

        return saved

    def vincular_carga_container(self, carga_id, container_id):
        carga = self.get_carga(carga_id)
        if not carga:
            return None
        carga["container"] = container_id
        return self.save_carga(carga)

    def liberar_carga_saida(self, carga_id, motivo=None, funcionario_info=None):
        """
        Libera a carga para EM_TRANSITO ou SAIDA.
        """
        carga = self.get_carga(carga_id)
        if not carga:
            return None
        carga["status"] = "EM_TRANSITO"
        saved = self.save_carga(carga)

        if funcionario_info:
            self._log_and_trail("EDICAO", "CARGA", carga["id"], motivo or "Liberação de Saída pelo Supervisor", "LIBEROU_NAVIO", funcionario_info)

        return saved

    def cancelar_carga(self, carga_id, motivo, funcionario_info=None):
        """
        Cancela a entrega da carga (Status = CANCELADA) registrando obrigatoriamente o motivo.
        """
        carga = self.get_carga(carga_id)
        if not carga:
            return None
        carga["status"] = "CANCELADA"
        carga["motivoCancelamento"] = motivo
        saved = self.save_carga(carga)

        if funcionario_info:
            self._log_and_trail("EDICAO", "CARGA", carga["id"], f"Cancelamento: {motivo}", "CANCELOU_ENTREGA", funcionario_info)

        return saved

    def atribuir_estivador(self, estivador_id, carga_id, estado_carregamento="EM_CARREGAMENTO"):
        payload = {
            "estivador_id": estivador_id,
            "carga_id": carga_id,
            "estado_carregamento": estado_carregamento
        }
        return self.client.request("POST", "estivador_cargas", body=payload)

    def _log_and_trail(self, alt_tipo, ent_tipo, ent_id, detalhes_str, dec_tipo, func):
        if not func:
            return
        log_payload = {
            "data_hora": datetime.now().isoformat(),
            "funcionario_id": func.get("id"),
            "cargo": func.get("cargo"),
            "codigo_individual": func.get("codigo_individual"),
            "entidade_tipo": ent_tipo,
            "entidade_id": str(ent_id),
            "tipo_alteracao": alt_tipo,
            "detalhes": {"descricao": detalhes_str}
        }
        self.client.request("POST", "logs_alteracoes", body=log_payload)

        trail_payload = {
            "data_hora": datetime.now().isoformat(),
            "funcionario_id": func.get("id"),
            "cargo": func.get("cargo"),
            "codigo_individual": func.get("codigo_individual"),
            "tipo_decisao": dec_tipo,
            "entidade_tipo": ent_tipo,
            "entidade_id": str(ent_id),
            "motivo": detalhes_str,
            "detalhes": {"descricao": detalhes_str}
        }
        self.client.request("POST", "trail_decisoes", body=trail_payload)
