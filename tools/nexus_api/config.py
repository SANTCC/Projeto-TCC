import os
import re

def load_config(config_path=None):
    """
    Carrega as credenciais do Supabase a partir do js/config.js,
    variáveis de ambiente (SUPABASE_URL, SUPABASE_ANON_KEY) ou do arquivo especificado.
    """
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_ANON_KEY", "")

    if url and key:
        return {"SUPABASE_URL": url, "SUPABASE_ANON_KEY": key}

    # Procura arquivos js/config.js ou js/config.example.js se nenhum caminho for fornecido
    paths_to_check = []
    if config_path:
        paths_to_check.append(config_path)
    else:
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        paths_to_check.append(os.path.join(repo_root, "js", "config.js"))
        paths_to_check.append(os.path.join(repo_root, "js", "config.example.js"))

    for path in paths_to_check:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
                    url_match = re.search(r'SUPABASE_URL\s*:\s*["\']([^"\']+)["\']', content)
                    key_match = re.search(r'SUPABASE_ANON_KEY\s*:\s*["\']([^"\']+)["\']', content)

                    if url_match and not url:
                        url = url_match.group(1)
                    if key_match and not key:
                        key = key_match.group(1)

                    if url and key and url != "https://seu-projeto.supabase.co":
                        return {"SUPABASE_URL": url, "SUPABASE_ANON_KEY": key}
            except Exception as e:
                pass

    return {
        "SUPABASE_URL": url or "http://localhost:3000",
        "SUPABASE_ANON_KEY": key or "mock-anon-key"
    }
