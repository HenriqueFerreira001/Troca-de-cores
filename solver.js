/*
 * Otimizador de rotas.
 *
 * Recebe uma matriz de custos (tempo ou distância real pelas ruas, podendo ser
 * assimétrica por causa de mão única) e devolve a melhor ordem de visitas.
 *
 * - Até EXACT_LIMIT paradas: algoritmo exato (Held-Karp). É garantido que não
 *   existe ordem melhor.
 * - Acima disso: vizinho mais próximo + inserção mais barata + 2-opt + Or-opt,
 *   repetido com perturbações (Iterated Local Search) até o tempo acabar.
 *
 * Funciona no navegador (window.RouteSolver) e no Node (module.exports).
 */
(function (root) {
    'use strict';

    const EXACT_LIMIT = 16;

    // Custo de percorrer a sequência de nós "path" (índices da matriz).
    function pathCost(matrix, path) {
        let c = 0;
        for (let i = 0; i < path.length - 1; i++) c += matrix[path[i]][path[i + 1]];
        return c;
    }

    /*
     * Resolve um caminho: começa em "start", passa por todos os "stops" e termina
     * em "end" (ou em qualquer parada, se end === null).
     * Retorna a ordem das paradas (sem start/end).
     */
    function solvePath(matrix, start, stops, end, opts) {
        opts = opts || {};
        if (stops.length <= 1) return stops.slice();
        if (stops.length <= (opts.exactLimit || EXACT_LIMIT)) {
            return heldKarp(matrix, start, stops, end);
        }
        return heuristic(matrix, start, stops, end, opts.timeLimitMs || 1500);
    }

    // Custo de um caminho completo, com start e end opcional.
    function fullCost(matrix, start, order, end) {
        let c = 0, prev = start;
        for (const n of order) { c += matrix[prev][n]; prev = n; }
        if (end !== null && end !== undefined) c += matrix[prev][end];
        return c;
    }

    // ---------- Exato: programação dinâmica de Held-Karp ----------
    function heldKarp(matrix, start, stops, end) {
        const n = stops.length;
        const full = (1 << n) - 1;
        const size = 1 << n;
        const dp = new Float64Array(size * n).fill(Infinity);
        const parent = new Int8Array(size * n).fill(-1);

        for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = matrix[start][stops[j]];

        for (let mask = 1; mask < size; mask++) {
            for (let j = 0; j < n; j++) {
                if (!(mask & (1 << j))) continue;
                const cur = dp[mask * n + j];
                if (cur === Infinity) continue;
                const from = stops[j];
                for (let k = 0; k < n; k++) {
                    if (mask & (1 << k)) continue;
                    const nm = mask | (1 << k);
                    const v = cur + matrix[from][stops[k]];
                    if (v < dp[nm * n + k]) {
                        dp[nm * n + k] = v;
                        parent[nm * n + k] = j;
                    }
                }
            }
        }

        let best = Infinity, last = -1;
        for (let j = 0; j < n; j++) {
            const v = dp[full * n + j] + (end !== null && end !== undefined ? matrix[stops[j]][end] : 0);
            if (v < best) { best = v; last = j; }
        }

        const order = [];
        let mask = full, j = last;
        while (j !== -1) {
            order.push(stops[j]);
            const p = parent[mask * n + j];
            mask &= ~(1 << j);
            j = p;
        }
        return order.reverse();
    }

    // ---------- Heurística para rotas grandes ----------

    // Gerador pseudo-aleatório com semente, para resultados reproduzíveis.
    function rng(seed) {
        let s = seed >>> 0 || 1;
        return function () {
            s ^= s << 13; s >>>= 0;
            s ^= s >>> 17;
            s ^= s << 5; s >>>= 0;
            return s / 4294967296;
        };
    }

    function nearestNeighbor(matrix, start, stops) {
        const left = new Set(stops);
        const order = [];
        let cur = start;
        while (left.size) {
            let best = null, bc = Infinity;
            for (const s of left) {
                if (matrix[cur][s] < bc) { bc = matrix[cur][s]; best = s; }
            }
            order.push(best);
            left.delete(best);
            cur = best;
        }
        return order;
    }

    function cheapestInsertion(matrix, start, stops, end) {
        const order = [];
        for (const s of stops) {
            let bestPos = 0, bestC = Infinity;
            for (let p = 0; p <= order.length; p++) {
                const prev = p === 0 ? start : order[p - 1];
                const next = p === order.length ? end : order[p];
                let delta = matrix[prev][s];
                if (next !== null && next !== undefined) delta += matrix[s][next] - matrix[prev][next];
                if (delta < bestC) { bestC = delta; bestPos = p; }
            }
            order.splice(bestPos, 0, s);
        }
        return order;
    }

    // Melhora local: 2-opt (inverter trecho) e Or-opt (mover trecho de 1 a 3 paradas).
    // Aceita matrizes assimétricas: sempre recalcula o custo real do trecho.
    function localSearch(matrix, start, order, end) {
        const hasEnd = end !== null && end !== undefined;
        let seq = [start].concat(order);
        if (hasEnd) seq.push(end);
        const lastMovable = hasEnd ? seq.length - 2 : seq.length - 1;

        let improved = true;
        let guard = 0;
        while (improved && guard++ < 1000) {
            improved = false;

            // 2-opt: inverte seq[i..j]
            for (let i = 1; i < lastMovable; i++) {
                for (let j = i + 1; j <= lastMovable; j++) {
                    const a = seq[i - 1], b = seq[i], c = seq[j];
                    const d = j + 1 < seq.length ? seq[j + 1] : null;
                    let before = matrix[a][b] + (d !== null ? matrix[c][d] : 0);
                    let after = matrix[a][c] + (d !== null ? matrix[b][d] : 0);
                    // custo interno do trecho (muda se a matriz for assimétrica)
                    for (let k = i; k < j; k++) {
                        before += matrix[seq[k]][seq[k + 1]];
                        after += matrix[seq[k + 1]][seq[k]];
                    }
                    if (after < before - 1e-9) {
                        const rev = seq.slice(i, j + 1).reverse();
                        seq.splice(i, j - i + 1, ...rev);
                        improved = true;
                    }
                }
            }

            // Or-opt: move um trecho de tamanho 1..3 para outra posição
            for (let len = 1; len <= 3; len++) {
                for (let i = 1; i + len - 1 <= lastMovable; i++) {
                    const segEnd = i + len - 1;
                    const prev = seq[i - 1];
                    const next = segEnd + 1 < seq.length ? seq[segEnd + 1] : null;
                    const first = seq[i], last = seq[segEnd];
                    const removeGain = matrix[prev][first] + (next !== null ? matrix[last][next] - matrix[prev][next] : 0);

                    let bestDelta = -1e-9, bestPos = -1;
                    for (let p = 0; p < seq.length - 1 || (!hasEnd && p === seq.length - 1); p++) {
                        if (p >= i - 1 && p <= segEnd) continue;
                        if (hasEnd && p >= seq.length - 1) break;
                        const x = seq[p];
                        const y = p + 1 < seq.length ? seq[p + 1] : null;
                        const addCost = matrix[x][first] + (y !== null ? matrix[last][y] - matrix[x][y] : 0);
                        const delta = addCost - removeGain;
                        if (delta < bestDelta) { bestDelta = delta; bestPos = p; }
                    }
                    if (bestPos !== -1) {
                        const seg = seq.splice(i, len);
                        const insertAt = bestPos < i ? bestPos + 1 : bestPos + 1 - len;
                        seq.splice(insertAt, 0, ...seg);
                        improved = true;
                    }
                }
            }
        }
        seq = seq.slice(1);
        if (hasEnd) seq.pop();
        return seq;
    }

    // Perturbação "double bridge": quebra a rota em 4 partes e troca a ordem.
    function doubleBridge(order, rand) {
        const n = order.length;
        if (n < 8) {
            const a = order.slice();
            const i = Math.floor(rand() * n), j = Math.floor(rand() * n);
            [a[i], a[j]] = [a[j], a[i]];
            return a;
        }
        const pos = [0, 0, 0].map(() => 1 + Math.floor(rand() * (n - 1))).sort((x, y) => x - y);
        const [p1, p2, p3] = pos;
        return order.slice(0, p1).concat(order.slice(p3), order.slice(p2, p3), order.slice(p1, p2));
    }

    function heuristic(matrix, start, stops, end, timeLimitMs) {
        const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const t0 = now();
        const rand = rng(12345 + stops.length);

        const candidates = [
            nearestNeighbor(matrix, start, stops),
            cheapestInsertion(matrix, start, stops, end),
        ];
        let best = null, bestC = Infinity;
        for (const c of candidates) {
            const o = localSearch(matrix, start, c, end);
            const v = fullCost(matrix, start, o, end);
            if (v < bestC) { bestC = v; best = o; }
        }

        // Número fixo de tentativas (e não tempo): a mesma lista dá sempre a mesma
        // ordem, em qualquer celular, rápido ou lento. (60 s é só uma trava de segurança.)
        const maxIter = Math.max(400, Math.min(6000, Math.round(60000 / stops.length)));
        let cur = best, curC = bestC;
        let iter = 0;
        while (iter < maxIter && now() - t0 < 60000) {
            iter++;
            const cand = localSearch(matrix, start, doubleBridge(cur, rand), end);
            const v = fullCost(matrix, start, cand, end);
            if (v < curC - 1e-9) { cur = cand; curC = v; }
            if (v < bestC - 1e-9) { best = cand; bestC = v; }
            // de vez em quando volta para a melhor solução
            if (iter % 50 === 0) { cur = best; curC = bestC; }
        }
        return best;
    }

    /*
     * Resolve considerando prioridades.
     * nodes: lista de { idx, priority: 'first' | 'second' | 'normal' | 'last' }
     * Ordem dos grupos: first, second, normal, last.
     */
    function solveWithPriorities(matrix, start, nodes, end, opts) {
        const groups = ['first', 'second', 'normal', 'last']
            .map(p => nodes.filter(n => (n.priority || 'normal') === p).map(n => n.idx))
            .filter(g => g.length);
        if (groups.length === 0) return [];
        if (groups.length === 1) return solvePath(matrix, start, groups[0], end, opts);

        // Resolve os grupos em sequência.
        let order = [];
        let from = start;
        for (let g = 0; g < groups.length; g++) {
            const isLast = g === groups.length - 1;
            // Grupos intermediários terminam na parada que deixa mais barato
            // entrar no próximo grupo.
            const part = isLast
                ? solvePath(matrix, from, groups[g], end, opts)
                : solveOpenTowards(matrix, from, groups[g], groups[g + 1], opts);
            order = order.concat(part);
            from = part[part.length - 1];
        }
        return order;
    }

    // Resolve o grupo terminando na parada que deixa mais barato entrar no próximo grupo.
    function solveOpenTowards(matrix, from, group, nextGroup, opts) {
        // Custo de sair de cada parada até a parada mais próxima do próximo grupo.
        const exitCost = group.map(g => Math.min(...nextGroup.map(n => matrix[g][n])));
        // Cria uma matriz estendida com um nó virtual de saída.
        const V = matrix.length;
        const ext = matrix.map((row, i) => {
            const r = row.slice();
            const gi = group.indexOf(i);
            r.push(gi >= 0 ? exitCost[gi] : 1e12);
            return r;
        });
        ext.push(new Array(V + 1).fill(1e12));
        return solvePath(ext, from, group, V, opts);
    }

    const api = { solvePath, solveWithPriorities, fullCost, pathCost, heldKarp, heuristic, EXACT_LIMIT };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.RouteSolver = api;
})(typeof window !== 'undefined' ? window : globalThis);
