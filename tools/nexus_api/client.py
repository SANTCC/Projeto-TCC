import json
import urllib.request
import urllib.parse
import urllib.error
from .config import load_config

class NexusClient:
    """
    Cliente REST para o Supabase (PostgREST / Edge Functions) do NexusPort.
    Oferece comunicação HTTP com headers padrão (apikey, Authorization, Prefer)
    e suporte a fallback em memória quando o servidor do banco não está acessível.
    """

    def __init__(self, supabase_url=None, supabase_key=None, config_path=None):
        config = load_config(config_path)
        self.supabase_url = (supabase_url or config.get("SUPABASE_URL", "")).rstrip("/")
        self.supabase_key = supabase_key or config.get("SUPABASE_ANON_KEY", "")
        self.mock_db = {}
        self.session = None

    def _headers(self, custom_headers=None):
        headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
        if custom_headers:
            headers.update(custom_headers)
        return headers

    def invoke_edge_function(self, function_name, body=None, params=None, method="POST"):
        """
        Invoca uma Supabase Edge Function pelo nome.
        """
        return self.request(method, function_name, params=params, body=body, is_edge_function=True)

    def request(self, method, path, params=None, body=None, headers=None, is_edge_function=False):
        """
        Realiza requisição HTTP para PostgREST ou Edge Functions.
        Se falhar por erro de conexão/servidor indisponível, faz fallback para armazenamento em memória.
        """
        base = "/functions/v1" if is_edge_function else "/rest/v1"
        url = f"{self.supabase_url}{base}/{path.lstrip('/')}"

        if params:
            query_string = urllib.parse.urlencode(params)
            url = f"{url}?{query_string}"

        req_headers = self._headers(headers)
        data_bytes = json.dumps(body).encode("utf-8") if body is not None else None

        req = urllib.request.Request(url, data=data_bytes, headers=req_headers, method=method.upper())

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp_bytes = resp.read()
                if not resp_bytes:
                    return None
                try:
                    return json.loads(resp_bytes.decode("utf-8"))
                except json.JSONDecodeError:
                    return resp_bytes.decode("utf-8")
        except (urllib.error.URLError, urllib.error.HTTPError, Exception) as err:
            # Em modo offline/desconectado, utiliza fallback em memória
            return self._handle_offline_fallback(method, path, params, body, err)

    def _handle_offline_fallback(self, method, path, params, body, error):
        clean_table = path.split("?")[0].split("/")[0]
        if clean_table not in self.mock_db:
            self.mock_db[clean_table] = []

        if "?" in path and not params:
            query_str = path.split("?", 1)[1]
            params = {}
            for pair in query_str.split("&"):
                if "=" in pair:
                    k, v = pair.split("=", 1)
                    params[k] = v

        method_upper = method.upper()

        if method_upper == "GET":
            table_data = self.mock_db[clean_table]
            if params:
                filtered = list(table_data)
                for k, v in params.items():
                    if k.endswith("=eq."):
                        col = k[:-4]
                        val = v[4:] if isinstance(v, str) and v.startswith("eq.") else v
                        filtered = [r for r in filtered if str(r.get(col, "")) == str(val)]
                return filtered
            return list(table_data)

        elif method_upper == "POST":
            if isinstance(body, list):
                self.mock_db[clean_table].extend(body)
                return body
            elif isinstance(body, dict):
                self.mock_db[clean_table].append(body)
                return [body]
            return body

        elif method_upper in ("PATCH", "PUT"):
            if isinstance(body, dict) and params:
                table_data = self.mock_db[clean_table]
                updated = []
                for row in table_data:
                    match = True
                    for k, v in params.items():
                        col = k.replace(".eq", "").replace("eq.", "")
                        val = v.replace("eq.", "") if isinstance(v, str) else v
                        if str(row.get(col, "")) != str(val):
                            match = False
                            break
                    if match:
                        row.update(body)
                        updated.append(row)
                return updated
            return [body] if isinstance(body, dict) else []

        elif method_upper == "DELETE":
            if params:
                original = self.mock_db[clean_table]
                remaining = []
                deleted = []
                for row in original:
                    match = True
                    for k, v in params.items():
                        col = k.replace(".eq", "").replace("eq.", "")
                        val = v.replace("eq.", "") if isinstance(v, str) else v
                        if str(row.get(col, "")) != str(val):
                            match = False
                            break
                    if match:
                        deleted.append(row)
                    else:
                        remaining.append(row)
                self.mock_db[clean_table] = remaining
                return deleted
            return []

        return None
