#!/usr/bin/env node
/*
 * Gera o índice de endereços de uma cidade a partir do CSV do CNEFE (IBGE, Censo 2022).
 * Uso: node tools/cnefe-indice.js <arquivo.csv> <codigo> "<Cidade>" <UF> <saida.json>
 *
 * Saída: { cod, cidade, uf, fonte, bairros: [...], ruas: { "RUA NOME": [[numero, lat*1e5, lng*1e5, bairroIdx], ...] } }
 */
'use strict';
const fs = require('fs');
const readline = require('readline');

async function main() {
    const [csv, cod, cidade, uf, out] = process.argv.slice(2);
    const rl = readline.createInterface({ input: fs.createReadStream(csv, 'latin1'), crlfDelay: Infinity });
    let header = null, sep = ';';
    const col = {};
    const bairros = [], bairroIdx = new Map();
    const grupos = new Map(); // "rua|bairro|numero" -> [somaLat, somaLng, qtd]
    const niveis = {};
    let linhas = 0, semCoord = 0;

    const clean = (s) => String(s || '').replace(/^"|"$/g, '').trim();
    for await (const raw of rl) {
        if (!header) {
            const line = raw.replace(/^﻿/, '');
            sep = (line.match(/;/g) || []).length >= (line.match(/,/g) || []).length ? ';' : ',';
            header = line.split(sep).map(h => clean(h).toUpperCase());
            header.forEach((h, i) => { col[h] = i; });
            console.log('Colunas:', header.join(' | '));
            for (const need of ['NOM_SEGLOGR', 'NUM_ENDERECO', 'LATITUDE', 'LONGITUDE']) {
                if (!(need in col)) throw new Error('Coluna não encontrada: ' + need);
            }
            continue;
        }
        const f = raw.split(sep).map(clean);
        if (linhas < 3) console.log('Exemplo:', f.join(' | '));
        linhas++;
        const lat = parseFloat((f[col.LATITUDE] || '').replace(',', '.'));
        const lng = parseFloat((f[col.LONGITUDE] || '').replace(',', '.'));
        if (!isFinite(lat) || !isFinite(lng) || lat === 0) { semCoord++; continue; }
        const nv = f[col.NV_GEO_COORD] || '?';
        niveis[nv] = (niveis[nv] || 0) + 1;

        const rua = [f[col.NOM_TIPO_SEGLOGR], f[col.NOM_TITULO_SEGLOGR], f[col.NOM_SEGLOGR]]
            .filter(Boolean).join(' ').toUpperCase().replace(/\s+/g, ' ').trim();
        if (!rua) continue;
        const num = parseInt(f[col.NUM_ENDERECO], 10) || 0;
        const bairro = (f[col.DSC_LOCALIDADE] || '').toUpperCase().trim();
        if (!bairroIdx.has(bairro)) { bairroIdx.set(bairro, bairros.length); bairros.push(bairro); }
        const key = `${rua}|${bairroIdx.get(bairro)}|${num}`;
        const g = grupos.get(key) || [0, 0, 0];
        g[0] += lat; g[1] += lng; g[2]++;
        grupos.set(key, g);
    }

    const ruas = {};
    for (const [key, g] of grupos) {
        const [rua, b, num] = key.split('|');
        (ruas[rua] = ruas[rua] || []).push([+num, Math.round(g[0] / g[2] * 1e5), Math.round(g[1] / g[2] * 1e5), +b]);
    }
    for (const r of Object.values(ruas)) r.sort((a, b) => a[0] - b[0]);

    const data = { cod, cidade, uf, fonte: 'IBGE - CNEFE Censo 2022', bairros, ruas };
    fs.writeFileSync(out, JSON.stringify(data));
    console.log(`Linhas: ${linhas} · sem coordenada: ${semCoord} · ruas: ${Object.keys(ruas).length} · números distintos: ${grupos.size} · bairros: ${bairros.length}`);
    console.log('Níveis de precisão (NV_GEO_COORD):', JSON.stringify(niveis));
    console.log('Tamanho do índice:', (fs.statSync(out).size / 1e6).toFixed(2), 'MB');
    console.log('Alguns bairros:', bairros.slice(0, 15).join(', '));
}
main().catch(e => { console.error(e); process.exit(1); });
