// Espace web TokTok Game Connector Live (100 % gratuit) : accueil, catalogue des jeux, téléchargements.
// Aucun framework : rendu par chaînes de caractères (toujours via esc() pour les données) et routes en #/…
'use strict';

const REPO = 'dexsdev329-afk/toktok-connector';
const REPO_REF = 'claude/inspiring-pascal-f38kve';
const REPO_URL = `https://github.com/${REPO}`;
const RELEASES_URL = `${REPO_URL}/releases`;
const ROOMS_URL = 'https://rooms-server-production.up.railway.app';
const tree = (path) => `${REPO_URL}/tree/${REPO_REF}/${path}`;
const blob = (path) => `${REPO_URL}/blob/${REPO_REF}/${path}`;

/** Jeux et familles de jeux compatibles. Visuels originaux (dégradés + emoji), aucun logo officiel. */
const GAMES = [
  {
    id: 'minecraft-java',
    name: 'Minecraft Java',
    emoji: '⛏️',
    colors: ['#3f8f3a', '#1f4d1d'],
    genre: 'Sandbox',
    how: 'RCON (serveur local ou hébergé)',
    level: 'Facile',
    short:
      'Les cadeaux font apparaître des mobs nommés au pseudo du viewer, de la TNT, des effets, des objets…',
    effects: [
      'Mobs nommés (zombie, creeper, warden…)',
      'TNT et pluie de TNT',
      'Effets de potion, météo, heure',
      'Objets, titres à l’écran, messages',
      'Commandes libres avec variables',
    ],
    steps: [
      'Dans <code>server.properties</code> : <code>enable-rcon=true</code>, un <code>rcon.password</code> et <code>rcon.port=25575</code>, puis redémarre le serveur.',
      'Dans l’app : Intégrations → <b>Minecraft Java (RCON)</b> → adresse, port et mot de passe → « Tester la connexion ».',
      'Actions → « Pack Minecraft » : un profil prêt à l’emploi (rose = zombie, cadeaux plus chers = boss…).',
      'Teste tout avec le simulateur du tableau de bord avant d’aller en live.',
    ],
    downloads: [],
  },
  {
    id: 'minecraft-bedrock',
    name: 'Minecraft Bedrock',
    emoji: '🧱',
    colors: ['#5b8c32', '#2c4a17'],
    genre: 'Sandbox',
    how: 'Commande /connect (Windows 10/11)',
    level: 'Facile',
    short: 'Le jeu se connecte directement à l’app, sans serveur : idéal en solo sur PC.',
    effects: [
      'Mêmes effets que Java (syntaxe Bedrock gérée automatiquement)',
      'Fonctionne dans un monde solo',
    ],
    steps: [
      'Dans l’app : Intégrations → <b>Minecraft Bedrock (/connect)</b> (port proposé : 19131).',
      'Dans ton monde : active les commandes (triche) et désactive « Websockets chiffrés obligatoires » dans les paramètres.',
      'Dans le chat du jeu : <code>/connect localhost:19131</code>.',
      'Le statut passe à « Connecté » : charge le pack Minecraft dans Actions.',
    ],
    downloads: [],
  },
  {
    id: 'gta-chaos',
    name: 'GTA V — Chaos Mod',
    emoji: '🌀',
    colors: ['#7c3aed', '#1e1b4b'],
    genre: 'Action',
    experimental: true,
    how: 'WebSocket de debug du Chaos Mod (solo)',
    level: 'Moyen',
    short:
      'Tes viewers déclenchent les effets du Chaos Mod : gravité lunaire, piétons explosifs, météo folle…',
    effects: [
      'Un effet précis (liste lue depuis le mod)',
      'Un effet aléatoire',
      'Effets désactivés dans le mod ignorés',
    ],
    steps: [
      'Installe le Chaos Mod (mod tiers, non fourni) pour GTA V en mode histoire.',
      'Dans le dossier de GTA V, crée le fichier vide <code>chaosmod/.enabledebugsocket</code>.',
      'Dans l’app : Intégrations → <b>GTA V Chaos Mod</b>. Elle se connecte dès que le jeu est lancé.',
      'Crée tes actions avec « Déclencher un effet Chaos » ou « Effet Chaos aléatoire ».',
    ],
    downloads: [
      {
        label: 'Chaos Mod (projet officiel du mod)',
        url: 'https://github.com/gta-chaos-mod/ChaosModV',
        external: true,
      },
    ],
  },
  {
    id: 'unity-mods',
    name: 'Jeux Unity moddables',
    emoji: '🧩',
    colors: ['#0ea5e9', '#0c2a4a'],
    genre: 'Mods',
    how: 'Bridge WebSocket + plugin BepInEx',
    level: 'Avancé',
    short: 'Pour les jeux Unity : un plugin BepInEx reçoit les effets et déclare ses propres effets à l’app.',
    effects: [
      'Effets déclarés par le mod (apparaissent dans l’éditeur d’actions)',
      'Événements du live envoyés au jeu',
      'Fonctionne aussi avec MelonLoader, Lua…',
    ],
    steps: [
      'Dans l’app : Intégrations → <b>Bridge mods (WebSocket)</b> (un jeton est généré).',
      'Pars de l’exemple BepInEx fourni (C#) ou implémente le protocole dans ton mod.',
      'Le mod se connecte à <code>ws://127.0.0.1</code> avec le jeton et déclare ses effets.',
      'Tes effets apparaissent dans l’éditeur d’actions de l’app.',
    ],
    downloads: [
      { label: 'Exemple de plugin BepInEx (C#)', url: tree('examples/unity-bepinex-bridge'), external: true },
      { label: 'Protocole du bridge (documentation)', url: blob('docs/bridge-protocol.md'), external: true },
    ],
  },
  {
    id: 'any-pc',
    name: 'N’importe quel jeu PC',
    emoji: '⌨️',
    colors: ['#f43f5e', '#4c0519'],
    genre: 'Tous les jeux',
    how: 'Simulation clavier & souris',
    level: 'Facile',
    short: 'Sauter, avancer, ouvrir l’inventaire, tourner la caméra… dans le jeu au premier plan.',
    effects: [
      'Touches (appui, maintien)',
      'Souris : clic, déplacement, molette',
      'Petites séquences : <code>tap space · wait 200 · hold w 1000</code>',
    ],
    steps: [
      'Dans l’app : Intégrations → <b>Clavier &amp; souris</b>.',
      'Crée une action, effet « Séquence de touches ».',
      'Lance ton jeu au premier plan et teste avec le simulateur.',
    ],
    downloads: [],
  },
  {
    id: 'gamepad',
    name: 'Jeux à la manette / Remote Play',
    emoji: '🎮',
    colors: ['#22c55e', '#052e16'],
    genre: 'Tous les jeux',
    how: 'Manette virtuelle Xbox 360 / DualShock 4 (ViGEmBus)',
    level: 'Moyen',
    short:
      'Une manette virtuelle pilotée par le live : boutons, sticks, gâchettes. Marche aussi en Remote Play.',
    effects: ['Boutons et croix directionnelle', 'Sticks et gâchettes analogiques', 'Séquences manette'],
    steps: [
      'Installe le pilote ViGEmBus (projet tiers, à installer toi-même).',
      'Dans l’app : Intégrations → <b>Manette virtuelle</b> → type Xbox 360 ou DualShock 4.',
      'Crée tes actions avec « Séquence manette ».',
    ],
    downloads: [
      {
        label: 'Pilote ViGEmBus (projet tiers)',
        url: 'https://github.com/nefarius/ViGEmBus/releases',
        external: true,
      },
    ],
  },
  {
    id: 'browser-games',
    name: 'Jeux navigateur de la communauté',
    emoji: '🌐',
    colors: ['#06b6d4', '#083344'],
    genre: 'Communauté',
    how: 'Serveur de salles (Railway) + script client',
    level: 'Moyen',
    short:
      'Tes jeux web (Three.js, Phaser…) rejoignent une salle protégée par PIN et reçoivent les événements du live.',
    effects: [
      'Événements du live (cadeaux, likes, chat…)',
      'Effets envoyés par tes actions',
      'Plusieurs jeux par salle',
    ],
    steps: [
      'Dans l’app : Intégrations → <b>Serveur de salles</b> → adresse <code>wss://rooms-server-production.up.railway.app</code>, numéro de salle, PIN <code>0000</code>.',
      'Change tout de suite le PIN avec « 🔑 Changer le PIN ».',
      'Dans ton jeu, ajoute le script client puis rejoins la salle avec le même numéro et PIN.',
    ],
    downloads: [
      {
        label: 'Script client des salles (toktok-room-client.js)',
        url: `${ROOMS_URL}/toktok-room-client.js`,
        external: true,
      },
    ],
  },
  {
    id: 'home-games',
    name: 'Tes jeux maison',
    emoji: '🏠',
    colors: ['#f59e0b', '#451a03'],
    genre: 'Communauté',
    how: 'Dossier local ou URL, ouvert par l’app',
    level: 'Facile',
    short:
      'Ajoute un jeu web (dossier ou URL) : l’app l’ouvre dans une fenêtre ou dans OBS, connecté au live.',
    effects: ['Événements du live', 'Effets « jeu maison » avec paramètres JSON'],
    steps: [
      'Dans l’app : Jeux maison → ajoute un dossier contenant <code>index.html</code> ou une URL.',
      'Dans ton jeu, utilise le script <code>/toktok-game-client.js</code> servi par l’app.',
      'Clique « Ouvrir » ou copie l’URL dans OBS.',
    ],
    downloads: [],
  },
  {
    id: 'webhook',
    name: 'Tes serveurs et bots',
    emoji: '🔗',
    colors: ['#64748b', '#0f172a'],
    genre: 'Mods',
    how: 'Requêtes HTTP (webhook)',
    level: 'Avancé',
    short: 'Chaque action peut appeler une URL : ton bot Discord, ton serveur de jeu, n’importe quelle API.',
    effects: [
      'GET / POST / PUT…',
      'Corps JSON avec variables ({username}, {giftName}…)',
      'En-tête d’authentification chiffré',
    ],
    steps: [
      'Dans l’app : Intégrations → <b>HTTP / Webhook</b>.',
      'Crée une action avec l’effet « Requête HTTP ».',
    ],
    downloads: [],
  },
];

const GENRES = ['Tous', ...new Set(GAMES.map((g) => g.genre))];

// ---------------------------------------------------------------- helpers

const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const $view = () => document.getElementById('view');
/**
 * Card backgrounds, applied after rendering (the CSP forbids inline style attributes):
 * the game's illustration `/img/jeux/<id>.webp` over its colour gradient (if the image
 * is missing, the gradient simply stays visible).
 */
const art = (g) => `data-art="${esc(g.id)}"`;
function paintArt(root) {
  root.querySelectorAll('[data-art]').forEach((el) => {
    const g = GAMES.find((x) => x.id === el.dataset.art);
    if (!g) return;
    el.style.backgroundImage = [
      'linear-gradient(rgba(11, 11, 20, 0.1), rgba(11, 11, 20, 0.3))',
      `url('/img/jeux/${g.id}.webp')`,
      `linear-gradient(135deg, ${g.colors[0]}, ${g.colors[1]})`,
    ].join(', ');
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
  });
}
const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' });

// ---------------------------------------------------------------- views

const views = {
  '': home,
  jeux: games,
  jeu: game,
  telecharger: download,
  confidentialite: privacy,
};

function home() {
  return `
  <section class="hero">
    <div>
      <span class="badge free">100 % GRATUIT · Windows</span>
      <h1>Ton live <span class="pink">TikTok</span> ou <span class="cyan">Kick</span> pilote tes jeux.</h1>
      <p class="lead">Un cadeau fait apparaître un zombie, un follow lance une roue, un « !tnt » dans le chat fait tout
        exploser. Choisis ton jeu, installe l’app et laisse ta communauté jouer avec toi.</p>
      <div class="hero-actions">
        <a class="btn primary" href="#/telecharger">⬇ Télécharger l’app</a>
        <a class="btn" href="#/jeux">🎮 Choisir un jeu</a>
      </div>
    </div>
    <div class="hero-visual" aria-hidden="true">
      <div class="flow">
        <div class="node n1"><span class="icon">🎁</span>Cadeaux</div>
        <div class="node n2"><span class="icon">💬</span>Chat</div>
        <div class="hub"><img src="/favicon.svg" alt="" /></div>
        <div class="node n3"><span class="icon">⛏️</span>Jeux</div>
        <div class="node n4"><span class="icon">🖥️</span>Overlays</div>
      </div>
    </div>
  </section>

  <div class="section-title"><h2>Comment ça marche</h2></div>
  <div class="grid cols-3 steps">
    <div class="card step"><h3>Télécharge l’app</h3><p class="muted">Installe TokTok Game Connector Live sur ton PC Windows. Entièrement gratuit, sans compte ni abonnement.</p></div>
    <div class="card step"><h3>Choisis ton jeu</h3><p class="muted">Minecraft, GTA V, jeux Unity, jeux navigateur… Chaque jeu a son guide pas à pas.</p></div>
    <div class="card step"><h3>Connecte ton live</h3><p class="muted">Entre ton pseudo TikTok (et/ou Kick) : les cadeaux, likes et messages déclenchent tes actions.</p></div>
  </div>

  <div class="section-title"><h2>Jeux populaires</h2><a href="#/jeux">Voir tous les jeux →</a></div>
  <div class="grid cols-3">${GAMES.slice(0, 3).map(gameCard).join('')}</div>

  <div class="section-title"><h2>Tout ce qu’il faut pour un live interactif</h2></div>
  <div class="grid cols-3">
    ${[
      ['🧪', 'Simulateur', 'Teste chaque action sans être en live : cadeaux, combos, likes, chat.'],
      [
        '🖼️',
        'Overlays',
        'Alertes, top donateurs, objectif de likes, chat, roue, minuteur subathon pour OBS / LIVE Studio.',
      ],
      ['🔊', 'Sons & voix', 'Sons par action, lecture du chat avec filtre anti-insultes.'],
      ['⚡', 'Moteur d’actions', 'Cooldowns, priorités, file d’attente, multiplicateur par quantité.'],
      ['🟩', 'Multistream', 'TikTok et Kick en même temps, les mêmes actions pour les deux.'],
      [
        '🎁',
        '100 % gratuit',
        'Toutes les fonctions, tous les jeux, tous les overlays. Pas d’abonnement, pas de compte.',
      ],
      ['🔒', 'Sécurisé', 'Tout tourne sur ton PC, secrets chiffrés, serveurs locaux fermés à l’extérieur.'],
    ]
      .map(
        ([i, t, d]) =>
          `<div class="card feature"><div class="icon">${i}</div><h3>${t}</h3><p class="muted">${d}</p></div>`,
      )
      .join('')}
  </div>`;
}

function gameCard(g) {
  return `<a class="card game" href="#/jeu/${esc(g.id)}">
    <div class="art" ${art(g)}><span>${g.emoji}</span></div>
    <div class="body">
      <h3>${esc(g.name)}</h3>
      <div class="muted small">${g.short}</div>
      <div class="meta"><span class="badge">${esc(g.genre)}</span><span class="badge">${esc(g.level)}</span>${
        g.experimental ? '<span class="badge exp">EXPÉRIMENTAL</span>' : ''
      }</div>
    </div>
  </a>`;
}

const gameFilter = { genre: 'Tous', q: '' };

function games() {
  return `
  <div class="section-title first"><h2>Choisis ton jeu</h2><span class="muted">${GAMES.length} façons de connecter ton live</span></div>
  <div class="filters">
    <input id="game-search" type="search" placeholder="Rechercher un jeu…" value="${esc(gameFilter.q)}" aria-label="Rechercher" />
    ${GENRES.map((g) => `<button class="chip ${gameFilter.genre === g ? 'on' : ''}" data-genre="${esc(g)}">${esc(g)}</button>`).join('')}
  </div>
  <div id="game-grid" class="grid cols-3 gap-top"></div>`;
}

function renderGameGrid() {
  const q = gameFilter.q.trim().toLowerCase();
  const list = GAMES.filter(
    (g) =>
      (gameFilter.genre === 'Tous' || g.genre === gameFilter.genre) &&
      (!q || `${g.name} ${g.short} ${g.how}`.toLowerCase().includes(q)),
  );
  const grid = document.getElementById('game-grid');
  if (!grid) return;
  grid.innerHTML = list.length
    ? list.map(gameCard).join('')
    : '<div class="card empty">Aucun jeu ne correspond.</div>';
  paintArt(grid);
}

function game(id) {
  const g = GAMES.find((x) => x.id === id);
  if (!g) return notFound();
  return `
  <p><a href="#/jeux">← Tous les jeux</a></p>
  <div class="detail">
    <div class="card">
      <div class="art" ${art(g)}>${g.emoji}</div>
      <div class="row"><span class="badge">${esc(g.genre)}</span><span class="badge">${esc(g.level)}</span>${
        g.experimental ? '<span class="badge exp">EXPÉRIMENTAL</span>' : ''
      }</div>
      <h1 class="gap-top">${esc(g.name)}</h1>
      <p class="muted">${g.short}</p>
      <h3>Installation</h3>
      <ol class="guide">${g.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    </div>
    <div class="stack">
      <div class="card">
        <h3>Connexion</h3>
        <p class="muted">${esc(g.how)}</p>
        <h3>Ce que tes viewers peuvent faire</h3>
        <ul class="list-plain">${g.effects.map((e) => `<li>${e}</li>`).join('')}</ul>
      </div>
      <div class="card">
        <h3>Téléchargements</h3>
        <ul class="list-plain">
          <li><a href="#/telecharger">⬇ TokTok Game Connector Live (Windows)</a></li>
          ${g.downloads.map((d) => `<li><a href="${esc(d.url)}" rel="noopener" target="_blank">↗ ${esc(d.label)}</a></li>`).join('')}
        </ul>
      </div>
    </div>
  </div>`;
}

function download() {
  setTimeout(loadRelease, 0);
  return `
  <div class="card download-hero">
    <div class="big">⬇</div>
    <div class="grow">
      <h1>TokTok Game Connector Live</h1>
      <p class="muted">Windows 10 / 11 (64 bits) · 100 % gratuit, sans compte · mises à jour automatiques</p>
      <div id="release" class="row gap-top"><span class="muted">Recherche de la dernière version…</span></div>
    </div>
  </div>
  <div class="section-title"><h2>Outils et compléments</h2></div>
  <div class="grid cols-2">
    <div class="card"><h3>🌐 Jeux navigateur</h3><p class="muted">Script client du serveur de salles, à inclure dans ton jeu web.</p>
      <a class="btn small" href="${ROOMS_URL}/toktok-room-client.js" rel="noopener" target="_blank">toktok-room-client.js</a></div>
    <div class="card"><h3>🧩 Mods Unity</h3><p class="muted">Exemple de plugin BepInEx (C#) et documentation du protocole.</p>
      <div class="row"><a class="btn small" href="${tree('examples/unity-bepinex-bridge')}" rel="noopener" target="_blank">Exemple BepInEx</a>
      <a class="btn small ghost" href="${blob('docs/bridge-protocol.md')}" rel="noopener" target="_blank">Protocole</a></div></div>
  </div>
  <p class="muted small gap-top">L’installateur n’est pas signé : au premier lancement, Windows SmartScreen peut afficher
    « Informations complémentaires → Exécuter quand même ». Toutes les versions : <a href="${RELEASES_URL}" rel="noopener">GitHub Releases</a>.</p>`;
}

async function loadRelease() {
  const box = document.getElementById('release');
  if (!box) return;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) throw new Error('none');
    if (!res.ok) throw new Error(String(res.status));
    const rel = await res.json();
    const exe = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
    const size = exe ? ` · ${(exe.size / 1048576).toFixed(0)} Mo` : '';
    box.innerHTML = exe
      ? `<a class="btn primary" href="${esc(exe.browser_download_url)}">⬇ Télécharger ${esc(rel.tag_name)} (.exe)</a>
         <span class="muted small">${esc(dateFmt.format(new Date(rel.published_at)))}${size}</span>`
      : `<a class="btn primary" href="${esc(rel.html_url)}" rel="noopener">Voir la version ${esc(rel.tag_name)}</a>`;
  } catch (err) {
    box.innerHTML =
      err.message === 'none'
        ? `<span class="notice">La première version publique arrive bientôt. <a href="${RELEASES_URL}" rel="noopener">Suivre les versions</a></span>`
        : `<a class="btn" href="${RELEASES_URL}" rel="noopener">Voir les versions sur GitHub</a>`;
  }
}

function privacy() {
  return `<div class="card prose">
    <h1>Confidentialité</h1>
    <p>TokTok Game Connector Live fonctionne <b>entièrement sur ton PC</b>, sans compte : les événements de ton live, tes
      actions, tes réglages et tes intégrations restent sur ta machine. Les mots de passe de tes jeux et tes clés d’API y
      sont chiffrés par Windows.</p>
    <h2>Ce site</h2>
    <p>Ce site ne demande aucune inscription et n’utilise aucun cookie, ni pistage, ni publicité. La page Téléchargements
      interroge l’API publique de GitHub pour afficher la dernière version de l’app.</p>
    <h2>Connexions de l’app</h2>
    <p>L’app se connecte uniquement aux services que tu utilises : TikTok et/ou Kick (lecture du live), tes jeux, le
      serveur de salles si tu l’actives, et GitHub pour les mises à jour.</p>
  </div>`;
}

function notFound() {
  return '<div class="card empty"><h2>Page introuvable</h2><a href="#/">Retour à l’accueil</a></div>';
}

// ---------------------------------------------------------------- router

function route() {
  const [name = '', arg = ''] = location.hash.replace(/^#\/?/, '').split('/');
  const view = views[name];
  const main = $view();
  main.innerHTML = view ? view(decodeURIComponent(arg)) : notFound();
  paintArt(main);
  document
    .querySelectorAll('.nav a')
    .forEach((a) => a.classList.toggle('active', a.dataset.route === (name === 'jeu' ? 'jeux' : name)));
  document.querySelector('.nav')?.classList.remove('open');
  if (name === 'jeux') bindGames();
  window.scrollTo(0, 0);
}

function bindGames() {
  renderGameGrid();
  const search = document.getElementById('game-search');
  search?.addEventListener('input', () => {
    gameFilter.q = search.value;
    renderGameGrid();
  });
  document.querySelectorAll('[data-genre]').forEach((b) =>
    b.addEventListener('click', () => {
      gameFilter.genre = b.dataset.genre;
      document.querySelectorAll('[data-genre]').forEach((x) => x.classList.toggle('on', x === b));
      renderGameGrid();
    }),
  );
}

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.menu-toggle');
  toggle?.addEventListener('click', () => {
    const nav = document.querySelector('.nav');
    nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(nav.classList.contains('open')));
  });
  window.addEventListener('hashchange', route);
  route();
});
