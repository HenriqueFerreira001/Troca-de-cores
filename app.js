/*
 * Rota Certa — planejador de rotas.
 *
 * Serviços gratuitos usados (sem chave, sem mensalidade):
 *  - Mapa: OpenStreetMap (Leaflet)
 *  - Busca de endereço: Photon (sugestões) e Nominatim (busca precisa)
 *  - CEP: ViaCEP
 *  - Distâncias e trajeto pelas ruas: OSRM
 */
(function () {
    'use strict';

    // ======================================================================
    // Configuração
    // ======================================================================
    const OSRM = 'https://router.project-osrm.org';
    const NOMINATIM = 'https://nominatim.openstreetmap.org';
    const PHOTON = 'https://photon.komoot.io';
    const VIACEP = 'https://viacep.com.br/ws';
    const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    const TABLE_CHUNK = 50;   // OSRM público aceita até 100 coordenadas por consulta
    const ROUTE_CHUNK = 90;
    const MAX_STOPS = 300;
    const STORAGE_KEY = 'rotacerta:v1';

    // ======================================================================
    // Utilidades
    // ======================================================================
    const $ = (sel) => document.querySelector(sel);
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function fmtDist(m) {
        if (m == null) return '—';
        return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`;
    }
    function fmtDur(s) {
        if (s == null) return '—';
        const min = Math.round(s / 60);
        if (min < 60) return `${min} min`;
        return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
    }
    function fmtClock(date) {
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    function haversine(a, b) {
        const R = 6371000, toR = Math.PI / 180;
        const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
        const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(x));
    }

    let toastTimer;
    function toast(msg, ms = 3000) {
        const t = $('#toast');
        t.textContent = msg;
        t.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
    }
    function busy(text, pct) {
        if (text === false) { $('#busy').classList.add('hidden'); return; }
        $('#busy').classList.remove('hidden');
        $('#busy-text').textContent = text;
        $('#busy-bar').style.width = (pct == null ? 0 : Math.round(pct * 100)) + '%';
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error('Não foi possível carregar ' + src));
            document.head.appendChild(s);
        });
    }

    async function fetchJSON(url, opts = {}, retries = 2) {
        for (let attempt = 0; ; attempt++) {
            try {
                const res = await fetch(url, opts);
                if (res.status === 429 && attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return await res.json();
            } catch (e) {
                if (attempt >= retries) throw e;
                await sleep(800 * (attempt + 1));
            }
        }
    }

    // ======================================================================
    // Estado (salvo no aparelho)
    // ======================================================================
    function newRoute(name) {
        return {
            id: uid(),
            name: name || 'Rota ' + new Date().toLocaleDateString('pt-BR'),
            createdAt: Date.now(),
            start: null,          // { addr, lat, lng }
            endMode: 'return',    // return | free | custom
            end: null,
            stops: [],            // { id, addr, lat, lng, note, phone, priority, status, doneAt, result, photos, warn }
            optimized: false,
            legs: null,           // [{ duration, distance }] na ordem atual (início→1, 1→2, ..., última→fim)
            geometry: null,       // [[lat,lng], ...]
            approx: false,        // true se a ordem foi calculada sem o servidor de ruas
            startedAt: null,
        };
    }

    const defaultSettings = {
        country: 'br',
        optimizeBy: 'duration',   // duration | distance
        serviceMin: 15,
        startTime: '08:00',
        navApp: 'google',         // google | waze | apple
    };

    let state = load();

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const s = JSON.parse(raw);
                s.settings = Object.assign({}, defaultSettings, s.settings);
                if (s.routes && s.routes[s.current]) return s;
            }
        } catch (e) { /* armazenamento indisponível */ }
        const r = newRoute();
        return { current: r.id, routes: { [r.id]: r }, settings: { ...defaultSettings } };
    }
    function save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
        catch (e) { toast('Não foi possível salvar no aparelho (memória cheia?)'); }
    }
    const route = () => state.routes[state.current];

    // Mudou algo que invalida a ordem calculada.
    function invalidate() {
        const r = route();
        r.optimized = false;
        r.legs = null;
        r.geometry = null;
    }

    // ======================================================================
    // Fotos (IndexedDB — não cabem no localStorage)
    // ======================================================================
    const photoDB = (() => {
        let dbp;
        function db() {
            if (!dbp) dbp = new Promise((res, rej) => {
                const req = indexedDB.open('rotacerta-fotos', 1);
                req.onupgradeneeded = () => req.result.createObjectStore('fotos');
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
            });
            return dbp;
        }
        async function tx(mode, fn) {
            const d = await db();
            return new Promise((res, rej) => {
                const t = d.transaction('fotos', mode);
                const r = fn(t.objectStore('fotos'));
                t.oncomplete = () => res(r && r.result);
                t.onerror = () => rej(t.error);
            });
        }
        return {
            put: (id, blob) => tx('readwrite', s => s.put(blob, id)),
            get: (id) => tx('readonly', s => s.get(id)),
            del: (id) => tx('readwrite', s => s.delete(id)),
        };
    })();

    function compressImage(file, maxSide = 1280) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const k = Math.min(1, maxSide / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.round(img.width * k);
                c.height = Math.round(img.height * k);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                c.toBlob(b => resolve(b || file), 'image/jpeg', 0.75);
                URL.revokeObjectURL(img.src);
            };
            img.onerror = () => resolve(file);
            img.src = URL.createObjectURL(file);
        });
    }

    // ======================================================================
    // Busca de endereços
    // ======================================================================
    const geo = {
        // "-23.55, -46.63" ou link do Google Maps
        parseCoords(text) {
            const t = text.trim();
            let m = t.match(/^(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)$/);
            if (!m) m = t.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
            if (!m) m = t.match(/[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);
            if (!m) return null;
            const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
            if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
            return { lat, lng };
        },

        bias() {
            const r = route();
            if (r.start) return r.start;
            if (r.stops.length) return r.stops[r.stops.length - 1];
            if (lastGPS) return lastGPS;
            return null;
        },

        // Sugestões enquanto digita
        async suggest(q) {
            const b = this.bias();
            let url = `${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=6`;
            if (b) url += `&lat=${b.lat}&lon=${b.lng}`;
            try {
                const data = await fetchJSON(url, {}, 0);
                const cc = state.settings.country;
                return (data.features || [])
                    .filter(f => !cc || (f.properties.countrycode || '').toLowerCase() === cc)
                    .map(f => {
                        const p = f.properties;
                        const line1 = [p.name, p.street && p.street !== p.name ? p.street : null, p.housenumber].filter(Boolean).join(', ');
                        const line2 = [p.district || p.locality, p.city, p.state, p.postcode].filter(Boolean).join(' - ');
                        return {
                            addr: [line1, line2].filter(Boolean).join(' - '),
                            line1: line1 || line2, line2,
                            lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
                            precise: !!p.housenumber || p.type === 'house',
                        };
                    });
            } catch (e) {
                return [];
            }
        },

        // Busca precisa (usada para listas e ao apertar Enter). Respeita 1 consulta/s do Nominatim.
        _last: 0,
        async search(q) {
            const coords = this.parseCoords(q);
            if (coords) return { addr: q.trim(), ...coords, precise: true };

            const cep = q.replace(/\D/g, '');
            if (/^\s*\d{5}-?\d{3}\s*$/.test(q)) return this.searchCEP(cep, q);

            const wait = 1100 - (Date.now() - this._last);
            if (wait > 0) await sleep(wait);
            this._last = Date.now();

            let url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=1&accept-language=pt-BR&q=${encodeURIComponent(q)}`;
            if (state.settings.country) url += `&countrycodes=${state.settings.country}`;
            const b = this.bias();
            if (b) url += `&viewbox=${b.lng - 0.5},${b.lat + 0.5},${b.lng + 0.5},${b.lat - 0.5}`;
            const data = await fetchJSON(url);
            if (!data.length) return null;
            const d = data[0];
            const hasNumberTyped = /\b\d{1,5}\b/.test(q.replace(/\d{5}-?\d{3}/, ''));
            const precise = !!(d.address && d.address.house_number) || ['house', 'building'].includes(d.addresstype);
            return {
                addr: q.trim(),
                lat: parseFloat(d.lat), lng: parseFloat(d.lon),
                precise: precise || !hasNumberTyped,
                found: d.display_name,
            };
        },

        async searchCEP(cep, original) {
            const c = await fetchJSON(`${VIACEP}/${cep}/json/`);
            if (!c || c.erro) return null;
            const text = [c.logradouro, c.bairro, c.localidade, c.uf].filter(Boolean).join(', ');
            const r = await this.search(text);
            if (!r) return null;
            return { ...r, addr: `${text} (CEP ${c.cep})`, precise: false, found: r.found || text, original };
        },

        async reverse(lat, lng) {
            const wait = 1100 - (Date.now() - this._last);
            if (wait > 0) await sleep(wait);
            this._last = Date.now();
            try {
                const d = await fetchJSON(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&accept-language=pt-BR&lat=${lat}&lon=${lng}`);
                const a = d.address || {};
                const line = [a.road, a.house_number].filter(Boolean).join(', ');
                const area = [a.suburb || a.neighbourhood, a.city || a.town || a.village].filter(Boolean).join(' - ');
                return [line, area].filter(Boolean).join(' - ') || d.display_name;
            } catch (e) {
                return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            }
        },
    };

    // ======================================================================
    // Distâncias pelas ruas (OSRM)
    // ======================================================================
    const routing = {
        coordStr: (pts) => pts.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';'),

        // Matriz completa de tempo e distância entre todos os pontos, em blocos.
        async matrix(points, onProgress) {
            const n = points.length;
            const dur = Array.from({ length: n }, () => new Array(n).fill(0));
            const dist = Array.from({ length: n }, () => new Array(n).fill(0));
            const chunks = [];
            for (let i = 0; i < n; i += TABLE_CHUNK) chunks.push([...Array(Math.min(TABLE_CHUNK, n - i)).keys()].map(k => k + i));

            const jobs = [];
            for (const A of chunks) for (const B of chunks) jobs.push([A, B]);
            let done = 0;
            for (const [A, B] of jobs) {
                const ids = A === B ? A : A.concat(B);
                const pts = ids.map(i => points[i]);
                const src = A.map((_, k) => k).join(';');
                const dst = (A === B ? A.map((_, k) => k) : B.map((_, k) => A.length + k)).join(';');
                const url = `${OSRM}/table/v1/driving/${this.coordStr(pts)}?sources=${src}&destinations=${dst}&annotations=duration,distance`;
                const data = await fetchJSON(url);
                if (data.code !== 'Ok') throw new Error(data.message || data.code);
                A.forEach((ai, r) => B.forEach((bi, c) => {
                    dur[ai][bi] = data.durations[r][c];
                    dist[ai][bi] = data.distances[r][c];
                }));
                done++;
                if (onProgress) onProgress(done / jobs.length);
            }
            // Pontos sem ligação pela rua (ilha, erro de posição): penaliza muito.
            for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
                if (dur[i][j] == null) dur[i][j] = 1e7;
                if (dist[i][j] == null) dist[i][j] = 1e9;
            }
            return { dur, dist };
        },

        // Matriz aproximada em linha reta (usada só se o servidor não responder).
        approxMatrix(points) {
            const dist = points.map(a => points.map(b => haversine(a, b) * 1.35));
            const dur = dist.map(row => row.map(d => d / (25 / 3.6)));
            return { dur, dist };
        },

        // Trajeto desenhado no mapa + tempo/distância de cada trecho.
        async path(points) {
            const legs = [];
            let geometry = [];
            for (let i = 0; i < points.length - 1; i += ROUTE_CHUNK - 1) {
                const part = points.slice(i, i + ROUTE_CHUNK);
                if (part.length < 2) break;
                const url = `${OSRM}/route/v1/driving/${this.coordStr(part)}?overview=full&geometries=geojson&steps=false`;
                const data = await fetchJSON(url);
                if (data.code !== 'Ok') throw new Error(data.message || data.code);
                const rt = data.routes[0];
                rt.legs.forEach(l => legs.push({ duration: l.duration, distance: l.distance }));
                geometry = geometry.concat(rt.geometry.coordinates.map(c => [c[1], c[0]]));
            }
            return { legs, geometry };
        },
    };

    // Pontos da rota na ordem: início, paradas, fim (se houver).
    function routePoints(r) {
        const pts = [];
        if (r.start) pts.push(r.start);
        r.stops.forEach(s => pts.push(s));
        const end = endPoint(r);
        if (end) pts.push(end);
        return pts;
    }
    function endPoint(r) {
        if (r.endMode === 'return') return r.start;
        if (r.endMode === 'custom') return r.end;
        return null;
    }

    // ======================================================================
    // Otimizar
    // ======================================================================
    async function optimize() {
        const r = route();
        const stops = r.stops.filter(s => s.lat != null);
        const missing = r.stops.length - stops.length;
        if (missing) return toast(`${missing} parada(s) sem localização. Corrija antes de otimizar.`, 4000);
        if (stops.length < 1) return toast('Adicione pelo menos uma parada.');
        if (!r.start) {
            toast('Defina o ponto de início (GPS ou endereço).', 4000);
            return startEdit();
        }
        if (r.endMode === 'custom' && !r.end) return toast('Defina o endereço de fim.');

        // Paradas já feitas ficam no começo, na ordem em que foram feitas.
        const done = r.stops.filter(s => s.status !== 'pending');
        const todo = r.stops.filter(s => s.status === 'pending');
        if (!todo.length) return toast('Todas as paradas já foram concluídas.');

        // Se já começou a rota, otimiza a partir da última parada feita.
        const lastDone = [...done].sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0)).pop();
        const origin = r.startedAt && lastDone ? lastDone : r.start;
        const end = endPoint(r);

        const points = [origin, ...todo];
        if (end) points.push(end);

        busy('Calculando distâncias pelas ruas…', 0);
        let m, approx = false;
        try {
            m = await routing.matrix(points, p => busy('Calculando distâncias pelas ruas…', p * 0.8));
        } catch (e) {
            console.warn(e);
            m = routing.approxMatrix(points);
            approx = true;
        }

        busy('Encontrando a melhor ordem…', 0.85);
        await sleep(30);
        const matrix = state.settings.optimizeBy === 'distance' ? m.dist : m.dur;
        const nodes = todo.map((s, i) => ({ idx: i + 1, priority: s.priority }));
        const endIdx = end ? points.length - 1 : null;
        const order = RouteSolver.solveWithPriorities(matrix, 0, nodes, endIdx, {
            timeLimitMs: Math.min(4000, 500 + todo.length * 30),
        });

        const doneOrdered = done.sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0));
        const before = r.stops.map(s => s.id).join();
        r.stops = doneOrdered.concat(order.map(i => todo[i - 1]));
        r.optimized = true;
        r.approx = approx;

        busy('Desenhando o trajeto…', 0.9);
        await computePath();
        busy(false);
        render();
        fitMap();

        const exact = todo.length <= RouteSolver.EXACT_LIMIT;
        if (approx) toast('Sem conexão com o servidor de ruas: ordem calculada em linha reta. Tente de novo quando tiver internet.', 6000);
        else if (before === r.stops.map(s => s.id).join()) toast('A ordem atual já era a melhor.');
        else toast(exact ? 'Rota otimizada — esta é a melhor ordem possível.' : 'Rota otimizada.');
    }

    // Recalcula trajeto e tempos na ordem atual (sem mudar a ordem).
    async function computePath() {
        const r = route();
        const pts = routePoints(r);
        if (pts.length < 2 || pts.some(p => p.lat == null)) { r.legs = null; r.geometry = null; save(); return; }
        try {
            const { legs, geometry } = await routing.path(pts);
            r.legs = legs;
            r.geometry = geometry;
        } catch (e) {
            console.warn(e);
            r.legs = pts.slice(1).map((p, i) => {
                const d = haversine(pts[i], p) * 1.35;
                return { distance: d, duration: d / (25 / 3.6) };
            });
            r.geometry = null;
            r.approx = true;
        }
        save();
    }

    // Horário previsto de chegada em cada parada.
    function etas(r) {
        if (!r.legs) return null;
        const [h, m] = (state.settings.startTime || '08:00').split(':').map(Number);
        const base = r.startedAt ? new Date(r.startedAt) : (() => { const d = new Date(); d.setHours(h, m, 0, 0); return d; })();
        let t = base.getTime();
        const off = r.start ? 0 : -1;
        return r.stops.map((s, i) => {
            const leg = r.legs[i + off];
            t += (leg ? leg.duration : 0) * 1000;
            const arrive = new Date(t);
            t += state.settings.serviceMin * 60000;
            return arrive;
        });
    }

    // ======================================================================
    // Mapa
    // ======================================================================
    let map, layer, lineLayer, meMarker, lastGPS = null, mapAddMode = false;

    function initMap() {
        map = L.map('map', { zoomControl: true }).setView([-15.78, -47.93], 4);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        layer = L.layerGroup().addTo(map);
        lineLayer = L.layerGroup().addTo(map);

        // Toque no mapa: adicionar parada, definir início/fim ou corrigir posição.
        map.on('click', async (e) => {
            if (!mapAddMode) return;
            setMapAdd(false);
            const { lat, lng } = e.latlng;
            if (pendingMapFix) {
                const s = route().stops.find(x => x.id === pendingMapFix);
                pendingMapFix = null;
                if (s) { s.lat = lat; s.lng = lng; s.warn = false; invalidate(); save(); render(); toast('Posição corrigida. Otimize de novo.'); }
                return;
            }
            const addr = await geo.reverse(lat, lng);
            if (searchTarget) applyPlace({ addr, lat, lng });
            else addStop({ addr, lat, lng, precise: true });
        });
    }

    function icon(cls, text) {
        return L.divIcon({ className: '', html: `<div class="marker ${cls}">${esc(text)}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
    }

    function drawMap() {
        if (!map) return;
        layer.clearLayers();
        lineLayer.clearLayers();
        const r = route();
        const next = nextStop(r);

        if (r.geometry) {
            L.polyline(r.geometry, { color: '#1558d6', weight: 5, opacity: 0.75 }).addTo(lineLayer);
        } else if (r.optimized) {
            L.polyline(routePoints(r).map(p => [p.lat, p.lng]), { color: '#1558d6', weight: 3, dashArray: '6 8' }).addTo(lineLayer);
        }

        if (r.start) L.marker([r.start.lat, r.start.lng], { icon: icon('start', 'I'), title: 'Início' }).addTo(layer);
        if (r.endMode === 'custom' && r.end) L.marker([r.end.lat, r.end.lng], { icon: icon('end', 'F'), title: 'Fim' }).addTo(layer);

        r.stops.forEach((s, i) => {
            if (s.lat == null) return;
            const cls = [s.status === 'done' ? 'done' : s.status === 'failed' ? 'failed' : '', next === s ? 'next' : '', s.warn ? 'warn' : ''].join(' ');
            const mk = L.marker([s.lat, s.lng], {
                icon: icon(cls, r.optimized ? i + 1 : '•'),
                draggable: true,
                title: s.addr,
            }).addTo(layer);
            mk.bindPopup(`<b>${r.optimized ? (i + 1) + '. ' : ''}${esc(s.addr)}</b>${s.note ? '<br>' + esc(s.note) : ''}<br><small>Arraste o marcador para corrigir a posição</small>`);
            mk.on('dragend', () => {
                const ll = mk.getLatLng();
                s.lat = ll.lat; s.lng = ll.lng; s.warn = false;
                invalidate(); save(); render();
                toast('Posição corrigida. Otimize de novo.');
            });
        });
    }

    function fitMap() {
        if (!map) return;
        const pts = routePoints(route()).filter(p => p && p.lat != null).map(p => [p.lat, p.lng]);
        if (pts.length === 1) map.setView(pts[0], 16);
        else if (pts.length) map.fitBounds(pts, { padding: [30, 30] });
    }

    function setMapAdd(on) {
        mapAddMode = on;
        $('#map-hint').classList.toggle('hidden', !on);
        $('#btn-map-add').classList.toggle('active', on);
        if (on) window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function getGPS() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) return reject(new Error('GPS não disponível'));
            navigator.geolocation.getCurrentPosition(
                p => {
                    lastGPS = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
                    if (map) {
                        if (meMarker) meMarker.setLatLng([lastGPS.lat, lastGPS.lng]);
                        else meMarker = L.marker([lastGPS.lat, lastGPS.lng], { icon: L.divIcon({ className: '', html: '<div class="marker me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(map);
                    }
                    resolve(lastGPS);
                },
                e => reject(new Error(e.code === 1 ? 'Permissão de localização negada' : 'Não foi possível obter a localização')),
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
            );
        });
    }

    // ======================================================================
    // Paradas
    // ======================================================================
    function addStop(p, silent) {
        const r = route();
        if (r.stops.length >= MAX_STOPS) { toast(`Limite de ${MAX_STOPS} paradas por rota.`); return false; }
        r.stops.push({
            id: uid(),
            addr: p.addr,
            lat: p.lat ?? null,
            lng: p.lng ?? null,
            note: p.note || '',
            phone: p.phone || '',
            priority: p.priority || 'normal',
            status: 'pending',
            doneAt: null,
            result: '',
            photos: [],
            warn: p.lat == null ? 'notfound' : (p.precise === false ? 'approx' : false),
        });
        invalidate();
        save();
        if (!silent) { render(); toast('Parada adicionada'); if (map && p.lat != null) map.panTo([p.lat, p.lng]); }
        return true;
    }

    function nextStop(r) {
        if (!r.optimized && !r.startedAt) return null;
        return r.stops.find(s => s.status === 'pending') || null;
    }

    // Adiciona várias de uma vez (lista colada, planilha, foto).
    async function addMany(items) {
        items = items.filter(it => it.addr && it.addr.trim().length > 2 || it.lat != null);
        if (!items.length) return toast('Nenhum endereço encontrado.');
        const room = MAX_STOPS - route().stops.length;
        if (items.length > room) { toast(`Só cabem mais ${room} paradas nesta rota.`); items = items.slice(0, room); }

        let found = 0, notFound = 0, approx = 0;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            busy(`Localizando endereços… ${i + 1} de ${items.length}`, i / items.length);
            let res = null;
            if (it.lat != null && it.lng != null) res = { lat: it.lat, lng: it.lng, precise: true };
            else {
                try { res = await geo.search(it.addr); } catch (e) { res = null; }
            }
            if (res) { found++; if (res.precise === false) approx++; } else notFound++;
            addStop({ ...it, addr: it.addr || res?.addr, lat: res?.lat, lng: res?.lng, precise: res?.precise }, true);
        }
        busy(false);
        render();
        fitMap();
        let msg = `${found} endereço(s) localizados.`;
        if (approx) msg += ` ${approx} com posição aproximada (confira no mapa).`;
        if (notFound) msg += ` ${notFound} não encontrado(s) — toque neles para corrigir.`;
        toast(msg, 6000);
    }

    // Converte texto (uma parada por linha) em itens.
    function parseLines(text) {
        return text.split(/\r?\n/)
            .map(l => l.replace(/^\s*(\d+[.)-]|[-•*])\s+/, '').trim())
            .filter(l => l.length > 2)
            .map(l => {
                // "endereço | observação"
                const [addr, ...rest] = l.split('|');
                return { addr: addr.trim(), note: rest.join('|').trim() };
            });
    }

    function moveStop(id, delta) {
        const r = route();
        const i = r.stops.findIndex(s => s.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= r.stops.length) return;
        [r.stops[i], r.stops[j]] = [r.stops[j], r.stops[i]];
        r.legs = null; r.geometry = null;
        save(); render();
        schedulePath();
    }

    let pathTimer;
    function schedulePath() {
        clearTimeout(pathTimer);
        pathTimer = setTimeout(async () => { await computePath(); render(); }, 900);
    }

    function removeStop(id) {
        const r = route();
        const s = r.stops.find(x => x.id === id);
        (s?.photos || []).forEach(pid => photoDB.del(pid).catch(() => { }));
        r.stops = r.stops.filter(x => x.id !== id);
        if (r.optimized) { r.legs = null; r.geometry = null; schedulePath(); }
        save(); render();
    }

    // ======================================================================
    // Navegação e compartilhamento
    // ======================================================================
    function navUrl(p, app) {
        app = app || state.settings.navApp;
        const ll = `${p.lat},${p.lng}`;
        if (app === 'waze') return `https://waze.com/ul?ll=${ll}&navigate=yes`;
        if (app === 'apple') return `https://maps.apple.com/?daddr=${ll}&dirflg=d`;
        return `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
    }
    function placeUrl(p) { return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`; }

    // Google Maps aceita no máximo 9 pontos intermediários por link.
    function googleLegs(r) {
        const pts = routePoints(r);
        const links = [];
        for (let i = 0; i < pts.length - 1; i += 10) {
            const part = pts.slice(i, i + 11);
            if (part.length < 2) break;
            const o = part[0], d = part[part.length - 1], w = part.slice(1, -1);
            let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${o.lat},${o.lng}&destination=${d.lat},${d.lng}`;
            if (w.length) url += `&waypoints=${encodeURIComponent(w.map(p => `${p.lat},${p.lng}`).join('|'))}`;
            // pts[0] é o início; a parada N está em pts[N].
            const from = Math.max(1, i), to = Math.min(r.stops.length, i + part.length - 1);
            links.push({ url, label: from === to ? `Parada ${from}` : `Paradas ${from} a ${to}` });
        }
        return links;
    }

    // Link que abre esta rota em outro celular.
    function shareLink(r) {
        const data = {
            n: r.name,
            s: r.start && [r.start.addr, +r.start.lat.toFixed(6), +r.start.lng.toFixed(6)],
            m: r.endMode,
            e: r.end && [r.end.addr, +r.end.lat.toFixed(6), +r.end.lng.toFixed(6)],
            o: r.optimized ? 1 : 0,
            p: r.stops.map(s => [s.addr, s.lat != null ? +s.lat.toFixed(6) : null, s.lng != null ? +s.lng.toFixed(6) : null, s.note || '', s.phone || '', s.priority === 'normal' ? '' : s.priority]),
        };
        const bytes = new TextEncoder().encode(JSON.stringify(data));
        let bin = '';
        bytes.forEach(b => bin += String.fromCharCode(b));
        const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        return location.origin + location.pathname + '#r=' + b64;
    }

    function readShareLink() {
        const m = location.hash.match(/#r=([\w-]+)/);
        if (!m) return null;
        try {
            const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
            const bin = atob(b64);
            const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
            const d = JSON.parse(new TextDecoder().decode(bytes));
            const r = newRoute(d.n);
            if (d.s) r.start = { addr: d.s[0], lat: d.s[1], lng: d.s[2] };
            r.endMode = d.m || 'return';
            if (d.e) r.end = { addr: d.e[0], lat: d.e[1], lng: d.e[2] };
            r.stops = (d.p || []).map(p => ({
                id: uid(), addr: p[0], lat: p[1], lng: p[2], note: p[3] || '', phone: p[4] || '',
                priority: p[5] || 'normal', status: 'pending', doneAt: null, result: '', photos: [], warn: p[1] == null ? 'notfound' : false,
            }));
            r.optimized = !!d.o;
            return r;
        } catch (e) {
            console.warn(e);
            return null;
        }
    }

    function whatsappText(r) {
        const lines = [`*${r.name}* — ${r.stops.length} paradas`];
        if (r.start) lines.push(`Início: ${r.start.addr}`);
        r.stops.forEach((s, i) => {
            lines.push(`\n*${i + 1}.* ${s.addr}${s.note ? ' — ' + s.note : ''}`);
            if (s.lat != null) lines.push(placeUrl(s));
        });
        const end = endPoint(r);
        if (end) lines.push(`\nFim: ${r.endMode === 'return' ? 'voltar ao início' : end.addr}`);
        lines.push(`\nAbrir no app: ${shareLink(r)}`);
        return lines.join('\n');
    }

    // ======================================================================
    // Exportar
    // ======================================================================
    function exportCSV() {
        const r = route();
        if (!r.stops.length) return toast('Nada para exportar.');
        const e = etas(r);
        const head = ['Ordem', 'Endereço', 'Observação', 'Telefone', 'Latitude', 'Longitude', 'Chegada prevista', 'Situação', 'Concluído em', 'Anotação da equipe'];
        const rows = r.stops.map((s, i) => [
            r.optimized ? i + 1 : '',
            s.addr, s.note, s.phone,
            s.lat != null ? String(s.lat).replace('.', ',') : '',
            s.lng != null ? String(s.lng).replace('.', ',') : '',
            e ? fmtClock(e[i]) : '',
            { pending: 'Pendente', done: 'Feito', failed: 'Não feito' }[s.status],
            s.doneAt ? new Date(s.doneAt).toLocaleString('pt-BR') : '',
            s.result,
        ]);
        const csv = [head, ...rows].map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${r.name.replace(/[^\w\- ]+/g, '_')}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    // ======================================================================
    // Importar planilha
    // ======================================================================
    function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }

    function rowsToItems(rows) {
        if (!rows.length) return [];
        const header = rows[0].map(norm);
        const find = (...names) => header.findIndex(h => names.some(n => h === n || h.includes(n)));
        const col = {
            addr: find('endereco', 'address', 'logradouro', 'rua', 'local'),
            num: find('numero', 'nº', 'n°', 'number'),
            comp: find('complemento'),
            bairro: find('bairro', 'district'),
            city: find('cidade', 'municipio', 'city'),
            uf: find('uf', 'estado'),
            cep: find('cep', 'postal', 'zip'),
            lat: find('latitude', 'lat'),
            lng: find('longitude', 'lng', 'lon'),
            note: find('observacao', 'obs', 'nota', 'descricao', 'servico', 'note'),
            phone: find('telefone', 'celular', 'fone', 'phone', 'whatsapp'),
            name: find('nome', 'cliente', 'name'),
        };
        const hasHeader = Object.values(col).some(i => i >= 0);
        const body = hasHeader ? rows.slice(1) : rows;
        const get = (row, i) => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');
        const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : null; };

        return body.map(row => {
            if (!hasHeader) return { addr: row.filter(Boolean).join(', ') };
            let addr = get(row, col.addr);
            if (col.num >= 0 && get(row, col.num) && !addr.includes(get(row, col.num))) addr += ', ' + get(row, col.num);
            addr = [addr, get(row, col.bairro), get(row, col.city), get(row, col.uf)].filter(Boolean).join(', ');
            if (!addr && get(row, col.cep)) addr = get(row, col.cep);
            const lat = col.lat >= 0 ? num(row[col.lat]) : null;
            const lng = col.lng >= 0 ? num(row[col.lng]) : null;
            const noteParts = [get(row, col.name), get(row, col.comp), get(row, col.note)].filter(Boolean);
            return { addr: addr || (lat != null ? `${lat}, ${lng}` : ''), lat, lng, note: noteParts.join(' — '), phone: get(row, col.phone) };
        }).filter(it => it.addr);
    }

    async function importFile(file) {
        try {
            let rows;
            if (/\.(csv|txt)$/i.test(file.name)) {
                const text = await file.text();
                const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
                if (/\.txt$/i.test(file.name) || !text.includes(sep)) return pasteDialog(text);
                rows = text.split(/\r?\n/).filter(Boolean).map(l => splitCSV(l, sep));
            } else {
                busy('Abrindo planilha…');
                if (!window.XLSX) await loadScript(XLSX_URL);
                const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
                rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
                busy(false);
            }
            const items = rowsToItems(rows);
            if (!items.length) return toast('Não achei endereços na planilha.');
            const ok = await confirmDialog('Importar planilha', `<p>Encontrei <b>${items.length}</b> endereço(s). Primeiros:</p><ul>${items.slice(0, 5).map(i => `<li>${esc(i.addr)}</li>`).join('')}</ul>`, 'Importar');
            if (ok) addMany(items);
        } catch (e) {
            busy(false);
            toast('Erro ao ler o arquivo: ' + e.message, 5000);
        }
    }

    function splitCSV(line, sep) {
        const out = []; let cur = '', q = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (q) {
                if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (c === '"') q = false;
                else cur += c;
            } else if (c === '"') q = true;
            else if (c === sep) { out.push(cur); cur = ''; }
            else cur += c;
        }
        out.push(cur);
        return out;
    }

    // Ler lista de endereços de uma foto (OCR).
    async function scanImage(file) {
        try {
            busy('Preparando leitor de texto…', 0.05);
            if (!window.Tesseract) await loadScript(TESSERACT_URL);
            const worker = await Tesseract.createWorker('por', 1, {
                logger: m => { if (m.status === 'recognizing text') busy('Lendo a foto…', m.progress); },
            });
            const { data } = await worker.recognize(file);
            await worker.terminate();
            busy(false);
            pasteDialog(data.text, 'Confira o texto lido da foto. Deixe um endereço por linha e apague o que não for endereço.');
        } catch (e) {
            busy(false);
            toast('Não foi possível ler a foto: ' + e.message, 5000);
        }
    }

    // ======================================================================
    // Janelas
    // ======================================================================
    function openDialog(title, bodyHTML, buttons) {
        const dlg = $('#dialog');
        $('#dialog-title').textContent = title;
        $('#dialog-body').innerHTML = bodyHTML;
        const acts = $('#dialog-actions');
        acts.innerHTML = '';
        return new Promise(resolve => {
            buttons.forEach(b => {
                const el = document.createElement('button');
                el.type = 'button';
                el.textContent = b.label;
                if (b.cls) el.className = b.cls;
                el.onclick = async () => {
                    if (b.onClick) {
                        const keep = await b.onClick();
                        if (keep === false) return;
                    }
                    dlg.close();
                    resolve(b.value);
                };
                acts.appendChild(el);
            });
            dlg.onclose = () => resolve(undefined);
            dlg.showModal();
        });
    }
    function confirmDialog(title, html, okLabel = 'OK', okCls = 'primary') {
        return openDialog(title, html, [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, cls: okCls }]);
    }

    function pasteDialog(text = '', hint) {
        openDialog('Colar lista de endereços', `
            <p class="muted">${esc(hint || 'Um endereço por linha. Para incluir observação use | (ex.: Rua A, 10 - Centro, Cidade | trocar poste).')}</p>
            <textarea id="paste-text" placeholder="Rua das Flores, 120 - Centro, Campinas&#10;Av. Brasil, 900 - Jardim, Campinas&#10;13010-000">${esc(text)}</textarea>
            <p class="muted">Dica: coloque bairro e cidade para achar o lugar exato.</p>`, [
            { label: 'Cancelar' },
            {
                label: 'Adicionar', cls: 'primary', onClick: () => {
                    const items = parseLines($('#paste-text').value);
                    setTimeout(() => addMany(items), 50);
                },
            },
        ]);
    }

    function stopDialog(id) {
        const r = route();
        const s = r.stops.find(x => x.id === id);
        if (!s) return;
        const idx = r.stops.indexOf(s);
        const warnTxt = s.warn === 'notfound' ? 'Endereço não encontrado. Corrija o texto ou use "Marcar no mapa".'
            : s.warn === 'approx' ? 'Posição aproximada (o número da casa não foi encontrado). Confira no mapa e, se precisar, arraste o marcador.' : '';
        openDialog(`Parada ${r.optimized ? idx + 1 : ''}`, `
            ${warnTxt ? `<div class="warning">${warnTxt}</div>` : ''}
            <label>Endereço</label><input type="text" id="sd-addr" value="${esc(s.addr)}">
            <label>Observação (o que fazer no local)</label><input type="text" id="sd-note" value="${esc(s.note)}">
            <label>Telefone do contato</label><input type="tel" id="sd-phone" value="${esc(s.phone)}">
            <label>Prioridade</label>
            <select id="sd-prio">
                <option value="normal">Normal (onde for melhor)</option>
                <option value="first">Fazer primeiro</option>
                <option value="last">Deixar para o final</option>
            </select>
            ${s.status !== 'pending' ? `<label>Situação</label><p>${s.status === 'done' ? '✅ Feito' : '❌ Não feito'} em ${new Date(s.doneAt).toLocaleString('pt-BR')}${s.result ? ' — ' + esc(s.result) : ''}</p><div class="photos" id="sd-photos"></div>` : ''}
        `, [
            { label: 'Excluir', cls: 'bad', onClick: async () => { if (await confirmDialog('Excluir parada', `<p>${esc(s.addr)}</p>`, 'Excluir', 'bad')) removeStop(id); } },
            { label: 'Marcar no mapa', onClick: () => { pendingMapFix = id; setMapAdd(true); toast('Toque no lugar certo no mapa'); } },
            ...(s.status !== 'pending' ? [{ label: 'Reabrir', onClick: () => { s.status = 'pending'; s.doneAt = null; save(); render(); } }] : []),
            {
                label: 'Salvar', cls: 'primary', onClick: async () => {
                    const addr = $('#sd-addr').value.trim();
                    s.note = $('#sd-note').value.trim();
                    s.phone = $('#sd-phone').value.trim();
                    const prio = $('#sd-prio').value;
                    if (prio !== s.priority) { s.priority = prio; invalidate(); }
                    if (addr && (addr !== s.addr || s.lat == null)) {
                        busy('Procurando endereço…');
                        const res = await geo.search(addr).catch(() => null);
                        busy(false);
                        s.addr = addr;
                        if (res) { s.lat = res.lat; s.lng = res.lng; s.warn = res.precise === false ? 'approx' : false; }
                        else { toast('Endereço não encontrado. Use "Marcar no mapa".', 4000); s.warn = 'notfound'; }
                        invalidate();
                    }
                    save(); render();
                },
            },
        ]);
        $('#sd-prio').value = s.priority;
        if (s.photos?.length) showPhotos(s.photos, $('#sd-photos'));
    }

    async function showPhotos(ids, el) {
        for (const pid of ids) {
            const blob = await photoDB.get(pid).catch(() => null);
            if (!blob) continue;
            const img = document.createElement('img');
            img.src = URL.createObjectURL(blob);
            img.onclick = () => window.open(img.src);
            el.appendChild(img);
        }
    }

    // Concluir parada com foto e anotação (comprovante).
    function finishDialog(id, status) {
        const r = route();
        const s = r.stops.find(x => x.id === id);
        const photos = [];
        const ok = status === 'done';
        openDialog(ok ? '✅ Concluir parada' : '❌ Não foi possível fazer', `
            <p><b>${esc(s.addr)}</b></p>
            <label>${ok ? 'Anotação (opcional)' : 'Motivo'}</label>
            <input type="text" id="fd-note" placeholder="${ok ? 'Ex.: serviço feito, trocado 2 metros de cano' : 'Ex.: local fechado, sem acesso'}">
            <label>Fotos (comprovante)</label>
            <input type="file" id="fd-photo" accept="image/*" capture="environment" multiple>
            <div class="photos" id="fd-photos"></div>
        `, [
            { label: 'Cancelar' },
            {
                label: ok ? 'Concluir' : 'Salvar', cls: ok ? 'primary' : 'bad', onClick: async () => {
                    const note = $('#fd-note').value.trim();
                    if (!ok && !note) { toast('Escreva o motivo.'); return false; }
                    for (const blob of photos) {
                        const pid = uid();
                        await photoDB.put(pid, blob).catch(() => toast('Não foi possível salvar a foto.'));
                        s.photos.push(pid);
                    }
                    s.status = status;
                    s.result = note;
                    s.doneAt = Date.now();
                    if (!r.startedAt) r.startedAt = Date.now();
                    save(); render();
                    const nx = nextStop(r);
                    if (!nx) toast('🎉 Rota concluída!', 5000);
                    else if (map) map.panTo([nx.lat, nx.lng]);
                },
            },
        ]);
        $('#fd-photo').onchange = async (e) => {
            for (const f of e.target.files) {
                const b = await compressImage(f);
                photos.push(b);
                const img = document.createElement('img');
                img.src = URL.createObjectURL(b);
                $('#fd-photos').appendChild(img);
            }
        };
    }

    function routesDialog() {
        const list = Object.values(state.routes).sort((a, b) => b.createdAt - a.createdAt);
        const html = list.map(r => {
            const done = r.stops.filter(s => s.status !== 'pending').length;
            return `<div class="route-item ${r.id === state.current ? 'current' : ''}">
                <div class="grow"><div>${esc(r.name)}</div><small class="muted">${r.stops.length} paradas · ${done} feitas · ${new Date(r.createdAt).toLocaleDateString('pt-BR')}</small></div>
                <button type="button" class="small-btn" data-open="${r.id}">Abrir</button>
                <button type="button" class="small-btn" data-copy="${r.id}" title="Duplicar">⧉</button>
                <button type="button" class="small-btn danger" data-del="${r.id}" title="Excluir">🗑</button>
            </div>`;
        }).join('');
        openDialog('Minhas rotas', html, [
            { label: 'Fechar' },
            { label: '+ Nova rota', cls: 'primary', onClick: () => { const r = newRoute(); if (route().start) r.start = { ...route().start }; state.routes[r.id] = r; state.current = r.id; save(); render(); fitMap(); } },
        ]);
        $('#dialog-body').onclick = async (e) => {
            const t = e.target.closest('button');
            if (!t) return;
            if (t.dataset.open) { state.current = t.dataset.open; save(); $('#dialog').close(); render(); fitMap(); }
            if (t.dataset.copy) {
                const src = state.routes[t.dataset.copy];
                const r = JSON.parse(JSON.stringify(src));
                Object.assign(r, { id: uid(), name: src.name + ' (cópia)', createdAt: Date.now(), startedAt: null });
                r.stops.forEach(s => Object.assign(s, { id: uid(), status: 'pending', doneAt: null, result: '', photos: [] }));
                state.routes[r.id] = r; state.current = r.id; save(); $('#dialog').close(); render(); fitMap();
                toast('Rota duplicada (paradas zeradas).');
            }
            if (t.dataset.del) {
                if (Object.keys(state.routes).length === 1) return toast('Precisa ter pelo menos uma rota.');
                const r = state.routes[t.dataset.del];
                $('#dialog').close();
                if (await confirmDialog('Excluir rota', `<p>Excluir "${esc(r.name)}"?</p>`, 'Excluir', 'bad')) {
                    r.stops.forEach(s => (s.photos || []).forEach(pid => photoDB.del(pid).catch(() => { })));
                    delete state.routes[r.id];
                    if (state.current === r.id) state.current = Object.keys(state.routes)[0];
                    save(); render(); fitMap();
                }
            }
        };
    }

    function settingsDialog() {
        const s = state.settings;
        openDialog('Configurações', `
            <label>Otimizar por</label>
            <select id="st-by">
                <option value="duration">Menor tempo de viagem</option>
                <option value="distance">Menor distância (km)</option>
            </select>
            <label>Horário de saída</label><input type="time" id="st-time" value="${esc(s.startTime)}">
            <label>Tempo em cada parada (minutos)</label><input type="number" id="st-service" min="0" max="600" value="${s.serviceMin}">
            <label>App de navegação</label>
            <select id="st-nav">
                <option value="google">Google Maps</option>
                <option value="waze">Waze</option>
                <option value="apple">Apple Mapas</option>
            </select>
            <label>Buscar endereços somente no país</label>
            <select id="st-country">
                <option value="br">Brasil</option>
                <option value="pt">Portugal</option>
                <option value="">Qualquer país</option>
            </select>
        `, [
            { label: 'Cancelar' },
            {
                label: 'Salvar', cls: 'primary', onClick: () => {
                    const by = $('#st-by').value;
                    if (by !== s.optimizeBy) invalidate();
                    s.optimizeBy = by;
                    s.startTime = $('#st-time').value || '08:00';
                    s.serviceMin = Math.max(0, parseInt($('#st-service').value, 10) || 0);
                    s.navApp = $('#st-nav').value;
                    s.country = $('#st-country').value;
                    save(); render();
                },
            },
        ]);
        $('#st-by').value = s.optimizeBy;
        $('#st-nav').value = s.navApp;
        $('#st-country').value = s.country;
    }

    function shareDialog() {
        const r = route();
        if (!r.stops.length) return toast('Adicione paradas primeiro.');
        const legs = r.optimized && r.start && r.stops.every(s => s.lat != null) ? googleLegs(r) : [];
        openDialog('Enviar rota para a equipe', `
            <p class="muted">A equipe recebe a lista numerada com o link de cada endereço e um link que abre esta rota no celular dela.</p>
            ${!r.optimized ? '<div class="warning">A rota ainda não foi otimizada.</div>' : ''}
            ${legs.length ? `<label>Abrir a rota inteira no Google Maps (até 9 paradas por link)</label><div class="link-list">${legs.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">🧭 ${esc(l.label)}</a>`).join('')}</div>` : ''}
        `, [
            { label: 'Fechar' },
            { label: 'Copiar link', onClick: async () => { await copy(shareLink(r)); return false; } },
            { label: 'Copiar texto', onClick: async () => { await copy(whatsappText(r)); return false; } },
            { label: 'WhatsApp', cls: 'primary', onClick: () => { window.open('https://wa.me/?text=' + encodeURIComponent(whatsappText(r)), '_blank'); } },
        ]);
    }

    async function copy(text) {
        try { await navigator.clipboard.writeText(text); toast('Copiado!'); }
        catch (e) {
            const ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); ta.remove(); toast('Copiado!');
        }
    }

    // ======================================================================
    // Início e fim
    // ======================================================================
    let searchTarget = null;   // null (parada) | 'start' | 'end'
    let pendingMapFix = null;  // id da parada que está sendo reposicionada no mapa

    function setSearchTarget(t) {
        searchTarget = t;
        const el = $('#search-target');
        el.classList.toggle('hidden', !t);
        el.querySelector('b').textContent = t === 'start' ? 'ponto de INÍCIO' : t === 'end' ? 'ponto de FIM' : '';
        $('#search').placeholder = t ? 'Digite o endereço' : 'Digite endereço, CEP ou coordenadas';
        if (t) $('#search').focus();
    }
    function startEdit() { setSearchTarget('start'); }

    function applyPlace(p) {
        const r = route();
        if (searchTarget === 'start') {
            r.start = { addr: p.addr, lat: p.lat, lng: p.lng };
            invalidate(); save(); setSearchTarget(null); render(); fitMap();
            toast('Início definido');
        } else if (searchTarget === 'end') {
            r.end = { addr: p.addr, lat: p.lat, lng: p.lng };
            invalidate(); save(); setSearchTarget(null); render(); fitMap();
            toast('Fim definido');
        } else {
            addStop(p);
        }
    }

    // ======================================================================
    // Desenhar a tela
    // ======================================================================
    function render() {
        const r = route();
        $('#route-name').value = r.name;
        $('#start-label').textContent = r.start ? r.start.addr : 'Não definido — use GPS ou digite';
        $('#end-mode').value = r.endMode;
        $('#end-label').classList.toggle('hidden', r.endMode !== 'custom');
        $('#btn-end-edit').classList.toggle('hidden', r.endMode !== 'custom');
        $('#end-label').textContent = r.end ? r.end.addr : 'Não definido';

        // Resumo
        const total = r.legs ? r.legs.reduce((a, l) => ({ d: a.d + l.distance, t: a.t + l.duration }), { d: 0, t: 0 }) : null;
        const doneN = r.stops.filter(s => s.status !== 'pending').length;
        const svc = r.stops.length * state.settings.serviceMin * 60;
        $('#summary').innerHTML = r.stops.length ? `
            <div class="stat"><b>${r.stops.length}</b><small>${r.stops.length === 1 ? 'parada' : 'paradas'}${doneN ? ` · ${doneN} ${doneN === 1 ? 'feita' : 'feitas'}` : ''}</small></div>
            <div class="stat"><b>${total ? fmtDist(total.d) : '—'}</b><small>distância</small></div>
            <div class="stat"><b>${total ? fmtDur(total.t) : '—'}</b><small>${total ? `dirigindo · ${fmtDur(total.t + svc)} total` : 'tempo'}</small></div>` : '';

        // Avisos
        const warns = [];
        const nf = r.stops.filter(s => s.warn === 'notfound').length;
        const ap = r.stops.filter(s => s.warn === 'approx').length;
        if (nf) warns.push(`⚠ ${nf} endereço(s) não encontrado(s). Toque neles para corrigir.`);
        if (ap) warns.push(`⚠ ${ap} endereço(s) com posição aproximada (laranja no mapa). Confira e arraste o marcador se precisar.`);
        if (r.approx && r.optimized) warns.push('⚠ Ordem calculada sem o servidor de ruas (sem internet). Otimize de novo com conexão.');
        if (r.stops.length && !r.optimized) warns.push('A rota mudou. Toque em “Otimizar rota” para organizar a ordem.');
        $('#warnings').innerHTML = warns.map(w => `<div class="warning">${esc(w)}</div>`).join('');

        $('#btn-optimize').disabled = !r.stops.length;
        $('#btn-reorder').classList.toggle('active', reorderMode);

        // Próxima parada
        const next = nextStop(r);
        const nc = $('#next-card');
        if (next && r.optimized) {
            const i = r.stops.indexOf(next);
            nc.classList.remove('hidden');
            nc.innerHTML = `
                <h3>Próxima parada · ${i + 1} de ${r.stops.length}</h3>
                <div class="addr">${esc(next.addr)}</div>
                ${next.note ? `<div class="note">📝 ${esc(next.note)}</div>` : ''}
                <div class="btns">
                    <button class="primary" data-act="nav" data-id="${next.id}">🧭 Navegar</button>
                    <button class="secondary" data-act="done" data-id="${next.id}">✅ Feito</button>
                    <button class="secondary danger" data-act="fail" data-id="${next.id}">❌ Não feito</button>
                    ${next.phone ? `<button class="secondary" data-act="call" data-id="${next.id}">📞 Ligar</button>` : ''}
                </div>`;
        } else nc.classList.add('hidden');

        // Lista
        const e = etas(r);
        $('#empty').classList.toggle('hidden', r.stops.length > 0);
        $('#stops').innerHTML = r.stops.map((s, i) => {
            const leg = r.legs ? r.legs[i + (r.start ? 0 : -1)] : null;
            const cls = [s.status === 'done' ? 'done' : '', s.status === 'failed' ? 'failed' : '', next === s ? 'next' : ''].join(' ');
            const flags = [
                s.warn === 'notfound' ? '<span class="flag flag-warn">não encontrado</span>' : '',
                s.warn === 'approx' ? '<span class="flag flag-warn">posição aproximada</span>' : '',
                s.priority === 'first' ? '<span class="flag flag-first">fazer primeiro</span>' : '',
                s.priority === 'last' ? '<span class="flag flag-last">deixar pro final</span>' : '',
                s.status === 'done' ? `<span class="flag flag-done">feito ${fmtClock(new Date(s.doneAt))}</span>` : '',
                s.status === 'failed' ? `<span class="flag flag-failed">não feito${s.result ? ': ' + esc(s.result) : ''}</span>` : '',
            ].join('');
            const meta = [];
            if (leg) meta.push(`+${fmtDist(leg.distance)} · ${fmtDur(leg.duration)}`);
            if (e && s.status === 'pending') meta.push(`chegada ~${fmtClock(e[i])}`);
            const side = reorderMode
                ? `<button data-act="up" data-id="${s.id}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button><button data-act="down" data-id="${s.id}" ${i === r.stops.length - 1 ? 'disabled' : ''} aria-label="Descer">▼</button>`
                : (s.lat != null ? `<button class="nav" data-act="nav" data-id="${s.id}" aria-label="Navegar">🧭</button>` : '')
                + (s.status === 'pending' && r.optimized ? `<button data-act="done" data-id="${s.id}" aria-label="Concluir">✅</button>` : '');
            return `<li class="stop ${cls}" data-id="${s.id}">
                <div class="num">${r.optimized ? i + 1 : '•'}</div>
                <div class="body" data-act="edit" data-id="${s.id}">
                    <div class="addr">${esc(s.addr)}</div>
                    ${meta.length ? `<div class="meta">${meta.join(' · ')}</div>` : ''}
                    ${s.note ? `<div class="note">📝 ${esc(s.note)}</div>` : ''}
                    ${flags}
                </div>
                <div class="side">${side}</div>
            </li>`;
        }).join('');

        drawMap();
    }

    let reorderMode = false;

    // ======================================================================
    // Eventos
    // ======================================================================
    function bind() {
        $('#route-name').addEventListener('change', e => { route().name = e.target.value.trim() || route().name; save(); });
        $('#btn-routes').onclick = routesDialog;
        $('#btn-settings').onclick = settingsDialog;
        $('#btn-share').onclick = shareDialog;
        $('#btn-optimize').onclick = optimize;
        $('#btn-export').onclick = exportCSV;
        $('#btn-reorder').onclick = () => {
            reorderMode = !reorderMode;
            const r = route();
            // A ordem manual passa a ser a ordem oficial da rota.
            if (reorderMode && !r.optimized) { r.optimized = true; save(); schedulePath(); }
            render();
        };
        $('#btn-clear').onclick = async () => {
            const r = route();
            if (!r.stops.length) return;
            if (await confirmDialog('Limpar paradas', `<p>Apagar as ${r.stops.length} paradas desta rota?</p>`, 'Apagar', 'bad')) {
                r.stops.forEach(s => (s.photos || []).forEach(pid => photoDB.del(pid).catch(() => { })));
                r.stops = []; r.startedAt = null; invalidate(); save(); render();
            }
        };

        $('#btn-start-gps').onclick = async () => {
            try {
                busy('Pegando sua localização…');
                const p = await getGPS();
                const addr = await geo.reverse(p.lat, p.lng);
                busy(false);
                route().start = { addr: '📍 ' + addr, lat: p.lat, lng: p.lng };
                invalidate(); save(); render(); fitMap();
                if (p.acc > 100) toast(`Precisão do GPS: ${Math.round(p.acc)} m. Confira o ponto no mapa.`, 5000);
            } catch (e) { busy(false); toast(e.message, 4000); }
        };
        $('#btn-start-edit').onclick = () => setSearchTarget('start');
        $('#btn-end-edit').onclick = () => setSearchTarget('end');
        $('#search-target-cancel').onclick = () => setSearchTarget(null);
        $('#end-mode').onchange = (e) => {
            route().endMode = e.target.value; invalidate(); save(); render();
            if (e.target.value === 'custom' && !route().end) setSearchTarget('end');
        };

        // Busca com sugestões
        const input = $('#search'), sug = $('#suggestions');
        let timer, items = [], active = -1, seq = 0;
        const hide = () => { sug.classList.add('hidden'); active = -1; };
        const show = () => {
            sug.innerHTML = items.map((it, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''}">${esc(it.line1)}<small>${esc(it.line2)}${it.precise ? '' : ' · (sem número exato)'}</small></li>`).join('');
            sug.classList.toggle('hidden', !items.length);
        };
        const pick = async (it) => {
            const typed = input.value.trim();
            input.value = '';
            hide();
            // A sugestão não tem o número da casa, mas o usuário digitou um:
            // tenta a busca precisa com o texto digitado antes de aceitar a posição da rua.
            if (!it.precise && /\d/.test(typed)) {
                busy('Procurando o número exato…');
                const res = await geo.search(`${typed}, ${it.line2}`).catch(() => null);
                busy(false);
                if (res && res.precise !== false) return applyPlace({ ...res, addr: `${typed} - ${it.line2}` });
            }
            applyPlace({ addr: it.addr, lat: it.lat, lng: it.lng, precise: it.precise });
            if (!it.precise) toast('Posição aproximada: confira no mapa.', 4000);
        };
        input.addEventListener('input', () => {
            clearTimeout(timer);
            const q = input.value.trim();
            if (q.length < 3 || geo.parseCoords(q)) { items = []; hide(); return; }
            timer = setTimeout(async () => {
                const my = ++seq;
                const res = await geo.suggest(q);
                if (my !== seq) return;
                items = res; active = -1; show();
            }, 350);
        });
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); show(); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); show(); e.preventDefault(); }
            else if (e.key === 'Escape') hide();
            else if (e.key === 'Enter') {
                e.preventDefault();
                if (active >= 0 && items[active]) return pick(items[active]);
                const q = input.value.trim();
                if (!q) return;
                hide();
                busy('Procurando endereço…');
                const res = await geo.search(q).catch(() => null);
                busy(false);
                if (!res) return toast('Endereço não encontrado. Inclua bairro e cidade, ou use "No mapa".', 5000);
                input.value = '';
                applyPlace(res);
                if (res.precise === false) toast('Posição aproximada: confira no mapa.', 4000);
            }
        });
        sug.addEventListener('mousedown', (e) => {
            const li = e.target.closest('li');
            if (li) { e.preventDefault(); pick(items[+li.dataset.i]); }
        });
        input.addEventListener('blur', () => setTimeout(hide, 150));

        // Voz
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) $('#btn-voice').classList.add('hidden');
        $('#btn-voice').onclick = () => {
            const rec = new SR();
            rec.lang = 'pt-BR';
            rec.interimResults = false;
            $('#btn-voice').classList.add('listening');
            toast('Fale o endereço…');
            rec.onresult = (e) => { input.value = e.results[0][0].transcript; input.dispatchEvent(new Event('input')); input.focus(); };
            rec.onend = () => $('#btn-voice').classList.remove('listening');
            rec.onerror = () => toast('Não entendi. Tente de novo.');
            rec.start();
        };

        // Ferramentas de adicionar
        $('#btn-paste').onclick = () => pasteDialog();
        $('#btn-import').onclick = () => $('#file-import').click();
        $('#file-import').onchange = (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; };
        $('#btn-scan').onclick = () => $('#file-scan').click();
        $('#file-scan').onchange = (e) => { if (e.target.files[0]) scanImage(e.target.files[0]); e.target.value = ''; };
        $('#btn-map-add').onclick = () => { pendingMapFix = null; setMapAdd(!mapAddMode); };
        $('#map-hint-cancel').onclick = () => { pendingMapFix = null; setMapAdd(false); };

        // Ações da lista e do cartão "próxima parada"
        const onAct = (e) => {
            const el = e.target.closest('[data-act]');
            if (!el) return;
            const id = el.dataset.id, r = route();
            const s = r.stops.find(x => x.id === id);
            switch (el.dataset.act) {
                case 'nav': if (s?.lat != null) window.open(navUrl(s), '_blank'); break;
                case 'done': finishDialog(id, 'done'); break;
                case 'fail': finishDialog(id, 'failed'); break;
                case 'call': location.href = 'tel:' + s.phone.replace(/[^\d+]/g, ''); break;
                case 'up': moveStop(id, -1); break;
                case 'down': moveStop(id, 1); break;
                case 'edit': stopDialog(id); break;
            }
        };
        $('#stops').addEventListener('click', onAct);
        $('#next-card').addEventListener('click', onAct);
    }

    // ======================================================================
    // Início
    // ======================================================================
    function init() {
        initMap();
        bind();

        const shared = readShareLink();
        if (shared) {
            history.replaceState(null, '', location.pathname);
            state.routes[shared.id] = shared;
            state.current = shared.id;
            save();
            toast(`Rota "${shared.name}" recebida com ${shared.stops.length} paradas.`, 5000);
            if (shared.optimized) computePath().then(render);
        }

        render();
        fitMap();
        if (!route().stops.length && !route().start) getGPS().then(p => { if (!route().start) map.setView([p.lat, p.lng], 14); }).catch(() => { });

        if ('serviceWorker' in navigator && location.protocol === 'https:') {
            navigator.serviceWorker.register('sw.js').catch(() => { });
        }
    }

    document.addEventListener('DOMContentLoaded', init);

    // Exposto para testes
    window.__rotaCerta = { parseLines, rowsToItems, geo, splitCSV, shareLink, readShareLink, state: () => state };
})();
