"""
Módulo do Técnico em Portos - Gestão de Funcionários e Visitantes (tools/nexus_api/tecnico.py)
"""

from datetime import datetime

from .uuid_utils import is_valid_uuid

class TecnicoAPI:
    def __init__(self, client):
        self.client = client

    # FUNCIONÁRIOS
    def get_funcionarios(self):
        return self.client.request("GET", "funcionarios", params={"select": "*"}) or []

    def get_funcionario(self, id_or_matricula):
        funcs = self.get_funcionarios()
        for f in funcs:
            if str(f.get("id")) == str(id_or_matricula) or str(f.get("matricula")) == str(id_or_matricula):
                return f
        return None

    def _buscar_funcionario_por_matricula(self, matricula):
        """matricula é UNIQUE no banco: localiza o funcionário já cadastrado."""
        if not matricula:
            return None
        rows = self.client.request("GET", "funcionarios", params={"select": "*", "matricula": f"eq.{matricula}"}) or []
        if not isinstance(rows, list):
            return None
        for r in rows:
            if str(r.get("matricula")) == str(matricula):
                return r
        return None

    def save_funcionario(self, func_data):
        payload = {
            "matricula": func_data.get("matricula"),
            "nome": func_data.get("nome"),
            "cargo": func_data.get("cargo"),
            "codigo_individual": func_data.get("codigo_individual") or f"COD-{func_data.get('matricula')}",
            "email": func_data.get("email"),
            "telefone": func_data.get("telefone"),
            "ativo": func_data.get("ativo", True)
        }
        fid = func_data.get("id")
        if not is_valid_uuid(fid):
            # Sem id válido: se a matrícula já existe, atualiza o cadastro existente (evita 23505)
            existente = self._buscar_funcionario_por_matricula(payload["matricula"])
            fid = existente.get("id") if existente else None
        if is_valid_uuid(fid):
            return self.client.request("PATCH", f"funcionarios?id=eq.{fid}", body=payload)
        return self.client.request("POST", "funcionarios", body=payload)

    def delete_funcionario(self, matricula):
        return self.client.request("DELETE", f"funcionarios?matricula=eq.{matricula}")

    def reemitir_codigo_funcionario(self, matricula):
        novo_codigo = f"COD-{int(datetime.now().timestamp())}"
        self.client.request("PATCH", f"funcionarios?matricula=eq.{matricula}", body={"codigo_individual": novo_codigo})
        return novo_codigo

    # VISITANTES
    def get_visitantes(self):
        return self.client.request("GET", "visitantes", params={"select": "*"}) or []

    def save_visitante(self, nome, documento, motivo=None, registrado_por=None):
        payload = {
            "nome": nome,
            "documento": documento,
            "motivo": motivo or "Visita operacional",
            "registrado_por": registrado_por,
            "data_hora_entrada": datetime.now().isoformat()
        }
        return self.client.request("POST", "visitantes", body=payload)

    def delete_visitante(self, doc_ou_id):
        return self.client.request("DELETE", f"visitantes?documento=eq.{doc_ou_id}")

    def registrar_saida_visitante(self, doc_ou_id):
        payload = {
            "data_hora_saida": datetime.now().isoformat()
        }
        return self.client.request("PATCH", f"visitantes?documento=eq.{doc_ou_id}", body=payload)
