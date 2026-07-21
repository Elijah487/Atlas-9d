/* ============ ATLAS DATA LAYER (atlas-data.js) ============ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, get, set, child, onValue, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, onAuthStateChanged, signOut, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

(function () {
  'use strict';

  var firebaseConfig = {
    databaseURL: "https://atlas-9d-default-rtdb.firebaseio.com"
  };

  var app = initializeApp(firebaseConfig);
  var db = getDatabase(app);
  var auth = getAuth(app);

  var SUBJECTS = [
    "Matemática",
    "Língua Portuguesa",
    "História",
    "Geografia",
    "Ciências",
    "Inglês",
    "Educação Física",
    "Arte",
    "Ensino Religioso"
  ];

  var BIMESTRES = [
    "1º Bimestre",
    "2º Bimestre",
    "3º Bimestre",
    "4º Bimestre"
  ];

  var STORAGE_KEY = 'atlas_9d_local_data_v1';
  var listeners = [];

  var _data = {
    tasks: [],
    notes: [],
    events: [],
    notices: []
  };

  function uid() {
    return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
  }

  function slugify(text) {
    if (!text) return '';
    return text.toString().toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function _loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        _data.tasks = parsed.tasks || [];
        _data.notes = parsed.notes || [];
        _data.events = parsed.events || [];
        _data.notices = parsed.notices || [];
      }
    } catch (e) {
      console.warn('AtlasData: Falha ao carregar do LocalStorage', e);
    }
  }

  function _saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_data));
    } catch (e) {
      console.warn('AtlasData: Falha ao salvar no LocalStorage', e);
    }
  }

  function notifyDataChange() {
    listeners.forEach(function (cb) {
      try { cb(_data); } catch (e) { console.error(e); }
    });
  }

  // --- Sincronização em Tempo Real com o Firebase ---
  var rootRef = ref(db, 'atlas_data');
  onValue(rootRef, function (snapshot) {
    if (snapshot.exists()) {
      var val = snapshot.val() || {};
      _data.tasks = val.tasks ? Object.values(val.tasks) : [];
      _data.notes = val.notes ? Object.values(val.notes) : [];
      _data.events = val.events ? Object.values(val.events) : [];
      _data.notices = val.notices ? Object.values(val.notices) : [];
      _saveLocal();
      notifyDataChange();
    }
  });

  _loadLocal();

  /* ============ MÉTODOS DE TAREFA ============ */
  function getTasks() {
    return _data.tasks || [];
  }

  function getTasksBy(filter) {
    filter = filter || {};
    return getTasks().filter(function (t) {
      if (filter.materia && slugify(t.materia) !== slugify(filter.materia)) return false;
      if (filter.bimestre && String(t.bimestre) !== String(filter.bimestre)) return false;
      return true;
    });
  }

  function saveTask(task) {
    if (!task || !task.titulo || !task.materia) return null;

    var tasks = getTasks();
    var existingIndex = task.id ? tasks.findIndex(function (t) { return t.id === task.id; }) : -1;

    var taskData = {
      id: (existingIndex >= 0) ? tasks[existingIndex].id : (task.id || 'task-' + uid()),
      titulo: String(task.titulo).trim(),
      materia: String(task.materia).trim(),
      bimestre: String(task.bimestre || '1º Bimestre'),
      dataEntrega: task.dataEntrega || '',
      resposta: task.resposta || '',
      criadoEm: (existingIndex >= 0 && tasks[existingIndex].criadoEm) ? tasks[existingIndex].criadoEm : new Date().toISOString(),
      atualizadoEm: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      tasks[existingIndex] = taskData;
    } else {
      tasks.push(taskData);
    }
    _data.tasks = tasks;
    _saveLocal();

    try {
      set(ref(db, 'atlas_data/tasks/' + taskData.id), taskData);
    } catch (err) {
      console.error('AtlasData: Falha na requisição ao Firebase:', err);
    }

    notifyDataChange();
    return taskData;
  }

  function deleteTask(id) {
    if (!id) return false;

    var tasks = getTasks();
    var filtered = tasks.filter(function (t) { return t.id !== id; });

    if (filtered.length === tasks.length) return false;

    _data.tasks = filtered;
    _saveLocal();

    try {
      set(ref(db, 'atlas_data/tasks/' + id), null);
    } catch (err) {
      console.error('AtlasData: Falha ao remover do Firebase:', err);
    }

    notifyDataChange();
    return true;
  }

  /* ============ MÉTODOS DE ANOTAÇÕES ============ */
  function getNotes() { return _data.notes || []; }
  function getNotesBy(filter) {
    filter = filter || {};
    return getNotes().filter(function (n) {
      if (filter.materia && slugify(n.materia) !== slugify(filter.materia)) return false;
      if (filter.bimestre && String(n.bimestre) !== String(filter.bimestre)) return false;
      return true;
    });
  }
  function saveNote(note) {
    if (!note || !note.titulo || !note.materia) return null;
    var notes = getNotes();
    var existingIndex = note.id ? notes.findIndex(function (n) { return n.id === note.id; }) : -1;
    var noteData = {
      id: (existingIndex >= 0) ? notes[existingIndex].id : (note.id || 'note-' + uid()),
      titulo: String(note.titulo).trim(),
      materia: String(note.materia).trim(),
      bimestre: String(note.bimestre || '1º Bimestre'),
      conteudo: note.conteudo || '',
      criadoEm: (existingIndex >= 0 && notes[existingIndex].criadoEm) ? notes[existingIndex].criadoEm : new Date().toISOString(),
      atualizadoEm: new Date().toISOString()
    };
    if (existingIndex >= 0) notes[existingIndex] = noteData;
    else notes.push(noteData);
    _data.notes = notes;
    _saveLocal();
    try { set(ref(db, 'atlas_data/notes/' + noteData.id), noteData); } catch (err) {}
    notifyDataChange();
    return noteData;
  }
  function deleteNote(id) {
    if (!id) return false;
    var notes = getNotes();
    var filtered = notes.filter(function (n) { return n.id !== id; });
    if (filtered.length === notes.length) return false;
    _data.notes = filtered;
    _saveLocal();
    try { set(ref(db, 'atlas_data/notes/' + id), null); } catch (err) {}
    notifyDataChange();
    return true;
  }

  /* ============ MÉTODOS DE CALENDÁRIO / EVENTOS ============ */
  function getEvents() { return _data.events || []; }
  function saveEvent(evt) {
    if (!evt || !evt.titulo || !evt.data) return null;
    var events = getEvents();
    var existingIndex = evt.id ? events.findIndex(function (e) { return e.id === evt.id; }) : -1;
    var evtData = {
      id: (existingIndex >= 0) ? events[existingIndex].id : (evt.id || 'evt-' + uid()),
      titulo: String(evt.titulo).trim(),
      data: evt.data,
      tipo: evt.tipo || 'prova',
      materia: evt.materia || '',
      descricao: evt.descricao || ''
    };
    if (existingIndex >= 0) events[existingIndex] = evtData;
    else events.push(evtData);
    _data.events = events;
    _saveLocal();
    try { set(ref(db, 'atlas_data/events/' + evtData.id), evtData); } catch (err) {}
    notifyDataChange();
    return evtData;
  }
  function deleteEvent(id) {
    if (!id) return false;
    var events = getEvents();
    var filtered = events.filter(function (e) { return e.id !== id; });
    if (filtered.length === events.length) return false;
    _data.events = filtered;
    _saveLocal();
    try { set(ref(db, 'atlas_data/events/' + id), null); } catch (err) {}
    notifyDataChange();
    return true;
  }

  /* ============ MÉTODOS DE AVISOS / MURAL ============ */
  function getNotices() { return _data.notices || []; }
  function saveNotice(notice) {
    if (!notice || !notice.titulo) return null;
    var notices = getNotices();
    var existingIndex = notice.id ? notices.findIndex(function (n) { return n.id === notice.id; }) : -1;
    var noticeData = {
      id: (existingIndex >= 0) ? notices[existingIndex].id : (notice.id || 'notice-' + uid()),
      titulo: String(notice.titulo).trim(),
      conteudo: notice.conteudo || '',
      data: notice.data || new Date().toISOString()
    };
    if (existingIndex >= 0) notices[existingIndex] = noticeData;
    else notices.push(noticeData);
    _data.notices = notices;
    _saveLocal();
    try { set(ref(db, 'atlas_data/notices/' + noticeData.id), noticeData); } catch (err) {}
    notifyDataChange();
    return noticeData;
  }
  function deleteNotice(id) {
    if (!id) return false;
    var notices = getNotices();
    var filtered = notices.filter(function (n) { return n.id !== id; });
    if (filtered.length === notices.length) return false;
    _data.notices = filtered;
    _saveLocal();
    try { set(ref(db, 'atlas_data/notices/' + id), null); } catch (err) {}
    notifyDataChange();
    return true;
  }

  /* ============ AUTENTICAÇÃO E SESSÃO ============ */
  function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password)
      .then(function (userCredential) {
        var user = userCredential.user;
        localStorage.setItem('atlas_user_session', 'true');
        
        // Verifica se é o Dev exato pelas regras do Firebase
        if (user.uid === 'dEwAC2T3aOYsk7JGxuOoiS7wBsW2') {
          localStorage.setItem('atlas_dev_session', 'true');
        }
        return user;
      });
  }

  function isDev() {
    var user = auth.currentUser;
    if (user && user.uid === 'dEwAC2T3aOYsk7JGxuOoiS7wBsW2') return true;
    return localStorage.getItem('atlas_dev_session') === 'true';
  }

  function requireSession(redirectUrl) {
    onAuthStateChanged(auth, function (user) {
      if (!user && !localStorage.getItem('atlas_user_session')) {
        window.location.href = redirectUrl || 'index.html';
      }
    });
  }

  function logout() {
    localStorage.removeItem('atlas_user_session');
    localStorage.removeItem('atlas_dev_session');
    signOut(auth).then(function () {
      window.location.href = 'index.html';
    });
  }

  function injectDevBanner() {
    if (isDev() && !document.getElementById('atlasDevBanner')) {
      var banner = document.createElement('div');
      banner.id = 'atlasDevBanner';
      banner.style.cssText = 'background:#5c2222; color:#ffb4b4; font-size:12px; font-weight:600; text-align:center; padding:4px; position:fixed; top:0; left:0; right:0; z-index:9999; border-bottom:1px solid #732a2a;';
      banner.textContent = 'Modo Desenvolvedor Ativo';
      document.body.prepend(banner);
    }
  }

  /* ============ EXPOSIÇÃO GLOBAL ============ */
  window.AtlasData = {
    SUBJECTS: SUBJECTS,
    BIMESTRES: BIMESTRES,
    slugify: slugify,
    
    getTasks: getTasks, getTasksBy: getTasksBy, saveTask: saveTask, deleteTask: deleteTask,
    getNotes: getNotes, getNotesBy: getNotesBy, saveNote: saveNote, deleteNote: deleteNote,
    getEvents: getEvents, saveEvent: saveEvent, deleteEvent: deleteEvent,
    getNotices: getNotices, saveNotice: saveNotice, deleteNotice: deleteNotice,
    
    // Auth (Adicionado!)
    login: login,
    isDev: isDev,
    requireSession: requireSession,
    logout: logout,
    injectDevBanner: injectDevBanner,
    onDataChange: function (cb) {
      if (typeof cb === 'function') listeners.push(cb);
    }
  };

  document.dispatchEvent(new CustomEvent('atlas-data-ready'));
})();
