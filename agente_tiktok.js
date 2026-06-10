/**
 * =============================================================
 *   AGENTE TIKTOK SHOP — Interface de Comandos no Terminal
 *   Versão 6.0
 * =============================================================
 *
 * ▶️  COMO RODAR:
 *   node agente_tiktok.js
 *
 * 💬 COMANDOS DISPONÍVEIS:
 *   analisar              → Busca os 7 melhores produtos no Kalodata
 *   gerar                 → Gera vídeos para os produtos encontrados
 *   gerar 3               → Gera apenas 3 vídeos
 *   status                → Mostra produtos prontos para gerar vídeo
 *   historico             → Mostra produtos já usados
 *   relatorio             → Mostra relatório do dia
 *   agendar 09:00         → Agenda execução automática diária
 *   parar agendamento     → Para o agendamento automático
 *   limpar historico      → Limpa o histórico de produtos usados
 *   ajuda                 → Lista todos os comandos
 *   sair                  → Encerra o agente
 * =============================================================
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');


// ============================================================
// ⚙️  CONFIGURAÇÕES
// ============================================================

const CONFIG = {
  quantidadeDeVideos: 7,
  tempoMaximoPorVideo: 180000,  // 3 minutos
  diCloakPerfilId: '3',         // número do perfil Kalodata no DICloak
  diCloakPortas: [27777, 50325, 50326, 8848, 8849, 9222], // portas que o DICloak pode usar
  telegramToken: '',
  telegramChatId: '',
  arquivos: {
    historico: './historico.json',
    perfil: './perfil_navegador',
    relatorios: './relatorios',
    screenshots: './screenshots',
  }
};


// ============================================================
// 📦 ESTADO DO AGENTE
// Guarda os produtos encontrados e o contexto do navegador
// ============================================================

const ESTADO = {
  produtosEncontrados: [],   // Produtos buscados no Kalodata
  navegadorAberto: false,    // Se o navegador está aberto
  contexto: null,            // Contexto do Playwright
  agendamento: null,         // Timer do agendamento automático
};


// ============================================================
// 📁 INICIALIZAÇÃO
// ============================================================

function inicializar() {
  for (const pasta of [CONFIG.arquivos.perfil, CONFIG.arquivos.relatorios, CONFIG.arquivos.screenshots]) {
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
  }
  if (!fs.existsSync(CONFIG.arquivos.historico)) {
    salvarHistorico({ produtos: [], totalVideos: 0, ultimaExecucao: null });
  }
}


// ============================================================
// 📋 HISTÓRICO
// ============================================================

function carregarHistorico() {
  return JSON.parse(fs.readFileSync(CONFIG.arquivos.historico, 'utf8'));
}

function salvarHistorico(historico) {
  fs.writeFileSync(CONFIG.arquivos.historico, JSON.stringify(historico, null, 2));
}

function produtoJaUsado(nome) {
  const historico = carregarHistorico();
  const trintaDias = Date.now() - (30 * 24 * 60 * 60 * 1000);
  return historico.produtos.some(p =>
    p.nome.toLowerCase() === nome.toLowerCase() &&
    new Date(p.data).getTime() > trintaDias
  );
}

function registrarNoHistorico(nome, videoGerado) {
  const historico = carregarHistorico();
  historico.produtos.push({ nome, data: new Date().toISOString(), videoGerado });
  if (videoGerado) historico.totalVideos++;
  historico.ultimaExecucao = new Date().toISOString();
  salvarHistorico(historico);
}


// ============================================================
// 🌐 NAVEGADOR — Conecta no DICloak via API local
// ============================================================

// Faz uma requisição HTTP simples (sem dependências externas)
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? require('https') : require('http');
    lib.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const lib = require('http');
    const dados = JSON.stringify(body);
    const opcoes = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) }
    };
    const req = lib.request(url, opcoes, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(dados);
    req.end();
  });
}

// Encontra as portas CDP do GinsBrowser (navegador do DICloak)
async function encontrarPortasCDP() {
  const { execSync } = require('child_process');
  const portas = [];

  try {
    // Pega o PID do GinsBrowser via wmic (evita problema com $PID do PowerShell)
    const processos = ['GinsBrowser.exe', 'DICloak.exe', 'chrome.exe'];
    const pids = [];

    for (const proc of processos) {
      try {
        const resultado = execSync(
          `wmic process where "name='${proc}'" get processid /format:value 2>nul`,
          { encoding: 'utf8', timeout: 5000 }
        );
        const matches = resultado.matchAll(/ProcessId=(\d+)/gi);
        for (const m of matches) pids.push(m[1]);
      } catch { }
    }

    if (pids.length > 0) {
      // Pega as portas desses PIDs via netstat
      const netstat = execSync('netstat -ano 2>nul', { encoding: 'utf8', timeout: 8000 });
      for (const linha of netstat.split('\n')) {
        for (const pid of pids) {
          if (linha.includes(pid) && linha.includes('LISTENING')) {
            const m = linha.match(/:(\d+)\s/);
            if (m) {
              const p = parseInt(m[1]);
              if (p > 8000 && p < 65000 && !portas.includes(p)) portas.push(p);
            }
          }
        }
      }
    }
  } catch { }

  return portas;
}

// Descobre porta CDP válida testando /json/version
async function descobrirPortaDICloak() {
  console.log('   🔍 Procurando o navegador do DICloak...');
  const portasDinamica = await encontrarPortasCDP();
  const todasPortas = [...new Set([...portasDinamica, ...CONFIG.diCloakPortas])];

  for (const porta of todasPortas) {
    try {
      const info = await httpGet(`http://localhost:${porta}/json/version`);
      if (info && info.Browser) {
        console.log(`   ✅ Navegador CDP encontrado na porta ${porta}: ${info.Browser}`);
        return { tipo: 'cdp', porta, wsUrl: info.webSocketDebuggerUrl };
      }
    } catch { }

    // Também testa a API do DICloak
    try {
      const resp = await httpGet(`http://localhost:${porta}/api/v1/browser/list?page=1&page_size=10`);
      if (resp && resp.code !== undefined) {
        console.log(`   ✅ DICloak API encontrada na porta ${porta}`);
        return { tipo: 'api', porta };
      }
    } catch { }
  }
  return null;
}

async function abrirNavegador() {
  if (ESTADO.navegadorAberto) return;

  const resultado = await descobrirPortaDICloak();

  if (resultado && resultado.tipo === 'cdp') {
    // Conecta direto via CDP no navegador já aberto
    const url = resultado.wsUrl || `http://localhost:${resultado.porta}`;
    ESTADO.contexto = await chromium.connectOverCDP(url);
    ESTADO.navegadorAberto = true;
    console.log('   ✅ Conectado ao navegador do DICloak!');
    return;
  }

  if (resultado && resultado.tipo === 'api') {
    // Usa a API do DICloak para abrir o perfil e pegar o WS
    try {
      const resp = await httpPost(
        `http://localhost:${resultado.porta}/api/v1/browser/start`,
        { id: CONFIG.diCloakPerfilId }
      );
      const wsUrl = resp?.data?.ws || resp?.ws || resp?.webSocketDebuggerUrl;
      if (wsUrl) {
        ESTADO.contexto = await chromium.connectOverCDP(wsUrl);
        ESTADO.navegadorAberto = true;
        console.log('   ✅ Conectado ao DICloak via API!');
        return;
      }
    } catch (e) {
      console.log(`   ⚠️  Erro na API do DICloak: ${e.message}`);
    }
  }

  console.log('\n' + '='.repeat(55));
  console.log('   ❌ Navegador do DICloak não encontrado!');
  console.log('='.repeat(55));
  console.log('   Certifique-se que:');
  console.log('   1. O DICloak está aberto');
  console.log('   2. O perfil KALODATA está ABERTO (botão Open clicado)');
  console.log('   3. Rode "analisar" novamente');
  console.log('='.repeat(55));
  throw new Error('Falha ao conectar ao DICloak.');
}

async function fecharNavegador() {
  if (ESTADO.contexto) {
    await ESTADO.contexto.close();
    ESTADO.contexto = null;
    ESTADO.navegadorAberto = false;
    console.log('   ✅ Navegador fechado.');
  }
}


// ============================================================
// 🛍️  COMANDO: analisar
// Busca os melhores produtos no Kalodata
// ============================================================

async function cmdAnalisar(quantidade) {
  console.log('\n📦 Abrindo o Kalodata para buscar produtos...');

  await abrirNavegador();
  const pagina = await ESTADO.contexto.newPage();

  try {
    await pagina.goto('https://www.kalodata.com/product', { waitUntil: 'load', timeout: 60000 });
  } catch {
    await pagina.goto('https://www.kalodata.com/product', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  await pagina.waitForTimeout(4000);

  console.log('\n' + '='.repeat(55));
  console.log('   🔐 AÇÃO NECESSÁRIA — 1 clique!');
  console.log('='.repeat(55));
  console.log('   1. Clique em "Confirme que é humano" no navegador');
  console.log('   2. Espere a lista de produtos carregar');
  console.log('   3. Digite  continuar  aqui e pressione ENTER');
  console.log('='.repeat(55));

  // Aguarda o comando "continuar" pelo readline (não bloqueia o terminal)
  await aguardarComando('continuar');

  await pagina.waitForTimeout(2000);

  // Aplica filtros automaticamente: Roupas Femininas + Acessórios de Moda + Últimos 30 dias
  console.log('   🔧 Aplicando filtros de categoria...');

  // Filtro de data: Últimos 30 dias
  try {
    const btnData = pagina.locator('text=Últimos 30 dias, text=Last 30 days, text=30 dias, text=30days').first();
    await btnData.click({ timeout: 5000 });
    await pagina.waitForTimeout(1000);
    console.log('   ✅ Filtro de data: Últimos 30 dias');
  } catch {
    // Tenta clicar no seletor de data e escolher 30 dias
    try {
      await pagina.locator('[class*="date"], [class*="Date"]').first().click({ timeout: 3000 });
      await pagina.waitForTimeout(500);
      await pagina.locator('text=30').first().click({ timeout: 3000 });
      await pagina.waitForTimeout(1000);
    } catch { }
  }

  // Filtro de categoria: Roupas Femininas + Acessórios de Moda
  try {
    // Clica em "Categoria" no menu lateral
    const btnCategoria = pagina.locator('text=Categoria, text=Category').first();
    await btnCategoria.click({ timeout: 5000 });
    await pagina.waitForTimeout(1000);

    // Seleciona "Roupas femininas"
    try {
      await pagina.locator('text=Roupas femininas, text=Womenswear, text=Women').first().click({ timeout: 4000 });
      await pagina.waitForTimeout(500);
      console.log('   ✅ Categoria: Roupas Femininas selecionada');
    } catch { }

    // Seleciona "Acessórios de moda"
    try {
      await pagina.locator('text=Acessórios de moda, text=Fashion Accessories, text=Accessories').first().click({ timeout: 4000 });
      await pagina.waitForTimeout(500);
      console.log('   ✅ Categoria: Acessórios de Moda selecionada');
    } catch { }

    // Clica em Enviar / Aplicar
    try {
      await pagina.locator('text=Enviar, text=Apply, text=Aplicar, text=Confirmar').first().click({ timeout: 4000 });
      await pagina.waitForTimeout(3000);
      console.log('   ✅ Filtros aplicados!');
    } catch { }
  } catch {
    console.log('   ⚠️  Não consegui aplicar os filtros automaticamente.');
    console.log('   👉 Verifique se os filtros "Roupas Femininas" e "Acessórios de Moda" estão ativos e salve-os no Kalodata.');
  }

  // Palavras que indicam texto de interface (não produto)
  const textosDaInterface = [
    'product info', 'informações do produto', 'product information',
    'verificando', 'cloudflare', 'tendência', 'taxa', 'receita',
    'revenue', 'growth', 'rank', 'category', 'date', 'filter',
    'search', 'sort', 'price', 'commission', 'loading', 'aplicar',
    'apply', 'reset', 'itens vendidos', 'items sold', 'shop name',
    'seller', 'vendedor', 'followers', 'seguidores'
  ];

  // Palavras que confirmam produto FEMININO (roupa + acessórios)
  const palavrasRoupas = [
    // Roupas femininas
    'vestido', 'blusa', 'saia', 'cropped', 'legging', 'macacão',
    'lingerie', 'kimono', 'cardigan', 'feminina', 'feminino', 'mulher',
    'woman', 'dress', 'blouse', 'skirt', 'calça feminina', 'calça larga feminina',
    'calça flare feminina', 'jaqueta feminina', 'casaco feminino',
    'moletom feminino', 'conjunto feminino', 'camiseta feminina',
    'camisa feminina', 'regata feminina', 'short feminino', 'bermuda feminina',
    'body feminino', 'tricot', 'blazer feminino', 'colete feminino',
    // Acessórios femininos — bolsa, sapato, sandália etc. são permitidos
    'bolsa', 'bolsinha', 'clutch', 'carteira feminina', 'mala feminina',
    'sapato feminino', 'sapato', 'sandália', 'scarpin', 'plataforma',
    'sapatilha', 'tamanco', 'salto', 'mule', 'bota feminina',
    'chinelo feminino', 'rasteirinha', 'tênis feminino',
    'colar', 'brinco', 'anel', 'pulseira', 'tiara', 'acessório feminino'
  ];

  // Palavras que indicam roupa MASCULINA — produtos ignorados
  const palavrasMasculinas = [
    'masculina', 'masculino', 'homem', ' men ', 'male', 'terno',
    'gravata', 'masculino', 'sarja masculina', 'camisa masculina',
    'camiseta masculina', 'calça masculina', 'jaqueta masculina',
    'casaco masculino', 'moletom masculino', 'bermuda masculina',
    'polo masculina', 'paletó', 'kit 2 calça'
  ];

  // Produtos bloqueados — eletrônicos, fitness, casa, etc.
  // PERMITIDOS: sapato, sandália, bolsa, carteira, acessórios femininos em geral
  const naoERoupa = [
    // Fitness / Academia
    'bicicleta', 'bike', 'spin', 'spinning', 'ergométrica', 'esteira',
    'haltere', 'musculação', 'kit treino', 'kit academia', 'kit fitness',
    // Eletrônicos
    'eletrônico', 'celular', 'smartphone', 'fone', 'cabo', 'carregador',
    'tablet', 'notebook', 'monitor', 'mouse', 'teclado',
    // Suplementos / Alimentos
    'suplemento', 'proteína', 'whey', 'creatina',
    // Casa / Cozinha
    'cama', 'colchão', 'travesseiro', 'panela', 'frigideira', 'utensílio',
    // Outros
    'figurinha', 'brinquedo', 'ferramenta'
  ];

  function isProdutoValido(texto) {
    const t = texto.toLowerCase().trim();
    if (t.length < 10 || t.length > 300) return false;
    if (textosDaInterface.some(p => t.includes(p))) return false;
    if (/^\d+([.,]\d+)?(%|k|m|r\$)?$/.test(t)) return false;
    return true;
  }

  function isProdutoRoupa(texto) {
    const t = texto.toLowerCase();
    // Rejeita masculino e não-roupa
    if (palavrasMasculinas.some(p => t.includes(p))) return false;
    if (naoERoupa.some(p => t.includes(p))) return false;
    // Aceita se tiver palavra feminina
    return palavrasRoupas.some(p => t.includes(p));
  }

  console.log('   🔍 Analisando a página...');
  await pagina.waitForTimeout(2000);

  // Aguarda a tabela carregar completamente antes de capturar
  await pagina.waitForTimeout(3000);
  try {
    // Espera pelo menos 5 linhas na tabela aparecerem
    await pagina.waitForSelector('tr', { timeout: 8000 });
  } catch { }

  // Captura nome E imagem do produto para o Gemini reproduzir a peça com fidelidade
  let produtos = await pagina.evaluate(() => {
    const visto = new Set(); // evita duplicatas
    const pares = [];

    // Estratégia 1: percorre todas as linhas da tabela capturando img + nome
    const linhas = document.querySelectorAll('tr');
    for (const linha of linhas) {
      const img = linha.querySelector('img');
      // Tenta vários seletores de nome dentro da linha
      const nomeEl = linha.querySelector(
        '[class*="product-name"],[class*="productName"],[class*="product_name"],' +
        '[class*="item-name"],[class*="itemName"],[class*="goods-name"],' +
        '[class*="title"],[class*="name"] a,[class*="name"] span,' +
        'td:nth-child(2) a,td:nth-child(2) span,td:nth-child(2)'
      );
      const nome = nomeEl ? nomeEl.textContent.trim() : '';
      const imagem = img ? (img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy') || '') : '';
      if (nome.length > 8 && !visto.has(nome)) {
        visto.add(nome);
        pares.push({ nome, imagem });
      }
    }
    if (pares.length >= 3) return pares.slice(0, 50);

    // Estratégia 2: seletores específicos de nome + imagem vizinha
    const seletores = [
      '[class*="product-name"]', '[class*="productName"]', '[class*="product_name"]',
      '[class*="item-name"]', '[class*="itemName"]', '[class*="goods-name"]',
      '[class*="commodity-name"]', '[class*="spu-name"]', '[class*="sku-name"]',
      '.ant-table-cell:nth-child(2)', 'td:nth-child(2) a', 'td:nth-child(2) span',
    ];
    for (const seletor of seletores) {
      const els = document.querySelectorAll(seletor);
      if (els.length >= 3) {
        const textos = Array.from(els).map(el => {
          const nome = el.textContent.trim();
          // Tenta pegar a imagem na mesma célula ou na célula anterior
          const celula = el.closest('td') || el.closest('tr');
          const img = celula ? celula.querySelector('img') : null;
          const imagem = img ? (img.src || img.getAttribute('data-src') || '') : '';
          return { nome, imagem };
        }).filter(t => t.nome.length > 8 && !visto.has(t.nome));
        textos.forEach(t => visto.add(t.nome));
        pares.push(...textos);
        if (pares.length >= 5) break;
      }
    }
    if (pares.length >= 3) return pares.slice(0, 50);

    // Estratégia 3: pega qualquer link de produto da tabela
    const links = document.querySelectorAll('table a, [class*="table"] a, [class*="list"] a');
    for (const link of links) {
      const nome = link.textContent.trim();
      if (nome.length > 8 && !visto.has(nome)) {
        visto.add(nome);
        const img = link.querySelector('img') || link.closest('tr')?.querySelector('img');
        pares.push({ nome, imagem: img ? (img.src || '') : '' });
      }
    }
    return pares.slice(0, 50);
  });

  // Normaliza: converte strings antigas para objetos { nome, imagem }
  produtos = produtos.map(p => typeof p === 'string' ? { nome: p, imagem: '' } : p);

  produtos = produtos.filter(p => isProdutoValido(p.nome));
  console.log(`   📦 ${produtos.length} itens encontrados na página antes do filtro.`);

  if (produtos.length === 0) {
    console.log('\n   ⚠️  Não encontrei produtos automaticamente.');
    console.log('   👉 Role a página até ver a lista de produtos e digite  continuar  para tentar de novo.');
    await aguardarComando('continuar');

    const nomes = await pagina.evaluate(() => {
      const todos = document.querySelectorAll('td, [class*="name"], a');
      return Array.from(todos).map(el => el.textContent.trim())
        .filter(t => t.length > 15 && t.length < 200).slice(0, 50);
    });
    produtos = nomes.map(n => ({ nome: n, imagem: '' })).filter(p => isProdutoValido(p.nome));
  }

  // SOMENTE roupas femininas — nunca aceita bicicleta, eletrônico, produto masculino etc.
  const roupasFemininas = produtos.filter(p => isProdutoRoupa(p.nome) && !produtoJaUsado(p.nome));
  // Se todos já foram usados nos 30 dias, aceita repetir (mas só roupas femininas)
  const roupasFemininasComRepetidas = produtos.filter(p => isProdutoRoupa(p.nome));

  const qtd = quantidade || CONFIG.quantidadeDeVideos;
  const listaPriorizada = roupasFemininas.length > 0
    ? roupasFemininas
    : roupasFemininasComRepetidas; // fallback: repete produto já usado, mas nunca aceita não-roupa

  ESTADO.produtosEncontrados = listaPriorizada.slice(0, qtd);

  if (roupasFemininas.length > 0) {
    console.log(`   👗 ${roupasFemininas.length} produto(s) de roupa feminina encontrado(s).`);
  } else if (roupasFemininasComRepetidas.length > 0) {
    console.log(`   ⚠️  Todos os produtos já foram usados recentemente — repetindo ${roupasFemininasComRepetidas.length} produto(s) de roupa feminina.`);
  } else {
    console.log('   ❌ Nenhuma roupa feminina encontrada na página.');
    console.log('   💡 Dica: role até ver a lista de produtos e aplique o filtro "Womenswear" manualmente no Kalodata.');
  }

  await pagina.close();

  if (ESTADO.produtosEncontrados.length === 0) {
    console.log('\n   ❌ Nenhum produto encontrado. Tente novamente.');
    return;
  }

  console.log(`\n   ✅ ${ESTADO.produtosEncontrados.length} produto(s) encontrado(s):\n`);
  ESTADO.produtosEncontrados.forEach((p, i) => {
    const jaUsado = produtoJaUsado(p.nome) ? ' ⚠️ (já usado recentemente)' : '';
    const temFoto = p.imagem ? ' 📸' : '';
    console.log(`   ${i + 1}. ${p.nome.substring(0, 65)}${jaUsado}${temFoto}`);
  });
  console.log('\n   💡 Digite "gerar" para criar os vídeos agora.');
}


// ============================================================
// 🎬 COMANDO: gerar
// Gera vídeos no Gemini para os produtos encontrados
// ============================================================

async function cmdGerar(quantidade) {
  if (ESTADO.produtosEncontrados.length === 0) {
    console.log('\n   ⚠️  Nenhum produto em memória. Digite "analisar" primeiro.');
    return;
  }

  const qtd = quantidade || ESTADO.produtosEncontrados.length;
  const lista = ESTADO.produtosEncontrados.slice(0, qtd);

  console.log(`\n🎬 Gerando ${lista.length} vídeo(s)...\n`);

  await abrirNavegador();

  let gerados = 0;
  let falhas = 0;

  for (let i = 0; i < lista.length; i++) {
    const produto = lista[i];
    console.log(`${'─'.repeat(55)}`);
    const nomeProd = typeof produto === 'string' ? produto : produto.nome;
    console.log(`🎬 Vídeo ${i + 1} de ${lista.length}: "${nomeProd.substring(0, 50)}"`);
    console.log('─'.repeat(55));

    const ok = await gerarVideoGemini(produto, i + 1);
    registrarNoHistorico(nomeProd, ok);

    if (ok) gerados++;
    else falhas++;

    // Remove da lista de pendentes
    ESTADO.produtosEncontrados = ESTADO.produtosEncontrados.filter(p => p !== produto);

    if (i < lista.length - 1) {
      console.log('   ⏸️  Aguardando 15s antes do próximo...');
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  const historico = carregarHistorico();
  console.log('\n' + '='.repeat(55));
  console.log('   🏁 GERAÇÃO CONCLUÍDA!');
  console.log(`   ✅ Gerados: ${gerados} | ❌ Falhas: ${falhas}`);
  console.log(`   📊 Total histórico: ${historico.totalVideos} vídeos`);
  console.log('='.repeat(55));

  await notificarTelegram(
    `🎬 <b>Vídeos gerados!</b>\n✅ ${gerados} gerados\n❌ ${falhas} falhas\n📊 Total: ${historico.totalVideos}`
  );

  // Salva relatório
  const data = new Date().toISOString().split('T')[0];
  const rel = `=== RELATÓRIO ${data} ===\nGerados: ${gerados} | Falhas: ${falhas}\n\nProdutos:\n${lista.map((p, i) => `${i+1}. ${p}`).join('\n')}`;
  fs.writeFileSync(path.join(CONFIG.arquivos.relatorios, `relatorio_${data}.txt`), rel);
  console.log(`\n   📊 Relatório salvo em /relatorios/relatorio_${data}.txt`);
}

// Função interna que gera um vídeo no Gemini
// produto pode ser string (legado) ou { nome, imagem }
async function gerarVideoGemini(produto, numero) {
  // Normaliza para objeto
  const prod = typeof produto === 'string' ? { nome: produto, imagem: '' } : produto;

  const pagina = await ESTADO.contexto.newPage();
  try {
    await pagina.goto('https://gemini.google.com', { waitUntil: 'load', timeout: 60000 });
    await pagina.waitForTimeout(4000);

    // Verifica login
    const logado = await pagina.evaluate(() => {
      const t = document.body.innerText.toLowerCase();
      return !t.includes('fazer login') && !t.includes('sign in');
    });

    if (!logado) {
      console.log('   ⚠️  Gemini pediu login. Faça login no navegador.');
      console.log('   👉 Depois digite  continuar  aqui.');
      await aguardarComando('continuar');
    } else {
      console.log('   ✅ Gemini pronto.');
    }

    // Se tiver imagem do produto, baixa e sobe como anexo para o Gemini ver a peça exata
    if (prod.imagem) {
      try {
        console.log('   📸 Enviando foto do produto para o Gemini analisar...');
        // Baixa a imagem
        const imgResp = await pagina.request.get(prod.imagem);
        const imgBuffer = await imgResp.body();
        const imgPath = path.join(CONFIG.arquivos.screenshots, `produto_temp_${numero}.jpg`);
        fs.writeFileSync(imgPath, imgBuffer);

        // Clica no botão de anexar arquivo do Gemini
        const btnAnexar = pagina.locator('[aria-label*="Upload"], [aria-label*="Attach"], [aria-label*="Anexar"], [data-tooltip*="upload"]').first();
        await btnAnexar.click({ timeout: 5000 });
        await pagina.waitForTimeout(1000);

        // Sobe a imagem
        const fileInput = pagina.locator('input[type="file"]').first();
        await fileInput.setInputFiles(imgPath);
        await pagina.waitForTimeout(2000);
        console.log('   ✅ Foto do produto enviada.');
      } catch {
        console.log('   ⚠️  Não foi possível enviar a foto — gerando só pelo nome.');
      }
    }

    // Monta prompt adaptado ao tipo de roupa
    const prompt = montarPrompt(prod.nome);

    // Cola o prompt via clipboard do sistema operacional (evita restrições do Trusted Types)
    const campo = pagina.locator('[contenteditable="true"], textarea, [role="textbox"]').first();
    await campo.click({ timeout: 10000 });
    await pagina.waitForTimeout(500);

    // Escreve o prompt no clipboard do SO e cola com Ctrl+V
    await pagina.evaluate(async (texto) => {
      try {
        await navigator.clipboard.writeText(texto);
      } catch {
        // fallback silencioso — o Ctrl+V abaixo resolve
      }
    }, prompt);
    await pagina.waitForTimeout(200);
    await pagina.keyboard.press('Control+a'); // seleciona tudo que tiver no campo
    await pagina.keyboard.press('Control+v'); // cola
    await pagina.waitForTimeout(500);

    // Verifica se o texto foi inserido; se não, usa execCommand sem innerHTML
    const textoNoCampo = await pagina.evaluate(() => document.activeElement?.innerText || '');
    if (!textoNoCampo.includes('Generate')) {
      // Último recurso: digita rápido com fill (funciona em algumas versões do Gemini)
      await campo.fill(prompt);
      await pagina.waitForTimeout(500);
    }

    try {
      await pagina.locator('button[aria-label*="Send"], button[aria-label*="Enviar"]').first().click({ timeout: 8000 });
    } catch {
      await pagina.keyboard.press('Enter');
    }
    console.log('   🚀 Prompt enviado. Aguardando vídeo...');

    // Aguarda geração
    const inicio = Date.now();
    let ok = false;
    while (Date.now() - inicio < CONFIG.tempoMaximoPorVideo) {
      const seg = Math.floor((Date.now() - inicio) / 1000);
      process.stdout.write(`   ⏱️  ${seg}s\r`);
      ok = await pagina.evaluate(() => {
        const t = document.body.innerText.toLowerCase();
        return t.includes('your video is ready') || t.includes('video is ready') ||
               t.includes('vídeo está pronto') || document.querySelector('video') !== null;
      }).catch(() => false);
      if (ok) { console.log(`\n   🎉 Vídeo ${numero} gerado!`); break; }
      await pagina.waitForTimeout(5000);
    }

    if (!ok) console.log(`\n   ⚠️  Tempo esgotado para o vídeo ${numero}.`);

    // Screenshot
    const arquivo = path.join(CONFIG.arquivos.screenshots, `video_${Date.now()}_${numero}.png`);
    await pagina.screenshot({ path: arquivo, fullPage: true });
    console.log(`   📸 Print: ${arquivo}`);

    return ok;
  } catch (e) {
    console.error(`   ❌ Erro: ${e.message}`);
    return false;
  } finally {
    await pagina.close();
  }
}

// Monta o prompt do vídeo — cirúrgico e focado no produto
function montarPrompt(produto) {
  const p = produto.toLowerCase();

  // Modelo feminino: loira, olhos claros, pele branca, corpo mediano
  const modeloF = `young Brazilian woman, straight blonde hair, light eyes, fair skin, medium build`;
  // Modelo masculino: cabelo preto curto, pele branca, barba feita
  const modeloM = `young Brazilian man, short black hair, fair skin, clean-shaven, average athletic build`;

  const eMasculino = ['masculino','masculina','homem',' men ','male','terno','gravata','paletó'].some(w => p.includes(w));
  const modelo = eMasculino ? modeloM : modeloF;

  // ---- CENA E AÇÃO POR TIPO DE PRODUTO ----
  let cena, acao, pov, fala;

  if (p.includes('bolsa') || p.includes('clutch') || p.includes('tote') || p.includes('bag')) {
    cena = `outfit mirror selfie in a cozy bedroom`;
    acao = `holds the bag naturally on her shoulder/hand, shows the bag from front and side, opens it briefly to show inside`;
    pov  = `POV: essa bolsa combina com tudo no meu look 👜`;
    fala = `Gente, essa bolsa é perfeita! Fica incrível em qualquer look. Link na bio!`;

  } else if (p.includes('sandália') || p.includes('scarpin') || p.includes('sapato') || p.includes('rasteirinha') || p.includes('salto') || p.includes('sapatilha')) {
    cena = `sitting on bed edge, feet visible, cozy bedroom`;
    acao = `shows the shoes from front, turns foot to show the side, stands up briefly showing full look with the shoes`;
    pov  = `POV: esse sapato valoriza demais qualquer look 👠`;
    fala = `Olha que lindo! Esse sapato eleva qualquer look na hora. Link na bio!`;

  } else if (p.includes('tênis')) {
    cena = `mirror selfie showing full body, casual bedroom`;
    acao = `lifts one foot slightly to show the sneaker, turns sideways showing both shoes`;
    pov  = `POV: esse tênis virou meu favorito do dia a dia 👟`;
    fala = `Esse tênis é tudo! Confortável e estiloso. Link na bio!`;

  } else if (p.includes('vestido') || p.includes('dress')) {
    cena = `full body mirror selfie in a bright cozy bedroom`;
    acao = `does one slow natural spin to show the dress flow, stops facing the mirror, smiles softly`;
    pov  = `POV: achei o vestido perfeito e não largo mais 😍`;
    fala = `Não aguento, que vestido lindo! Fica incrível. Corre que esgota. Link na bio!`;

  } else if (p.includes('legging') || p.includes('calça')) {
    cena = `full body mirror selfie in a cozy bedroom`;
    acao = `slowly runs both hands along the sides of the pants to show the fit, turns sideways to show the silhouette, faces forward again`;
    pov  = `POV: essa calça valoriza demais o corpo 🔥`;
    fala = `Essa calça valoriza demais! Fica incrível no corpo. Link na bio!`;

  } else if (p.includes('saia') || p.includes('skirt')) {
    cena = `full body mirror selfie in a cozy bedroom`;
    acao = `gently sways hips to show how the skirt moves, poses sideways, smiles at reflection`;
    pov  = `POV: me sinto a personagem principal com essa saia 👑`;
    fala = `Essa saia é perfeita! Me sinto incrível com ela. Link na bio!`;

  } else if (p.includes('jaqueta') || p.includes('casaco') || p.includes('puffer') || p.includes('jacket')) {
    cena = `full body mirror selfie in a cozy bedroom`;
    acao = `opens the jacket to show the outfit underneath, closes it, turns sideways showing the silhouette`;
    pov  = `POV: essa jaqueta completa qualquer look 🧥`;
    fala = `Essa jaqueta é tudo! Quente e estilosa. Aproveita, link na bio!`;

  } else if (p.includes('blusa') || p.includes('camiseta') || p.includes('cropped') || p.includes('top') || p.includes('regata')) {
    cena = `upper body mirror selfie in a cozy bedroom`;
    acao = `lightly tucks the hem to show the fit, tilts head to one side, smiles naturally`;
    pov  = `POV: essa blusa combina com tudo no guarda-roupa ✨`;
    fala = `Amei essa blusa! Fica incrível e combina com tudo. Link na bio!`;

  } else if (p.includes('conjunto')) {
    cena = `full body mirror selfie in a cozy bedroom`;
    acao = `shows the full outfit front, turns sideways, adjusts the top slightly`;
    pov  = `POV: comprei esse conjunto e me sinto imparável 💫`;
    fala = `Esse conjunto é perfeito! Me sinto incrível. Corre, link na bio!`;

  } else if (p.includes('macacão')) {
    cena = `full body mirror selfie in a cozy bedroom`;
    acao = `shows the full outfit, does a slow turn, shows the back, faces forward again`;
    pov  = `POV: esse macacão ficou melhor do que eu esperava 😍`;
    fala = `Gente, esse macacão é tudo! Fica lindo. Link na bio!`;

  } else {
    // Genérico feminino
    cena = `full body mirror selfie in a cozy bedroom`;
    acao = `shows the item front, turns sideways, adjusts it slightly, smiles at the mirror`;
    pov  = `POV: achei a peça perfeita e agora não largo mais 😍`;
    fala = `Gente, olha que lindo! Amei demais. Link na bio!`;
  }

  // Para masculino, sobrescreve fala e POV
  if (eMasculino) {
    pov  = `POV: esse look ficou melhor do que eu esperava 🔥`;
    fala = `Olha como ficou! Incrível. Aproveita, link na bio!`;
  }

  // ---- MONTA O PROMPT FINAL — curto e direto ----
  return (
    `Vertical 9:16 TikTok video. NO watermark anywhere in the video.\n` +
    `Person: ${modelo}.\n` +
    `Product being shown: "${produto}". Show THIS exact product — exact color, exact cut, exact details. Do NOT change or invent any detail.\n` +
    `Scene: ${cena}. Natural warm bedroom lighting.\n` +
    `Action: ${acao}. Movement is casual and natural, like a real person filming themselves — slight hand tremor on phone, natural breathing, relaxed posture. NOT a photoshoot.\n` +
    `Text overlay at top of screen, bold white letters with shadow: "${pov}"\n` +
    `Person speaks once in Brazilian Portuguese: "${fala}" — casual, spontaneous tone, NOT an ad.\n` +
    `Audio: soft ambient room sound. No music. Portuguese speech only.\n` +
    `CRITICAL: NO watermark, NO logo, NO brand text anywhere.`
  );
}


// ============================================================
// 📊 COMANDO: status
// Mostra produtos prontos para gerar vídeo
// ============================================================

function cmdStatus() {
  console.log('\n📋 STATUS DO AGENTE:\n');

  if (ESTADO.produtosEncontrados.length === 0) {
    console.log('   Nenhum produto em memória.');
    console.log('   → Digite "analisar" para buscar produtos no Kalodata.\n');
  } else {
    console.log(`   ${ESTADO.produtosEncontrados.length} produto(s) prontos para gerar vídeo:\n`);
    ESTADO.produtosEncontrados.forEach((p, i) => {
      const nome = typeof p === 'string' ? p : p.nome;
      const foto = (p.imagem) ? ' 📸' : '';
      console.log(`   ${i + 1}. ${nome.substring(0, 65)}${foto}`);
    });
    console.log('\n   → Digite "gerar" para criar os vídeos.');
    console.log(`   → Digite "gerar 3" para criar apenas 3 vídeos.\n`);
  }

  const historico = carregarHistorico();
  console.log(`   📊 Total de vídeos gerados até hoje: ${historico.totalVideos}`);
  console.log(`   🕐 Última execução: ${historico.ultimaExecucao ? new Date(historico.ultimaExecucao).toLocaleString('pt-BR') : 'Nunca'}\n`);
}


// ============================================================
// 📜 COMANDO: historico
// Mostra os últimos produtos usados
// ============================================================

function cmdHistorico() {
  const historico = carregarHistorico();

  if (historico.produtos.length === 0) {
    console.log('\n   📋 Histórico vazio — nenhum produto gerado ainda.\n');
    return;
  }

  console.log(`\n📜 HISTÓRICO (últimos 20 produtos):\n`);
  const ultimos = historico.produtos.slice(-20).reverse();
  ultimos.forEach((p, i) => {
    const data = new Date(p.data).toLocaleDateString('pt-BR');
    const status = p.videoGerado ? '✅' : '❌';
    console.log(`   ${i + 1}. ${status} ${data} — ${p.nome.substring(0, 55)}`);
  });
  console.log(`\n   Total: ${historico.totalVideos} vídeos gerados\n`);
}


// ============================================================
// 📄 COMANDO: relatorio
// Mostra o relatório do dia atual
// ============================================================

function cmdRelatorio() {
  const data = new Date().toISOString().split('T')[0];
  const arquivo = path.join(CONFIG.arquivos.relatorios, `relatorio_${data}.txt`);

  if (!fs.existsSync(arquivo)) {
    console.log(`\n   📄 Nenhum relatório para hoje (${data}) ainda.\n`);
    return;
  }

  console.log('\n' + fs.readFileSync(arquivo, 'utf8'));
}


// ============================================================
// ⏰ COMANDO: agendar HH:MM
// Agenda execução automática diária
// ============================================================

function cmdAgendar(horario) {
  if (!horario || !/^\d{2}:\d{2}$/.test(horario)) {
    console.log('\n   ⚠️  Formato inválido. Use: agendar 09:00\n');
    return;
  }

  if (ESTADO.agendamento) {
    clearTimeout(ESTADO.agendamento);
    ESTADO.agendamento = null;
  }

  const [hora, minuto] = horario.split(':').map(Number);

  function agendarProxima() {
    const agora = new Date();
    const proxima = new Date();
    proxima.setHours(hora, minuto, 0, 0);
    if (proxima <= agora) proxima.setDate(proxima.getDate() + 1);

    const ms = proxima - agora;
    const h = Math.floor(ms / 1000 / 60 / 60);
    const m = Math.floor((ms / 1000 / 60) % 60);

    console.log(`\n   ⏰ Agendado para ${proxima.toLocaleString('pt-BR')} (em ${h}h ${m}min)`);
    console.log('   ℹ️  Deixe o terminal aberto. Use "parar agendamento" para cancelar.\n');

    ESTADO.agendamento = setTimeout(async () => {
      console.log('\n🔔 Horário agendado! Iniciando execução automática...\n');
      await cmdAnalisar();
      await cmdGerar();
      agendarProxima(); // Agenda o próximo dia
    }, ms);
  }

  agendarProxima();
}


// ============================================================
// 🧹 COMANDO: limpar historico
// ============================================================

function cmdLimparHistorico() {
  salvarHistorico({ produtos: [], totalVideos: 0, ultimaExecucao: null });
  ESTADO.produtosEncontrados = [];
  console.log('\n   ✅ Histórico limpo com sucesso.\n');
}


// ============================================================
// ❓ COMANDO: ajuda
// ============================================================

function cmdAjuda() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║          AGENTE TIKTOK SHOP — COMANDOS               ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  analisar           Busca produtos no Kalodata       ║
║  analisar 5         Busca apenas 5 produtos          ║
║                                                      ║
║  gerar              Gera vídeos de todos os produtos ║
║  gerar 3            Gera apenas 3 vídeos             ║
║                                                      ║
║  status             Mostra produtos na memória       ║
║  historico          Mostra produtos já usados        ║
║  relatorio          Mostra relatório do dia          ║
║                                                      ║
║  agendar 09:00      Agenda execução diária às 9h     ║
║  parar agendamento  Cancela o agendamento            ║
║                                                      ║
║  limpar historico   Limpa o histórico de produtos    ║
║  fechar navegador   Fecha o navegador                ║
║  ajuda              Mostra estes comandos            ║
║  sair               Encerra o agente                 ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
`);
}


// ============================================================
// 📱 TELEGRAM
// ============================================================

async function notificarTelegram(mensagem) {
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) return;
  const corpo = JSON.stringify({ chat_id: CONFIG.telegramChatId, text: mensagem, parse_mode: 'HTML' });
  return new Promise(resolve => {
    const req = https.request(`https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) },
    }, () => resolve());
    req.on('error', () => resolve());
    req.write(corpo);
    req.end();
  });
}


// ============================================================
// 🔧 UTILITÁRIOS
// ============================================================

// Aguarda um comando específico via readline (não bloqueia o terminal)
// Usado para pausas onde o usuário precisa fazer algo no navegador
let _resolverComando = null;
let _comandoEsperado = null;

function aguardarComando(cmd) {
  _comandoEsperado = cmd;
  return new Promise(resolve => { _resolverComando = resolve; });
}

function esperarEnter() {
  return new Promise(resolve => {
    process.stdin.resume();
    process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
  });
}


// ============================================================
// 💬 INTERFACE DE COMANDOS NO TERMINAL
// ============================================================

async function iniciarInterface() {
  inicializar();

  // Cabeçalho
  console.log('\n' + '='.repeat(55));
  console.log('   🤖 AGENTE TIKTOK SHOP v6.0');
  console.log('   Gerador automático de vídeos com IA');
  console.log('='.repeat(55));
  console.log('   Digite "ajuda" para ver os comandos disponíveis.');
  console.log('   Digite "analisar" para começar.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  rl.prompt();

  rl.on('line', async (linha) => {
    const cmd = linha.trim().toLowerCase();
    const partes = cmd.split(' ');
    const comando = partes[0];
    const argumento = partes[1];

    // Se está esperando um comando específico (ex: "continuar"), resolve a promessa
    if (_comandoEsperado && cmd === _comandoEsperado) {
      _comandoEsperado = null;
      const resolver = _resolverComando;
      _resolverComando = null;
      resolver();
      rl.prompt();
      return;
    }

    try {
      if (comando === 'analisar') {
        await cmdAnalisar(argumento ? parseInt(argumento) : null);

      } else if (comando === 'gerar') {
        await cmdGerar(argumento ? parseInt(argumento) : null);

      } else if (comando === 'status') {
        cmdStatus();

      } else if (comando === 'historico') {
        cmdHistorico();

      } else if (comando === 'relatorio') {
        cmdRelatorio();

      } else if (comando === 'agendar') {
        cmdAgendar(argumento);

      } else if (cmd === 'parar agendamento') {
        if (ESTADO.agendamento) {
          clearTimeout(ESTADO.agendamento);
          ESTADO.agendamento = null;
          console.log('\n   ✅ Agendamento cancelado.\n');
        } else {
          console.log('\n   ℹ️  Nenhum agendamento ativo.\n');
        }

      } else if (cmd === 'limpar historico') {
        cmdLimparHistorico();

      } else if (cmd === 'fechar navegador') {
        await fecharNavegador();

      } else if (comando === 'ajuda' || comando === 'help') {
        cmdAjuda();

      } else if (comando === 'sair' || comando === 'exit') {
        console.log('\n   👋 Encerrando o agente...\n');
        await fecharNavegador();
        process.exit(0);

      } else if (cmd === '') {
        // Linha em branco — não faz nada

      } else {
        console.log(`\n   ❓ Comando não reconhecido: "${cmd}"`);
        console.log('   Digite "ajuda" para ver os comandos disponíveis.\n');
      }

    } catch (e) {
      console.error(`\n   ❌ Erro ao executar comando: ${e.message}\n`);
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    await fecharNavegador();
    process.exit(0);
  });
}

// Inicia a interface
iniciarInterface().catch(console.error);
