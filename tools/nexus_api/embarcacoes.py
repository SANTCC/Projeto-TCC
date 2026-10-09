"""
Módulo de Gestão de Embarcações, Berços, Guindastes e Rotas (tools/nexus_api/embarcacoes.py)
Aplica as mesmas validações e normalização 1:1 do front-end (js/embarcacoes.js e NexusSupabaseUtils.normalizarBerco)
"""

import re
from datetime import datetime

def normalizar_berco(berco_data):
    """
    Normaliza um berço conforme as regras de banco de public.bercos (regras de bercos_vinculo_navio_check e bercos_id_formato_check):
    - id precisa ter formato 'BERCO-NN'
    - se estado for OCUPADO, exige navio_nome ou navio_imo
    - se estado for LIVRE ou MANUTENCAO, limpa qualquer resíduo de navio_*
    """
    if not berco_data:
        return {"payload": None, "corrigido": False, "motivo": "dados do berço vazios"}

    nome = str(berco_data.get("nome", "") or "").strip()
    if not nome:
        return {"payload": None, "corrigido": False, "motivo": "berço sem nome"}

    bid = str(berco_data.get("id", "") or "").strip()
    if not re.match(r"^BERCO-[0-9]{2}$", bid):
        digitos = re.sub(r"\D", "", nome)
        bid = f"BERCO-{int(digitos):02d}" if digitos else ""

    if not re.match(r"^BERCO-[0-9]{2}$", bid):
        return {"payload": None, "corrigido": False, "motivo": f"sem identificador BERCO-NN para '{nome}'"}

    estado_raw = str(berco_data.get("estado", "LIVRE") or "LIVRE").upper().strip()
    estado = estado_raw if estado_raw in ("LIVRE", "OCUPADO", "MANUTENCAO") else "LIVRE"

    navio_nome = str(berco_data.get("navio_nome", "") or "").strip() or None
    navio_imo = str(berco_data.get("navio_imo", "") or "").strip() or None
    navio_id = str(berco_data.get("navio_id", "") or "").strip() or None

    motivo = None

    if estado == "OCUPADO" and not navio_nome and not navio_imo:
        estado = "LIVRE"
        motivo = "estado OCUPADO sem navio_nome/navio_imo - redefinido como LIVRE"

    if estado != "OCUPADO":
        if navio_nome or navio_imo or navio_id:
            motivo = motivo or "limpando vínculo de navio em berço não ocupado"
        navio_nome = None
        navio_imo = None
        navio_id = None

    payload = {
        "id": bid,
        "nome": nome,
        "estado": estado,
        "navio_nome": navio_nome,
        "navio_imo": navio_imo,
        "navio_id": navio_id
    }

    return {"payload": payload, "corrigido": motivo is not None, "motivo": motivo}


class EmbarcacoesAPI:
    def __init__(self, client):
        self.client = client

    # NAVIOS
    def get_navios(self):
        raw = self.client.request("GET", "navios", params={"select": "*"}) or []
        mapped = []
        for n in raw:
            mapped.append({
                "id": n.get("id"),
                "nome": n.get("nome"),
                "imo": n.get("numero_imo") or n.get("imo"),
                "estado": n.get("estado_operacional") or n.get("estado") or "OPERANTE",
                "localizacao": n.get("localizacao") or "DENTRO_DO_PORTO",
                "origem": n.get("porto_origem") or n.get("origem") or "Porto de Santos",
                "destino": n.get("porto_destino") or n.get("destino") or "Destino",
                "operacoes": n.get("quantidade_cargas_realizadas") or n.get("operacoes") or 0,
                "data_saida": n.get("data_saida")
            })
        return mapped

    def get_navio(self, id_or_imo):
        navios = self.get_navios()
        for n in navios:
            if str(n["id"]) == str(id_or_imo) or str(n["imo"]) == str(id_or_imo) or n["nome"] == id_or_imo:
                return n
        return None

    def save_navio(self, data):
        payload = {
            "nome": data.get("nome"),
            "numero_imo": data.get("imo") or data.get("numero_imo"),
            "estado_operacional": data.get("estado", "OPERANTE"),
            "localizacao": data.get("localizacao", "DENTRO_DO_PORTO"),
            "porto_origem": data.get("origem", "Porto de Santos"),
            "porto_destino": data.get("destino", "Destino"),
            "quantidade_cargas_realizadas": int(data.get("operacoes", 0))
        }
        nid = data.get("id")
        if nid:
            res = self.client.request("PATCH", f"navios?id=eq.{nid}", body=payload)
        else:
            payload["data_registro_sistema"] = datetime.now().strftime("%Y-%m-%d")
            res = self.client.request("POST", "navios", body=payload)
        if isinstance(res, list) and len(res) > 0:
            return res[0]
        return res

    def delete_navio(self, id_or_imo):
        return self.client.request("DELETE", f"navios?numero_imo=eq.{id_or_imo}")

    def liberar_saida_navio(self, navio_id, motivo=None, funcionario_info=None):
        navio = self.get_navio(navio_id)
        if not navio:
            return None
        payload = {
            "localizacao": "FORA_DO_PORTO",
            "data_saida": datetime.now().isoformat()
        }
        res = self.client.request("PATCH", f"navios?id=eq.{navio['id']}", body=payload)

        # Desvincula berço ocupado por este navio
        navio_nome = navio.get("nome")
        navio_imo = navio.get("imo")
        bercos = self.get_bercos()
        for b in bercos:
            if (navio_imo and b.get("navio_imo") == navio_imo) or (navio_nome and b.get("navio_nome") == navio_nome):
                b["estado"] = "LIVRE"
                b["navio_nome"] = None
                b["navio_imo"] = None
                b["navio_id"] = None
                self.save_berco(b)

        return res

    def autorizar_retorno_navio(self, navio_id, funcionario_info=None):
        navio = self.get_navio(navio_id)
        if not navio:
            return None
        payload = {
            "localizacao": "DENTRO_DO_PORTO",
            "data_saida": None
        }
        return self.client.request("PATCH", f"navios?id=eq.{navio['id']}", body=payload)

    # BERÇOS
    def get_bercos(self):
        raw = self.client.request("GET", "bercos", params={"select": "*"}) or []
        return raw

    def save_berco(self, berco_data):
        norm = normalizar_berco(berco_data)
        payload = norm["payload"]
        if not payload:
            return None
        # Upsert no PostgREST
        res = self.client.request("POST", "bercos", body=payload, headers={"Prefer": "resolution=merge-duplicates,return=representation"})
        if isinstance(res, list) and len(res) > 0:
            return res[0]
        return res

    def vincular_navio_berco(self, berco_nome, navio_data):
        bercos = self.get_bercos()
        alvo = None
        for b in bercos:
            if b.get("nome") == berco_nome or b.get("id") == berco_nome:
                alvo = b
                break

        if not alvo:
            alvo = {"id": berco_nome if "BERCO" in berco_nome else "BERCO-01", "nome": berco_nome}

        if navio_data:
            alvo["estado"] = "OCUPADO"
            alvo["navio_nome"] = navio_data.get("nome")
            alvo["navio_imo"] = navio_data.get("imo")
            alvo["navio_id"] = navio_data.get("id")
        else:
            alvo["estado"] = "LIVRE"
            alvo["navio_nome"] = None
            alvo["navio_imo"] = None
            alvo["navio_id"] = None

        return self.save_berco(alvo)

    # CONTAINERS
    def get_containers(self):
        return self.client.request("GET", "containers", params={"select": "*"}) or []

    def save_container(self, container_data):
        payload = {
            "numero_identificacao": container_data.get("numero_identificacao") or container_data.get("identificacao"),
            "material_carregado": container_data.get("material_carregado"),
            "estado": container_data.get("estado", "OPERANTE"),
            "navio_id": container_data.get("navio_id")
        }
        cid = container_data.get("id")
        if cid:
            return self.client.request("PATCH", f"containers?id=eq.{cid}", body=payload)
        return self.client.request("POST", "containers", body=payload)

    def delete_container(self, container_id):
        return self.client.request("DELETE", f"containers?id=eq.{container_id}")

    def vincular_container_navio(self, container_id, navio_id):
        return self.client.request("PATCH", f"containers?id=eq.{container_id}", body={"navio_id": navio_id})

    # GUINDASTES
    def get_guindastes(self):
        return self.client.request("GET", "guindastes", params={"select": "*"}) or []

    def save_guindaste(self, data):
        payload = {
            "numero_identificacao": data.get("numero_identificacao") or data.get("identificacao"),
            "estado": data.get("estado", "OPERANTE")
        }
        gid = data.get("id")
        if gid:
            return self.client.request("PATCH", f"guindastes?id=eq.{gid}", body=payload)
        return self.client.request("POST", "guindastes", body=payload)

    def delete_guindaste(self, guindaste_id):
        return self.client.request("DELETE", f"guindastes?id=eq.{guindaste_id}")

    # ROTAS
    def get_rotas(self):
        return self.client.request("GET", "rotas_maritimas", params={"select": "*"}) or []

    def save_rota(self, data):
        payload = {
            "origem": data.get("origem"),
            "destino": data.get("destino"),
            "distancia_km": float(data.get("distancia_km", 0))
        }
        rid = data.get("id")
        if rid:
            return self.client.request("PATCH", f"rotas_maritimas?id=eq.{rid}", body=payload)
        return self.client.request("POST", "rotas_maritimas", body=payload)
