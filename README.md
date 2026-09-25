# Rota Certa — planejador de rotas

Aplicativo para organizar as paradas do dia na **melhor ordem pelas ruas reais**
(1, 2, 3, 4…), sem ficar indo e voltando. Substitui apps pagos como o Zeo Route Planner.

- **Sem mensalidade e sem cadastro.** Usa serviços gratuitos (OpenStreetMap).
- Funciona no **celular e no computador**, e pode ser instalado na tela inicial.
- Os dados ficam salvos **no próprio aparelho**.

## Como usar

1. **Início:** toque em **📍 GPS** (sua localização) ou em **Mudar** e digite o endereço.
2. **Fim:** escolha *Voltar ao início*, *Terminar na última parada* ou *Terminar em outro endereço*.
3. **Adicione as paradas:**
   - digite o endereço, CEP ou coordenadas (ou fale no 🎤);
   - **📋 Colar lista:** um endereço por linha (`endereço | observação`);
   - **📄 Planilha:** Excel ou CSV (reconhece colunas como Endereço, Número, Bairro, Cidade, CEP, Latitude, Longitude, Observação, Telefone, Cliente);
   - **📷 Foto da lista:** tira foto de uma lista impressa e o app lê os endereços;
   - **🗺 No mapa:** toca no lugar exato.
4. Toque em **⚡ Otimizar rota**. As paradas ficam numeradas na melhor ordem.
5. Na rua: **🧭 Navegar** abre o Google Maps, Waze ou Apple Mapas. Depois toque em
   **✅ Feito** (com foto e anotação de comprovante) ou **❌ Não feito** (com o motivo).
6. **⤴ Enviar:** manda a rota para a equipe pelo WhatsApp (lista numerada + link que abre a rota no celular dela).
7. **⬇ Exportar planilha:** relatório com ordem, horários, situação e anotações.

### Precisão

- **Até 13 paradas** o app testa matematicamente todas as possibilidades e garante a **melhor ordem possível**.
- **Acima disso** usa um método de otimização que, nos testes, chega ao resultado ótimo ou a menos de 1% dele (em 1 a 4 segundos).
- As distâncias são **pelas ruas de verdade** (mão de rua incluída), não em linha reta.
- O maior risco de erro é o **endereço ser achado no lugar errado**. Por isso o app avisa
  quando não achou o número exato (marcador laranja). Confira no mapa e **arraste o marcador**
  para o lugar certo se precisar.
- Prioridade por parada: *Fazer primeiro* ou *Deixar para o final*.
- Se a rota já começou, **Otimizar** reorganiza só o que falta, a partir da última parada feita.

## Colocar no ar (grátis, com GitHub Pages)

1. Junte esta branch na `main`.
2. No GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, escolha `main` e a pasta `/ (root)`.
3. Em 1–2 minutos o app fica em `https://<seu-usuario>.github.io/Troca-de-cores/`.
4. No celular, abra o link e use **"Adicionar à tela inicial"** para instalar como app.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `index.html`, `app.css` | Tela |
| `app.js` | Busca de endereços, mapa, importação, execução da rota, envio |
| `solver.js` | Otimizador (cálculo da melhor ordem) |
| `sw.js`, `manifest.json`, `icon.svg` | Permitem instalar no celular |
| `tests/solver.test.js` | Testes do otimizador: `node tests/solver.test.js` |

## Serviços gratuitos usados

- Mapa: [OpenStreetMap](https://www.openstreetmap.org)
- Endereços: [Nominatim](https://nominatim.org) e [Photon](https://photon.komoot.io); CEP: [ViaCEP](https://viacep.com.br)
- Distâncias e trajeto: [OSRM](https://project-osrm.org)

São servidores públicos com limite de uso justo (ex.: 1 busca de endereço por segundo).
Isso é tranquilo para uma empresa pequena ou média. Se um dia o uso crescer muito, dá
para trocar por um servidor próprio ou pago sem mudar o resto do app.
