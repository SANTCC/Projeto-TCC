import asyncio
from playwright.async_api import async_playwright

async def verify_t1_7():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        print("[TEST T1.7] Iniciando teste RBAC...")

        # 1. Estivador
        session_estivador = {
            "id": "1",
            "codigo_individual": "NX-1040-EST",
            "matricula": "MAT-1040",
            "nome": "Carlos Estivador",
            "cargo": "ESTIVADOR",
            "cargo_nome": "Estivador",
            "terminal": "STS-01 Santos"
        }

        await page.goto("http://localhost:3000/index.html")
        await page.evaluate(f"sessionStorage.setItem('nexus_session', JSON.stringify({session_estivador}));")
        await page.goto("http://localhost:3000/dashboard.html")
        await page.wait_for_selector("#headerUserName")

        can_move_carga = await page.evaluate("NexusAuth.hasPermission('MOVIMENTAR_CARGA')")
        can_release_ship = await page.evaluate("NexusAuth.hasPermission('LIBERAR_NAVIO')")
        can_export = await page.evaluate("NexusAuth.hasPermission('EXPORTAR_HISTORICO')")

        print(f"Estivador - MOVIMENTAR_CARGA: {can_move_carga} (Esperado: True)")
        print(f"Estivador - LIBERAR_NAVIO: {can_release_ship} (Esperado: False)")
        print(f"Estivador - EXPORTAR_HISTORICO: {can_export} (Esperado: False)")

        assert can_move_carga == True, "Estivador deveria poder movimentar carga"
        assert can_release_ship == False, "Estivador NÃO deveria poder liberar navio"
        assert can_export == False, "Estivador NÃO deveria poder exportar histórico"

        # 2. Supervisor
        session_supervisor = {
            "id": "2",
            "codigo_individual": "NX-6070-SUP",
            "matricula": "MAT-6070",
            "nome": "Mariana Souza",
            "cargo": "SUPERVISOR_GERENTE_OPERACOES",
            "cargo_nome": "Supervisor de Operações",
            "terminal": "STS-01 Santos"
        }

        await page.evaluate(f"sessionStorage.setItem('nexus_session', JSON.stringify({session_supervisor}));")
        await page.goto("http://localhost:3000/dashboard.html")
        await page.wait_for_selector("#headerUserName")

        can_release_ship_sup = await page.evaluate("NexusAuth.hasPermission('LIBERAR_NAVIO')")
        can_export_sup = await page.evaluate("NexusAuth.hasPermission('EXPORTAR_HISTORICO')")

        print(f"Supervisor - LIBERAR_NAVIO: {can_release_ship_sup} (Esperado: True)")
        print(f"Supervisor - EXPORTAR_HISTORICO: {can_export_sup} (Esperado: False)")

        assert can_release_ship_sup == True, "Supervisor deveria poder liberar navio"
        assert can_export_sup == False, "Supervisor NÃO deveria poder exportar histórico"

        # 3. Diretor
        session_diretor = {
            "id": "3",
            "codigo_individual": "NX-7010-DIR",
            "matricula": "MAT-7010",
            "nome": "Dr. Eduardo Costa",
            "cargo": "DIRETOR_OPERACOES_LOGISTICA",
            "cargo_nome": "Diretor de Operações e Logística",
            "terminal": "STS-01 Santos"
        }

        await page.evaluate(f"sessionStorage.setItem('nexus_session', JSON.stringify({session_diretor}));")
        await page.goto("http://localhost:3000/dashboard.html")
        await page.wait_for_selector("#headerUserName")

        can_release_ship_dir = await page.evaluate("NexusAuth.hasPermission('LIBERAR_NAVIO')")
        can_export_dir = await page.evaluate("NexusAuth.hasPermission('EXPORTAR_HISTORICO')")

        print(f"Diretor - LIBERAR_NAVIO: {can_release_ship_dir} (Esperado: True)")
        print(f"Diretor - EXPORTAR_HISTORICO: {can_export_dir} (Esperado: True)")

        assert can_release_ship_dir == True, "Diretor deveria poder liberar navio"
        assert can_export_dir == True, "Diretor deveria poder exportar histórico"

        await page.screenshot(path="/home/jules/verification/screenshots/rbac_t1_7.png")
        print("[TEST T1.7] Screenshot salvo com sucesso em /home/jules/verification/screenshots/rbac_t1_7.png")

        await browser.close()
        print("[TEST T1.7] Teste concluído com sucesso!")

if __name__ == "__main__":
    asyncio.run(verify_t1_7())
