//variables globales
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAJSv5Ir-HvjQ0QSEEuodnJ3LDsszjT89A",
  authDomain: "looptech-7c8de.firebaseapp.com",
  databaseURL: "https://looptech-7c8de-default-rtdb.firebaseio.com",
  projectId: "looptech-7c8de",
  storageBucket: "looptech-7c8de.firebasestorage.app",
  messagingSenderId: "316927186873",
  appId: "1:316927186873:web:e266046e10a1e902928868",
  measurementId: "G-PLW2PG10L5"
};


let db = null, auth = null, fbReady = false;

try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
  auth = firebase.auth();
  fbReady = true;
} catch(e) {
  console.error("Error al conectar con Firebase:", e);
}

//estado global
let currentUser  = null;
let allItems     = [];
let allMsgs      = [];
let filterType   = 'all';
let filterCond   = 'all';
let filterCat    = null;
let sortMode     = 'recent';
let selEmoji     = '💻';
let stats        = { items:0, users:0, swaps:0, msgs:0 };

// estado del chat
let currentChatId = 'global';
let chatListener  = null;

//inicializa

window.addEventListener('load', () => {

  setTimeout(() => {
    const loader = document.getElementById('loading');
    if(loader) {
      loader.style.opacity = '0';
      setTimeout(() => loader.remove(), 400);
    }
  }, 1800);

  buildEmojiPicker();
  if (fbReady) initFirebase();
});

function initFirebase() {
//autenticación
  auth.onAuthStateChanged(user => {
    if (user) {
      db.ref('users/' + user.uid).once('value').then(snap => {
        const data = snap.val() || {};
        currentUser = { 
          uid: user.uid, 
          email: user.email, 
          name: data.name || user.email.split('@')[0], 
          initials: data.initials || '?', 
          career: data.career || '' 
        };
        applyLogin();

  //detectar usuario online
        const userStatusRef = db.ref('status/' + user.uid);
        db.ref('.info/connected').on('value', snap => {
          if (snap.val() === true) {
            // si se sale ps ya offline
            userStatusRef.onDisconnect().set({ state: 'offline', last_changed: Date.now() });
            // practicamente el else xd
            userStatusRef.set({ state: 'online', last_changed: Date.now() });
          }
        });
      });
    } else {
      // lo mismo pero si cierra sesion
      if (currentUser) {
        db.ref('status/' + currentUser.uid).set({ state: 'offline', last_changed: Date.now() });
      }
      currentUser = null;
      applyLogout();
    }
  });
  //solo lo detecta onkije cuando esta logeado
  
  // 2. contador de usuarios online en tiempo real
  db.ref('status').on('value', snap => {
    let count = 0;
    snap.forEach(u => {
      if (u.val().state === 'online') count++;
    });
    const onlineEl = document.getElementById('onlineN');
    if(onlineEl) onlineEl.textContent = count;
  });

  // 3. articulos en tiemo real
  db.ref('items').orderByChild('ts').on('value', snap => {
    allItems = [];
    snap.forEach(child => {
      const item = child.val();
      if (item.status !== 'completado') {
        allItems.unshift({ id: child.key, ...item });
      }
    });
    stats.items = allItems.length;
    renderItems();
    updateStats();
  });

  // stats globales
  db.ref('users').on('value', snap => { 
    stats.users = snap.numChildren(); 
    updateStats(); 
  });
  
  db.ref('stats/global/totalCompletados').on('value', snap => { 
    stats.swaps = snap.val() || 0; 
    updateStats(); 
  });

  // iniciar chat global
  switchChat('global', 'CHAT GLOBAL');

  // Escuchar lista de chats del usuario para el contador
  auth.onAuthStateChanged(user => {
    if (user) {
      db.ref(`user_chats/${user.uid}`).on('value', snap => {
        const count = snap.numChildren();
        const cntEl = document.getElementById('cnt-msgs');
        if(cntEl) cntEl.textContent = count;
      });
    }
  });
}

//chat privado y global
function getRoomId(uid1, uid2) {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
}

function switchChat(roomId, title) {
  currentChatId = roomId;
  
  // Actualizar UI
  const titleEl = document.getElementById('chatTitle');
  if(titleEl) titleEl.textContent = `// ${title.toUpperCase()}`;
  
  const backBtn = document.getElementById('backToGlobal');
  if(backBtn) backBtn.style.display = (roomId === 'global') ? 'none' : 'block';

// Mostrar panel de chat en móvil y pc 
const chatPanel = document.querySelector('.chat');
if(chatPanel) {
  chatPanel.classList.add('open');
  chatPanel.classList.remove('desktop-hidden');
}

  // Cambiar suscripción de Firebase
  if (chatListener) chatListener.off();
  
  const path = (roomId === 'global') ? 'chat' : `private_chats/${roomId}`;
  chatListener = db.ref(path).limitToLast(50);
  
  chatListener.on('value', snap => {
    allMsgs = [];
    snap.forEach(child => {
      const m = child.val();
      if(m && typeof m === 'object') allMsgs.push(m);
    });
    
    if(roomId === 'global') stats.msgs = allMsgs.filter(m => !m.system).length;
    renderChat();
    updateStats();
  });
}

function contactUser(sellerUid, sellerName, itemTitle) {
  if (!currentUser) { openModal('authM'); return; }
  
  // Evitar chatear con uno mismo
  const targetUid = (sellerUid && sellerUid !== 'undefined') ? sellerUid : null;
  if (!targetUid || targetUid === currentUser.uid) { 
    toast('🏠', 'Es tu propio artículo'); 
    return; 
  }

  const roomId = getRoomId(currentUser.uid, targetUid);
  switchChat(roomId, sellerName);

  const input = document.getElementById('msgIn');
  if(input) {
    input.value = `Hola ${sellerName}, me interesa tu artículo: "${itemTitle}"`;
    input.focus();
  }
  db.ref(`user_chats/${currentUser.uid}/${roomId}`).set({
  with: sellerName,
  uid: sellerUid
});

db.ref(`user_chats/${sellerUid}/${roomId}`).set({
  with: currentUser.name,
  uid: currentUser.uid
});
}

function sendMsg() {
  if (!currentUser) { toast('⚠️', 'Inicia sesión para chatear', true); return; }
  const text = v('msgIn');
  if (!text) return;

  // filtro de palabras
  const textoFiltrado = censurarTexto(text);

  const now = new Date();
  const msg = {
    user: currentUser.name,
    userInit: currentUser.initials,
    uid: currentUser.uid,
    text: textoFiltrado, // Guardamos el texto ya censurado
    time: `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`,
    ts: Date.now()
  };

  const path = (currentChatId === 'global') ? 'chat' : `private_chats/${currentChatId}`;
  db.ref(path).push(msg);
  document.getElementById('msgIn').value = '';
}

function renderChat() {
  const container = document.getElementById('msgs');
  if(!container) return;

  container.innerHTML = allMsgs.map(m => {
    if (m.system) return `<div class="sys-msg">${m.text}</div>`;
    const me = currentUser && m.uid === currentUser.uid;
    return `
      <div class="msg${me ? ' me' : ''}">
        <div class="msg-hd">
          ${!me ? `<span class="msg-name">${m.userInit}</span>` : ''}
          <span class="msg-ts">${m.time}</span>
        </div>
        <div class="bubble">${escHtml(m.text)}</div>
      </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function cerrarChatMovil() {
  const chatPanel = document.querySelector('.chat');
  if(chatPanel) {
    chatPanel.classList.remove('open'); // Lo oculta en celular
    chatPanel.classList.add('desktop-hidden'); // Lo oculta en PC
  }
}

function toggleChatMovil() {
  const chatPanel = document.querySelector('.chat');
  if(chatPanel) {
    // 'open' controla el deslizamiento en móvil
    chatPanel.classList.toggle('open'); 
    // 'desktop-hidden' controla la visibilidad en PC
    chatPanel.classList.toggle('desktop-hidden');
  }
}

//marketplace

function doPublish() {
  if (!currentUser) return;
  
  const title = v('pTitle'), desc = v('pDesc'),
        cat = v('pCat'), cond = v('pCond'),
        type = v('pType'), price = parseFloat(v('pPrice')) || 0,
        loc = v('pLocation');

  if (!title || !cat || !type) { toast('⚠️', 'Faltan campos críticos', true); return; }

  const item = {
    emoji: selEmoji, title, desc, category: cat, condition: cond,
    type, price, location: loc, status: 'activo',
    user: currentUser.name, userInit: currentUser.initials,
    uid: currentUser.uid, ts: Date.now(), rating: 5.0
  };

  db.ref('items').push(item).then(() => {
    closeModal('pubM');
    clearPublishForm();
    toast('✓', '¡Publicado con éxito!');
  }).catch(err => toast('⚠️', err.message, true));
}

function finalizarIntercambio(itemId) {
  if (!confirm("¿Seguro que quieres marcar este intercambio como finalizado?")) return;

  db.ref('items/' + itemId).update({ 
    status: 'completado', 
    tsCompletado: Date.now() 
  }).then(() => {
    // Incrementar contador global mediante transacción segura
    db.ref('stats/global/totalCompletados').transaction(current => (current || 0) + 1);
    toast('🤝', 'Intercambio finalizado');
    closeModal('detM');
  });
}

function renderItems() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  let items = [...allItems];

  // Filtros
  if (filterType !== 'all') items = items.filter(i => i.type === filterType);
  if (filterCat)            items = items.filter(i => i.category === filterCat);
  if (filterCond !== 'all') items = items.filter(i => i.condition === filterCond);
  if (q) items = items.filter(i => i.title.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));

  // Orden
  if(sortMode === 'asc') items.sort((a,b) => a.price - b.price);
  else if(sortMode === 'desc') items.sort((a,b) => b.price - a.price);
  else items.sort((a,b) => b.ts - a.ts);

  const grid = document.getElementById('grid');
  if(!grid) return;

  if (items.length === 0) {
    grid.innerHTML = `<div class="empty"><div class="e-ico">◎</div><p>No hay artículos con estos filtros</p></div>`;
    return;
  }

  grid.innerHTML = items.map(item => {
    const condCls = item.condition === 'Nuevo' ? 'cn' : item.condition === 'Buen estado' ? 'cb' : 'cr';
    const priceLabel = item.type === 'sale' ? `$${Number(item.price).toLocaleString()}` : item.type === 'donate' ? 'Gratis' : 'Intercambio';
    
    return `
    <div class="card" onclick="openDetail('${item.id}')">
      <div class="card-img">
        ${item.emoji}
        <span class="card-type t-${item.type}">${translateType(item.type)}</span>
        <span class="card-cond ${condCls}">${item.condition}</span>
      </div>
      <div class="card-body">
        <div class="card-title">${escHtml(item.title)}</div>
        <div class="card-price">${priceLabel}</div>
        <span class="card-tag">${item.category}</span>
      </div>
      <div class="card-foot">
        <div class="foot-av">${item.userInit}</div>
        <span class="foot-user">${item.user}</span>
        <span class="foot-time">${timeAgo(item.ts)}</span>
        <div class="foot-btns">
          <div class="ic-btn" onclick="event.stopPropagation();contactUser('${item.uid}','${item.user}','${escAttr(item.title)}')">✉</div>
        </div>
      </div>
    </div>`;
  }).join('');
}
function translateType(type){
  return {
    swap: 'Intercambio',
    sale: 'Venta',
    donate: 'Donación'
  }[type] || type;
}

function openDetail(id) {
  const item = allItems.find(i => i.id === id);
  if (!item) return;

  const esDueño = currentUser && item.uid === currentUser.uid;
  const locText = (item.location && item.location !== 'undefined') ? item.location : 'A convenir';
  const priceText = item.type === 'sale' ? `$${Number(item.price).toLocaleString()} MXN` : item.type === 'donate' ? 'GRATIS' : 'INTERCAMBIO';

  document.getElementById('detContent').innerHTML = `
    <div class="modal-title">// ${escHtml(item.title.toUpperCase())}</div>
    <button class="x-btn" onclick="closeModal('detM')">×</button>
    <div class="det-img">${item.emoji}</div>
    
    <div style="display:flex; gap:.8rem; flex-wrap:wrap; margin-bottom:1rem;">
      <span class="det-price">${priceText}</span>
      <span class="card-tag" style="background:rgba(61,255,160,0.1); color:var(--accent);"> ${locText}</span>
    </div>

    <div class="det-desc">${escHtml(item.desc || 'Sin descripción.')}</div>
    
    <div class="det-row">
      <button class="det-btn db-pri" onclick="contactUser('${item.uid}','${item.user}','${escAttr(item.title)}'); closeModal('detM')">✉ Contactar</button>
      ${esDueño ? 
        `<button class="det-btn" style="background:var(--accent2); color:#000; border:none;" onclick="finalizarIntercambio('${item.id}')"> Finalizar Trato</button>` : 
        `<button class="det-btn db-sec" onclick="toast('⤴','Enlace copiado')">⤴ Compartir</button>`
      }
    </div>

    <div class="seller-box">
      <div class="seller-av">${item.userInit}</div>
      <div style="flex:1">
        <div class="seller-name">${item.user}</div>
        <div class="seller-sub">${item.career || 'Estudiante'} · ${timeAgo(item.ts)}</div>
      </div>
    </div>`;
  
  openModal('detM');
}

function showInbox(el) {
  if (!currentUser) { openModal('authM'); return; }
  updateSidebarUI(el);
  
  const grid = document.getElementById('grid');
  grid.innerHTML = '<div class="empty"><p>Cargando tus conversaciones...</p></div>';

  db.ref(`user_chats/${currentUser.uid}`).once('value', snap => {
    grid.innerHTML = '';
    const chats = [];
    snap.forEach(child => {
      chats.push({ id: child.key, ...child.val() });
    });

    if (chats.length === 0) {
      grid.innerHTML = '<div class="empty"><div class="e-ico">✉</div><p>Aún no tienes mensajes directos.</p></div>';
      return;
    }

    grid.className = 'inbox-list'; // Cgrid a lista
    grid.innerHTML = chats.map(chat => `
      <div class="inbox-item" onclick="switchChat('${chat.id}', '${chat.with}')">
        <div class="seller-av">${chat.with.charAt(0).toUpperCase()}</div>
        <div class="inbox-info">
          <div class="inbox-name">${chat.with}</div>
          <div class="inbox-sub">Toca para reanudar la conversación</div>
        </div>
        <div class="ic">➜</div>
      </div>
    `).join('');
  });
}


function resetGridLayout() {
  const grid = document.getElementById('grid');
  if(grid) grid.className = 'grid';
}

// Filtro de palabras y helpers
const palabrasProhibidas = [
  'puto', 'puta', 'pendejo', 'pendeja', 'mierda', 'cabrón', 'cabrona',
  'chinga', 'chingada', 'pinche', 'verga', 'pito', 'culero', 'culera',
  'mamada', 'perra', 'idiota', 'estúpido', 'estúpida', 'imbécil',
  'joto', 'maricón', 'zorra', 'ramera', 'puñetas', 'coño', 'gilipollas', 'hijo de puta', 'maldito', 'maldita', 'pendejazo', 'pendejaza', 'cabronear', 'chingar', 'chingaré', 'chinga tu madre', 'pinche loco', 'pinche loca'
  ,'puto el que lo lea', 'puta la que lo parió', 'pendejo el que lo lea', 'chinga tu madre', 'pinche loco', 'pinche loca', 'hijo de puta el que lo lea', 'maldito el que lo lea', 'maldita la que lo lea', 'cabrón el que lo lea', 'cabrona la que lo lea', 'zorra la que lo lea', 'perra la que lo lea', 'idiota el que lo lea', 'estúpido el que lo lea', 'estúpida la que lo lea', 'imbécil el que lo lea', 'joto el que lo lea', 'maricón el que lo lea'
  , 'puto', 'puta', 'pendejo', 'pendeja', 'mierda', 'cabrón', 'cabrona','inminencia', 'ano',
];

function censurarTexto(texto) {
  let textoLimpio = texto;
  
  palabrasProhibidas.forEach(palabra => {
      //practicamente un tolowercase global con word boundary para evitar censurar palabras dentro de otras
    const regex = new RegExp(`\\b${palabra}\\b`, 'gi');
    
    //censura
    const censura = '*'.repeat(palabra.length);
    
    textoLimpio = textoLimpio.replace(regex, censura);
  });
  
  return textoLimpio;
}
function v(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

function escHtml(s) { return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function escAttr(s) { return String(s).replace(/'/g,"\\'"); }

function timeAgo(ts) {
  if(!ts) return 'hace poco';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'ahora';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h';
  return Math.floor(diff/86400000) + 'd';
}

function toast(icon, msg, err=false) {
  const container = document.getElementById('toasts');
  if(!container) return;
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
}

function buildEmojiPicker() {
  const emojis = ['💻','🖥️','📱','🎧','🎮','🔌','🔋','⚙️','🛠️','💡','📡','🧩','⚡','🔧'];
  const p = document.getElementById('epick');
  if(!p) return;
  p.innerHTML = emojis.map(e => `
    <div class="ep ${e === selEmoji ? 'on' : ''}" onclick="setEmoji('${e}', this)">${e}</div>
  `).join('');
}

function setEmoji(e, el) {
  selEmoji = e;
  document.querySelectorAll('.ep').forEach(x => x.classList.remove('on'));
  el.classList.add('on');
}

// AUTH UI
function doLogin() {
  const e = v('lEmail'), p = v('lPass');
  auth.signInWithEmailAndPassword(e, p)
    .then(() => closeModal('authM'))
    .catch(err => toast('⚠️', 'Credenciales incorrectas', true));
}

function doRegister() {
  const n = v('rName'), l = v('rLast'), e = v('rEmail'), p = v('rPass'), p2 = v('rPass2'), c = v('rCareer');
  if(p !== p2) return toast('⚠️', 'Contraseñas no coinciden', true);
  
  auth.createUserWithEmailAndPassword(e, p).then(cred => {
    return db.ref('users/' + cred.user.uid).set({ 
      name: `${n} ${l.charAt(0)}.`, initials: (n[0]+l[0]).toUpperCase(), career: c, email: e 
    });
  }).then(() => closeModal('authM')).catch(err => toast('⚠️', err.message, true));
}

function applyLogin() {
  const av = document.getElementById('ava');
  if(av) { av.style.display = 'flex'; av.textContent = currentUser.initials; }
  document.getElementById('pubBtn').style.display = 'inline-flex';
  document.getElementById('loginBtn').style.display = 'none';
  document.getElementById('pdName').textContent = currentUser.name;
  document.getElementById('pdEmail').textContent = currentUser.email;
}

function applyLogout() {
  document.getElementById('ava').style.display = 'none';
  document.getElementById('pubBtn').style.display = 'none';
  document.getElementById('loginBtn').style.display = 'inline-flex';
}

function logout() { auth.signOut(); }

function openModal(id) { const m = document.getElementById(id); if(m) m.classList.add('open'); }
function closeModal(id) { const m = document.getElementById(id); if(m) m.classList.remove('open'); }
function closeBg(e, id) { if(e.target.id === id) closeModal(id); }
function toggleDrop() { document.getElementById('pdrop').classList.toggle('open'); }

function swTab(t) {
  document.getElementById('tp-login').classList.toggle('on', t === 'login');
  document.getElementById('tp-reg').classList.toggle('on', t === 'reg');
  document.querySelectorAll('.tab').forEach((el, i) => el.classList.toggle('on', i === (t === 'login' ? 0 : 1)));
}

function setType(t, el) { resetGridLayout(); filterType = t; updateSidebarUI(el); renderItems(); }
function setCat(c, el) { resetGridLayout(); filterCat = c; updateSidebarUI(el); renderItems(); }
function setCond(c, el) { filterCond = c; document.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); el.classList.add('on'); renderItems(); }
function setSort(s) { sortMode = s; renderItems(); }

function updateSidebarUI(el) {
  document.querySelectorAll('.sb-item').forEach(x => x.classList.remove('active'));
  if(el) el.classList.add('active');
}

function updateStats() {
  const keys = ['Items', 'Users', 'Swaps', 'Msgs'];
  keys.forEach(k => {
    const el = document.getElementById('s' + k);
    if(el) el.textContent = stats[k.toLowerCase()];
  });
}
function checkAuthPublish() {
  if (!currentUser) {
    openModal('authM');
    return;
  }
  openModal('pubM');
}

function clearPublishForm() {
  ['pTitle', 'pDesc', 'pPrice'].forEach(id => document.getElementById(id).value = '');
}

function myItems() {
  if (!currentUser) return;
  document.getElementById('pdrop').classList.remove('open');
  const mine = allItems.filter(i => i.uid === currentUser.uid);
  const grid = document.getElementById('grid');
  grid.innerHTML = mine.length ? mine.map(item => `
    <div class="card" onclick="openDetail('${item.id}')">
      <div class="card-img">${item.emoji}</div>
      <div class="card-body">
        <div class="card-title">${escHtml(item.title)}</div>
        <div class="card-price">Tus artículos</div>
      </div>
    </div>`).join('') : '<div class="empty"><p>No has publicado nada aún</p></div>';
}