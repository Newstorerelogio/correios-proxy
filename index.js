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

app.get('/', (req, res) => res.json({ status: 'ok' }));

// Endpoint de rastreamento usando API pública dos Correios (SRO)
app.get('/rastrear/:codigo', async (req, res) => {
  const { codigo } = req.params;
  try {
    // Tenta API pública dos Correios
    const response = await axios.post(
      'https://api.correios.com.br/srorastro/v1/objetos',
      { codObjeto: [codigo] },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 30000
      }
    );
    return res.json(response.data);
  } catch (err1) {
    // Fallback: tenta outro endpoint
    try {
      const response2 = await axios.get(
        `https://www.linketrack.com/track/json?user=teste&token=1abcd01234567890123456789012345678901234&codigo=${codigo}`,
        { timeout: 30000 }
      );
      // Converter para formato esperado pelo Apps Script
      const data = response2.data;
      const eventos = (data.eventos || []).map(e => ({
        descricao: e.status || '',
        dtHrCriado: e.data ? e.data + ' ' + (e.hora || '') : '',
        dtHrOcorrido: e.data ? e.data + ' ' + (e.hora || '') : '',
        unidade: { endereco: { cidade: e.local || '' } }
      }));
      return res.json({
        objetos: [{
          codObjeto: codigo,
          eventos: eventos
        }]
      });
    } catch (err2) {
      // Fallback final: buscar direto no site dos Correios
      try {
        const response3 = await axios.get(
          `https://rastreamento.correios.com.br/app/resultado.php?objeto=${codigo}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
              'Accept': 'application/json, text/plain, */*',
              'Referer': 'https://rastreamento.correios.com.br/'
            },
            timeout: 30000
          }
        );
        const d = response3.data;
        if (d && d.objetos) return res.json(d);
        return res.json({ objetos: [] });
      } catch (err3) {
        console.error('Todos os endpoints falharam:', err3.message);
        return res.status(500).json({ erro: err3.message });
      }
    }
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
    console.error('Erro boleto:', err.message);
    return res.status(500).json({ erro: err.message });
  }
});

app.listen(PORT, () => console.log('Proxy rodando na porta ' + PORT));
