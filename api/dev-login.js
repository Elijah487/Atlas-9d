export default async function handler(req, res) {

  console.log("========== ATLAS DEV LOGIN ==========");
  console.log("MÉTODO RECEBIDO:", req.method);
  console.log("BODY RECEBIDO:", req.body);
  console.log("=====================================");

  if (req.method !== 'POST')  {
    return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  }

  const { password, idToken } = req.body || {};
  if (!password || !idToken) {
    return res.status(400).json({ ok: false, error: 'Campos ausentes.' });
  }

  if (password !== process.env.DEV_PASSWORD) {
    return res.status(403).json({ ok: false, error: 'Senha incorreta.' });
  }

  try {
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

    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    const dbUrl = process.env.FIREBASE_DATABASE_URL;

    const now = Math.floor(Date.now() / 1000);
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }));

    const signingInput = `${header}.${payload}`;
    const pemContents = privateKey
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '');
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8', binaryDer.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign']
    );

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5', cryptoKey,
      new TextEncoder().encode(signingInput)
    );

    const b64sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const jwt = `${signingInput}.${b64sig}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error('Erro access token:', tokenData);
      return res.status(500).json({ ok: false, error: 'Erro de autenticação no servidor.' });
    }

    const writeRes = await fetch(`${dbUrl}/dev_sessions/${uid}.json`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify(true),
    });

    if (!writeRes.ok) {
      console.error('Erro ao gravar:', await writeRes.text());
      return res.status(500).json({ ok: false, error: 'Erro ao registrar sessão.' });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Erro:', err.message);
    return res.status(500).json({ ok: false, error: 'Erro interno.' });
  }
}
