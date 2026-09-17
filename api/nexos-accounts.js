import admin from "firebase-admin";
import bcrypt from "bcryptjs";

/* =====================================================================
   NEXOS — /api/nexos-accounts
   ---------------------------------------------------------------------
   CRUD simples de contas de aluno para a aba "Contas" do Modo Dev.

   Segurança: o Nexos não usa mais um nó "dev_sessions" (esse mecanismo
   era do fluxo antigo de login por Cloud Function). Agora o dev entra
   com e-mail + senha reais do Firebase Authentication
   (NexosData.loginAsDev). Este endpoint confere, a partir do idToken
   enviado pelo cliente, que o usuário autenticado entrou por e-mail e
   senha (sign_in_provider === "password") — e não por custom token,
   que é como os alunos entram. Só assim libera qualquer operação.

   Ações suportadas (body.action):
     "list"        -> lista todas as contas (sem o hash da senha)
     "create"      -> { nome, senha, turma } cria uma nova conta
     "update"      -> { id, patch } atualiza campos (turma, active, payments)
     "setPassword" -> { id, senha } troca a senha (novo hash bcrypt)

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
var SALT_ROUNDS = 10;

function slugify(text) {
  return String(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

async function requireDev(req) {
  var authHeader = req.headers.authorization || "";
  var idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) return null;

  try {
    var decoded = await admin.auth().verifyIdToken(idToken);
    var provider = decoded.firebase && decoded.firebase.sign_in_provider;
    /* Alunos entram por custom token ("custom"); só quem entrou com
       e-mail e senha reais do Firebase Auth ("password") é dev. */
    if (provider === "password") {
      return decoded.uid;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function stripSensitive(id, account) {
  return {
    id: id,
    nome: account.nome || "",
    turma: account.turma || "",
    active: !!account.active,
    payments: account.payments || {}
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método não permitido" });
  }

  var devUid = await requireDev(req);
  if (!devUid) {
    return res.status(403).json({ ok: false, error: "Acesso restrito ao Modo Dev" });
  }

  var body = req.body || {};
  var action = body.action;

  try {
    var ref = admin.database().ref(ACCOUNTS_PATH);

    if (action === "list") {
      var snap = await ref.get();
      var val = snap.val() || {};
      var accounts = Object.keys(val).map(function (id) {
        return stripSensitive(id, val[id]);
      });
      return res.status(200).json({ ok: true, accounts: accounts });
    }

    if (action === "create") {
      var nome = body.nome;
      var senha = body.senha;
      var turma = body.turma || "";

      if (!nome || !senha) {
        return res.status(400).json({ ok: false, error: "Campos ausentes" });
      }

      var slug = slugify(nome);
      if (!slug) {
        return res.status(400).json({ ok: false, error: "Nome inválido" });
      }

      var existing = await ref.child(slug).get();
      if (existing.exists()) {
        return res.status(409).json({ ok: false, error: "Já existe uma conta com esse nome" });
      }

      var senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);

      await ref.child(slug).set({
        nome: nome,
        turma: turma,
        active: true,
        senhaHash: senhaHash,
        payments: {},
        createdAt: Date.now(),
        createdBy: devUid
      });

      return res.status(200).json({ ok: true, id: slug });
    }

    if (action === "update") {
      var id = body.id;
      var patch = body.patch || {};
      if (!id) return res.status(400).json({ ok: false, error: "ID ausente" });

      var updates = {};
      if (typeof patch.turma === "string") updates["turma"] = patch.turma;
      if (typeof patch.active === "boolean") updates["active"] = patch.active;
      if (patch.payments && typeof patch.payments === "object") {
        Object.keys(patch.payments).forEach(function (mes) {
          updates["payments/" + mes] = patch.payments[mes];
        });
      }

      await ref.child(id).update(updates);
      return res.status(200).json({ ok: true });
    }

    if (action === "setPassword") {
      var pid = body.id;
      var novaSenha = body.senha;
      if (!pid || !novaSenha) {
        return res.status(400).json({ ok: false, error: "Campos ausentes" });
      }
      var novoHash = await bcrypt.hash(novaSenha, SALT_ROUNDS);
      await ref.child(pid).update({ senhaHash: novoHash });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: "Ação desconhecida" });

  } catch (error) {
    console.error("Nexos accounts error:", error);
    return res.status(500).json({ ok: false, error: "Erro interno" });
  }
}
