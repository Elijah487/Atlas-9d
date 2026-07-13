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
    // Verificar o idToken e pegar o uid via Firebase Auth REST API
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

    // Gravar dev_sessions/{uid} = true via Firebase REST API
    // usando o idToken do próprio usuário + regras do banco
    const dbUrl = process.env.FIREBASE_DATABASE_URL;
    const writeRes = await fetch(
      `${dbUrl}/dev_sessions/${uid}.json?auth=${idToken}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
