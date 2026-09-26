#!/usr/bin/env node
/*
 * Organiza uma rota pela linha de comando, com os mesmos serviços e o mesmo
 * otimizador do app. Usado para conferir listas reais (ex.: comparar com o Zeo).
 *
 * Uso: node tools/rota-cli.js testes-rota/minha-rota.json
 *
 * Formato do arquivo:
 * {
 *   "nome": "Rota de teste",
 *   "cidade": "Embu das Artes", "uf": "SP",
 *   "inicio": "endereço de saída" (opcional),
 *   "fim": "perto" (termina perto da saída) | "livre" | "voltar" | "endereço" (padrão "perto" com início),
 *   "otimizarPor": "distancia" | "tempo" (opcional, padrão "distancia"),
 *   "paradas": [{ "os": "123", "rua": "RUA X", "numero": "10", "bairro": "JD Y", "prioridade": false }]
 * }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Solver = require('../solver.js');
const Enderecos = require('../enderecos.js');

// Índice do IBGE da cidade, se existir em dados/cnefe.
function ibgeCity(nome) {
    try {
        const lista = JSON.parse(fs.readFileSync(path.join(__dirname, '../dados/cidades.json'), 'utf8'));
        const c = lista.find(x => Enderecos.nucleo(x.cidade) === Enderecos.nucleo(nome));
        if (!c) return null;
        const dir = path.join(__dirname, `../dados/cnefe/${c.cod}`);
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
        return Enderecos.prepare(meta, (letra) => JSON.parse(fs.readFileSync(path.join(dir, letra + '.json'), 'utf8')));
    } catch (e) { return null; }
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OSRM = 'https://router.project-osrm.org';
const UA = 'RotaCerta/1.0 (https://github.com/HenriqueFerreira001/Troca-de-cores)';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Mesmas abreviações do app.
function expand(text) {
    const map = [
        [/\bAV\.?(?=\s)/gi, 'Avenida'], [/\bR\.(?=\s)/gi, 'Rua'], [/\bAL\.?(?=\s)/gi, 'Alameda'],
        [/\bTV\.?(?=\s)/gi, 'Travessa'], [/\bPCA\.?(?=\s)|\bPÇA\.?(?=\s)/gi, 'Praça'], [/\bEST\.?(?=\s)/gi, 'Estrada'],
        [/\bJD\.?(?=\s)/gi, 'Jardim'], [/\bJARD\.?(?=\s)/gi, 'Jardim'], [/\bPQ\.?(?=\s)/gi, 'Parque'], [/\bVL\.?(?=\s)/gi, 'Vila'],
        [/\bCH\.?(?=\s)/gi, 'Chácara'], [/\bCJ\.?(?=\s)/gi, 'Conjunto'], [/\bRES\.?(?=\s)/gi, 'Residencial'],
        [/\bNSA\.?\s+SRA\.?(?=\s)/gi, 'Nossa Senhora'], [/\bN\.?\s?SRA\.?(?=\s)/gi, 'Nossa Senhora'],
        [/\bSTA\.?(?=\s)/gi, 'Santa'], [/\bSTO\.?(?=\s)/gi, 'Santo'], [/\bSAO(?=\s)/gi, 'São'],
        [/\bPROF\.?(?=\s)/gi, 'Professor'], [/\bPROFA\.?(?=\s)/gi, 'Professora'], [/\bDR\.?(?=\s)/gi, 'Doutor'],
        [/\bENG\.?(?=\s)/gi, 'Engenheiro'], [/\bCEL\.?(?=\s)/gi, 'Coronel'], [/\bGAL\.?(?=\s)/gi, 'General'],
    ];
    let t = ' ' + text + ' ';
    for (const [re, full] of map) t = t.replace(re, full);
    return t.trim();
}

let last = 0;
async function nominatim(params) {
    const wait = 1100 - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const qs = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '1', 'accept-language': 'pt-BR', countrycodes: 'br', ...params });
    for (let i = 0; i < 3; i++) {
        const res = await fetch(`${NOMINATIM}/search?${qs}`, { headers: { 'User-Agent': UA } });
        if (res.ok) return res.json();
        await sleep(2000 * (i + 1));
    }
    throw new Error('Nominatim não respondeu');
}

// Mesma estratégia do app: primeiro o IBGE (número exato); depois o mapa gratuito
// (rua+número+cidade; texto com bairro; sem bairro).
async function geocode(p, cidade, uf, city) {
    let ibge = null;
    if (city) {
        const r = await Enderecos.find(city, { street: p.rua, number: p.numero, bairro: p.bairro });
        if (r && !r.ambiguous && r.lat != null) {
            ibge = { lat: r.lat, lng: r.lng, precise: r.exact || r.good, found: `${r.found} [IBGE ${r.exact ? 'exato' : 'estimado'}]` };
            // Número exato ou estimativa boa: não precisa do mapa gratuito.
            if (ibge.precise) return ibge;
        }
    }
    const street = expand(p.rua);
    const bairro = expand(p.bairro || '');
    const tries = [
        { street: `${p.numero || ''} ${street}`.trim(), city: cidade, state: uf },
        { q: [street, p.numero, bairro, cidade, uf].filter(Boolean).join(', ') },
        { q: [street, p.numero, cidade, uf].filter(Boolean).join(', ') },
    ];
    let best = ibge;
    for (const t of tries) {
        const data = await nominatim(t);
        if (!data.length) continue;
        const d = data[0];
        const a = d.address || {};
        const r = {
            lat: +d.lat, lng: +d.lon,
            precise: !!a.house_number || ['house', 'building'].includes(d.addresstype),
            found: [a.road, a.house_number, a.suburb || a.neighbourhood, a.city || a.town].filter(Boolean).join(', '),
        };
        if (r.precise) return r;
        if (!best) best = r;
    }
    return best;
}

async function osrmTable(points) {
    const coords = points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const res = await fetch(`${OSRM}/table/v1/driving/${coords}?annotations=duration,distance`, { headers: { 'User-Agent': UA } });
    const data = await res.json();
    if (data.code !== 'Ok') throw new Error('OSRM: ' + (data.message || data.code));
    const fix = (m, big) => m.map(row => row.map(v => (v == null ? big : v)));
    return { dur: fix(data.durations, 1e7), dist: fix(data.distances, 1e9) };
}

const km = (m) => (m / 1000).toFixed(1).replace('.', ',') + ' km';
const min = (s) => { const t = Math.round(s / 60); return t < 60 ? `${t} min` : `${Math.floor(t / 60)}h${String(t % 60).padStart(2, '0')}`; };

async function main() {
    const file = process.argv[2];
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = [];
    const log = (s = '') => out.push(s);

    log(`## ${cfg.nome || path.basename(file)}`);
    log();

    const city = ibgeCity(cfg.cidade);
    log(city ? `Endereços: IBGE (CNEFE 2022) + mapa gratuito quando faltar` : 'Endereços: mapa gratuito (cidade sem dados do IBGE)');
    log();
    const stops = [];
    for (const p of cfg.paradas) {
        const g = await geocode(p, cfg.cidade, cfg.uf, city).catch(() => null);
        stops.push({ ...p, geo: g });
    }
    // Início: { rua, numero, bairro } ou texto. Procura no IBGE e depois no mapa gratuito.
    let start = null;
    if (cfg.inicio) {
        const ini = typeof cfg.inicio === 'string' ? { ...Enderecos.parse(cfg.inicio), texto: cfg.inicio } : { street: cfg.inicio.rua, number: cfg.inicio.numero, bairro: cfg.inicio.bairro, texto: cfg.inicio.nome || cfg.inicio.rua };
        // O início pode ser em outra cidade (ex.: base em Embu, paradas em São Paulo).
        const cityIni = cfg.inicio.cidade ? ibgeCity(cfg.inicio.cidade) : city;
        const r = cityIni ? await Enderecos.find(cityIni, ini) : null;
        if (r && r.lat != null) start = { lat: r.lat, lng: r.lng, label: `${ini.texto} (${r.found})` };
        else {
            const d = await nominatim({ q: `${expand(ini.texto)}, ${cfg.cidade}, ${cfg.uf}` });
            if (d.length) start = { lat: +d[0].lat, lng: +d[0].lon, label: ini.texto };
        }
        if (!start) log(`**Início não encontrado:** ${ini.texto}`);
    }

    const missing = stops.filter(s => !s.geo);
    if (missing.length) {
        log(`**${missing.length} endereço(s) não encontrados** (ficaram fora da rota):`);
        missing.forEach(s => log(`- OS ${s.os}: ${s.rua}, ${s.numero} - ${s.bairro}`));
        log();
    }
    const ok = stops.filter(s => s.geo);

    const fimModo = cfg.fim || 'livre';
    const perto = fimModo === 'perto' && !!start;
    const livre = fimModo === 'livre' && !!start;   // igual ao app: caminho livre + sentido pela ponta mais rápida
    let end = null;
    if (fimModo === 'voltar' && start) end = start;
    else if (fimModo !== 'voltar' && fimModo !== 'livre' && fimModo !== 'perto') {
        const d = await nominatim({ q: `${expand(fimModo)}, ${cfg.cidade}, ${cfg.uf}` });
        if (d.length) end = { lat: +d[0].lat, lng: +d[0].lon };
    }

    const points = [...(start ? [start] : []), ...ok.map(s => s.geo), ...(end ? [end] : [])];
    const m = await osrmTable(points);
    let matrix = cfg.otimizarPor === 'distancia' ? m.dist : m.dur;
    // Sem início: ponto virtual com custo zero até qualquer parada (igual ao app).
    const off = start ? 0 : 1;
    if (!start) matrix = [new Array(points.length + 1).fill(0)].concat(matrix.map(r => [1e12, ...r]));
    const nodes = ok.map((s, i) => ({ idx: i + 1, priority: 'normal' }));
    // "perto": melhor caminho só entre as paradas (começo e fim livres), virado no
    // sentido que termina perto da base (igual ao app).
    let solveMatrix = matrix;
    let endIdx = end ? matrix.length - 1 : null;
    if (perto || livre) {
        const sub = matrix.slice(1).map(row => row.slice(1));
        solveMatrix = [new Array(sub.length + 1).fill(0)].concat(sub.map(row => [1e12, ...row]));
        endIdx = null;
    }
    let order;
    if (start && cfg.maisPertoPrimeiro === true && nodes.length > 1) {
        // Igual ao app: parada 1 = a mais perto da saída; depois a melhor ordem.
        let first = 1;
        for (let i = 2; i <= nodes.length; i++) if (matrix[0][i] < matrix[0][first]) first = i;
        order = [first].concat(Solver.solveWithPriorities(solveMatrix, first, nodes.filter(n => n.idx !== first), endIdx, { timeLimitMs: 8000 }));
    } else {
        order = Solver.solveWithPriorities(solveMatrix, 0, nodes, endIdx, { timeLimitMs: 8000 });
    }

    if (perto && order.length > 1) {
        const a = order[0], z = order[order.length - 1];
        if (matrix[a][0] < matrix[z][0]) order = [...order].reverse();
    }
    if (livre && order.length > 1) {
        // Igual ao app: serviço longe da base → começa na ponta mais longe; perto → pela mais perto.
        const maisPerto = Math.min(...order.map(i => matrix[0][i]));
        const longe = cfg.otimizarPor === 'distancia' ? maisPerto > 15000 : maisPerto > 25 * 60;
        const a = order[0], z = order[order.length - 1];
        if (longe ? matrix[a][0] < matrix[z][0] : matrix[0][z] < matrix[0][a]) order = [...order].reverse();
    }
    if (cfg.inverter) order = [...order].reverse();

    // Totais pela matriz real (índices sem o ponto virtual).
    const real = (i) => i - off;
    let totD = 0, totT = 0;
    const seq = [...(start ? [0] : []), ...order, ...(end ? [endIdx] : [])];
    for (let i = 0; i < seq.length - 1; i++) {
        totD += m.dist[real(seq[i])][real(seq[i + 1])];
        totT += m.dur[real(seq[i])][real(seq[i + 1])];
    }

    log(`Início: ${start ? start.label : 'livre (começa pela parada mais conveniente)'} · Fim: ${fimModo}`);
    log(`Otimizado por: ${cfg.otimizarPor === 'distancia' ? 'distância' : 'tempo'} · ${ok.length} paradas`);
    log(`**Total dirigindo: ${km(totD)} · ${min(totT)}**`);
    log();
    log('| # | OS | Endereço | Trecho | Localização encontrada |');
    log('|---|---|---|---|---|');
    let prev = start ? 0 : null;
    order.forEach((idx, n) => {
        const s = ok[idx - 1];
        const leg = prev === null ? '—' : `${km(m.dist[real(prev)][real(idx)])} · ${min(m.dur[real(prev)][real(idx)])}`;
        const where = `${s.geo.found}${s.geo.precise ? '' : ' ⚠ aproximada'} (${s.geo.lat.toFixed(5)}, ${s.geo.lng.toFixed(5)})`;
        log(`| ${n + 1} | ${s.os} | ${s.rua}, ${s.numero} - ${s.bairro}${s.prioridade ? ' 🔴' : ''} | ${leg} | ${where} |`);
        prev = idx;
    });
    log();

    // Mede a ordem de outro app (lista de OS) com a mesma régua: mesmas posições e mesmas ruas.
    if (Array.isArray(cfg.compararCom) && cfg.compararCom.length) {
        const idxDaOs = new Map(ok.map((s, i) => [String(s.os), i + 1]));
        const outra = cfg.compararCom.map(os => idxDaOs.get(String(os))).filter(Boolean);
        const seq2 = [...(start ? [0] : []), ...outra, ...(end ? [endIdx] : [])];
        let d2 = 0, t2 = 0;
        for (let i = 0; i < seq2.length - 1; i++) {
            d2 += m.dist[real(seq2[i])][real(seq2[i + 1])];
            t2 += m.dur[real(seq2[i])][real(seq2[i + 1])];
        }
        const nome = cfg.compararNome || 'outro app';
        log(`### Comparação com ${nome} (mesmo mapa, mesmas posições)`);
        log(`- Rota Certa: **${km(totD)} · ${min(totT)}**`);
        log(`- ${nome}: **${km(d2)} · ${min(t2)}**`);
        const dif = d2 - totD;
        log(`- Diferença: ${dif >= 0 ? 'Rota Certa ' + km(dif) + ' mais curta' : nome + ' ' + km(-dif) + ' mais curta'} · ${min(Math.abs(t2 - totT))} de diferença no tempo`);
        const nossa = order.map(i => ok[i - 1].os);
        const difs = outra.map((i, n) => (ok[i - 1].os === nossa[n] ? null : `${n + 1}: ${nome} ${ok[i - 1].rua} × Rota Certa ${ok[order[n] - 1].rua}`)).filter(Boolean);
        log(`- Posições iguais: ${outra.length - difs.length} de ${outra.length}`);
        difs.forEach(x => log(`  - ${x}`));
        log();
    }
    console.log(out.join('\n'));
}

if (require.main === module) main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
module.exports = { geocode, osrmTable, ibgeCity, nominatim, expand, km, min };
