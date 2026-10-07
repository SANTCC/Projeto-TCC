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
        await page.wait_for_selector("#cardsOperacionaisPanel:not(.hidden)")

        print("Testing Phase 6 Flow on dashboard.html & relatorios.html...")

        dialog_messages = []
        async def handle_dialog(dialog):
            dialog_messages.append(dialog.message)
            await dialog.accept()

        page.on("dialog", handle_dialog)

        # 1. Test Operational Cards on dashboard.html (T6.1, T6.2, T6.3, T6.4)
        card_val = await page.text_content("#cardNaviosManutencaoVal")
        assert card_val is not None, "Card value expected"

        # Click on card for details
        await page.click("#cardsOperacionaisPanel > div.grid > div:first-child")
        await page.wait_for_timeout(300)
        modal_visible = await page.is_visible("#cardDetailModal")
        assert modal_visible, "Card detail modal expected to be visible"
        print("1. Operational Cards & detail modal passed.")

        # 2. Test Reports and Productivity on relatorios.html (T6.8, T6.9, T6.10)
        await page.goto("http://localhost:3000/relatorios.html")
        await page.wait_for_selector("#produtividadeTableBody")

        prod_count = await page.query_selector_all("#produtividadeTableBody tr")
        assert len(prod_count) > 0, "Productivity rows expected"
        print("2. Productivity Report on relatorios.html passed.")

        await page.screenshot(path="verification_phase6_final.png")
        print("Phase 6 verification complete! Screenshot saved.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
