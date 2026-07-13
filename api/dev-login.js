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

  // Senha correta — gravar dev_sessions no Firebase com Admin SDK
  try {
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getDatabase } = await import('firebase-admin/database');

    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
        databaseURL: 'https://atlas-9d-default-rtdb.firebaseio.com',
      });
    }

    // Extrai o uid do ID Token (verificação simples via Firebase Auth REST)
    const verifyUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`;
    const verifyRes = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.users?.[0]?.localId) {
      return res.status(401).json({ ok: false, error: 'Token inválido.' });
    }

    const uid = verifyData.users[0].localId;
    await getDatabase().ref(`dev_sessions/${uid}`).set(true);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro interno.' });
  }
}
