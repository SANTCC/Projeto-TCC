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

        await page.goto("http://localhost:3000/dashboard.html")
        await page.wait_for_selector("#auditLogPanel")

        print("Testing Phase 7 Flow on dashboard.html & delegacao.html...")

        dialog_messages = []
        async def handle_dialog(dialog):
            dialog_messages.append(dialog.message)
            if dialog.type == "prompt":
                await dialog.accept("Retificação de teste formalizada no trail")
            else:
                await dialog.accept()

        page.on("dialog", handle_dialog)

        # 1. Test Audit Log Table on dashboard.html (T7.1, T7.2)
        audit_rows = await page.query_selector_all("#auditLogTableBody tr")
        assert len(audit_rows) > 0, "Audit log rows expected"
        print("1. Audit Log rendering passed.")

        # 2. Test Critical Decision Trail & Rectification Attachment on dashboard.html (T7.3, T7.4, T7.5)
        trail_items = await page.query_selector_all("#trailDecisoesContainer > div")
        assert len(trail_items) > 0, "Trail items expected"

        # Click Anexar Retificação
        retif_btns = await page.query_selector_all('button:has-text("Anexar Retificação")')
        if retif_btns:
            await retif_btns[0].click()
            await page.wait_for_timeout(300)
            assert any("Retificação vinculada com sucesso" in msg for msg in dialog_messages), "Rectification success alert expected"
            print("2. Decision trail & rectification attachment passed.")

        # 3. Test Supervisor Delegation Flow & Active Rule Limit on delegacao.html (T7.6, T7.7, T7.8, T7.9)
        await page.goto("http://localhost:3000/delegacao.html")
        await page.wait_for_selector("#delegacaoForm")

        await page.fill("#delegSubstitutoMatricula", "MAT-6090")
        await page.fill("#delegDataInicio", "2026-10-01T08:00")
        await page.fill("#delegDataFim", "2026-10-10T18:00")

        await page.evaluate("() => document.querySelector('#delegacaoForm button[type=\"submit\"]').click()")
        await page.wait_for_timeout(500)

        assert any("designado temporariamente como substituto" in msg for msg in dialog_messages), "Delegation success alert expected"
        print("3. Delegation assignment passed.")

        # Test Revocation
        await page.click("#revogarDelegacaoBtn")
        await page.wait_for_timeout(300)
        assert any("Delegação revogada com sucesso" in msg for msg in dialog_messages), "Revocation success alert expected"
        print("4. Delegation revocation passed.")

        await page.screenshot(path="verification_phase7_final.png")
        print("Phase 7 verification complete! Screenshot saved.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
