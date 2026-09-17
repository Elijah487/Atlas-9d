# Nexos — Notas de instalação e deploy (atualizado)

Esta versão do Nexos foi re-baseada na versão atual do Atlas que você
enviou (v7.3.3), mantendo tudo que já existia de exclusivo do Nexos:
tema roxo, login obrigatório de aluno (nome + senha, sem e-mail/Gmail)
e a aba **Contas** no Modo Dev.

## 1. O que mudou nesta atualização

O Atlas atual trouxe mudanças importantes na arquitetura, e o Nexos foi
adaptado para acompanhá-las:

- **Login de desenvolvedor**: o Atlas não usa mais Cloud Function +
  senha (`api/dev-login.js` + nó `dev_sessions`). Agora o Modo Dev
  entra com **e-mail + senha reais do Firebase Authentication**
  (`NexosData.loginAsDev`). O Nexos manteve a mesma tela (só pede a
  senha — o e-mail fica fixo em `DEV_EMAIL` dentro de `index.html`),
  já que Atlas e Nexos compartilham o mesmo Firebase Auth.
- **`api/nexos-accounts.js` foi ajustado**: como `dev_sessions` não
  existe mais, a verificação de quem pode mexer em Contas agora
  confere, no próprio token do Firebase, que a pessoa entrou por
  e-mail/senha (`sign_in_provider === "password"`) — que é exatamente
  como o dev entra. Alunos entram por *custom token* (`"custom"`), então
  nunca passam nessa checagem.
- **`api/dev-login.js` foi removido** — não é mais necessário, nem no
  Atlas nem no Nexos.
- **Novas páginas do Atlas**: `anotacao.html` e `tarefa.html`
  (visualização detalhada de nota e de tarefa, antes dentro de
  `materia.html`) e `nexos-imgbb.js` (upload de imagem via ImgBB,
  usado pelo editor). Essas páginas já receberam o mesmo tratamento
  das demais: tema roxo, exigência de login e o item "Contas" no menu
  (visível só em Modo Dev).
- **Correção visual**: a página `contas.html` agora carrega
  corretamente `nexos-theme.css` — no build anterior esse link estava
  faltando, por isso ela aparecia sem a identidade roxa. Já corrigido.

## 2. O que continua igual

- Mesmo Firebase do Atlas (`firebaseConfig`, `DATA_PATH = 'atlas_data'`)
  — tarefas, notas, eventos, avisos, matérias e conteúdos continuam
  compartilhados entre os dois sites.
- Login de aluno por nome + senha (sem e-mail/Gmail), via Custom Token
  emitido por `/api/nexos-login.js`.
- Contas de aluno num nó separado e exclusivo do Nexos:

```
nexos_accounts/{slug-do-nome}
    nome
    turma
    active
    senhaHash        (bcrypt — nunca a senha em texto puro)
    payments/{Mês}   ("Pago" | "Pendente")
```

- Nenhuma funcionalidade do Atlas foi removida, e o Atlas continua
  funcionando exatamente como está — os dois códigos são
  independentes.

## 3. Variáveis de ambiente (Vercel)

No projeto Vercel do **Nexos** (separado do projeto Vercel do Atlas):

| Variável | Descrição |
|---|---|
| `FIREBASE_PROJECT_ID` | mesmo do Atlas |
| `FIREBASE_CLIENT_EMAIL` | mesmo do Atlas (Service Account) |
| `FIREBASE_PRIVATE_KEY` | mesmo do Atlas (Service Account) |
| `FIREBASE_DATABASE_URL` | mesmo do Atlas |

Não é mais necessário `DEV_PASSWORD` — o Modo Dev agora usa a conta de
e-mail/senha já cadastrada no Firebase Authentication do projeto (a
mesma que o Atlas usa).

## 4. Antes de publicar — confira o `DEV_EMAIL`

Em `index.html`, o e-mail de desenvolvedor está fixo na constante:

```js
var DEV_EMAIL = 'eagbedejobi@gmail.com';
```

Isso veio direto do Atlas (mesmo Firebase Auth) — confirme que é o
e-mail correto da conta de administrador antes do deploy. Se quiser um
administrador diferente para o Nexos, crie outro usuário de e-mail/senha
no Firebase Authentication e troque esse valor.

## 5. Regras de segurança do Firebase (recomendado)

```json
{
  "rules": {
    "nexos_accounts": {
      ".read": false,
      ".write": false
    }
  }
}
```

Como todo acesso a `nexos_accounts` passa pelo Admin SDK (que ignora
as regras), o recomendado é bloquear leitura/escrita direta do
cliente nesse nó. O restante das regras (`atlas_data`, etc.) continua
como já está configurado para o Atlas.

## 6. Criando a primeira conta de aluno

1. Acesse o Nexos → clique em "Entrar no Nexos" → clique no ícone
   de Modo Dev e entre com a senha da conta de e-mail/senha do Firebase.
2. Abra a aba **Contas** no menu lateral (só aparece em Modo Dev).
3. Clique em "Criar conta", preencha nome, senha e turma.
4. O aluno já pode entrar pelo login normal (nome + senha).

## 7. Deploy

1. Projeto Vercel separado do Atlas, apontando para este diretório.
2. Configure as variáveis de ambiente da seção 3.
3. `npm install` (instala `firebase-admin` e `bcryptjs`).
4. Deploy.
