// Procura uma estrada no OpenStreetMap (Overpass) e mostra o traçado e os marcos de km (uso pontual).
const UA = 'RotaCerta/1.0 (github.com/HenriqueFerreira001/Troca-de-cores)';
const bbox = '-23.62,-46.40,-23.38,-46.05'; // Mogi das Cruzes e arredores
async function overpass(q) {
    for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
        try {
            const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' } });
            if (r.ok) return r.json();
            console.log(url, r.status);
        } catch (e) { console.log(url, e.message); }
    }
    return { elements: [] };
}
const km = (a, b) => { const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lon - a.lon) * Math.PI / 180; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
(async () => {
    const vias = await overpass(`[out:json][timeout:60];way["name"~"Itapeti",i](${bbox});out tags geom;`);
    const nomes = {};
    for (const w of vias.elements) {
        const n = w.tags.name;
        (nomes[n] = nomes[n] || []).push(w);
    }
    for (const [n, ws] of Object.entries(nomes)) {
        const len = ws.reduce((t, w) => t + w.geometry.reduce((s, p, i) => s + (i ? km(w.geometry[i - 1], p) : 0), 0), 0);
        const ref = [...new Set(ws.map(w => w.tags.ref).filter(Boolean))].join(',');
        console.log(`## ${n} ${ref ? '(' + ref + ')' : ''} — ${ws.length} trechos, ${len.toFixed(1)} km, highway=${[...new Set(ws.map(w => w.tags.highway))].join(',')}`);
        ws.forEach(w => console.log(`   trecho ${w.id}: ${w.geometry[0].lat.toFixed(5)},${w.geometry[0].lon.toFixed(5)} → ${w.geometry[w.geometry.length - 1].lat.toFixed(5)},${w.geometry[w.geometry.length - 1].lon.toFixed(5)} (${w.geometry.length} pts)`));
    }
    const marcos = await overpass(`[out:json][timeout:60];(node["highway"="milestone"](${bbox});node["distance"](${bbox}););out;`);
    console.log(`\n## Marcos de km (${marcos.elements.length})`);
    marcos.elements.forEach(m => console.log(`   ${m.lat},${m.lon} ${JSON.stringify(m.tags)}`));
    const bairro = await overpass(`[out:json][timeout:60];(node["name"~"Itapeti",i](${bbox});relation["name"~"Itapeti",i](${bbox}););out center tags;`);
    console.log(`\n## Lugares com "Itapeti"`);
    bairro.elements.forEach(b => console.log(`   ${b.type} ${JSON.stringify(b.tags.name)} ${b.tags.place || b.tags.boundary || b.tags.landuse || ''} ${(b.center || b).lat},${(b.center || b).lon}`));
    const perto = await overpass(`[out:json][timeout:60];(node["name"~"Furnas|Itapeti",i](${bbox});way["name"~"Furnas",i](${bbox}););out center tags;`);
    console.log(`\n## "Furnas"`);
    perto.elements.forEach(b => console.log(`   ${b.type} ${JSON.stringify(b.tags.name)} ${b.tags.highway || b.tags.place || ''} ${(b.center || b).lat},${(b.center || b).lon}`));
})();
