// Procura um endereço nos mapas gratuitos e mostra o que cada um acha (uso pontual).
const UA = 'RotaCerta/1.0 (github.com/HenriqueFerreira001/Troca-de-cores)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function nom(params) {
    await sleep(1200);
    const qs = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '5', countrycodes: 'br', ...params });
    const r = await fetch('https://nominatim.openstreetmap.org/search?' + qs, { headers: { 'User-Agent': UA } });
    return r.ok ? r.json() : [];
}
(async () => {
    const qs = [
        { q: 'Estrada do Itapeti das Furnas, Mogi das Cruzes' },
        { q: 'Parque Residencial Itapeti, Mogi das Cruzes' },
        { q: 'Estrada do Itapeti, Mogi das Cruzes' },
        { postalcode: '08771-001', country: 'Brasil' },
    ];
    let estrada = null, bairro = null;
    for (const p of qs) {
        const res = await nom({ ...p, polygon_geojson: '1' });
        console.log('\n## ' + JSON.stringify(p));
        for (const x of res) {
            console.log(`- ${x.display_name} | ${x.lat},${x.lon} | ${x.category}/${x.type} | geo ${x.geojson && x.geojson.type} ${x.geojson && x.geojson.coordinates && JSON.stringify(x.geojson.coordinates).length}`);
            if (!estrada && /Itapeti/i.test(x.display_name) && x.geojson && /LineString/.test(x.geojson.type)) estrada = x;
            if (!bairro && /Residencial Itapeti/i.test(x.display_name)) bairro = x;
        }
    }
    try {
        const v = await (await fetch('https://viacep.com.br/ws/08771001/json/')).json();
        console.log('\n## ViaCEP', JSON.stringify(v));
    } catch (e) { console.log('ViaCEP falhou', e.message); }
    try {
        const ph = await (await fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent('Estrada do Itapeti das Furnas Mogi das Cruzes') + '&limit=5')).json();
        console.log('\n## Photon'); ph.features.forEach(f => console.log('-', JSON.stringify(f.properties.name), f.properties.district || '', f.properties.city || '', f.geometry.coordinates.reverse().join(',')));
    } catch (e) { console.log('Photon falhou', e.message); }
    if (estrada) {
        // Pontos da estrada, com a distância acumulada desde cada ponta (para achar o "km 11").
        const lines = estrada.geojson.type === 'LineString' ? [estrada.geojson.coordinates] : estrada.geojson.coordinates;
        const pts = lines.flat();
        const km = (a, b) => { const R = 6371, dLat = (b[1] - a[1]) * Math.PI / 180, dLng = (b[0] - a[0]) * Math.PI / 180; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
        let d = 0; const acc = pts.map((p, i) => (d += i ? km(pts[i - 1], p) : 0));
        console.log(`\n## Estrada: ${pts.length} pontos, ${d.toFixed(1)} km no total; pontas ${pts[0].slice().reverse()} e ${pts[pts.length - 1].slice().reverse()}`);
        if (bairro) {
            const c = [+bairro.lon, +bairro.lat];
            let best = 0; pts.forEach((p, i) => { if (km(p, c) < km(pts[best], c)) best = i; });
            console.log(`Ponto da estrada mais perto do bairro: ${pts[best][1]},${pts[best][0]} (a ${km(pts[best], c).toFixed(2)} km do centro do bairro; ${acc[best].toFixed(1)} km de uma ponta, ${(d - acc[best]).toFixed(1)} km da outra)`);
        }
    }
})();
