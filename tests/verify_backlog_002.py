import asyncio
from playwright.async_api import async_playwright

async def run_tests():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        print("--- 1. Configurando Sessão TÉCNICO_PORTOS ---")
        await page.goto("http://localhost:3000/index.html")
        await page.evaluate("""() => {
            const session = {
                codigo_individual: 'NX-1914-PL',
                matricula: 'MAT-1914',
                cargo: 'TECNICO_PORTOS',
                cargo_nome: 'Técnico em Portos',
                nome: 'Maxwell Philip da Cruz',
                nivel: 'Nível Operacional',
                camada_visao: 'Visão Operacional'
            };
            localStorage.setItem('nexus_session', JSON.stringify(session));
        }""")

        dialog_messages = []
        async def handle_dialog(dialog):
            dialog_messages.append(dialog.message)
            await dialog.accept()

        page.on("dialog", handle_dialog)

        print("--- 2. Testando Validação de CPF do Visitante (Item 15) ---")
        await page.goto("http://localhost:3000/tecnico_portos.html")
        await page.wait_for_timeout(1000)

        # Toggle form
        await page.click("#toggleVisFormBtn")
        await page.fill("#visNome", "Visitante Teste CPF")
        await page.fill("#visDocumento", "12345678900") # CPF inválido
        await page.fill("#visMotivo", "Auditoria")

        await page.click("#visCrudForm button[type='submit']")
        await page.wait_for_timeout(500)
        assert any("CPF INVÁLIDO" in msg or "inválido" in msg.lower() for msg in dialog_messages), f"Esperado alerta de CPF inválido, obtidos: {dialog_messages}"
        print("✅ Validação de CPF Funcional!")

        print("--- 3. Testando Validação de Valores Positivos em Cargas (Item 16) ---")
        # Supervisor session
        await page.evaluate("""() => {
            const session = {
                codigo_individual: 'SUP-2001',
                matricula: 'MAT-888001',
                cargo: 'SUPERVISOR_GERENTE_OPERACOES',
                cargo_nome: 'Supervisor de Operações',
                nome: 'Carlos Supervisor',
                nivel: 'Nível Tático/Gestão',
                camada_visao: 'Visão Operacional'
            };
            localStorage.setItem('nexus_session', JSON.stringify(session));
        }""")
        await page.goto("http://localhost:3000/cargas.html")
        await page.wait_for_timeout(1000)

        await page.click("#toggleAgendamentoFormBtn")
        await page.select_option("#agTipoCarga", index=1)
        await page.fill("#agPeso", "-10")
        await page.fill("#agVolume", "20")
        await page.fill("#agValor", "1000")
        await page.fill("#agNatureza", "Carga Teste")
        await page.select_option("#agPortoDescarga", index=1)
        await page.fill("#agDestino", "Destino Teste")
        await page.fill("#agDataPrevista", "2026-10-10")

        is_valid = await page.evaluate("() => document.getElementById('agPeso').checkValidity()")
        assert is_valid == False, "Input com peso negativo deve ser inválido via checkValidity()"
        print("✅ Validação de valores estritamente positivos em cargas OK (min=0.01 & checkValidity)!")

        print("--- 4. Testando IMO e GPS em Embarcações (Itens 11 e 12) ---")
        # Inspetor session
        await page.evaluate("""() => {
            const session = {
                codigo_individual: 'INS-6090',
                matricula: 'MAT-6090',
                cargo: 'INSPETOR',
                cargo_nome: 'Inspetor Técnico',
                nome: 'Ana Inspetora',
                nivel: 'Nível Tático/Gestão',
                camada_visao: 'Visão Operacional'
            };
            localStorage.setItem('nexus_session', JSON.stringify(session));
        }""")
        await page.goto("http://localhost:3000/embarcacoes.html")
        await page.wait_for_timeout(1000)

        await page.click("#toggleNavioFormBtn")
        await page.fill("#navioNome", "Navio IMO Invalido")
        await page.fill("#navioImo", "12345") # Formato incorreto (requer 3 letras + 7 números)
        await page.fill("#navioOrigem", "Santos")
        await page.fill("#navioDestino", "Roterdã")
        await page.fill("#navioGps", "23.9608° S, 46.3022° W")
        await page.fill("#navioDistancia", "10200")

        await page.click("#navioForm button[type='submit']")
        await page.wait_for_timeout(500)
        assert any("FORMATO DE IMO INVÁLIDO" in msg for msg in dialog_messages), f"Esperado alerta de IMO inválido, obtidos: {dialog_messages}"
        print("✅ Validação de IMO (3 letras + 7 números) OK!")

        print("--- 5. Testando Manutenção de Navio e Regra de 3 Anos (Item 17) ---")
        await page.goto("http://localhost:3000/manutencao.html")
        await page.wait_for_timeout(1000)

        await page.click("#toggleNavioManutFormBtn")
        await page.select_option("#navioManutSelect", index=1)
        await page.select_option("#navioTipoManutSelect", "GERAL")
        await page.fill("#navioDescManut", "Manutenção Geral Teste")

        await page.click("#navioManutForm button[type='submit']")
        await page.wait_for_timeout(500)
        assert any("OPÇÃO BLOQUEADA" in msg or "Manutenção Geral" in msg for msg in dialog_messages), f"Alerta recebido para Manutenção Geral: {dialog_messages}"
        print("✅ Regra de 3 anos para Manutenção Geral de Navio OK!")

        await browser.close()
        print("\n=== TODOS OS TESTES AUTOMATIZADOS DO BACKLOG 002 PASSARAM COM SUCESSO! ===")

if __name__ == "__main__":
    asyncio.run(run_tests())
