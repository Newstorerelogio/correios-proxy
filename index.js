const express = require('express');
const axios = require('axios').default;
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const { wrapper: wrapperAxios } = require('axios-cookiejar-support');

const app = express();
const PORT = process.env.PORT || 3000;

const TWOCAPTCHA_KEY = 'b097c2c70ebbc16c98f23c89d4b4dc4f';
const BASE_URL = 'https://rastreamento.correios.com.br';
const USUARIO = 'newstorerj';
const SENHA = 'Ggjt7017+@';
const LOGIN_URL = 'https://cas.correios.com.br/login?service=https%3A%2F%2Fportalimportador.correios.com.br%2Fpages%2FpesquisarRemessaImportador%2FpesquisarRemessaImportador.jsf';
const PORTAL_URL = 'https://portalimportador.correios.com.br/pages/pesquisarRemessaImportador/pesquisarRemessaImportador.jsf';

app.get('/', (req, res) => res.json({ status: 'ok' }));

async function resolverCaptchaComSessao() {
  // Cria sessao com cookie jar para manter o mesmo session id
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar, withCredentials: true }));

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9'
  };

  // Passo 1: visitar a pagina principal para obter o cookie de sessao
  await client.get(BASE_URL + '/app/index.php', { headers });

  // Passo 2: baixar a imagem do captcha com o mesmo cookie de sessao
  const imgResp = await client.get(BASE_URL + '/core/securimage/securimage_show.php', {
    responseType: 'arraybuffer',
    headers: { ...headers, 'Referer': BASE_URL + '/app/index.php' }
  });
  const base64 = Buffer.from(imgResp.data).toString('base64');

  // Passo 3: enviar para 2captcha resolver
  const sendResp = await axios.post('https://2captcha.com/in.php', {
    key: TWOCAPTCHA_KEY,
    method: 'base64',
    body: base64,
    json: 1,
    min_len: 4,
    max_len: 8,
    language: 2
  });
  if (sendResp.data.status !== 1) throw new Error('2captcha envio: ' + JSON.stringify(sendResp.data));
  const captchaId = sendResp.data.request;

  // Passo 4: aguardar resolucao
  for (let t = 0; t < 24; t++) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await axios.get('https://2captcha.com/res.php?key=' + TWOCAPTCHA_KEY + '&action=get&id=' + captchaId + '&json=1');
    if (res.data.status === 1) {
      return { captchaText: res.data.request, client, headers };
    }
    if (res.data.request !== 'CAPCHA_NOT_READY') throw new Error('2captcha: ' + res.data.request);
  }
  throw new Error('2captcha timeout');
}

app.get('/rastrear/:codigo', async (req, res) => {
  const { codigo } = req.params;
  try {
    const { captchaText, client, headers } = await resolverCaptchaComSessao();
    console.log('Captcha resolvido:', captchaText);

    const r = await client.get(BASE_URL + '/app/resultado.php', {
      params: { objeto: codigo, captcha: captchaText, mqs: 'S' },
      headers: { ...headers, 'Accept': 'application/json, text/plain, */*', 'Referer': BASE_URL + '/app/index.php' }
    });
    console.log('Rastreio status:', r.status, 'data:', JSON.stringify(r.data).substring(0, 200));
    return res.json(r.data);
  } catch (err) {
    console.error('Erro rastreio:', err.message);
    return res.status(500).json({ erro: err.message });
  }
});

app.get('/boleto/:codigo', async (req, res) => {
  const { codigo } = req.params;
  try {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true }));
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'pt-BR,pt;q=0.9'
    };
    const r1 = await client.get(LOGIN_URL, { headers });
    const html1 = r1.data;
    const lt = (html1.match(/name="lt"\s+value="([^"]+)"/) || [])[1] || '';
    const execution = (html1.match(/name="execution"\s+value="([^"]+)"/) || [])[1] || 'e1s1';
    const p1 = new URLSearchParams();
    p1.append('username', USUARIO); p1.append('password', SENHA);
    p1.append('lt', lt); p1.append('execution', execution); p1.append('_eventId', 'submit');
    await client.post(LOGIN_URL, p1.toString(), { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' } });
    const p2 = new URLSearchParams();
    p2.append('form-pesquisarRemessas', 'form-pesquisarRemessas');
    p2.append('form-pesquisarRemessas:codigoObjeto', codigo);
    p2.append('form-pesquisarRemessas:comandoPesquisar', 'form-pesquisarRemessas:comandoPesquisar');
    p2.append('javax.faces.ViewState', 'stateless');
    const r3 = await client.post(PORTAL_URL, p2.toString(), { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' } });
    const html3 = r3.data;
    if ((html3.match(/Total de Registros/g) || []).length >= 2) return res.status(503).json({ erro: 'TRAVADO' });
    const valorMatch = html3.match(/R\$\s*([\d.,]+)/i);
    const boletoMatch = html3.match(/(\d{5}\.\d{5}\s\d{5}\.\d{6}\s\d{5}\.\d{6}\s\d\s\d{14})|(\d{47,48})/);
    return res.json({ codigo, valor: valorMatch ? 'R$ ' + valorMatch[1] : '', boleto: boletoMatch ? boletoMatch[0].replace(/\s/g, '') : '', travado: false });
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
});

app.listen(PORT, () => console.log('Proxy rodando na porta ' + PORT));
