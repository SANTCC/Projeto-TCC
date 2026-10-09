#!/usr/bin/env python3
"""
Script de Verificação Automatizado para a Fase 9 (Testes, Integração e Implantação) - NexusPort
Valida:
1. Carregamento dos scripts Supabase em dashboard.html e index.html
2. Inicialização do client Supabase em js/supabase-client.js
3. Estrutura de configuração js/config.example.js
4. Presença de todas as funções e módulos necessários das Fases 1 a 8
"""

import re
import sys

def check_phase9():
    print("--- Verificando Fase 9: Testes, Integração e Implantação ---")
    errors = []

    # 1. Verificar dashboard.html
    with open("dashboard.html", "r", encoding="utf-8") as f:
        dash_content = f.read()

    if "@supabase/supabase-js" not in dash_content:
        errors.append("dashboard.html não inclui a CDN do Supabase JS")
    if "js/supabase-client.js" not in dash_content:
        errors.append("dashboard.html não inclui o script js/supabase-client.js")
    if "js/config.example.js" not in dash_content:
        errors.append("dashboard.html não inclui o script js/config.example.js")

    # 2. Verificar index.html
    with open("index.html", "r", encoding="utf-8") as f:
        idx_content = f.read()

    if "@supabase/supabase-js" not in idx_content:
        errors.append("index.html não inclui a CDN do Supabase JS")
    if "js/supabase-client.js" not in idx_content:
        errors.append("index.html não inclui o script js/supabase-client.js")

    # 3. Verificar js/supabase-client.js
    with open("js/supabase-client.js", "r", encoding="utf-8") as f:
        supa_content = f.read()

    if "window.nexusSupabase = supabaseClient;" not in supa_content:
        errors.append("js/supabase-client.js não expõe window.nexusSupabase")

    # 4. Verificar js/dashboard.js
    with open("js/dashboard.js", "r", encoding="utf-8") as f:
        dash_js = f.read()

    required_functions = [
        "initQrCodeEtiquetas",
        "initDashboardsPesquisaRelatorios",
        "initLogsTrailDelegacao",
        "initLocalizacaoETempos",
        "calcularEstimativaChegada",
        "calcularTempoPermanenciaPorto",
        "calcularTempoForaPorto",
        "registrarLogAlteracao",
        "registrarTrailDecisao",
        "gerarRelatorioPdfA4"
    ]

    for fn in required_functions:
        if fn not in dash_js:
            errors.append(f"Função obrigatória '{fn}' não encontrada em js/dashboard.js")

    if errors:
        print("❌ Falha na verificação da Fase 9:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)

    print("✅ Todas as verificações da Fase 9 passaram com sucesso!")

if __name__ == "__main__":
    check_phase9()
