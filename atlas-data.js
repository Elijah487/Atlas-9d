/* =====================================================================
   ATLAS — Camada central de dados, sessão e mídias (v7.3.1 — Resilient Storage)
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
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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
  var lastCacheHash = '';
  var changeCallbacks = [];
  var firebaseAuthInstance = null;
  var firebaseDbInstance = null;
  var firebaseStorageInstance = null;
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

  function sanitizeHtml(html) {
    if (!html) return '';
    if (typeof document === 'undefined') return String(html);
    var template = document.createElement('template');
    template.innerHTML = html;
    return template.innerHTML;
  }

  /* --- Validação de Imagem (10MB / 7000px) e Processamento Canvas --- */
  function validateAndCompressImage(file, maxWidth, quality) {
    maxWidth = maxWidth || 1200;
    quality = quality || 0.75;

    return new Promise(function (resolve, reject) {
      if (!file || !file.type.match(/image.*/)) {
        reject(new Error('O arquivo selecionado não é uma imagem válida.'));
        return;
      }

      // Validação de Tamanho (Máx 10 MB)
      var MAX_SIZE_BYTES = 10 * 1024 * 1024;
      if (file.size > MAX_SIZE_BYTES) {
        reject(new Error('A imagem excede o tamanho máximo permitido de 10 MB.'));
        return;
      }

      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          // Validação de Resolução (Máx 7000 px)
          if (img.width > 7000 || img.height > 7000) {
            reject(new Error('A resolução da imagem é muito grande (máximo 7000px).'));
            return;
          }

          var width = img.width;
          var height = img.height;

          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }

          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            function (blob) {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Falha ao processar a imagem no navegador.'));
              }
            },
            'image/webp',
            quality
          );
        };
        img.onerror = function () { reject(new Error('Erro ao carregar a imagem.')); };
        img.src = e.target.result;
      };
      reader.onerror = function () { reject(new Error('Erro ao ler o arquivo.')); };
      reader.readAsDataURL(file);
    });
  }

  /* --- Upload com Progresso e Retry Automático (3x) --- */
  function uploadWithRetry(fileRef, blob, onProgress, attemptsLeft) {
    attemptsLeft = typeof attemptsLeft === 'number' ? attemptsLeft : 3;

    return new Promise(function (resolve, reject) {
      var uploadTask = uploadBytesResumable(fileRef, blob, { contentType: 'image/webp' });

      uploadTask.on(
        'state_changed',
        function (snapshot) {
          if (typeof onProgress === 'function' && snapshot.totalBytes > 0) {
            var percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            onProgress(percent);
          }
        },
        function (error) {
          if (attemptsLeft > 1) {
            console.warn('Atlas: Falha no upload. Tentando novamente... Restam ' + (attemptsLeft - 1) + ' tentativas.');
            setTimeout(function () {
              uploadWithRetry(fileRef, blob, onProgress, attemptsLeft - 1)
                .then(resolve)
                .catch(reject);
            }, 1500);
          } else {
            reject(error);
          }
        },
        function () {
          getDownloadURL(uploadTask.snapshot.ref)
            .then(resolve)
            .catch(reject);
        }
      );
    });
  }

  /* --- Upload de Imagem no Firebase Storage Organizado --- */
  function uploadImageToStorage(file, folderName, itemId, onProgress) {
    if (!file) return Promise.resolve('');

    return new Promise(function (resolve, reject) {
      if (!firebaseStorageInstance) {
        reject(new Error('Firebase Storage não está pronto.'));
        return;
      }

      var entityId = itemId || uid();
      // Estrutura organizada: imagens/tarefas/ID_DA_TAREFA/capa.webp
      var fullPath = 'imagens/' + folderName + '/' + entityId + '/capa.webp';
      var fileRef = storageRef(firebaseStorageInstance, fullPath);

      validateAndCompressImage(file, 1200, 0.75)
        .then(function (compressedBlob) {
          return uploadWithRetry(fileRef, compressedBlob, onProgress, 3);
        })
        .then(function (downloadURL) {
          resolve(downloadURL);
        })
        .catch(function (err) {
          reject(err);
        });
    });
  }

  /* --- Exclusão Segura no Storage --- */
  function deleteImageFromStorageByUrl(url) {
    if (!firebaseStorageInstance || !url || !url.includes('firebasestorage.googleapis.com')) {
      return Promise.resolve(true);
    }
    return new Promise(function (resolve) {
      try {
        var fileRef = storageRef(firebaseStorageInstance, url);
        deleteObject(fileRef)
          .then(function () { resolve(true); })
          .catch(function () { resolve(true); });
      } catch (e) {
        resolve(true);
      }
    });
  }

  /* --- Inicialização do Firebase --- */
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

    if (hasCache) markFirebaseReady();

    try {
      var app = initializeApp(FIREBASE_CONFIG);
      firebaseAuthInstance    = getAuth(app);
      firebaseDbInstance      = getDatabase(app);
      firebaseStorageInstance = getStorage(app);
    } catch (e) {
      console.error('Atlas: erro na inicialização.', e);
      markFirebaseReady();
      return;
    }

    attachDataListeners();

    if (!hasCache) markFirebaseReady();

    setPersistence(firebaseAuthInstance, inMemoryPersistence).catch(function () {});
  }

  /* --- Sessão DEV --- */
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

  /* --- Persistência Realtime Database --- */
  function persistCollection(collectionName, list) {
    if (!firebaseDbInstance) return false;
    cache[collectionName] = list;
    saveToSessionStorage();
    set(ref(firebaseDbInstance, DATA_PATH + '/' + collectionName), list);
    return true;
  }

  /* --- CRUD Anotações --- */
  function getNotes() { return cache.notes || []; }
  function getNotesBy(materia, bimestre) {
    return getNotes().filter(function (n) { return n.materia === materia && (!bimestre || n.bimestre === bimestre); });
  }

  function saveNote(note) {
    if (!isDev()) return null;
    var list = (cache.notes || []).slice();
    var clean = {
      titulo: String(note.titulo || '').trim(),
      materia: note.materia,
      bimestre: note.bimestre,
      imagemUrl: note.imagemUrl || '',
      conteudo: sanitizeHtml(note.conteudo || '')
    };

    if (note.id) {
      var idx = list.findIndex(function (n) { return n.id === note.id; });
      if (idx !== -1) {
        // Trata imagem antiga se trocada
        if (list[idx].imagemUrl && note.imagemUrl && list[idx].imagemUrl !== note.imagemUrl) {
          deleteImageFromStorageByUrl(list[idx].imagemUrl);
        }
        clean = Object.assign({}, list[idx], clean, { id: note.id, atualizadoEm: Date.now() });
        list[idx] = clean;
      }
    } else {
      clean.id = note.id || uid();
      clean.criadoEm = Date.now();
      clean.atualizadoEm = Date.now();
      list.push(clean);
    }
    persistCollection('notes', list);
    return clean;
  }

  function deleteNote(id) {
    if (!isDev()) return Promise.resolve(false);
    var target = (cache.notes || []).find(function (n) { return n.id === id; });
    var imageToDelete = target ? target.imagemUrl : null;

    // Primeiro apaga a imagem do Storage, depois apaga o registro do Banco
    return deleteImageFromStorageByUrl(imageToDelete).then(function () {
      var newList = (cache.notes || []).filter(function (n) { return n.id !== id; });
      persistCollection('notes', newList);
      return true;
    });
  }

  /* --- CRUD Tarefas --- */
  function getTasks() { return cache.tasks || []; }
  function getTasksBy(materia, bimestre) {
    return getTasks().filter(function (t) { return t.materia === materia && (!bimestre || t.bimestre === bimestre); });
  }

  function saveTask(task) {
    if (!isDev()) return null;
    var list = (cache.tasks || []).slice();
    var clean = {
      titulo: String(task.titulo || '').trim(),
      materia: task.materia,
      bimestre: task.bimestre,
      dataEntrega: task.dataEntrega || '',
      imagemUrl: task.imagemUrl || '',
      enunciado: sanitizeHtml(task.enunciado || ''),
      resposta: sanitizeHtml(task.resposta || '')
    };

    if (task.id) {
      var idx = list.findIndex(function (t) { return t.id === task.id; });
      if (idx !== -1) {
        // Trata imagem antiga se trocada
        if (list[idx].imagemUrl && task.imagemUrl && list[idx].imagemUrl !== task.imagemUrl) {
          deleteImageFromStorageByUrl(list[idx].imagemUrl);
        }
        clean = Object.assign({}, list[idx], clean, { id: task.id, atualizadoEm: Date.now() });
        list[idx] = clean;
      }
    } else {
      clean.id = task.id || uid();
      clean.criadoEm = Date.now();
      clean.atualizadoEm = Date.now();
      list.push(clean);
    }
    persistCollection('tasks', list);
    return clean;
  }

  function deleteTask(id) {
    if (!isDev()) return Promise.resolve(false);
    var target = (cache.tasks || []).find(function (t) { return t.id === id; });
    var imageToDelete = target ? target.imagemUrl : null;

    // Primeiro apaga a imagem do Storage, depois apaga o registro do Banco
    return deleteImageFromStorageByUrl(imageToDelete).then(function () {
      var newList = (cache.tasks || []).filter(function (t) { return t.id !== id; });
      persistCollection('tasks', newList);
      return true;
    });
  }

  /* --- CRUD Eventos --- */
  function getEvents() { return cache.events || []; }
  function saveEvent(evt) {
    if (!isDev()) return null;
    var list = (cache.events || []).slice();
    var clean = {
      titulo: String(evt.titulo || '').trim(),
      descricao: String(evt.descricao || ''),
      data: evt.data || ''
    };
    if (evt.id) {
      var idx = list.findIndex(function (e) { return e.id === evt.id; });
      if (idx !== -1) {
        clean = Object.assign({}, list[idx], clean, { id: evt.id, atualizadoEm: Date.now() });
        list[idx] = clean;
      }
    } else {
      clean.id = evt.id || uid();
      clean.criadoEm = Date.now();
      clean.atualizadoEm = Date.now();
      list.push(clean);
    }
    persistCollection('events', list);
    return clean;
  }

  function deleteEvent(id) {
    if (!isDev()) return false;
    var newList = (cache.events || []).filter(function (e) { return e.id !== id; });
    persistCollection('events', newList);
    return true;
  }

  /* --- CRUD Avisos --- */
  function getNotices() { return cache.notices || []; }
  function saveNotice(notice) {
    if (!isDev()) return null;
    var list = (cache.notices || []).slice();
    var prioridade = NOTICE_PRIORITIES.indexOf(notice.prioridade) !== -1 ? notice.prioridade : 'Normal';
    var clean = {
      titulo: String(notice.titulo || '').trim(),
      descricao: String(notice.descricao || '').trim(),
      data: notice.data || '',
      prioridade: prioridade
    };
    if (notice.id) {
      var idx = list.findIndex(function (n) { return n.id === notice.id; });
      if (idx !== -1) {
        clean = Object.assign({}, list[idx], clean, { id: notice.id, atualizadoEm: Date.now() });
        list[idx] = clean;
      }
    } else {
      clean.id = notice.id || uid();
      clean.criadoEm = Date.now();
      clean.atualizadoEm = Date.now();
      list.push(clean);
    }
    persistCollection('notices', list);
    return clean;
  }

  function deleteNotice(id) {
    if (!isDev()) return false;
    var newList = (cache.notices || []).filter(function (n) { return n.id !== id; });
    persistCollection('notices', newList);
    return true;
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

    uploadImageToStorage:        uploadImageToStorage,
    deleteImageFromStorageByUrl: deleteImageFromStorageByUrl,

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
