const express = require('express');
const axios = require('axios').default;
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const app = express();
const PORT = process.env.PORT || 3000;

const USUARIO = 'newstorerj';
const SENHA = 'Ggjt7017+@';
const LOGIN_URL = 'https://cas.correios.com.br/login?service=https%3A%2F%2Fportalimportador.correios.com.br%2Fpages%2FpesquisarRemessaImportador%2FpesquisarRemessaImportador.jsf';
const PORTAL_URL = 'https://portalimportador.correios.com.br/pages/pesquisarRemessaImportador/pesquisarRemessaImportador.jsf';
const RASTREIO_URL = 'https://proxyapp.correios.com.br/v1/sro-rastro/';

app.get('/', (req, res) => res.json({ status: 'ok' }));

// Endpoint de rastreamento (contorna bloqueio de IP do Google)
app.get('/rastrear/:codigo', async (req, res) => {
  const { codigo } = req.params;
  try {
    const response = await axios.get(RASTREIO_URL + codigo, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });
    return res.json(response.data);
  } catch (err) {
    console.error('Erro rastreio:', err.message);
    return res.status(500).json({ erro: err.message });
  }
});

// Endpoint de boleto (login no portal importador)
app.get('/boleto/:codigo', async (req, res) => {
  const { codigo } = req.params;
  try {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true }));

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9'
    };

    const r1 = await client.get(LOGIN_URL, { headers });
    const html1 = r1.data;
    const lt = (html1.match(/name="lt"\s+value="([^"]+)"/) || [])[1] || '';
    const execution = (html1.match(/name="execution"\s+value="([^"]+)"/) || [])[1] || 'e1s1';

    const p1 = new URLSearchParams();
    p1.append('username', USUARIO);
    p1.append('password', SENHA);
    p1.append('lt', lt);
    p1.append('execution', execution);
    p1.append('_eventId', 'submit');
    await client.post(LOGIN_URL, p1.toString(), { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' } });

    const p2 = new URLSearchParams();
    p2.append('form-pesquisarRemessas', 'form-pesquisarRemessas');
    p2.append('form-pesquisarRemessas:codigoObjeto', codigo);
    p2.append('form-pesquisarRemessas:comandoPesquisar', 'form-pesquisarRemessas:comandoPesquisar');
    p2.append('javax.faces.ViewState', 'stateless');
    const r3 = await client.post(PORTAL_URL, p2.toString(), { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' } });

    const html3 = r3.data;

    if ((html3.match(/Total de Registros/g) || []).length >= 2)
      return res.status(503).json({ erro: 'TRAVADO' });

    const valorMatch = html3.match(/R\$\s*([\d.,]+)/i);
    const boletoMatch = html3.match(/(\d{5}\.\d{5}\s\d{5}\.\d{6}\s\d{5}\.\d{6}\s\d\s\d{14})|(\d{47,48})/);
    const valor = valorMatch ? 'R$ ' + valorMatch[1] : '';
    const boleto = boletoMatch ? boletoMatch[0].replace(/\s/g, '') : '';

    return res.json({ codigo, valor, boleto, travado: false });
  } catch (err) {
    console.error('Erro:', err.message);
    return res.status(500).json({ erro: err.message });
  }
});

app.listen(PORT, () => console.log('Proxy rodando na porta ' + PORT));
