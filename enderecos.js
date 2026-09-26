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
        [/\bCH\b/g, 'CHACARA'], [/\bCJ\b/g, 'CONJUNTO'], [/\bRES\b/g, 'RESIDENCIAL'], [/\bHAB\b/g, 'HABITACIONAL'],
        [/\bV\b/g, 'VILA'], [/\bCID\b/g, 'CIDADE'], [/\bLOT\b/g, 'LOTEAMENTO'], [/\bBR\b/g, 'BAIRRO'],
        [/\bII\b/g, '2'], [/\bIII\b/g, '3'], [/\bIV\b/g, '4'],
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
     * Índice de uma cidade (gerado por tools/cnefe-indice.js), em pedaços pela
     * primeira letra do nome da rua, para cidades grandes não pesarem no celular:
     *   meta.json  { cod, cidade, uf, bairros: [...], pedacos: ["A", "B", ...] }
     *   A.json     { ruas: { "RUA NOME": [[numero, lat*1e5, lng*1e5, bairroIdx], ...] } }
     *
     * prepare(meta, loader): loader(letra) devolve o pedaço (ou uma Promise dele).
     */
    function prepare(meta, loader) {
        meta._loader = loader;
        meta._pedacos = {};
        meta._bairrosNorm = meta.bairros.map(b => nucleo(b));
        return meta;
    }

    // Letra do pedaço onde a rua fica (primeira letra do nome, sem o tipo).
    function pedacoDe(street) {
        const k = nucleo(street);
        const ch = k.charAt(0);
        return /[A-Z]/.test(ch) ? ch : '0';
    }

    function preparePedaco(data) {
        const porNucleo = new Map();
        for (const nome of Object.keys(data.ruas)) {
            const k = nucleo(nome);
            if (!porNucleo.has(k)) porNucleo.set(k, []);
            porNucleo.get(k).push(nome);
        }
        data._porNucleo = porNucleo;
        data._nucleos = [...porNucleo.keys()];
        return data;
    }

    // Garante que o pedaço da rua está carregado (assíncrono no navegador).
    async function load(city, street) {
        const letra = pedacoDe(street);
        if (!city.pedacos.includes(letra)) return null;
        if (!city._pedacos[letra]) {
            city._pedacos[letra] = Promise.resolve(city._loader(letra)).then(d => (d ? preparePedaco(d) : null));
        }
        return city._pedacos[letra];
    }

    // Ruas candidatas: mesmo nome, ou nome muito parecido (erro de digitação).
    function candidatas(pedaco, street) {
        const k = nucleo(street);
        const nomes = [];
        if (pedaco._porNucleo.has(k)) nomes.push(...pedaco._porNucleo.get(k));
        // A mesma via pode estar cadastrada com nome maior ou menor
        // (ex.: "JACU PESSEGO" e "JACU PESSEGO NOVA TRABALHADORES"). Só vale
        // quando a parte em comum tem pelo menos duas palavras: "WILSON" não
        // pode puxar "WILSON ACKEL". Se a rua de nome exato existir, a variante
        // ainda precisa ficar perto dela (lookup confere).
        const variantes = [];
        for (const n of pedaco._nucleos) {
            if (n === k) continue;
            const menor = n.length < k.length ? n : k, maior = n.length < k.length ? k : n;
            if (menor.split(' ').length >= 2 && maior.startsWith(menor + ' ')) variantes.push(...pedaco._porNucleo.get(n));
        }
        if (nomes.length || variantes.length) return { nomes: nomes.concat(variantes), exatos: nomes.length, score: 1 };
        let best = null, bs = 0;
        for (const n of pedaco._nucleos) {
            if (Math.abs(n.length - k.length) > 4) continue;
            const s = similar(k, n);
            if (s > bs) { bs = s; best = n; }
        }
        if (best && bs >= 0.85) return { nomes: pedaco._porNucleo.get(best), score: bs };
        return null;
    }

    // Procura rua + número (+ bairro): carrega o pedaço necessário e consulta.
    async function find(city, p) {
        const pedaco = await load(city, p.street);
        if (!pedaco) return null;
        return lookup(city, p, pedaco);
    }

    /*
     * Procura rua + número (+ bairro) na cidade.
     * Retorna { lat, lng, exact, found } ou null.
     *  exact = true: o IBGE tem esse número exato.
     *  exact = false: número estimado entre os vizinhos da mesma rua.
     */
    function lookup(city, p, pedaco) {
        if (!pedaco) return null;
        const c = candidatas(pedaco, p.street);
        if (!c) return null;
        const t = tipo(p.street);
        const numero = parseInt(String(p.number || '').replace(/\D/g, ''), 10);
        const bairro = p.bairro ? nucleo(p.bairro) : '';
        const bairroNota = (b) => (!bairro ? 0 : (b === bairro ? 1 : similar(b, bairro) >= 0.8 ? 0.8 : 0));

        // 1) Escolhe a rua: mesmo tipo (Rua/Avenida) e que passe pelo bairro informado.
        const toPts = (nome) => pedaco.ruas[nome].map(e => ({ n: e[0], lat: e[1] / 1e5, lng: e[2] / 1e5, nome, bairro: city.bairros[e[3]], bn: bairroNota(city._bairrosNorm[e[3]] || '') }));
        // Variantes do nome só entram se forem continuação da rua de nome exato (até ~1,5 km).
        const exatosPts = c.exatos ? c.nomes.slice(0, c.exatos).flatMap(toPts) : [];
        const nomesOk = c.nomes.filter((nome, i) => {
            if (!c.exatos || i < c.exatos) return true;
            const pts = toPts(nome);
            return pts.some(p => exatosPts.some(q => Math.abs(p.lat - q.lat) < 0.014 && Math.abs(p.lng - q.lng) < 0.014));
        });
        let melhor = null;
        for (const nome of nomesOk) {
            const pts = toPts(nome);
            // Desempate: o trecho que tem o número procurado (ou vizinhos colados) ganha.
            const temNumero = isFinite(numero) && pts.some(x => x.n === numero) ? 3
                : (isFinite(numero) && (estimar(pts, numero) || {}).perto <= 12 ? 1.5 : 0);
            const nota = Math.max(...pts.map(x => x.bn)) * 2 + (!t || tipo(nome) === t ? 1 : 0) + temNumero + pts.length / 1e6;
            if (!melhor || nota > melhor.nota) melhor = { nome, pts, nota };
        }
        let pontos = melhor.pts;
        // O bairro informado bateu com o cadastro? (serve para escolher a cidade certa)
        const bairroOk = Math.max(...melhor.pts.map(x => x.bn)) >= 0.8;

        // 2) Ruas com o mesmo nome em lugares diferentes da cidade: fica só com o trecho
        //    que passa pelo bairro informado (e a continuação dele nos bairros vizinhos).
        const ancoras = pontos.filter(x => x.bn > 0);
        if (ancoras.length) {
            pontos = pontos.filter(x => x.bn > 0 || ancoras.some(a => Math.abs(a.lat - x.lat) < 0.012 && Math.abs(a.lng - x.lng) < 0.012));
        } else if (espalhado(pontos)) {
            // Rua longa ou repetida em vários bairros, e o bairro informado não bateu.
            // Os números ao longo de uma mesma via não se repetem: se o número (ou
            // vizinhos bem próximos) existir, a posição é confiável mesmo assim.
            const exato = isFinite(numero) && pontos.find(x => x.n === numero);
            const est = !exato && isFinite(numero) ? estimar(pontos, numero) : null;
            if (!exato && !(est && est.perto <= 12)) {
                return { ambiguous: true, found: `${titulo(melhor.nome)} (existe em mais de um lugar da cidade; confira o bairro)` };
            }
        }

        const label = (x) => `${titulo(x.nome)}, ${x.n || 's/n'} - ${titulo(x.bairro)}`;
        if (!isFinite(numero)) {
            const ref = ancoras.length ? ancoras : pontos;
            const mid = ref[Math.floor(ref.length / 2)];
            return { lat: mid.lat, lng: mid.lng, exact: false, good: false, found: `${titulo(mid.nome)} - ${titulo(mid.bairro)} (sem número)` };
        }

        // 3) Número exato cadastrado no IBGE.
        let exatos = pontos.filter(x => x.n === numero);
        if (exatos.length) {
            // mesmo número em dois trechos: prefere o do bairro informado
            const noBairro = exatos.filter(x => x.bn > 0);
            if (noBairro.length) exatos = noBairro;
            const x = exatos[0];
            return { lat: x.lat, lng: x.lng, exact: true, good: true, bairroOk, found: label(x), score: c.score };
        }

        // 4) Número não cadastrado: estima entre o vizinho de baixo e o de cima
        //    (mesmo lado da rua quando possível). Se o trecho do bairro não tiver
        //    vizinhos próximos, tenta a rua inteira.
        let est = estimar(pontos, numero);
        if ((!est || !est.good) && pontos !== melhor.pts) {
            const inteira = estimar(melhor.pts, numero);
            if (inteira && (!est || inteira.perto < est.perto)) est = inteira;
        }
        if (!est) return null;
        const { lo, hi } = est;
        return {
            lat: est.lat, lng: est.lng, exact: false,
            // até ~40 números do vizinho cadastrado, a estimativa cai na mesma quadra
            good: est.good, bairroOk,
            found: `${titulo(melhor.nome)}, ~${numero} (entre ${lo ? lo.n : '—'} e ${hi ? hi.n : '—'}) - ${titulo((lo || hi).bairro)}`,
            score: c.score,
        };
    }

    function estimar(pontos, numero) {
        const comNum = pontos.filter(x => x.n > 0).sort((a, b) => a.n - b.n);
        if (!comNum.length) return null;
        const entre = (lista) => {
            let lo = null, hi = null;
            for (const x of lista) {
                if (x.n < numero) lo = x;
                else if (x.n > numero && !hi) hi = x;
            }
            return { lo, hi };
        };
        const gap = (r) => (r.lo && r.hi ? Math.min(numero - r.lo.n, r.hi.n - numero) : Infinity);
        const mesmoLado = entre(comNum.filter(x => x.n % 2 === numero % 2));
        const todos = entre(comNum);
        const { lo, hi } = gap(mesmoLado) <= 40 || gap(mesmoLado) <= gap(todos) ? mesmoLado : todos;
        if (lo && hi) {
            const f = (numero - lo.n) / (hi.n - lo.n);
            const perto = Math.min(numero - lo.n, hi.n - numero);
            return { lat: lo.lat + (hi.lat - lo.lat) * f, lng: lo.lng + (hi.lng - lo.lng) * f, lo, hi, perto, good: perto <= 40 };
        }
        // além do último número cadastrado: não dá para estimar bem
        const x = lo || hi;
        if (!x) return null;
        return { lat: x.lat, lng: x.lng, lo, hi, perto: Infinity, good: false };
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

    const api = { norm, nucleo, similar, prepare, load, find, lookup, parse, pedacoDe };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Enderecos = api;
})(typeof window !== 'undefined' ? window : globalThis);
