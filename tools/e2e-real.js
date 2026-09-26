#!/usr/bin/env node
/*
 * Roda o APP DE VERDADE num navegador, com mapa e endereços reais, do jeito que
 * o usuário usa: importa a planilha, deixa "Descobrir sozinho", toca em Otimizar
 * e lê a ordem da tela. Compara com a ordem do Zeo (testes-rota/*.json com compararCom).
 * Uso (no GitHub Actions): node tools/e2e-real.js http://localhost:8080/
 */
'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { chromium } = require('playwright');

async function main() {
    const url = process.argv[2];
    const browser = await chromium.launch();
    const out = ['## App real × Zeo', ''];
    for (const f of fs.readdirSync('testes-rota').filter(x => x.endsWith('.json'))) {
        const cfg = JSON.parse(fs.readFileSync(path.join('testes-rota', f), 'utf8'));
        if (!cfg.compararCom) continue;
        const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
        const page = await ctx.newPage();
        const erros = [];
        page.on('pageerror', e => erros.push(e.message));
        page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') erros.push(m.text().slice(0, 200)); });
        page.on('requestfailed', r => erros.push('falhou: ' + r.url().slice(0, 120) + ' ' + (r.failure() || {}).errorText));
        const t0 = Date.now();
        const tick = setInterval(async () => {
            try {
                const st = await page.evaluate(() => ({ n: document.querySelectorAll('#stops li').length, busy: document.querySelector('#busy-text').textContent, hidden: document.querySelector('#busy').classList.contains('hidden'), toast: document.querySelector('#toast').textContent }));
                console.error(`[${f} ${Math.round((Date.now() - t0) / 1000)}s] paradas=${st.n} busy=${st.hidden ? '-' : st.busy} toast=${st.toast}`);
            } catch (e) { /* página ocupada */ }
        }, 10000);
        await page.goto(url);
        await page.waitForSelector('#map .leaflet-pane', { state: 'attached' });

        // planilha igual à do usuário
        const rows = [['OS', 'RUA', 'NÚMERO', 'BAIRRO'], ...cfg.paradas.map(p => [p.os, p.rua, p.numero, p.bairro])];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'OS');
        const xlsx = path.join('/tmp', f.replace('.json', '.xlsx'));
        XLSX.writeFile(wb, xlsx);

        await page.setInputFiles('#file-import', xlsx);
        await page.waitForSelector('#imp-city-sel');
        await page.click('#dialog-actions button.primary');
        await page.waitForFunction((n) => document.querySelectorAll('#stops li').length === n, cfg.paradas.length, { timeout: 600000 });
        await page.waitForSelector('#busy.hidden', { state: 'attached', timeout: 600000 });
        const avisos = (await page.textContent('#warnings')).trim();
        const semLugar = await page.$$eval('#stops li', ls => ls.filter(li => /não encontrado/.test(li.textContent)).map(li => li.querySelector('.addr').textContent));
        if (semLugar.length) console.error('SEM LOCALIZAÇÃO:', semLugar.join(' | '));

        await page.click('#btn-optimize');
        await page.waitForFunction(() => document.querySelector('#stops li .num') && document.querySelector('#stops li .num').textContent === '1', null, { timeout: 180000 });
        await page.waitForSelector('#busy.hidden', { state: 'attached', timeout: 180000 });
        await page.waitForTimeout(1500);

        const saida = await page.textContent('#start-label');
        const resumo = (await page.textContent('#summary')).replace(/\s+/g, ' ').trim();
        const lista = await page.$$eval('#stops li', ls => ls.map(li => ({
            addr: li.querySelector('.addr').textContent.trim(),
            note: (li.querySelector('.note') || {}).textContent || '',
        })));
        const ordem = lista.map(x => (x.note.match(/OS (\d+)/) || [])[1]);
        const zeo = cfg.compararCom.map(String);
        const iguais = ordem.filter((o, i) => o === zeo[i]).length;
        const pos = new Map(ordem.map((o, i) => [o, i]));
        let ok = 0, tot = 0;
        for (let a = 0; a < zeo.length; a++) for (let b = a + 1; b < zeo.length; b++) { tot++; if (pos.get(zeo[a]) < pos.get(zeo[b])) ok++; }

        out.push(`### ${cfg.nome}`);
        out.push(`- Saída na tela: ${saida}`);
        out.push(`- Resumo: ${resumo}`);
        if (avisos) out.push(`- Avisos: ${avisos}`);
        out.push(`- Posições iguais ao Zeo: **${iguais} de ${zeo.length}** · ordem parecida: **${Math.round(ok / tot * 100)}%**`);
        if (erros.length) out.push(`- Erros na página: ${erros.join(' | ')}`);
        out.push('');
        out.push('| # | App | Zeo |');
        out.push('|---|---|---|');
        const nome = (os) => { const p = cfg.paradas.find(x => String(x.os) === os); return p ? `${p.rua} ${p.numero}` : os; };
        for (let i = 0; i < zeo.length; i++) out.push(`| ${i + 1} | ${nome(ordem[i])}${ordem[i] === zeo[i] ? ' ✅' : ''} | ${nome(zeo[i])} |`);
        out.push('');
        await page.screenshot({ path: `/tmp/app-${f.replace('.json', '')}.png` });
        clearInterval(tick);
        await ctx.close();
    }
    await browser.close();
    console.log(out.join('\n'));
}
main().catch(e => { console.error('Erro:', e); process.exit(1); });
process.on('exit', () => {});
