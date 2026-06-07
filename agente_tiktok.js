/**
 * =============================================================
 *   AGENTE COMPLETO DE VENDAS TIKTOK SHOP COM IA
 *   Versão 2.0 — Totalmente Automatizado
 * =============================================================
 *
 * 🎯 O QUE ESSE AGENTE FAZ:
 *   ✅ Busca os melhores produtos do dia no Kalodata
 *   ✅ Gera múltiplos vídeos de uma vez (você define quantos)
 *   ✅ Nunca repete o mesmo produto (salva histórico)
 *   ✅ Roda automaticamente todo dia no horário que você definir
 *   ✅ Envia notificação no seu celular quando terminar
 *   ✅ Salva relatório do dia com todos os produtos e status
 *
 * ⚙️  CONFIGURAÇÕES:
 *   Edite o bloco CONFIGURAÇÕES abaixo para personalizar o agente.
 *
 * ▶️  COMO RODAR:
 *   Uma única vez (manual):
 *     node agente_tiktok.js
 *
 *   Todo dia automaticamente (deixa rodando em segundo plano):
 *     node agente_tiktok.js --agendar
 * =============================================================
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');


// ============================================================
// ⚙️  CONFIGURAÇÕES — EDITE AQUI CONFORME SUA NECESSIDADE
// ============================================================

const CONFIG = {

  // Quantos vídeos gerar por vez (um para cada produto diferente)
  // Recomendado: 3 por dia para não sobrecarregar o Gemini
  quantidadeDeVideos: 3,

  // Horário para rodar automaticamente todo dia (formato 24h)
  // Exemplo: '09:00' roda às 9h da manhã todo dia
  horarioAutomatico: '09:00',

  // Tempo máximo para aguardar cada vídeo ser gerado (em milissegundos)
  // 180000 = 3 minutos. Aumente se o Gemini demorar mais.
  tempoMaximoPorVideo: 180000,

  // Token do Telegram para receber notificações no celular
  // Deixe em branco ('') se não quiser notificações
  // Veja como configurar no final deste arquivo
  telegramToken: '',
  telegramChatId: '',

  // Pasta onde ficam salvos os dados do agente
  pastasDados: {
    perfil: './perfil_navegador',      // Login do navegador
    historico: './historico.json',     // Produtos já usados
    relatorios: './relatorios',        // Relatório de cada dia
    screenshots: './screenshots',      // Prints dos vídeos gerados
  }

};


// ============================================================
// 📁 INICIALIZAÇÃO — Cria as pastas e arquivos necessários
// ============================================================

function inicializar() {
  // Cria as pastas que o agente vai usar
  const pastas = [
    CONFIG.pastasDados.perfil,
    CONFIG.pastasDados.relatorios,
    CONFIG.pastasDados.screenshots,
  ];

  for (const pasta of pastas) {
    if (!fs.existsSync(pasta)) {
      fs.mkdirSync(pasta, { recursive: true });
      console.log(`   📁 Pasta criada: ${pasta}`);
    }
  }

  // Cria o arquivo de histórico se não existir
  if (!fs.existsSync(CONFIG.pastasDados.historico)) {
    fs.writeFileSync(CONFIG.pastasDados.historico, JSON.stringify({
      produtos: [],           // Lista de produtos já gerados
      totalVideos: 0,         // Total de vídeos gerados até hoje
      ultimaExecucao: null,   // Data da última execução
    }, null, 2));
    console.log('   📋 Arquivo de histórico criado.');
  }
}


// ============================================================
// 📋 HISTÓRICO — Controla produtos já usados para não repetir
// ============================================================

function carregarHistorico() {
  const dados = fs.readFileSync(CONFIG.pastasDados.historico, 'utf8');
  return JSON.parse(dados);
}

function salvarHistorico(historico) {
  fs.writeFileSync(CONFIG.pastasDados.historico, JSON.stringify(historico, null, 2));
}

function produtoJaFoiUsado(historico, nomeProduto) {
  // Verifica se o produto já foi usado nos últimos 30 dias
  const trintaDiasAtras = Date.now() - (30 * 24 * 60 * 60 * 1000);
  return historico.produtos.some(p =>
    p.nome.toLowerCase() === nomeProduto.toLowerCase() &&
    new Date(p.data).getTime() > trintaDiasAtras
  );
}

function registrarProdutoNoHistorico(historico, nomeProduto, videoGerado) {
  historico.produtos.push({
    nome: nomeProduto,
    data: new Date().toISOString(),
    videoGerado: videoGerado,
  });
  historico.totalVideos += videoGerado ? 1 : 0;
  historico.ultimaExecucao = new Date().toISOString();
  salvarHistorico(historico);
}


// ============================================================
// 📊 RELATÓRIO — Salva um resumo de cada execução do agente
// ============================================================

function criarRelatorio() {
  const data = new Date().toISOString().split('T')[0]; // Ex: 2026-06-07
  return {
    data: data,
    inicio: new Date().toISOString(),
    fim: null,
    produtos: [],
    totalGerados: 0,
    totalErros: 0,
  };
}

function salvarRelatorio(relatorio) {
  relatorio.fim = new Date().toISOString();
  const nomeArquivo = path.join(
    CONFIG.pastasDados.relatorios,
    `relatorio_${relatorio.data}.json`
  );
  fs.writeFileSync(nomeArquivo, JSON.stringify(relatorio, null, 2));

  // Também salva uma versão legível em texto
  const nomeTexto = path.join(
    CONFIG.pastasDados.relatorios,
    `relatorio_${relatorio.data}.txt`
  );

  const duracao = Math.floor(
    (new Date(relatorio.fim) - new Date(relatorio.inicio)) / 1000 / 60
  );

  const texto = `
==========================================
  RELATÓRIO DO AGENTE TIKTOK SHOP
  Data: ${relatorio.data}
  Duração: ${duracao} minutos
==========================================

Total de vídeos gerados: ${relatorio.totalGerados}
Total de erros: ${relatorio.totalErros}

PRODUTOS PROCESSADOS:
${relatorio.produtos.map((p, i) => `
  ${i + 1}. ${p.nome}
     Status: ${p.videoGerado ? '✅ Vídeo gerado' : '❌ Falhou'}
     Horário: ${p.horario}
`).join('')}

==========================================
`;

  fs.writeFileSync(nomeTexto, texto);
  console.log(`\n   📊 Relatório salvo em: ${nomeArquivo}`);
}


// ============================================================
// 📱 NOTIFICAÇÕES — Envia mensagem no Telegram quando terminar
// ============================================================
// Como configurar o Telegram:
//   1. Abra o Telegram e procure por @BotFather
//   2. Digite /newbot e siga as instruções para criar seu bot
//   3. Copie o token gerado e cole em CONFIG.telegramToken
//   4. Procure por @userinfobot no Telegram
//   5. Digite /start para receber seu Chat ID
//   6. Cole o Chat ID em CONFIG.telegramChatId

async function enviarNotificacaoTelegram(mensagem) {
  // Se não tiver token configurado, pula a notificação
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) {
    return;
  }

  const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;
  const corpo = JSON.stringify({
    chat_id: CONFIG.telegramChatId,
    text: mensagem,
    parse_mode: 'HTML',
  });

  return new Promise((resolve) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(corpo),
      },
    }, (res) => {
      if (res.statusCode === 200) {
        console.log('   📱 Notificação enviada para o Telegram!');
      }
      resolve();
    });

    req.on('error', () => {
      console.log('   ⚠️  Não foi possível enviar notificação Telegram.');
      resolve();
    });

    req.write(corpo);
    req.end();
  });
}


// ============================================================
// 🛍️  ETAPA 1: Buscar MÚLTIPLOS produtos no Kalodata
// ============================================================

async function buscarProdutosKalodata(pagina, quantidade, historico) {
  console.log(`\n📦 Buscando os ${quantidade} melhores produtos no Kalodata...`);

  // Tenta carregar o Kalodata com timeout maior e fallback para 'load'
  try {
    await pagina.goto('https://www.kalodata.com/product', {
      waitUntil: 'networkidle',
      timeout: 60000  // 60 segundos
    });
  } catch {
    console.log('   ⚠️  Timeout no networkidle — tentando com load...');
    await pagina.goto('https://www.kalodata.com/product', {
      waitUntil: 'load',
      timeout: 60000
    });
  }
  await pagina.waitForTimeout(4000);

  // ---- Aguarda o Cloudflare liberar o acesso ----
  // O Kalodata usa Cloudflare que bloqueia bots — precisamos esperar a verificação passar
  // Fica verificando até a página de produtos aparecer de verdade (até 60 segundos)
  console.log('   ⏳ Verificando se o Cloudflare liberou o acesso...');
  let tentativas = 0;
  while (tentativas < 12) {
    const paginaLiberada = await pagina.evaluate(() => {
      const texto = document.body.innerText.toLowerCase();
      const bloqueado = texto.includes('verificando') ||
                        texto.includes('executando verificação') ||
                        texto.includes('checking') ||
                        texto.includes('just a moment') ||
                        texto.includes('verification');
      return !bloqueado;
    });

    if (paginaLiberada) {
      console.log('   ✅ Cloudflare liberou! Kalodata carregado.');
      break;
    }

    tentativas++;
    console.log(`   ⏳ Aguardando Cloudflare liberar... (${tentativas * 5}s)`);
    await pagina.waitForTimeout(5000);
  }

  if (tentativas >= 12) {
    console.log('   ⚠️  Cloudflare não liberou automaticamente.');
    console.log('   👉 Complete a verificação manualmente no navegador.');
    console.log('   👉 Depois pressione ENTER para continuar...');
    await esperarEnter();
  }

  await pagina.waitForTimeout(3000);

  // ---- Aplica filtro de DATA (últimos 7 dias) ----
  try {
    await pagina.locator('text=Last 7 days, text=Últimos 7 dias').first().click({ timeout: 6000 });
    await pagina.waitForTimeout(1500);
    console.log('   ✅ Filtro: Últimos 7 dias aplicado.');
  } catch {
    console.log('   ⚠️  Filtro de data não encontrado — continuando.');
  }

  // ---- Aplica filtro de CATEGORIA (Roupas Femininas) ----
  try {
    await pagina.locator('text=Category, text=Categoria').first().click({ timeout: 6000 });
    await pagina.waitForTimeout(1500);
    await pagina.locator('text=Womenswear, text=Roupas femininas, text=Women').first().click({ timeout: 6000 });
    await pagina.waitForTimeout(1000);
    await pagina.locator('text=Apply, text=Aplicar').first().click({ timeout: 6000 });
    await pagina.waitForTimeout(2000);
    console.log('   ✅ Filtro: Roupas Femininas aplicado.');
  } catch {
    console.log('   ⚠️  Filtro de categoria não aplicado automaticamente.');
  }

  // ---- Confirma os filtros ----
  try {
    await pagina.locator('text=Submit, text=Enviar, text=Search').first().click({ timeout: 6000 });
    await pagina.waitForTimeout(4000);
  } catch {
    await pagina.waitForTimeout(3000);
  }

  // ---- Coleta a lista de produtos ----
  console.log('   🔍 Coletando lista de produtos...');

  // Pega todos os elementos de produto visíveis na página
  const todosProdutos = await pagina.evaluate(() => {
    const elementos = document.querySelectorAll(
      '[class*="product-name"], [class*="product-title"], h3, h2'
    );
    return Array.from(elementos)
      .map(el => el.textContent.trim())
      .filter(texto => texto.length > 10) // Filtra textos muito curtos
      .slice(0, 20); // Pega os primeiros 20
  });

  if (todosProdutos.length === 0) {
    console.log('   ⚠️  Não encontrei produtos automaticamente.');
    console.log('   ℹ️  Por favor, aplique os filtros manualmente no navegador.');
    console.log('   ℹ️  Depois pressione ENTER para continuar...');
    await esperarEnter();

    // Tenta novamente após intervenção manual
    const produtosAposManual = await pagina.evaluate(() => {
      const elementos = document.querySelectorAll('h2, h3, [class*="title"]');
      return Array.from(elementos).map(el => el.textContent.trim()).filter(t => t.length > 10).slice(0, 20);
    });
    todosProdutos.push(...produtosAposManual);
  }

  // ---- Filtra produtos que já foram usados ----
  const produtosNovos = todosProdutos.filter(nome => !produtoJaFoiUsado(historico, nome));

  if (produtosNovos.length === 0) {
    console.log('   ⚠️  Todos os produtos já foram usados recentemente!');
    console.log('   ℹ️  Usando os mais antigos do histórico para não parar o agente...');
    // Se todos foram usados, pega os primeiros mesmo assim
    produtosNovos.push(...todosProdutos.slice(0, quantidade));
  }

  // Retorna a quantidade solicitada de produtos novos
  const selecionados = produtosNovos.slice(0, quantidade);
  console.log(`   ✅ ${selecionados.length} produtos selecionados (nenhum repetido):`);
  selecionados.forEach((p, i) => console.log(`      ${i + 1}. ${p.substring(0, 60)}...`));

  return selecionados;
}


// ============================================================
// 🤖 ETAPAS 2, 3 e 4: Gerar vídeo no Gemini para um produto
// ============================================================

async function gerarVideoParaProduto(contexto, produto, indice, total) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🎬 Gerando vídeo ${indice + 1} de ${total}: "${produto.substring(0, 50)}..."`);
  console.log('─'.repeat(60));

  const paginaGemini = await contexto.newPage();

  try {
    // ---- Abre o Gemini ----
    await paginaGemini.goto('https://gemini.google.com', { waitUntil: 'networkidle' });
    await paginaGemini.waitForTimeout(4000);

    // Verifica login
    try {
      await paginaGemini.waitForSelector(
        'img[aria-label*="Google Account"], [data-ogsr-up]',
        { timeout: 8000 }
      );
      console.log('   ✅ Logado no Google.');
    } catch {
      console.log('   ⚠️  Faça login no Google e pressione ENTER...');
      await esperarEnter();
    }

    // ---- Monta o prompt com o produto ----
    const prompt =
      `Generate a vertical 9:16 video for TikTok: ` +
      `Vertical mirror selfie in a bedroom with soft natural lighting. ` +
      `A young woman wearing ${produto} ` +
      `holds her phone in front of her face, filming her reflection in a full-length mirror. ` +
      `Full body frontal pose, slight weight shift, small clothing adjustment. ` +
      `She takes a small step toward the mirror with a light body sway to show how the clothing ` +
      `drapes and moves, then slowly turns to a side profile showing the silhouette of the outfit ` +
      `in the mirror. Relaxed, natural posture. Authentic TikTok fitting room style, ` +
      `UGC handheld creator style, natural lighting. ` +
      `Audio: soft bedroom ambient sound, light breathing, soft footsteps on floor, no speech, no music.`;

    // ---- Digita o prompt no Gemini ----
    const campoTexto = paginaGemini.locator(
      '[contenteditable="true"], textarea, [role="textbox"]'
    ).first();
    await campoTexto.click({ timeout: 10000 });
    await paginaGemini.waitForTimeout(500);
    await campoTexto.type(prompt, { delay: 10 });
    console.log('   ✅ Prompt digitado.');

    // ---- Envia o prompt ----
    try {
      await paginaGemini.locator(
        'button[aria-label*="Send"], button[aria-label*="Enviar"]'
      ).first().click({ timeout: 8000 });
    } catch {
      await paginaGemini.keyboard.press('Enter');
    }
    console.log('   🚀 Prompt enviado! Aguardando geração do vídeo...');

    // ---- Aguarda o vídeo ser gerado ----
    const inicio = Date.now();
    let videoGerado = false;

    while (Date.now() - inicio < CONFIG.tempoMaximoPorVideo) {
      const segundos = Math.floor((Date.now() - inicio) / 1000);
      process.stdout.write(`   ⏱️  Aguardando... ${segundos}s\r`);

      videoGerado = await paginaGemini.evaluate(() => {
        const texto = document.body.innerText.toLowerCase();
        return (
          texto.includes('your video is ready') ||
          texto.includes('vídeo está pronto') ||
          texto.includes('video is ready') ||
          document.querySelector('video') !== null
        );
      }).catch(() => false);

      if (videoGerado) {
        console.log(`\n   🎉 Vídeo ${indice + 1} gerado com sucesso!`);
        break;
      }

      await paginaGemini.waitForTimeout(5000);
    }

    if (!videoGerado) {
      console.log(`\n   ⚠️  Tempo máximo atingido para o vídeo ${indice + 1}.`);
    }

    // ---- Salva screenshot do resultado ----
    const nomeScreenshot = path.join(
      CONFIG.pastasDados.screenshots,
      `video_${Date.now()}_produto${indice + 1}.png`
    );
    await paginaGemini.screenshot({ path: nomeScreenshot, fullPage: true });
    console.log(`   📸 Print salvo: ${nomeScreenshot}`);

    return videoGerado;

  } catch (erro) {
    console.error(`   ❌ Erro ao gerar vídeo ${indice + 1}: ${erro.message}`);
    return false;
  } finally {
    // Fecha a aba do Gemini após terminar (para não acumular abas abertas)
    await paginaGemini.close();
  }
}


// ============================================================
// ⏰ AGENDAMENTO — Roda automaticamente todo dia no horário fixo
// ============================================================

function calcularProximaExecucao(horario) {
  const [hora, minuto] = horario.split(':').map(Number);
  const agora = new Date();
  const proxima = new Date();

  proxima.setHours(hora, minuto, 0, 0);

  // Se o horário de hoje já passou, agenda para amanhã
  if (proxima <= agora) {
    proxima.setDate(proxima.getDate() + 1);
  }

  return proxima;
}

async function agendarExecucaoDiaria() {
  console.log('\n' + '='.repeat(60));
  console.log('   ⏰ MODO AGENDAMENTO ATIVO');
  console.log('='.repeat(60));
  console.log(`   O agente vai rodar todo dia às ${CONFIG.horarioAutomatico}`);
  console.log('   Deixe este terminal aberto em segundo plano.');
  console.log('   Para parar, pressione CTRL+C\n');

  while (true) {
    const proxima = calcularProximaExecucao(CONFIG.horarioAutomatico);
    const agora = new Date();
    const msAteProxima = proxima - agora;
    const horasAte = Math.floor(msAteProxima / 1000 / 60 / 60);
    const minutosAte = Math.floor((msAteProxima / 1000 / 60) % 60);

    console.log(`   ⏳ Próxima execução: ${proxima.toLocaleString('pt-BR')}`);
    console.log(`   ⏳ Tempo até lá: ${horasAte}h ${minutosAte}min`);
    console.log('   (Aguardando...)\n');

    // Aguarda até o horário programado
    await new Promise(resolve => setTimeout(resolve, msAteProxima));

    // Roda o agente
    console.log('\n🔔 Horário programado atingido! Iniciando agente...');
    await executarAgente();
  }
}


// ============================================================
// 🚀 EXECUÇÃO PRINCIPAL DO AGENTE
// ============================================================

async function executarAgente() {
  const relatorio = criarRelatorio();
  const historico = carregarHistorico();

  console.log('\n' + '='.repeat(60));
  console.log(`   🤖 AGENTE TIKTOK SHOP — ${new Date().toLocaleString('pt-BR')}`);
  console.log('='.repeat(60));
  console.log(`   Vídeos a gerar hoje: ${CONFIG.quantidadeDeVideos}`);
  console.log(`   Total gerado até hoje: ${historico.totalVideos} vídeos\n`);

  // Inicia o navegador com perfil salvo
  const contexto = await chromium.launchPersistentContext(CONFIG.pastasDados.perfil, {
    headless: false,
    args: ['--start-maximized'],
    viewport: null,
  });

  console.log('   ✅ Navegador iniciado.\n');

  const paginaKalodata = await contexto.newPage();

  try {
    // ---- Busca os produtos do dia ----
    const produtos = await buscarProdutosKalodata(
      paginaKalodata,
      CONFIG.quantidadeDeVideos,
      historico
    );

    // ---- Gera um vídeo para cada produto ----
    for (let i = 0; i < produtos.length; i++) {
      const produto = produtos[i];
      const videoGerado = await gerarVideoParaProduto(contexto, produto, i, produtos.length);

      // Registra no histórico para não repetir
      registrarProdutoNoHistorico(historico, produto, videoGerado);

      // Adiciona ao relatório do dia
      relatorio.produtos.push({
        nome: produto,
        videoGerado: videoGerado,
        horario: new Date().toLocaleTimeString('pt-BR'),
      });

      if (videoGerado) relatorio.totalGerados++;
      else relatorio.totalErros++;

      // Aguarda 10 segundos entre vídeos para não sobrecarregar o Gemini
      if (i < produtos.length - 1) {
        console.log('\n   ⏸️  Aguardando 10 segundos antes do próximo vídeo...');
        await new Promise(r => setTimeout(r, 10000));
      }
    }

    // ---- Salva o relatório do dia ----
    salvarRelatorio(relatorio);

    // ---- Exibe resumo final ----
    console.log('\n' + '='.repeat(60));
    console.log('   🏁 AGENTE FINALIZADO — RESUMO DO DIA:');
    console.log('='.repeat(60));
    console.log(`   ✅ Vídeos gerados com sucesso: ${relatorio.totalGerados}`);
    console.log(`   ❌ Falhas: ${relatorio.totalErros}`);
    console.log(`   📊 Total histórico: ${historico.totalVideos} vídeos`);
    console.log(`   📁 Screenshots: pasta /screenshots`);
    console.log(`   📋 Relatório: pasta /relatorios`);
    console.log('='.repeat(60));

    // ---- Envia notificação no Telegram ----
    await enviarNotificacaoTelegram(
      `🎬 <b>Agente TikTok Shop finalizado!</b>\n\n` +
      `✅ Vídeos gerados: ${relatorio.totalGerados}\n` +
      `❌ Falhas: ${relatorio.totalErros}\n` +
      `📊 Total histórico: ${historico.totalVideos} vídeos\n\n` +
      `<b>Produtos de hoje:</b>\n` +
      relatorio.produtos.map((p, i) =>
        `${i + 1}. ${p.nome.substring(0, 40)}... ${p.videoGerado ? '✅' : '❌'}`
      ).join('\n')
    );

    console.log('\n   🌐 Navegador aberto para você baixar os vídeos.');
    console.log('   Pressione CTRL+C quando terminar.\n');

    // Mantém o navegador aberto para o usuário baixar os vídeos
    await new Promise(() => {});

  } catch (erro) {
    console.error(`\n❌ Erro geral no agente: ${erro.message}`);
    await enviarNotificacaoTelegram(`❌ Erro no Agente TikTok Shop: ${erro.message}`);
    salvarRelatorio(relatorio);

  } finally {
    await contexto.close();
  }
}


// ============================================================
// 🔧 UTILITÁRIOS
// ============================================================

function esperarEnter() {
  return new Promise(resolve => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}


// ============================================================
// ▶️  PONTO DE ENTRADA — Decide como iniciar o agente
// ============================================================

async function main() {
  // Inicializa pastas e arquivos necessários
  inicializar();

  // Verifica se foi passado o argumento --agendar
  const modoAgendamento = process.argv.includes('--agendar');

  if (modoAgendamento) {
    // Modo agendamento: roda todo dia no horário configurado
    await agendarExecucaoDiaria();
  } else {
    // Modo manual: roda uma vez agora
    await executarAgente();
  }
}

main().catch(console.error);
