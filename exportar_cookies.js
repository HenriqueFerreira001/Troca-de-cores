/**
 * exportar_cookies.js
 * Lê o banco SQLite de cookies do GinsBrowser (DICloak) e salva os
 * cookies do Kalodata em cookies_kalodata.json — sem precisar de extensão.
 *
 * COMO USAR:
 *   1. Feche o GinsBrowser (o SQLite fica travado enquanto ele está aberto)
 *   2. node exportar_cookies.js
 *   3. Abra o GinsBrowser de novo
 */

const fs   = require('fs');
const path = require('path');

// Caminhos exatos dos arquivos de cookies encontrados pelo PowerShell
const ARQUIVOS_COOKIES = [
  'C:\\Users\\Henri\\AppData\\Roaming\\.DIcloakCache\\20463716900026287106\\ud_20463716900026287106\\Default\\Network\\Cookies',
  'C:\\Users\\Henri\\AppData\\Roaming\\.DIcloakCache\\20463716900026287106\\ud_20463716900026287106\\Guest Profile\\Network\\Cookies',
  'C:\\Users\\Henri\\AppData\\Roaming\\.DIcloakCache\\20463716900026287106\\ud_20463716900026287106\\Profile 1\\Network\\Cookies',
];

// Verifica se o better-sqlite3 está instalado
let Database;
try {
  Database = require('better-sqlite3');
} catch (_) {
  console.log('📦 Instalando better-sqlite3...');
  require('child_process').execSync('npm install better-sqlite3', { stdio: 'inherit' });
  Database = require('better-sqlite3');
}

const DOMINIO = 'kalodata';
let totalExportados = 0;
const cookiesFinais = [];

for (const arquivo of ARQUIVOS_COOKIES) {
  const perfil = arquivo.split('\\').slice(-3, -2)[0]; // ex: "Default"
  console.log(`\n🔍 Verificando: ${arquivo}`);
  console.log(`   Existe: ${fs.existsSync(arquivo)}`);
  if (!fs.existsSync(arquivo)) continue;

  // Copia o arquivo antes de abrir (evita lock do SQLite)
  const tmp = arquivo + '.tmp_export';
  fs.copyFileSync(arquivo, tmp);

  try {
    const db = new Database(tmp, { readonly: true });

    // Mostra todos os domínios pra debug
    const dominios = db.prepare(`SELECT DISTINCT host_key FROM cookies ORDER BY host_key`).all();
    if (dominios.length > 0) {
      console.log(`   Domínios em "${perfil}": ${dominios.map(d => d.host_key).join(', ')}`);
    } else {
      console.log(`   "${perfil}" vazio.`);
    }

    const linhas = db.prepare(
      `SELECT name, value, host_key, path, expires_utc, is_httponly, is_secure, samesite
       FROM cookies WHERE host_key LIKE ?`
    ).all(`%${DOMINIO}%`);
    db.close();

    for (const c of linhas) {
      // Converte timestamp Chromium (microssegundos desde 1601) para Unix
      const expires = c.expires_utc
        ? (c.expires_utc / 1000000) - 11644473600
        : -1;

      const sameSiteMap = { 0: 'no_restriction', 1: 'lax', 2: 'strict' };
      cookiesFinais.push({
        name:           c.name,
        value:          c.value,
        domain:         c.host_key,
        path:           c.path,
        expirationDate: expires > 0 ? expires : undefined,
        httpOnly:       !!c.is_httponly,
        secure:         !!c.is_secure,
        sameSite:       sameSiteMap[c.samesite] || 'no_restriction',
        session:        expires <= 0,
      });
      totalExportados++;
    }

    console.log(`✅ Perfil "${perfil}": ${linhas.length} cookies do Kalodata`);
  } catch (e) {
    console.log(`⚠️  Perfil "${perfil}" ERRO: ${e.message}`);
    console.log(e.stack);
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

if (cookiesFinais.length === 0) {
  console.log('\n❌ Nenhum cookie do Kalodata encontrado.');
  console.log('   Verifique se você está logado no Kalodata no GinsBrowser (perfil #3).');
  process.exit(1);
}

fs.writeFileSync('./cookies_kalodata.json', JSON.stringify(cookiesFinais, null, 2));
console.log(`\n🎉 ${totalExportados} cookies exportados para cookies_kalodata.json`);
console.log('   Agora rode: node agente_tiktok.js → analisar');
