// Testa o otimizador: compara com força bruta (todas as ordens possíveis).
// Rodar: node tests/solver.test.js
const S = require('../solver.js');
const assert = require('assert');

function rand(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function makeMatrix(n, r, asym) {
    const pts = Array.from({ length: n }, () => [r() * 10, r() * 10]);
    return pts.map((a, i) => pts.map((b, j) => {
        if (i === j) return 0;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]) * 60;
        return asym ? d * (1 + r() * 0.4) : d;
    }));
}
function perms(arr) {
    if (arr.length <= 1) return [arr];
    const out = [];
    arr.forEach((x, i) => perms(arr.slice(0, i).concat(arr.slice(i + 1))).forEach(p => out.push([x, ...p])));
    return out;
}
function brute(m, start, stops, end) {
    let best = Infinity;
    for (const p of perms(stops)) best = Math.min(best, S.fullCost(m, start, p, end));
    return best;
}

let checks = 0;
for (let seed = 1; seed <= 60; seed++) {
    const r = rand(seed);
    const n = 3 + (seed % 7);                  // 3..9 paradas
    const asym = seed % 2 === 0;
    const m = makeMatrix(n + 2, r, asym);
    const stops = Array.from({ length: n }, (_, i) => i + 1);
    for (const end of [0, n + 1, null]) {       // volta ao início, fim fixo, fim livre
        const o = S.solvePath(m, 0, stops, end);
        assert.deepStrictEqual([...o].sort((a, b) => a - b), stops, 'deve visitar todas uma vez');
        const got = S.fullCost(m, 0, o, end), exp = brute(m, 0, stops, end);
        assert(Math.abs(got - exp) < 1e-6, `exato seed=${seed} end=${end}: ${got} vs ${exp}`);
        // heurística também deve achar o ótimo nesses tamanhos
        const h = S.heuristic(m, 0, stops, end, 150);
        const hc = S.fullCost(m, 0, h, end);
        assert(hc <= exp * 1.0001, `heurística seed=${seed} end=${end}: ${hc} vs ${exp}`);
        checks += 2;
    }
}

// Heurística vs exato em 13 paradas (onde o exato ainda roda)
let worst = 0;
for (let seed = 100; seed < 120; seed++) {
    const r = rand(seed);
    const m = makeMatrix(14, r, seed % 2 === 0);
    const stops = Array.from({ length: 13 }, (_, i) => i + 1);
    const exact = S.fullCost(m, 0, S.heldKarp(m, 0, stops, 0), 0);
    const h = S.fullCost(m, 0, S.heuristic(m, 0, stops, 0, 400), 0);
    worst = Math.max(worst, h / exact - 1);
    checks++;
}
console.log(`heurística em 13 paradas: pior diferença para o ótimo = ${(worst * 100).toFixed(3)}%`);

// Prioridades: "first" antes de todas, "last" depois de todas
{
    const r = rand(999);
    const m = makeMatrix(12, r, true);
    const nodes = Array.from({ length: 11 }, (_, i) => ({ idx: i + 1, priority: i < 2 ? 'first' : i > 8 ? 'last' : 'normal' }));
    const o = S.solveWithPriorities(m, 0, nodes, 0);
    assert.deepStrictEqual([...o].sort((a, b) => a - b), nodes.map(n => n.idx));
    assert([1, 2].includes(o[0]) && [1, 2].includes(o[1]), 'prioritárias primeiro');
    assert([10, 11].includes(o[9]) && [10, 11].includes(o[10]), 'últimas no fim');
    checks++;
}

// Grande: 100 paradas em grade — rota ótima conhecida
{
    const pts = [];
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) pts.push([x, y]);
    const m = pts.map(a => pts.map(b => Math.hypot(a[0] - b[0], a[1] - b[1])));
    const stops = pts.map((_, i) => i).slice(1);
    const t = Date.now();
    const o = S.solvePath(m, 0, stops, 0, { timeLimitMs: 1500 });
    const c = S.fullCost(m, 0, o, 0);
    console.log(`grade 10x10 (ótimo = 100): obtido ${c.toFixed(2)} em ${Date.now() - t} ms`);
    assert(c <= 100 * 1.03, 'grade deve ficar a no máximo 3% do ótimo');
    checks++;
}

console.log(`OK — ${checks} verificações passaram`);
