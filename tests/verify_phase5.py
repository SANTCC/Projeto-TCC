import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Set localStorage session before navigation
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

        await page.goto("http://localhost:3000/cargas.html")
        await page.wait_for_selector("#cargasTableBody")

        print("Testing Phase 5 Flow on cargas.html & scanner.html...")

        dialog_messages = []
        async def handle_dialog(dialog):
            dialog_messages.append(dialog.message)
            await dialog.accept()

        page.on("dialog", handle_dialog)

        # 1. Test QR Code Generation on Scheduling (T5.1, T5.2)
        await page.click("#toggleAgendamentoFormBtn")
        await page.wait_for_selector("#agendamentoCargaForm:not(.hidden)")

        await page.select_option("#agTipoCarga", "Grãos Soltos")
        await page.fill("#agPeso", "30.0")
        await page.fill("#agVolume", "50")
        await page.fill("#agValor", "100000")
        await page.fill("#agNatureza", "Agrícola")
        tag_name = await page.eval_on_selector("#agPortoDescarga", "el => el.tagName.toLowerCase()")
        if tag_name == "select":
            await page.select_option("#agPortoDescarga", index=1)
        else:
            await page.fill("#agPortoDescarga", "Porto de Roterdã")
        await page.fill("#agDestino", "Roterdã")
        await page.fill("#agDataPrevista", "2026-10-15")

        await page.evaluate("() => document.querySelector('#agendamentoCargaForm button[type=\"submit\"]').click()")
        await page.wait_for_timeout(500)

        # Modal should be visible
        modal_id = await page.text_content("#qrModalEntityId")
        assert modal_id and "CRG" in modal_id, "Modal entity ID expected"

        # Click Print PDF
        await page.click("#printEtiquetaBtn")
        await page.wait_for_timeout(300)

        await page.click("#closeQrModalBtn")

        # 2. Test Dedicated Scanner Page (scanner.html)
        await page.goto("http://localhost:3000/scanner.html")
        await page.wait_for_selector("#simulatedQrInput")

        await page.fill("#simulatedQrInput", "QR-CRG-2026-001")
        await page.click("#simulateScanBtn")
        await page.wait_for_timeout(500)

        card_visible = await page.is_visible("#qrResultCard:not(.hidden)")
        assert card_visible, "Scan result card expected"
        print("4. Dedicated Scanner page & scan test passed.")

        await page.screenshot(path="verification_phase5_final.png")
        print("Phase 5 verification complete! Screenshot saved.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
