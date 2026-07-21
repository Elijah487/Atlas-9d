/* =====================================================================
   ATLAS — Camada central de dados e sessão (v7.3 — Performance & Launch)
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  inMemoryPersistence,
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

  /* --- Estado interno com controle de alteração (Dirty Checking) --- */
  var cache = emptyData();
  var lastCacheHash = '';
  var changeCallbacks = [];
  var firebaseAuthInstance = null;
  var firebaseDbInstance = null;
  var firebaseReady = false;
  var firebaseReadyCallbacks = [];
  var dataListenerAttached = false;
  var atlasDataReadyEventDispatched = false;
  var notifyRafId = null;

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

  /* --- Persistência rápida em sessionStorage --- */
  function saveToSessionStorage() {
    if (!hasSessionStorage()) return;
    try {
      var serialized = JSON.stringify(cache);
      if (serialized !== lastCacheHash) {
        lastCacheHash = serialized;
        global.sessionStorage.setItem(CACHE_KEY, serialized);
      }
    } catch (e) {}
  }

  function loadFromSessionStorage() {
    if (!hasSessionStorage()) return false;
    try {
      var raw = global.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      if (raw === lastCacheHash) return true;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        cache = {
          notes:   Array.isArray(parsed.notes)   ? parsed.notes   : [],
          tasks:   Array.isArray(parsed.tasks)   ? parsed.tasks   : [],
          events:  Array.isArray(parsed.events)  ? parsed.events  : [],
          notices: Array.isArray(parsed.notices) ? parsed.notices : []
        };
        lastCacheHash = raw;
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* --- Notificação via requestAnimationFrame (Agrupamento de DOM/Batching) --- */
  function scheduleNotify() {
    if (notifyRafId) cancelAnimationFrame(notifyRafId);
    notifyRafId = requestAnimationFrame(function () {
      notifyChange();
    });
  }

  function notifyChange() {
    for (var i = 0; i < changeCallbacks.length; i++) {
      try { changeCallbacks[i](); } catch (e) { console.error('Atlas: erro em callback onDataChange.', e); }
    }
  }

  /* --- Sanitização otimizada --- */
  function sanitizeHtml(html) {
    if (!html) return '';
    if (typeof document === 'undefined') return String(html);
    var template = document.createElement('template');
    template.innerHTML = html;
    return template.innerHTML;
  }

  /* --- Firebase com listeners otimizados --- */
  function onFirebaseReady(callback) {
    if (firebaseReady) callback();
    else firebaseReadyCallbacks.push(callback);
  }

  function markFirebaseReady() {
    if (firebaseReady) return;
    firebaseReady = true;
    var cbs = firebaseReadyCallbacks;
    firebaseReadyCallbacks = [];
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](); } catch (e) {}
    }
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
        var newData = objectToArray(snapshot.val());
        var newStr = JSON.stringify(newData);
        if (JSON.stringify(cache[collectionName]) !== newStr) {
          cache[collectionName] = newData;
          saveToSessionStorage();
          scheduleNotify();
        }
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

    // Libera a renderização instantânea via cache local
    if (hasCache) {
      markFirebaseReady();
    }

    try {
      var app = initializeApp(FIREBASE_CONFIG);
      firebaseAuthInstance = getAuth(app);
      firebaseDbInstance   = getDatabase(app);
    } catch (e) {
      console.error('Atlas: falha ao inicializar o Firebase.', e);
      markFirebaseReady();
      return;
    }

    attachDataListeners();

    if (!hasCache) {
      markFirebaseReady();
    }

    setPersistence(firebaseAuthInstance, inMemoryPersistence).catch(function () {});
  }

  /* --- Sessão DEV em sessionStorage --- */
  function getSession() {
    if (!hasSessionStorage()) return null;
    try {
      return global.sessionStorage.getItem(ATLAS_SESSION_KEY) === 'dev' ? 'dev' : null;
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
      if (global.localStorage) global.localStorage.removeItem(ATLAS_SESSION_KEY);
    } catch (e) {}
  }

  function isDev() { return getSession() === 'dev'; }
  function isLoggedIn() { return true; }
  function requireSession() { return true; }

  function loginAsDev(email, password, callback) {
    if (!firebaseAuthInstance) { callback(false, 'auth_error'); return; }
    signInWithEmailAndPassword(firebaseAuthInstance, email, password)
      .then(function () {
        setSessionDev();
        callback(true, null);
      })
      .catch(function (err) {
        callback(false, err.code || 'error');
      });
  }

  function loginWithRole(role, callback) {
    clearSessionLocal();
    if (firebaseAuthInstance) signOut(firebaseAuthInstance).catch(function () {});
    if (callback) callback(role === 'student');
  }

  function logout() {
    clearSessionLocal();
    if (firebaseAuthInstance) signOut(firebaseAuthInstance).catch(function () {});
    global.location.href = 'index.html';
  }

  function clearSession() { logout(); }

  /* --- Persistência de Coleções --- */
  function persistCollection(collectionName, list) {
    if (!firebaseDbInstance) return false;
    cache[collectionName] = list;
    saveToSessionStorage();
    set(ref(firebaseDbInstance, DATA_PATH + '/' + collectionName), list);
    return true;
  }

  /* --- CRUDs --- */
  function getNotes() { return cache.notes; }
  function getNotesBy(materia, bimestre) {
    return getNotes().filter(function (n) { return n.materia === materia && (!bimestre || n.bimestre === bimestre); });
  }
  function saveNote(note) {
    if (!isDev()) return null;
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
    if (!isDev()) return false;
    persistCollection('notes', cache.notes.filter(function (n) { return n.id !== id; })); return true;
  }

  function getTasks() { return cache.tasks; }
  function getTasksBy(materia, bimestre) {
    return getTasks().filter(function (t) { return t.materia === materia && (!bimestre || t.bimestre === bimestre); });
  }
  function saveTask(task) {
    if (!isDev()) return null;
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
    if (!isDev()) return false;
    persistCollection('tasks', cache.tasks.filter(function (t) { return t.id !== id; })); return true;
  }

  function getEvents() { return cache.events; }
  function saveEvent(evt) {
    if (!isDev()) return null;
    var list = cache.events.slice();
    var clean = { titulo: String(evt.titulo || '').trim(), descricao: String(evt.descricao || ''), data: evt.data };
    if (evt.id) {
      var idx = list.findIndex(function (e) { return e.id === evt.id; });
      if (idx !== -1) { clean = Object.assign({}, list[idx], clean, { id: evt.id, atualizadoEm: Date.now() }); list[idx] = clean; }
    } else { clean.id = uid(); clean.criadoEm = Date.now(); clean.atualizadoEm = Date.now(); list.push(clean); }
    persistCollection('events', list); return clean;
  }
  function deleteEvent(id) {
    if (!isDev()) return false;
    persistCollection('events', cache.events.filter(function (e) { return e.id !== id; })); return true;
  }

  function getNotices() { return cache.notices; }
  function saveNotice(notice) {
    if (!isDev()) return null;
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
    if (!isDev()) return false;
    persistCollection('notices', cache.notices.filter(function (n) { return n.id !== id; })); return true;
  }

  function onDataChange(callback) { changeCallbacks.push(callback); }

  function injectDevBanner() {
    if (!isDev() || document.getElementById('atlasDevBanner')) return;
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
