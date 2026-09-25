/*
 * Endereços oficiais do IBGE (CNEFE, Censo 2022).
 *
 * O IBGE registrou a posição de cada endereço do país. O app guarda esses dados
 * das cidades usadas pela empresa (pasta dados/cnefe) e procura primeiro aqui:
 * acha o número exato da casa, coisa que o mapa gratuito não tem.
 *
 * Funciona no navegador (window.Enderecos) e no Node (module.exports).
 */
(function (root) {
    'use strict';

    const ABREV = [
        [/\bAV\b/g, 'AVENIDA'], [/\bR\b/g, 'RUA'], [/\bAL\b/g, 'ALAMEDA'], [/\bTV\b/g, 'TRAVESSA'],
        [/\bTRAV\b/g, 'TRAVESSA'], [/\bPCA\b/g, 'PRACA'], [/\bEST\b/g, 'ESTRADA'], [/\bROD\b/g, 'RODOVIA'],
        [/\bJD\b/g, 'JARDIM'], [/\bJARD\b/g, 'JARDIM'], [/\bPQ\b/g, 'PARQUE'], [/\bVL\b/g, 'VILA'],
        [/\bCH\b/g, 'CHACARA'], [/\bCJ\b/g, 'CONJUNTO'], [/\bRES\b/g, 'RESIDENCIAL'],
        [/\bNSA SRA\b/g, 'NOSSA SENHORA'], [/\bN SRA\b/g, 'NOSSA SENHORA'], [/\bNS\b/g, 'NOSSA SENHORA'],
        [/\bSTA\b/g, 'SANTA'], [/\bSTO\b/g, 'SANTO'], [/\bS\b/g, 'SAO'],
        [/\bPROF\b/g, 'PROFESSOR'], [/\bPROFA\b/g, 'PROFESSORA'], [/\bDR\b/g, 'DOUTOR'], [/\bDRA\b/g, 'DOUTORA'],
        [/\bENG\b/g, 'ENGENHEIRO'], [/\bCEL\b/g, 'CORONEL'], [/\bGAL\b/g, 'GENERAL'], [/\bGEN\b/g, 'GENERAL'],
        [/\bCAP\b/g, 'CAPITAO'], [/\bTEN\b/g, 'TENENTE'], [/\bSGT\b/g, 'SARGENTO'], [/\bPE\b/g, 'PADRE'],
        [/\bMAL\b/g, 'MARECHAL'], [/\bPRES\b/g, 'PRESIDENTE'], [/\bVER\b/g, 'VEREADOR'], [/\bDEP\b/g, 'DEPUTADO'],
    ];
    const TIPOS = new Set(['RUA', 'AVENIDA', 'ALAMEDA', 'TRAVESSA', 'PRACA', 'ESTRADA', 'RODOVIA', 'VIELA',
        'PASSAGEM', 'VIA', 'LARGO', 'VIADUTO', 'BECO', 'ACESSO', 'VIELA', 'CAMINHO', 'VILA', 'PRAÇA']);
    const PARTICULAS = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'D']);

    // Texto padronizado: sem acento, maiúsculo, abreviações por extenso.
    function norm(s) {
        let t = ' ' + String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
        for (const [re, full] of ABREV) t = t.replace(re, full);
        return t.trim();
    }

    // Nome da rua sem o tipo (RUA, AVENIDA...) e sem "da/de/do": a parte que identifica a rua.
    function nucleo(s) {
        const w = norm(s).split(' ').filter(Boolean);
        while (w.length > 1 && TIPOS.has(w[0])) w.shift();
        return w.filter(x => !PARTICULAS.has(x)).join(' ');
    }
    function tipo(s) {
        const w = norm(s).split(' ');
        return TIPOS.has(w[0]) ? w[0] : '';
    }

    // Semelhança entre dois textos (0 a 1), tolera erro de digitação (JACINTHA x JACINTA).
    function similar(a, b) {
        if (a === b) return 1;
        const m = a.length, n = b.length;
        if (!m || !n) return 0;
        let prev = Array.from({ length: n + 1 }, (_, j) => j);
        for (let i = 1; i <= m; i++) {
            const cur = [i];
            for (let j = 1; j <= n; j++) {
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            }
            prev = cur;
        }
        return 1 - prev[n] / Math.max(m, n);
    }

    /*
     * Índice de uma cidade (gerado por tools/cnefe-indice.js):
     * { cod, cidade, uf, bairros: [...], ruas: { "RUA NOME": [[numero, lat*1e5, lng*1e5, bairroIdx], ...] } }
     */
    function prepare(data) {
        const porNucleo = new Map();
        for (const nome of Object.keys(data.ruas)) {
            const k = nucleo(nome);
            if (!porNucleo.has(k)) porNucleo.set(k, []);
            porNucleo.get(k).push(nome);
        }
        data._porNucleo = porNucleo;
        data._nucleos = [...porNucleo.keys()];
        data._bairrosNorm = data.bairros.map(b => nucleo(b));
        return data;
    }

    // Ruas candidatas: mesmo nome, ou nome muito parecido (erro de digitação).
    function candidatas(city, street) {
        const k = nucleo(street);
        if (city._porNucleo.has(k)) return { nomes: city._porNucleo.get(k), score: 1 };
        let best = null, bs = 0;
        for (const n of city._nucleos) {
            if (Math.abs(n.length - k.length) > 4) continue;
            const s = similar(k, n);
            if (s > bs) { bs = s; best = n; }
        }
        if (best && bs >= 0.85) return { nomes: city._porNucleo.get(best), score: bs };
        return null;
    }

    /*
     * Procura rua + número (+ bairro) na cidade.
     * Retorna { lat, lng, exact, found } ou null.
     *  exact = true: o IBGE tem esse número exato.
     *  exact = false: número estimado entre os vizinhos da mesma rua.
     */
    function lookup(city, p) {
        const c = candidatas(city, p.street);
        if (!c) return null;
        const t = tipo(p.street);
        const numero = parseInt(String(p.number || '').replace(/\D/g, ''), 10);
        const bairro = p.bairro ? nucleo(p.bairro) : '';

        // Junta os endereços de todas as ruas candidatas, dando nota para tipo e bairro.
        let pontos = [];
        for (const nome of c.nomes) {
            const tipoOk = !t || tipo(nome) === t;
            for (const e of city.ruas[nome]) {
                const b = city._bairrosNorm[e[3]] || '';
                const bairroNota = !bairro ? 0.5 : (b === bairro ? 1 : similar(b, bairro) >= 0.8 ? 0.8 : 0);
                pontos.push({ n: e[0], lat: e[1] / 1e5, lng: e[2] / 1e5, nome, bairro: city.bairros[e[3]], nota: bairroNota + (tipoOk ? 0.5 : 0) });
            }
        }
        if (!pontos.length) return null;

        // Mesma rua pode existir em bairros diferentes: fica com o grupo de melhor nota.
        const melhorNota = Math.max(...pontos.map(x => x.nota));
        pontos = pontos.filter(x => x.nota === melhorNota);
        // Se o bairro informado não bateu e a rua existe em lugares distantes, é ambíguo.
        if (bairro && melhorNota < 1 && espalhado(pontos)) {
            return { ambiguous: true, found: `${pontos[0].nome} (existe em mais de um bairro)` };
        }

        const label = (x) => `${titulo(x.nome)}, ${x.n || 's/n'} - ${titulo(x.bairro)}`;
        if (!isFinite(numero)) {
            const mid = pontos[Math.floor(pontos.length / 2)];
            return { lat: mid.lat, lng: mid.lng, exact: false, found: `${titulo(mid.nome)} - ${titulo(mid.bairro)} (sem número)` };
        }

        const exatos = pontos.filter(x => x.n === numero);
        if (exatos.length) {
            const lat = exatos.reduce((a, x) => a + x.lat, 0) / exatos.length;
            const lng = exatos.reduce((a, x) => a + x.lng, 0) / exatos.length;
            return { lat, lng, exact: true, found: label(exatos[0]), score: c.score };
        }

        // Número não cadastrado: estima entre o vizinho de baixo e o de cima, do mesmo lado da rua.
        const lado = pontos.filter(x => x.n && x.n % 2 === numero % 2);
        const base = lado.length >= 2 ? lado : pontos.filter(x => x.n);
        if (!base.length) return null;
        base.sort((a, b) => a.n - b.n);
        let lo = null, hi = null;
        for (const x of base) {
            if (x.n < numero) lo = x;
            else if (x.n > numero && !hi) hi = x;
        }
        let lat, lng, perto;
        if (lo && hi) {
            const f = (numero - lo.n) / (hi.n - lo.n);
            lat = lo.lat + (hi.lat - lo.lat) * f;
            lng = lo.lng + (hi.lng - lo.lng) * f;
            perto = Math.min(numero - lo.n, hi.n - numero);
        } else {
            const x = lo || hi;
            lat = x.lat; lng = x.lng;
            perto = Math.abs(x.n - numero);
        }
        return {
            lat, lng, exact: false,
            // até ~40 números de distância do vizinho cadastrado a estimativa é boa
            good: perto <= 40,
            found: `${titulo(base[0].nome)}, ~${numero} (entre ${lo ? lo.n : '—'} e ${hi ? hi.n : '—'}) - ${titulo((lo || hi).bairro)}`,
            score: c.score,
        };
    }

    function espalhado(pontos) {
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        for (const x of pontos) {
            minLat = Math.min(minLat, x.lat); maxLat = Math.max(maxLat, x.lat);
            minLng = Math.min(minLng, x.lng); maxLng = Math.max(maxLng, x.lng);
        }
        return (maxLat - minLat) > 0.02 || (maxLng - minLng) > 0.02; // ~2 km
    }

    function titulo(s) {
        return String(s || '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase())
            .replace(/\s(Da|De|Do|Das|Dos|E)\s/g, m => m.toLowerCase());
    }

    // Separa "RUA X, 123 - BAIRRO" em partes.
    function parse(text) {
        const t = String(text || '').trim();
        const m = t.match(/^(.*?)[,\s]+(?:N[º°O.]?\s*)?(\d{1,6})\b\s*(?:[-,]\s*(.*))?$/i);
        if (!m) return { street: t.split(/[-,]/)[0].trim(), number: '', bairro: '' };
        const resto = (m[3] || '').split(/\s*[-,]\s*/).filter(Boolean);
        return { street: m[1].trim(), number: m[2], bairro: resto[0] || '' };
    }

    const api = { norm, nucleo, similar, prepare, lookup, parse };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Enderecos = api;
})(typeof window !== 'undefined' ? window : globalThis);
