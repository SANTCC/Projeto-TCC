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

        await page.goto("http://localhost:3000/embarcacoes.html")
        await page.wait_for_selector("#embarcacoesGpsTableBody")

        print("Testing Phase 8 Flow on embarcacoes.html...")

        # 1. Test GPS Table & Classification Rendering (T8.1, T8.2)
        navio_rows = await page.query_selector_all("#embarcacoesGpsTableBody tr")
        assert len(navio_rows) > 0, "Location rows expected"

        gps_text = await page.text_content("#embarcacoesGpsTableBody tr:first-child")
        assert gps_text and gps_text.strip(), "Ship row expected"
        print("1. Ship table & classification rendering passed.")

        # 2. Test NO_PORTO_DE_DESTINO paused time fix (RF 5 / RN 8)
        dest_text = await page.text_content("#embarcacoesGpsTableBody tr:nth-child(3)")
        assert "Atracado no Destino" in dest_text, "NO_PORTO_DE_DESTINO time outside port should be paused/Atracado"
        print("2. NO_PORTO_DE_DESTINO paused time fix passed.")

        await page.screenshot(path="verification_phase8_final.png")
        print("Phase 8 verification complete! Screenshot saved.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
