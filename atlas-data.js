/* =====================================================================
   ATLAS — Camada central de dados e sessão (v7.2 — Correção de Sessão DEV)
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  inMemoryPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase,
  ref,
  onValue,
  set
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

(function (global) {
  'use strict';

  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyBnt7aI16nXLXTSEg9ncITDI1KWS1wv650",
    authDomain: "atlas-9d.firebaseapp.com",
    databaseURL: "https://atlas-9d-default-rtdb.firebaseio.com",
    projectId: "atlas-9d",
    storageBucket: "atlas-9d.firebasestorage.app",
    messagingSenderId: "967138045816",
    appId: "1:967138045816:web:c90ba328cc71bf6dcf628d"
  };

  var ATLAS_SESSION_KEY = 'atlas_session';
  var DATA_PATH = 'atlas_data';
  var CACHE_KEY  = 'atlas_cache';

  var SUBJECTS = [
    'Matemática', 'Português', 'História', 'Geografia',
    'Ciências', 'Inglês', 'Arte',
    'O.E Matemática', 'O.E Português', 'Multidisciplinar'
  ];

  var BIMESTRES = ['3º Bimestre', '4º Bimestre'];
  var NOTICE_PRIORITIES = ['Normal', 'Importante', 'Urgente'];

  /* --- Estado interno --- */
  var cache = emptyData();
  var changeCallbacks = [];
  var firebaseAuthInstance = null;
  var firebaseDbInstance = null;
  var firebaseReady = false;
  var firebaseReadyCallbacks = [];
  var dataListenerAttached = false;
  var atlasDataReadyEventDispatched = false;
  var notifyTimer = null;

  /* --- Utilitários --- */
  function uid() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function slugify(text) {
    return String(text)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, '-');
  }

  function emptyData() {
    return { notes: [], tasks: [], events: [], notices: [] };
  }

  function hasSessionStorage() {
    try { return !!global.sessionStorage; } catch (e) { return false; }
  }

  /* --- Cache em sessionStorage --- */
  function saveToSessionStorage() {
    if (!hasSessionStorage()) return;
    try {
      global.sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
  }

  function loadFromSessionStorage() {
    if (!hasSessionStorage()) return false;
    try {
      var raw = global.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        cache = {
          notes:   Array.isArray(parsed.notes)   ? parsed.notes   : [],
          tasks:   Array.isArray(parsed.tasks)   ? parsed.tasks   : [],
          events:  Array.isArray(parsed.events)  ? parsed.events  : [],
          notices: Array.isArray(parsed.notices) ? parsed.notices : []
        };
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* --- Notificação via debounce --- */
  function scheduleNotify() {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(function () { notifyChange(); }, 0);
  }

  function notifyChange() {
    changeCallbacks.forEach(function (cb) {
      try { cb(); } catch (e) { console.error('Atlas: erro em callback onDataChange.', e); }
    });
  }

  /* --- Sanitização de HTML --- */
  function sanitizeHtml(html) {
    if (!html) return '';
    if (typeof document === 'undefined') return String(html);
    var ALLOWED_TAGS = {
      B:1, STRONG:1, I:1, EM:1, U:1, H1:1, H2:1, H3:1,
      UL:1, OL:1, LI:1, BLOCKQUOTE:1, HR:1,
      A:1, IMG:1, BR:1, P:1, SPAN:1, DIV:1
    };
    var ALLOWED_ATTRS = { A: ['href','target','rel'], IMG: ['src','alt'] };
    var template = document.createElement('template');
    template.innerHTML = html;
    function clean(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 1) {
          var tag = child.tagName;
          if (!ALLOWED_TAGS[tag]) {
            while (child.firstChild) node.insertBefore(child.firstChild, child);
            node.removeChild(child); return;
          }
          var allowed = ALLOWED_ATTRS[tag] || [];
          Array.prototype.slice.call(child.attributes).forEach(function (attr) {
            var name = attr.name.toLowerCase();
            if (name.indexOf('on') === 0 || allowed.indexOf(name) === -1) {
              child.removeAttribute(attr.name);
            }
          });
          if (tag === 'A') {
            var href = child.getAttribute('href') || '';
            if (href.indexOf('javascript:') === 0) child.removeAttribute('href');
            else { child.setAttribute('target','_blank'); child.setAttribute('rel','noopener noreferrer'); }
          }
          if (tag === 'IMG') {
            var src = child.getAttribute('src') || '';
            if (src.indexOf('javascript:') === 0) child.removeAttribute('src');
          }
          clean(child);
        } else if (child.nodeType === 8) {
          node.removeChild(child);
        }
      });
    }
    clean(template.content);
    return template.innerHTML;
  }

  /* --- Firebase — Inicialização e Escuta --- */
  function onFirebaseReady(callback) {
    if (firebaseReady) callback();
    else firebaseReadyCallbacks.push(callback);
  }

  function markFirebaseReady() {
    firebaseReady = true;
    var cbs = firebaseReadyCallbacks;
    firebaseReadyCallbacks = [];
    cbs.forEach(function (cb) {
      try { cb(); } catch (e) { console.error('Atlas: erro em callback de inicialização.', e); }
    });
    if (!atlasDataReadyEventDispatched) {
      atlasDataReadyEventDispatched = true;
      try { document.dispatchEvent(new Event('atlas-data-ready')); } catch (e) {}
    }
  }

  function objectToArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    return Object.keys(value).map(function (k) { return value[k]; });
  }

  function makeCollectionListener(collectionName) {
    onValue(
      ref(firebaseDbInstance, DATA_PATH + '/' + collectionName),
      function (snapshot) {
        cache[collectionName] = objectToArray(snapshot.val());
        saveToSessionStorage();
        scheduleNotify();
      },
      function (error) {
        console.error('Atlas: erro ao escutar "' + collectionName + '".', error);
      }
    );
  }

  function attachDataListeners() {
    if (dataListenerAttached || !firebaseDbInstance) return;
    dataListenerAttached = true;
    makeCollectionListener('notes');
    makeCollectionListener('tasks');
    makeCollectionListener('events');
    makeCollectionListener('notices');
  }

  function initFirebase() {
    var hasCache = loadFromSessionStorage();

    var app;
    try {
      app = initializeApp(FIREBASE_CONFIG);
      firebaseAuthInstance = getAuth(app);
      firebaseDbInstance   = getDatabase(app);
    } catch (e) {
      console.error('Atlas: falha ao inicializar o Firebase.', e);
      markFirebaseReady();
      return;
    }

    attachDataListeners();

    if (hasCache) {
      markFirebaseReady();
    } else {
      setTimeout(function () {
        markFirebaseReady();
      }, 100);
    }

    // Define persistência apenas em memória para a auth do Firebase
    setPersistence(firebaseAuthInstance, inMemoryPersistence).catch(function (e) {
      console.warn('Atlas: não foi possível definir persistência em memória.', e);
    });
  }

  /* --- Gerenciamento de Sessão DEV (via sessionStorage) --- */
  function getSession() {
    if (!hasSessionStorage()) return null;
    try {
      var v = global.sessionStorage.getItem(ATLAS_SESSION_KEY);
      return v === 'dev' ? 'dev' : null;
    } catch (e) { return null; }
  }

  function setSessionDev() {
    if (!hasSessionStorage()) return;
    try { global.sessionStorage.setItem(ATLAS_SESSION_KEY, 'dev'); } catch (e) {}
  }

  function clearSessionLocal() {
    if (!hasSessionStorage()) return;
    try { 
      global.sessionStorage.removeItem(ATLAS_SESSION_KEY);
      // Limpa também o localStorage por compatibilidade retroativa
      if (global.localStorage) {
        global.localStorage.removeItem(ATLAS_SESSION_KEY);
      }
    } catch (e) {}
  }

  function isDev() {
    return getSession() === 'dev';
  }

  function isLoggedIn() {
    return true;
  }

  function requireSession() {
    return true;
  }

  function loginAsDev(email, password, callback) {
    if (!firebaseAuthInstance) {
      callback(false, 'auth_error'); return;
    }

    var settled = false;
    function settle(ok, reason) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback(ok, reason);
    }

    var timeoutId = setTimeout(function () {
      settle(false, 'timeout');
    }, 12000);

    signInWithEmailAndPassword(firebaseAuthInstance, email, password)
      .then(function () {
        setSessionDev();
        settle(true, null);
      })
      .catch(function (err) {
        console.error('Atlas: falha no login dev.', err);
        var reason = 'network_error';
        if (err.code === 'auth/wrong-password' ||
            err.code === 'auth/user-not-found' ||
            err.code === 'auth/invalid-credential') {
          reason = 'wrong_password';
        } else if (err.code === 'auth/operation-not-allowed') {
          reason = 'provider_disabled';
        } else if (err.code === 'auth/unauthorized-domain') {
          reason = 'unauthorized_domain';
        }
        settle(false, reason);
      });
  }

  function loginWithRole(role, callback) {
    // Ao entrar como aluno, garante o encerramento imediato de qualquer sessão DEV ativa
    clearSessionLocal();
    if (firebaseAuthInstance) {
      signOut(firebaseAuthInstance).catch(function () {});
    }

    if (role === 'student') {
      if (callback) callback(true);
    } else {
      if (callback) callback(false);
    }
  }

  function logout() {
    clearSessionLocal();
    if (firebaseAuthInstance) {
      signOut(firebaseAuthInstance).catch(function () {});
    }
    safeRedirect('index.html');
  }

  function clearSession() {
    logout();
  }

  function safeRedirect(path) {
    try { global.location.href = path; } catch (e) {
      try { global.location.assign(path); } catch (e2) {}
    }
  }

  /* --- Persistência no Firebase --- */
  function persistCollection(collectionName, list) {
    if (!firebaseDbInstance) {
      console.error('Atlas: Firebase não conectado.'); return false;
    }
    cache[collectionName] = list;
    saveToSessionStorage();
    set(ref(firebaseDbInstance, DATA_PATH + '/' + collectionName), list).catch(function (err) {
      console.error('Atlas: falha ao salvar no Firebase.', err);
    });
    return true;
  }

  /* --- CRUD Anotações --- */
  function getNotes() { return cache.notes; }

  function getNotesBy(materia, bimestre) {
    return getNotes().filter(function (n) {
      return n.materia === materia && (!bimestre || n.bimestre === bimestre);
    });
  }

  function saveNote(note) {
    if (!isDev()) { console.warn('Atlas: escrita bloqueada fora do modo dev.'); return null; }
    var list = cache.notes.slice();
    var clean = {
      titulo: String(note.titulo || '').trim(),
      materia: note.materia, bimestre: note.bimestre,
      conteudo: sanitizeHtml(note.conteudo || '')
    };
    if (note.id) {
      var idx = list.findIndex(function (n) { return n.id === note.id; });
      if (idx !== -1) { clean = Object.assign({}, list[idx], clean, { id: note.id, atualizadoEm: Date.now() }); list[idx] = clean; }
    } else { clean.id = uid(); clean.criadoEm = Date.now(); clean.atualizadoEm = Date.now(); list.push(clean); }
    persistCollection('notes', list); return clean;
  }

  function deleteNote(id) {
    if (!isDev()) { console.warn('Atlas: escrita bloqueada fora do modo dev.'); return false; }
    persistCollection('notes', cache.notes.filter(function (n) { return n.id !== id; })); return true;
  }

  /* --- CRUD Tarefas --- */
  function getTasks() { return cache.tasks; }

  function getTasksBy(materia, bimestre) {
    return getTasks().filter(function (t) {
      return t.materia === materia && (!bimestre || t.bimestre === bimestre);
    });
  }

  function saveTask(task) {
    if (!isDev()) { console.warn('Atlas: escrita bloqueada fora do modo dev.'); return null; }
    var list = cache.tasks.slice();
    var clean = {
      titulo: String(task.titulo || '').trim(),
      materia: task.materia, bimestre: task.bimestre, dataEntrega: task.dataEntrega,
      enunciado: sanitizeHtml(task.enunciado || ''), resposta: sanitizeHtml(task.resposta || '')
    };
    if (task.id) {
      var idx = list.findIndex(function (t) { return t.id === task.id; });
      if (idx !== -1) { clean = Object.assign({}, list[idx], clean, { id: task.id, atualizadoEm: Date.now() }); list[idx] = clean; }
    } else { clean.id = uid(); clean.criadoEm = Date.now(); clean.atualizadoEm = Date.now(); list.push(clean); }
    persistCollection('tasks', list); return clean;
  }

  function deleteTask(id) {
    if (!isDev()) { console.warn('Atlas: escrita bloqueada fora do modo dev.'); return false; }
    persistCollection('tasks', cache.tasks.filter(function (t) { return t.id !== id; })); return true;
  }

  /* --- CRUD Eventos --- */
  function getEvents() { return cache.events; }

  function saveEvent(evt) {
    if (!isDev()) { console.warn('Atlas: escrita bloqueada fora do modo dev.'); return null; }
    var list = cache.events.slice();
    var clean = { titulo: String(evt.titulo || '').trim(), descricao: String(evt.descricao || ''), data: evt.data };
    if (evt.id) {
      var idx = list.findIndex(function (e) { return e.id === evt.id; });
      if (idx !== -1) { clean = Object.assign({}, list[idx], clean, { id: evt.id, atualizadoEm: Date.now() }); list[idx] = clean; }
    } else { clean.id = uid(); clean.criadoEm = Date.now(); clean.atualizadoEm = Date.now(); list.push(clean); }
    persistCollection('events', list); return clean;
  }

  function deleteEvent(id) {
    if (!isDev()) { console.warn('Atlas: escrita bloqueada fora do modo dev.'); return false; }
    persistCollection('events', cache.events.filter(function (e) { return e.id !== id; })); return true;
  }

  /* --- CRUD Avisos --- */
  function getNotices() { return cache.notices; }

  function saveNotice(notice) {
    if (!isDev()) { console.warn('Atlas: escrita bloqueada fora do modo dev.'); return null; }
    var list = cache.notices.slice();
    var prioridade = NOTICE_PRIORITIES.indexOf(notice.prioridade) !== -1 ? notice.prioridade : 'Normal';
    var clean = { titulo: String(notice.titulo || '').trim(), descricao: String(notice.descricao || '').trim(), data: notice.data || '', prioridade: prioridade };
    if (notice.id) {
      var idx = list.findIndex(function (n) { return n.id === notice.id; });
      if (idx !== -1) { clean = Object.assign({}, list[idx], clean, { id: notice.id, atualizadoEm: Date.now() }); list[idx] = clean; }
    } else { clean.id = uid(); clean.criadoEm = Date.now(); clean.atualizadoEm = Date.now(); list.push(clean); }
    persistCollection('notices', list); return clean;
  }

  function deleteNotice(id) {
    if (!isDev()) { console.warn('Atlas: escrita bloqueada fora do modo dev.'); return false; }
    persistCollection('notices', cache.notices.filter(function (n) { return n.id !== id; })); return true;
  }

  /* --- Callbacks e Banner --- */
  function onDataChange(callback) {
    changeCallbacks.push(callback);
  }

  function injectDevBanner() {
    if (!isDev()) return;
    if (document.getElementById('atlasDevBanner')) return;
    var style = document.createElement('style');
    style.textContent =
      '#atlasDevBanner{position:fixed;top:0;left:0;right:0;z-index:500;' +
      'display:flex;align-items:center;justify-content:center;gap:14px;' +
      'padding:9px 16px;background:linear-gradient(90deg,#7c3aed,#a855f7);' +
      'color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;' +
      'font-size:13px;font-weight:600;letter-spacing:.02em;' +
      'box-shadow:0 2px 14px rgba(0,0,0,.35);min-height:38px;box-sizing:border-box;}' +
      '#atlasDevBanner .dot{width:7px;height:7px;border-radius:50%;background:#fff;' +
      'box-shadow:0 0 0 3px rgba(255,255,255,.25);flex-shrink:0;}' +
      '#atlasDevBanner button{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);' +
      'color:#fff;font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:100px;cursor:pointer;' +
      'font-family:inherit;transition:background .2s ease;flex-shrink:0;}' +
      '#atlasDevBanner button:hover{background:rgba(255,255,255,.32);}' +
      'body.atlas-dev-active{padding-top:38px;}' +
      'body.atlas-dev-active .app{min-height:calc(100vh - 38px);}' +
      'body.atlas-dev-active header#siteHeader{top:38px;}' +
      '@media(max-width:720px){' +
        '#atlasDevBanner{font-size:11.5px;padding:7px 10px;text-align:center;}' +
        '#atlasDevBanner span:not(.dot){overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw;}' +
        'body.atlas-dev-active{padding-top:34px;}' +
        'body.atlas-dev-active .sidebar{top:94px;}' +
      '}';
    document.head.appendChild(style);
    var banner = document.createElement('div');
    banner.id = 'atlasDevBanner';
    banner.innerHTML =
      '<span class="dot"></span>' +
      '<span>MODO DESENVOLVEDOR ATIVO — alterações feitas aqui aparecem para todos os alunos</span>' +
      '<button id="atlasDevExitBtn" type="button">Sair do modo</button>';
    document.body.prepend(banner);
    document.body.classList.add('atlas-dev-active');
    var exitBtn = document.getElementById('atlasDevExitBtn');
    if (exitBtn) exitBtn.addEventListener('click', function () { logout(); });
  }

  /* --- API Exposta --- */
  global.AtlasData = {
    SUBJECTS:          SUBJECTS,
    BIMESTRES:         BIMESTRES,
    NOTICE_PRIORITIES: NOTICE_PRIORITIES,

    slugify:        slugify,
    uid:            uid,
    sanitizeHtml:   sanitizeHtml,

    getSession:     getSession,
    clearSession:   clearSession,
    isDev:          isDev,
    isLoggedIn:     isLoggedIn,
    loginWithRole:  loginWithRole,
    loginAsDev:     loginAsDev,
    requireSession: requireSession,
    logout:         logout,
    onFirebaseReady:onFirebaseReady,

    getNotes:    getNotes,
    getNotesBy:  getNotesBy,
    saveNote:    saveNote,
    deleteNote:  deleteNote,

    getTasks:    getTasks,
    getTasksBy:  getTasksBy,
    saveTask:    saveTask,
    deleteTask:  deleteTask,

    getEvents:   getEvents,
    saveEvent:   saveEvent,
    deleteEvent: deleteEvent,

    getNotices:  getNotices,
    saveNotice:  saveNotice,
    deleteNotice:deleteNotice,

    onDataChange:    onDataChange,
    injectDevBanner: injectDevBanner
  };

  initFirebase();

})(window);
