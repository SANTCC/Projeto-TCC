import asyncio
from playwright.async_api import async_playwright

async def verify_t1_8():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Aceitar diálogos nativos confirm() e alert()
        page.on("dialog", lambda dialog: dialog.accept())

        print("[TEST T1.8] Autenticando como Técnico em Portos (MAT-5080)...")
        session_tecnico = {
            "id": "5",
            "codigo_individual": "NX-5080-TC",
            "matricula": "MAT-5080",
            "nome": "Lucas Mendes",
            "cargo": "TECNICO_PORTOS",
            "cargo_nome": "Técnico em Portos",
            "terminal": "STS-01 Santos"
        }

        await page.goto("http://localhost:3000/index.html")
        await page.evaluate(f"sessionStorage.setItem('nexus_session', JSON.stringify({session_tecnico}));")
        await page.goto("http://localhost:3000/tecnico_portos.html")
        await page.wait_for_selector("#headerUserName")

        print("[TEST T1.8] Painel do Técnico em Portos carregado. Buscando funcionário MAT-1040...")
        await page.fill("#empMatriculaSearch", "MAT-1040")
        await page.click("#searchEmpBtn")

        await page.wait_for_selector("#empSearchResultBox", state="visible")
        emp_nome = await page.text_content("#resEmpNome")
        old_code = await page.text_content("#resEmpCodigo")
        print(f"[TEST T1.8] Funcionário encontrado: {emp_nome} | Código atual: {old_code}")

        assert "João Pedro" in emp_nome, "Deveria ter encontrado o funcionário João Pedro"
        assert old_code == "NX-1040-OP", "O código antigo deveria ser NX-1040-OP"

        print("[TEST T1.8] Invalidando o código antigo e gerando novo código...")
        await page.click("#regenCodeBtn")

        await page.wait_for_selector("#codeRegenNotice", state="visible")
        new_code = await page.text_content("#newGeneratedCode")
        print(f"[TEST T1.8] Novo código reemitido com sucesso: {new_code}")

        assert new_code != "NX-1040-OP", "O novo código deve ser diferente do antigo"
        assert new_code.startswith("NX-1040-"), "O novo código deve estar vinculado à mesma matrícula (MAT-1040)"

        # Tentar login na tela inicial com o CÓDIGO ANTIGO (deve falhar)
        print("[TEST T1.8] Testando login com CÓDIGO ANTIGO (deve ser rejeitado)...")
        await page.goto("http://localhost:3000/index.html")
        await page.fill("#operatorCode", "NX-1040-OP")
        await page.click("#loginSubmitBtn")

        await page.wait_for_selector("#authNotice", state="visible")
        notice_text = await page.text_content("#authNotice")
        print(f"[TEST T1.8] Feedback para código antigo: {notice_text}")
        assert "Invalidado" in notice_text, "Deveria indicar que o código foi invalidado"

        # Tentar login na tela inicial com o NOVO CÓDIGO (deve passar)
        print("[TEST T1.8] Testando login com NOVO CÓDIGO (deve ser aceito)...")
        await page.fill("#operatorCode", new_code)
        await page.click("#loginSubmitBtn")

        await page.wait_for_url("**/confirm-role.html", timeout=5000)
        print("[TEST T1.8] Redirecionado com sucesso para confirm-role.html com o novo código!")

        await page.screenshot(path="/home/jules/verification/screenshots/invalidation_t1_8.png")
        print("[TEST T1.8] Screenshot salvo com sucesso em /home/jules/verification/screenshots/invalidation_t1_8.png")

        await browser.close()
        print("[TEST T1.8] Teste concluído com sucesso!")

if __name__ == "__main__":
    asyncio.run(verify_t1_8())
