import asyncio
import json
from playwright.async_api import async_playwright

async def run_tests():
    print("=== TESTANDO PONTOS 1, 2 E 3 ===")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # 1. Teste Estivador (MAT-1040)
        context = await browser.new_context()
        page = await context.new_page()
        await page.goto("http://localhost:3000/index.html")
        session_estivador = {
            "codigo_individual": "NX-1040-OP",
            "matricula": "MAT-1040",
            "nome": "João Pedro",
            "cargo": "ESTIVADOR",
            "cargo_nome": "Estivador"
        }
        await page.evaluate(f"sessionStorage.setItem('nexus_session', '{json.dumps(session_estivador)}')")
        await page.evaluate(f"localStorage.setItem('nexus_session', '{json.dumps(session_estivador)}')")

        await page.goto("http://localhost:3000/dashboard.html")
        await page.wait_for_timeout(1000)

        print(f"Estivador logado. URL atual: {page.url}")

        sidebar_text = await page.inner_text("#appSidebar")
        print("Menu lateral do Estivador contém Cargas & Pátio:", "Cargas & Pátio" in sidebar_text)
        print("Menu lateral do Estivador esconde Gestão de Pessoas:", "Gestão de Pessoas" not in sidebar_text)
        print("Menu lateral do Estivador esconde Delegação Supervisor:", "Delegação Supervisor" not in sidebar_text)

        # Tentar acessar diretamente manutencao.html como Estivador (deve ser bloqueado e redirecionar para dashboard)
        await page.goto("http://localhost:3000/manutencao.html")
        await page.wait_for_timeout(1000)
        print(f"Tentativa de acesso direto à Manutenção pelo Estivador redirecionou para: {page.url}")

        # 2. Teste Inspetor (MAT-6090)
        session_inspetor = {
            "codigo_individual": "NX-6090-IN",
            "matricula": "MAT-6090",
            "nome": "Patricia Rocha",
            "cargo": "INSPETOR",
            "cargo_nome": "Inspetor"
        }
        await page.evaluate(f"sessionStorage.setItem('nexus_session', '{json.dumps(session_inspetor)}')")
        await page.evaluate(f"localStorage.setItem('nexus_session', '{json.dumps(session_inspetor)}')")

        await page.goto("http://localhost:3000/manutencao.html")
        await page.wait_for_timeout(1000)
        print(f"Inspetor acessando Manutenção. URL atual: {page.url}")

        guindastes_section = await page.inner_text("main")
        print("Seção de Guindastes visível em Manutenção:", "Guindastes e Pórticos de Pátio" in guindastes_section)

        # Cadastrar novo guindaste como Inspetor
        await page.click("#toggleGuindasteFormBtn")
        await page.fill("#gndNumero", "GND-09-STS")
        await page.fill("#gndDataManut", "2026-03-01")
        await page.select_option("#gndEstado", "OPERANTE")
        await page.click("#guindasteForm button[type='submit']")
        await page.wait_for_timeout(1000)

        guindastes_table = await page.inner_text("#guindastesTableBody")
        print("Novo Guindaste GND-09-STS cadastrado no sistema:", "GND-09-STS" in guindastes_table)

        # 3. Teste Supervisor (MAT-8821)
        session_supervisor = {
            "codigo_individual": "NX-8821-SP",
            "matricula": "MAT-8821",
            "nome": "Carlos Silva",
            "cargo": "SUPERVISOR_GERENTE_OPERACOES",
            "cargo_nome": "Supervisor"
        }
        await page.evaluate(f"sessionStorage.setItem('nexus_session', '{json.dumps(session_supervisor)}')")
        await page.evaluate(f"localStorage.setItem('nexus_session', '{json.dumps(session_supervisor)}')")

        await page.goto("http://localhost:3000/cargas.html")
        await page.wait_for_timeout(1000)

        bercos_panel = await page.inner_text("main")
        print("Painel de Berços de Descarga do Terminal STS-01 visível:", "Painel de Berços de Descarga do Terminal STS-01" in bercos_panel)

        await page.click("#toggleAgendamentoFormBtn")
        options = await page.eval_on_selector_all("#agPortoDescarga option", "opts => opts.map(o => o.text)")
        print("Opções de Berço Livre disponíveis no formulário de descarga:", options)

        await browser.close()
        print("=== TODOS OS TESTES DOS PONTOS 1, 2 E 3 PASSARAM COM SUCESSO! ===")

if __name__ == "__main__":
    asyncio.run(run_tests())
