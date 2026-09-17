import admin from "firebase-admin";
import bcrypt from "bcryptjs";

/* =====================================================================
   NEXOS — /api/nexos-login
   ---------------------------------------------------------------------
   Login de aluno usando apenas NOME + SENHA (sem e-mail, sem Gmail).

   1. Recebe { nome, senha } do cliente.
   2. Normaliza o nome em um "slug" e procura a conta em
      nexos_accounts/{slug} no MESMO Firebase Realtime Database do Atlas.
   3. Confere se a conta existe, está ativa, e se a senha bate com o
      hash bcrypt salvo (a senha em texto puro nunca é armazenada).
   4. Se tudo certo, cria um Custom Token do Firebase Auth (Admin SDK)
      para o uid fixo dessa conta (ex.: "nexos_joao-silva") e devolve
      ao cliente, que usa signInWithCustomToken no navegador.
   5. Um e-mail interno NUNCA é usado, pedido ou exibido — o Firebase
      Authentication aqui serve só como identidade técnica (uid) para
      as regras de segurança do Realtime Database.

   Variáveis de ambiente necessárias (Vercel):
     FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY,
     FIREBASE_DATABASE_URL  (as mesmas do Atlas — mesmo projeto Firebase)
   ===================================================================== */

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

var ACCOUNTS_PATH = "nexos_accounts";

function slugify(text) {
  return String(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método não permitido" });
  }

  var nome = (req.body || {}).nome;
  var senha = (req.body || {}).senha;

  if (!nome || !senha) {
    return res.status(400).json({ ok: false, error: "Campos ausentes" });
  }

  var slug = slugify(nome);
  if (!slug) {
    return res.status(401).json({ ok: false, error: "Credenciais inválidas" });
  }

  try {
    var snap = await admin.database().ref(ACCOUNTS_PATH + "/" + slug).get();

    if (!snap.exists()) {
      return res.status(401).json({ ok: false, error: "Credenciais inválidas" });
    }

    var account = snap.val();

    if (!account.active) {
      return res.status(403).json({ ok: false, error: "Conta desativada" });
    }

    var senhaOk = await bcrypt.compare(senha, account.senhaHash || "");
    if (!senhaOk) {
      return res.status(401).json({ ok: false, error: "Credenciais inválidas" });
    }

    var uid = "nexos_" + slug;
    var customToken = await admin.auth().createCustomToken(uid, {
      nexosAccountId: slug,
      turma: account.turma || ""
    });

    return res.status(200).json({
      ok: true,
      token: customToken,
      nome: account.nome || nome,
      turma: account.turma || ""
    });

  } catch (error) {
    console.error("Nexos login error:", error);
    return res.status(500).json({ ok: false, error: "Erro interno" });
  }
}
