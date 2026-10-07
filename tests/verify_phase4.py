import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Set localStorage session
        await page.goto("http://localhost:3000/index.html")
        await page.evaluate("""() => {
            const session = {
                codigo_individual: 'SUP-2001',
                matricula: '888001',
                cargo: 'SUPERVISOR_GERENTE_OPERACOES',
                cargo_nome: 'Supervisor de Operações',
                nome: 'Carlos Supervisor',
                nivel: 'Nível Tático/Gestão',
                camada_visao: 'Visão Operacional'
            };
            localStorage.setItem('nexus_session', JSON.stringify(session));
        }""")

        await page.goto("http://localhost:3000/manutencao.html")
        await page.wait_for_selector("#osTableBody")

        print("Testing Phase 4 Flow on manutencao.html...")

        dialog_messages = []
        async def handle_dialog(dialog):
            dialog_messages.append(dialog.message)
            await dialog.accept()

        page.on("dialog", handle_dialog)

        # 1. Test OS Creation (T4.1)
        await page.click("#toggleOsFormBtn")
        await page.wait_for_selector("#osForm:not(.hidden)")

        await page.select_option("#osEquipamento", "GND-01-STS")
        await page.select_option("#osPrioridade", "ALTA")
        await page.fill("#osDescricao", "Troca dos cabos de aço")

        await page.evaluate("() => document.querySelector('#osForm button[type=\"submit\"]').click()")
        await page.wait_for_timeout(500)

        assert any("Ordem de Serviço" in msg for msg in dialog_messages), "OS creation alert expected"
        print("1. OS Creation test passed.")

        # 2. Test OS Approval (T4.2, T4.3, T4.4)
        aprovar_btns = await page.query_selector_all('button:has-text("Aprovar")')
        if aprovar_btns:
            await aprovar_btns[0].click()
            await page.wait_for_timeout(300)
            assert any("APROVADA" in msg for msg in dialog_messages), "OS approval alert expected"
            print("2. OS Approval & Maintenance Blockage test passed.")

        # 3. Test OS Completion (T4.5)
        concluir_btns = await page.query_selector_all('button:has-text("Concluir Manutenção")')
        if concluir_btns:
            await concluir_btns[0].click()
            await page.wait_for_timeout(300)
            assert any("CONCLUÍDA" in msg for msg in dialog_messages), "OS completion alert expected"
            print("3. OS Completion test passed.")

        # 4. Test Panic Button & Emergency Banner (T4.6, T4.7, T4.8)
        await page.click("#panicButton")
        await page.wait_for_timeout(300)
        assert any("EMERGÊNCIA CRÍTICA" in msg for msg in dialog_messages), "Panic alert expected"

        banner_visible = await page.is_visible("#emergencyAlertBanner:not(.hidden)")
        assert banner_visible, "Emergency banner should be visible"
        print("4. Panic Button & Emergency Banner test passed.")

        # 5. Test Emergency Alarm Reset (T4.10)
        await page.click("#resetEmergencyBtn")
        await page.wait_for_timeout(300)
        assert any("desativado" in msg for msg in dialog_messages), "Alarm reset alert expected"
        print("5. Emergency Alarm Reset test passed.")

        await page.screenshot(path="verification_phase4_final.png")
        print("Phase 4 verification complete! Screenshot saved.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
