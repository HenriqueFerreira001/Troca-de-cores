#!/usr/bin/env node
/*
 * Compara jeitos diferentes de otimizar a mesma lista com a ordem de outro app.
 * Uso: node tools/variantes.js testes-rota/arquivo.json   (precisa de "compararCom")
 * Mostra, para cada jeito: km, tempo, quantas posições batem e a ordem.
 */
'use strict';
const fs = require('fs');
const Solver = require('../solver.js');
const Enderecos = require('../enderecos.js');
const { geocode, osrmTable, ibgeCity, km, min } = require('./rota-cli.js');

async function main() {
    const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const city = ibgeCity(cfg.cidade);
    const stops = [];
    for (const p of cfg.paradas) stops.push({ ...p, geo: await geocode(p, cfg.cidade, cfg.uf, city) });
    const ok = stops.filter(s => s.geo);
    const ini = cfg.inicio;
    const cityIni = ini.cidade ? ibgeCity(ini.cidade) : city;
    const r = await Enderecos.find(cityIni, { street: ini.rua, number: ini.numero, bairro: ini.bairro });
    const start = { lat: r.lat, lng: r.lng };
    const m = await osrmTable([start, ...ok.map(s => s.geo)]);
    const n = ok.length;
    const nome = (i) => `${ok[i - 1].rua.replace(/^(RUA|AVENIDA|TRAVESSA) /, '')} ${ok[i - 1].numero}`;
    const osIdx = new Map(ok.map((s, i) => [String(s.os), i + 1]));
    const zeo = cfg.compararCom.map(o => osIdx.get(String(o))).filter(Boolean);

    const custo = (mat, seq, volta) => {
        let c = 0, prev = 0;
        for (const i of seq) { c += mat[prev][i]; prev = i; }
        if (volta) c += mat[prev][0];
        return c;
    };
    const iguais = (seq) => seq.filter((x, k) => x === zeo[k]).length;
    // semelhança: pares na mesma ordem relativa (100% = mesma ordem)
    const pares = (seq) => {
        const pos = new Map(seq.map((x, k) => [x, k]));
        let ok2 = 0, tot = 0;
        for (let a = 0; a < zeo.length; a++) for (let b = a + 1; b < zeo.length; b++) { tot++; if (pos.get(zeo[a]) < pos.get(zeo[b])) ok2++; }
        return Math.round(ok2 / tot * 100);
    };
    const livreSub = (mat) => {
        const sub = mat.slice(1).map(row => row.slice(1));
        return [new Array(sub.length + 1).fill(0)].concat(sub.map(row => [1e12, ...row]));
    };
    const nodes = Array.from({ length: n }, (_, i) => ({ idx: i + 1, priority: 'normal' }));
    const variantes = [];
    for (const [rot, mat] of [['distância', m.dist], ['tempo', m.dur]]) {
        const volta = Solver.solveWithPriorities(mat, 0, nodes, 0, {});
        const voltaRev = [...volta].reverse();
        variantes.push([`${rot} · ida e volta (sentido do cálculo)`, volta]);
        variantes.push([`${rot} · ida e volta (sentido inverso)`, voltaRev]);
        variantes.push([`${rot} · termina na última parada`, Solver.solveWithPriorities(mat, 0, nodes, null, {})]);
        let perto = Solver.solveWithPriorities(livreSub(mat), 0, nodes, null, {});
        if (mat[perto[0]][0] < mat[perto[perto.length - 1]][0]) perto = [...perto].reverse();
        variantes.push([`${rot} · termina perto da saída`, perto]);
        variantes.push([`${rot} · APP: começa pela ponta mais rápida`, [...perto].reverse()[0] && (mat[0][perto[0]] <= mat[0][perto[perto.length - 1]] ? perto : [...perto].reverse())]);
        variantes.push([`${rot} · APP com ⇅ Inverter`, (mat[0][perto[0]] <= mat[0][perto[perto.length - 1]] ? [...perto].reverse() : perto)]);
        // vizinho mais próximo a partir da parada mais longe
        let far = 1; for (let i = 2; i <= n; i++) if (mat[0][i] > mat[0][far]) far = i;
        const nn = [far]; const left = new Set(nodes.map(x => x.idx)); left.delete(far);
        while (left.size) { const cur = nn[nn.length - 1]; let b = null; for (const x of left) if (b === null || mat[cur][x] < mat[cur][b]) b = x; nn.push(b); left.delete(b); }
        variantes.push([`${rot} · começa na mais longe e vai na mais perto`, nn]);
    }
    variantes.push(['ZEO', zeo]);

    const out = ['## Variantes × Zeo', '', '| Jeito | km (só ida) | tempo | posições iguais | ordem parecida |', '|---|---|---|---|---|'];
    for (const [rot, seq] of variantes) {
        out.push(`| ${rot} | ${km(custo(m.dist, seq, false))} | ${min(custo(m.dur, seq, false))} | ${iguais(seq)} de ${zeo.length} | ${pares(seq)}% |`);
    }
    out.push('');
    for (const [rot, seq] of variantes) out.push(`- **${rot}:** ${seq.map((x, k) => `${k + 1}.${nome(x)}`).join(' → ')}`);
    out.push('');
    out.push('Localizações usadas:');
    ok.forEach((s, i) => out.push(`- ${nome(i + 1)}: ${s.geo.found}`));
    console.log(out.join('\n'));
}
main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
