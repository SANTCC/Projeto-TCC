import asyncio
from playwright.async_api import async_playwright

async def verify():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()

        session_json = '{"id":"1","cargo":"SUPERVISOR_GERENTE_OPERACOES","cargo_nome":"Supervisor de Operações","matricula":"MAT-1914","codigo_individual":"OP-1914","nome":"Maxwell Philip da Cruz"}'

        await context.add_cookies([{
            'name': 'nexus_session',
            'value': session_json,
            'url': 'http://localhost:3000'
        }])

        await page.goto('http://localhost:3000/cargas.html')
        await page.wait_for_selector('#cargasTableBody')

        await page.evaluate('''() => {
            localStorage.setItem('nexus_cargas_fluxo', JSON.stringify([{
                id: 'CRG-TEST-GND',
                tipo: 'Carga Geral',
                peso: '10 t',
                volume: '20 m³',
                valor: 'R$ 10.000',
                natureza: 'Teste',
                portoDescarga: 'Berço 01',
                status: 'AGENDAMENTO',
                qrCode: 'QR-CRG-TEST-GND'
            }]));
            localStorage.setItem('nexus_guindastes_list', JSON.stringify([{
                id: 'GND-01-STS',
                identificacao: 'GND-01-STS',
                estado: 'OPERANTE'
            }]));
        }''')

        await page.reload()
        await page.wait_for_selector('#cargasTableBody')
        await page.wait_for_function('() => typeof window.executarAcaoCarga === "function"')

        # Trigger movimentar with guindaste selection
        await page.evaluate('''async () => {
            await window.executarAcaoCarga('CRG-TEST-GND', 'MOVIMENTAR', { guindasteIdentificacao: 'GND-01-STS' });
        }''')

        await page.wait_for_timeout(1000)

        # Check localStorage to ensure nexus_guindaste_tarefas was NOT created
        local_tasks = await page.evaluate("localStorage.getItem('nexus_guindaste_tarefas')")
        print(f"localStorage 'nexus_guindaste_tarefas': {local_tasks}")
        assert local_tasks is None, "Expected localStorage nexus_guindaste_tarefas to be None!"

        print("Verification script passed successfully! Crane tasks do not use localStorage.")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(verify())
