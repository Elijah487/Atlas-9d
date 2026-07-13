export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  }

  const { password, idToken } = req.body || {};
  if (!password || !idToken) {
    return res.status(400).json({ ok: false, error: 'Campos ausentes.' });
  }

  const DEV_PASSWORD = process.env.DEV_PASSWORD;
  if (!DEV_PASSWORD) {
    return res.status(500).json({ ok: false, error: 'Servidor mal configurado.' });
  }

  if (password !== DEV_PASSWORD) {
    return res.status(403).json({ ok: false, error: 'Senha incorreta.' });
  }

  try {
    // 1. Verificar idToken e pegar uid
    const apiKey = process.env.FIREBASE_API_KEY;
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    const verifyData = await verifyRes.json();
    if (!verifyData.users?.[0]?.localId) {
      return res.status(401).json({ ok: false, error: 'Token inválido.' });
    }
    const uid = verifyData.users[0].localId;

    // 2. Gerar Access Token do Google com a Service Account
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };

    // Assinar o JWT com a chave privada
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify(claim));
    const signingInput = `${header}.${payload}`;

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      pemToBuffer(privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
    const jwt = `${signingInput}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;

    // 3. Trocar JWT por Access Token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('Erro ao obter access token:', tokenData);
      return res.status(500).json({ ok: false, error: 'Erro de autenticação no servidor.' });
    }

    // 4. Gravar dev_sessions/{uid} = true com privilégio de admin
    const dbUrl = process.env.FIREBASE_DATABASE_URL;
    const writeRes = await fetch(
      `${dbUrl}/dev_sessions/${uid}.json`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(true),
      }
    );

    if (!writeRes.ok) {
      const writeErr = await writeRes.json();
      console.error('Erro ao gravar dev_sessions:', writeErr);
      return res.status(500).json({ ok: false, error: 'Erro ao registrar sessão.' });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro interno.' });
  }
}

function pemToBuffer(pem) {
  const base64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer.buffer;
}
