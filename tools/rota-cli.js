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
 *   "fim": "voltar" | "livre" | "endereço" (opcional, padrão "livre" sem início e "voltar" com início),
 *   "otimizarPor": "tempo" | "distancia" (opcional, padrão "tempo"),
 *   "paradas": [{ "os": "123", "rua": "RUA X", "numero": "10", "bairro": "JD Y", "prioridade": false }]
 * }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Solver = require('../solver.js');

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

// Mesma estratégia do app: rua+número+cidade; depois texto com bairro; depois sem bairro.
async function geocode(p, cidade, uf) {
    const street = expand(p.rua);
    const bairro = expand(p.bairro || '');
    const tries = [
        { street: `${p.numero || ''} ${street}`.trim(), city: cidade, state: uf },
        { q: [street, p.numero, bairro, cidade, uf].filter(Boolean).join(', ') },
        { q: [street, p.numero, cidade, uf].filter(Boolean).join(', ') },
    ];
    let best = null;
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

    const stops = [];
    for (const p of cfg.paradas) {
        const g = await geocode(p, cfg.cidade, cfg.uf).catch(() => null);
        stops.push({ ...p, geo: g });
    }
    let start = null;
    if (cfg.inicio) {
        const d = await nominatim({ q: `${expand(cfg.inicio)}, ${cfg.cidade}, ${cfg.uf}` });
        if (d.length) start = { lat: +d[0].lat, lng: +d[0].lon, label: cfg.inicio };
    }

    const missing = stops.filter(s => !s.geo);
    if (missing.length) {
        log(`**${missing.length} endereço(s) não encontrados** (ficaram fora da rota):`);
        missing.forEach(s => log(`- OS ${s.os}: ${s.rua}, ${s.numero} - ${s.bairro}`));
        log();
    }
    const ok = stops.filter(s => s.geo);

    const fimModo = cfg.fim || (start ? 'voltar' : 'livre');
    let end = null;
    if (fimModo === 'voltar' && start) end = start;
    else if (fimModo !== 'voltar' && fimModo !== 'livre') {
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
    const endIdx = end ? matrix.length - 1 : null;
    const order = Solver.solveWithPriorities(matrix, 0, nodes, endIdx, { timeLimitMs: 8000 });

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
    console.log(out.join('\n'));
}

main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
