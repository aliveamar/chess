/* ══════════════════════════════════════════
   Chess Engine — Client-Side Game + Auth
   Uses chess.js + Stockfish.js WASM Web Worker
   User accounts stored in LocalStorage
   ══════════════════════════════════════════ */

// ══════════════════════════════════════
// PIECE IMAGES
// ══════════════════════════════════════
const PIECE_IMAGES = {
    wK: 'https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg',
    wQ: 'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg',
    wR: 'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg',
    wB: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg',
    wN: 'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg',
    wP: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg',
    bK: 'https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg',
    bQ: 'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg',
    bR: 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg',
    bB: 'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg',
    bN: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg',
    bP: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg',
};

const CAPTURED_SYMBOLS = {
    wP: '\u2659', wN: '\u2658', wB: '\u2657', wR: '\u2656', wQ: '\u2655',
    bP: '\u265F', bN: '\u265E', bB: '\u265D', bR: '\u265C', bQ: '\u265B',
};

const DIFFICULTY = {
    1: { depth: 1,  name: 'Beginner',    elo: 800 },
    2: { depth: 3,  name: 'Easy',        elo: 1200 },
    3: { depth: 8,  name: 'Medium',      elo: 1800 },
    4: { depth: 15, name: 'Hard',        elo: 2500 },
    5: { depth: 20, name: 'Grandmaster', elo: 3500 },
};

// ══════════════════════════════════════
// AUTH SYSTEM (Server + LocalStorage stats)
// Usernames are validated globally via Flask API.
// Stats stay in this browser's LocalStorage.
// ══════════════════════════════════════

const STORAGE_USERS_KEY = 'chess_users';
const STORAGE_CURRENT_KEY = 'chess_current_user';

// When opened as a static file or from another port, talk to the local Flask server.
const API_BASE = (location.protocol === 'file:' || location.port !== '5000')
    ? 'http://localhost:5000'
    : '';

async function authRequest(path, body) {
    try {
        const res = await fetch(API_BASE + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.ok) {
            return { ok: false, error: data.error || 'Request failed.' };
        }
        return data;
    } catch {
        return {
            ok: false,
            error: 'Cannot reach the server. Run python app.py, then open http://localhost:5000/play/',
        };
    }
}

function getUsers() {
    try { return JSON.parse(localStorage.getItem(STORAGE_USERS_KEY)) || {}; }
    catch { return {}; }
}

function saveUsers(users) {
    localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(users));
}

function getCurrentUser() {
    const name = localStorage.getItem(STORAGE_CURRENT_KEY);
    if (!name) return null;
    const users = getUsers();
    if (!users[name]) { localStorage.removeItem(STORAGE_CURRENT_KEY); return null; }
    return { username: name, ...users[name] };
}

function setCurrentUser(username) {
    localStorage.setItem(STORAGE_CURRENT_KEY, username);
}

function clearCurrentUser() {
    localStorage.removeItem(STORAGE_CURRENT_KEY);
}

function createDefaultStats() {
    return { gamesPlayed: 0, wins: 0, losses: 0, draws: 0, totalTimeSecs: 0, bestWinElo: 0, history: [] };
}

function ensureLocalUser(username, type) {
    const users = getUsers();
    if (!users[username]) {
        users[username] = { type, password: null, stats: createDefaultStats() };
        saveUsers(users);
    }
}

async function registerUser(username, password) {
    const res = await authRequest('/api/auth/register', { username, password });
    if (!res.ok) return res;

    ensureLocalUser(username, 'registered');
    const users = getUsers();
    users[username].type = 'registered';
    users[username].password = password;
    saveUsers(users);
    setCurrentUser(username);
    return { ok: true };
}

async function loginUser(username, password) {
    const res = await authRequest('/api/auth/login', { username, password });
    if (!res.ok) return res;

    const canonical = res.username || username;
    ensureLocalUser(canonical, 'registered');
    setCurrentUser(canonical);
    return { ok: true };
}

async function guestLogin(username) {
    const res = await authRequest('/api/auth/guest', { username });
    if (!res.ok) return res;

    const canonical = res.username || username;
    ensureLocalUser(canonical, 'guest');
    setCurrentUser(canonical);
    return { ok: true };
}

function logoutUser() {
    clearCurrentUser();
}

function updateUserStats(result, eloLevel, timeSecs) {
    const username = localStorage.getItem(STORAGE_CURRENT_KEY);
    if (!username) return;

    const users = getUsers();
    if (!users[username]) return;

    const stats = users[username].stats || createDefaultStats();
    stats.gamesPlayed++;
    stats.totalTimeSecs += timeSecs;

    if (result === 'win') {
        stats.wins++;
        if (eloLevel > stats.bestWinElo) stats.bestWinElo = eloLevel;
    } else if (result === 'loss') {
        stats.losses++;
    } else {
        stats.draws++;
    }

    stats.history.push({
        date: new Date().toISOString(),
        result: result,
        elo: eloLevel,
        timeSecs: timeSecs,
    });

    // Keep only last 50 games in history
    if (stats.history.length > 50) stats.history = stats.history.slice(-50);

    users[username].stats = stats;
    saveUsers(users);
}

// ══════════════════════════════════════
// GAME STATE
// ══════════════════════════════════════

let game = new Chess();
let selectedSquare = null;
let legalMoves = [];
let lastMove = null;
let isFlipped = false;
let isThinking = false;
let playerColor = 'w';
let capturedPieces = { w: [], b: [] };
let moveHistory = [];

// Game timer
let gameStartTime = null;
let gameTimerInterval = null;
let gameElapsedSecs = 0;

// ══════════════════════════════════════
// STOCKFISH WEB WORKER
// ══════════════════════════════════════

let stockfish = null;
let engineReady = false;

function initStockfish() {
    try {
        const stockfishUrl = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
        const blob = new Blob([`importScripts('${stockfishUrl}');`], { type: 'application/javascript' });
        stockfish = new Worker(URL.createObjectURL(blob));

        stockfish.onmessage = function (e) {
            const msg = e.data;
            if (msg === 'uciok') { engineReady = true; console.log('[Stockfish] Ready.'); }
            if (typeof msg === 'string' && msg.startsWith('bestmove')) {
                const best = msg.split(' ')[1];
                if (best && best !== '(none)') onEngineBestMove(best);
            }
            if (typeof msg === 'string' && msg.includes(' score ')) parseEvaluation(msg);
        };
        stockfish.onerror = (err) => console.error('[Stockfish] Error:', err);
        stockfish.postMessage('uci');
    } catch (err) { console.error('[Stockfish] Init failed:', err); }
}

function parseEvaluation(line) {
    const cpM = line.match(/score cp (-?\d+)/);
    const mateM = line.match(/score mate (-?\d+)/);
    if (mateM) {
        let m = parseInt(mateM[1]); if (game.turn() === 'b') m = -m;
        updateEvalDisplay({ type: 'mate', value: m });
    } else if (cpM) {
        let cp = parseInt(cpM[1]); if (game.turn() === 'b') cp = -cp;
        updateEvalDisplay({ type: 'cp', value: cp });
    }
}

function requestEngineMove() {
    if (!stockfish || !engineReady) { isThinking = false; showLoading(false); return; }
    const diff = DIFFICULTY[parseInt(difficultySelect.value)] || DIFFICULTY[3];
    stockfish.postMessage('position fen ' + game.fen());
    stockfish.postMessage('go depth ' + diff.depth);
}

function onEngineBestMove(uci) {
    const from = uci.substring(0, 2), to = uci.substring(2, 4);
    const promo = uci.length > 4 ? uci[4] : undefined;
    const moveObj = game.move({ from, to, promotion: promo });
    if (moveObj) { lastMove = { from, to }; moveHistory.push(moveObj.san); updateCapturedPieces(moveObj); }
    isThinking = false; showLoading(false); updateUI();
    checkGameEnd();
}

// ══════════════════════════════════════
// DOM ELEMENTS
// ══════════════════════════════════════

const authScreen = document.getElementById('authScreen');
const appContainer = document.getElementById('appContainer');
const tabLogin = document.getElementById('tabLogin');
const tabGuest = document.getElementById('tabGuest');
const formLogin = document.getElementById('formLogin');
const formGuest = document.getElementById('formGuest');
const loginError = document.getElementById('loginError');
const guestError = document.getElementById('guestError');
const btnRegister = document.getElementById('btnRegister');
const btnLogout = document.getElementById('btnLogout');
const displayUsername = document.getElementById('displayUsername');
const displayUserType = document.getElementById('displayUserType');

const boardEl = document.getElementById('chessBoard');
const evalFill = document.getElementById('evalFill');
const evalScore = document.getElementById('evalScore');
const capturedByWhite = document.getElementById('capturedByWhite');
const capturedByBlack = document.getElementById('capturedByBlack');
const turnIndicator = document.getElementById('turnIndicator');
const gameStatus = document.getElementById('gameStatus');
const gameTimerEl = document.getElementById('gameTimer');
const moveList = document.getElementById('moveList');
const loadingOverlay = document.getElementById('loadingOverlay');
const promotionModal = document.getElementById('promotionModal');
const promotionChoices = document.getElementById('promotionChoices');
const rankLabels = document.getElementById('rankLabels');
const fileLabels = document.getElementById('fileLabels');
const btnNewGame = document.getElementById('btnNewGame');
const btnUndo = document.getElementById('btnUndo');
const btnFlip = document.getElementById('btnFlip');
const difficultySelect = document.getElementById('difficultySelect');
const colorSelect = document.getElementById('colorSelect');

// Stats elements
const statGames = document.getElementById('statGames');
const statWins = document.getElementById('statWins');
const statLosses = document.getElementById('statLosses');
const statDraws = document.getElementById('statDraws');
const statTotalGames = document.getElementById('statTotalGames');
const statWinRate = document.getElementById('statWinRate');
const statTimePlayed = document.getElementById('statTimePlayed');
const statBestElo = document.getElementById('statBestElo');

let dragFrom = null, ghostEl = null;

// ══════════════════════════════════════
// AUTH UI
// ══════════════════════════════════════

tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active'); tabGuest.classList.remove('active');
    formLogin.classList.remove('hidden'); formGuest.classList.add('hidden');
    loginError.textContent = '';
});

tabGuest.addEventListener('click', () => {
    tabGuest.classList.add('active'); tabLogin.classList.remove('active');
    formGuest.classList.remove('hidden'); formLogin.classList.add('hidden');
    guestError.textContent = '';
});

// Login button
document.getElementById('btnLogin').addEventListener('click', async () => {
    const u = document.getElementById('loginUsername').value.trim();
    const p = document.getElementById('loginPassword').value;
    loginError.textContent = '';
    if (!u || u.length < 3) { loginError.textContent = 'Username must be at least 3 characters.'; return; }
    if (!p || p.length < 4) { loginError.textContent = 'Password must be at least 4 characters.'; return; }
    const res = await loginUser(u, p);
    if (res.ok) { enterGame(); } else { loginError.textContent = res.error; }
});

// Register button
document.getElementById('btnRegister').addEventListener('click', async () => {
    const u = document.getElementById('loginUsername').value.trim();
    const p = document.getElementById('loginPassword').value;
    loginError.textContent = '';
    if (!u || u.length < 3) { loginError.textContent = 'Username must be at least 3 characters.'; return; }
    if (!p || p.length < 4) { loginError.textContent = 'Password must be at least 4 characters.'; return; }
    const res = await registerUser(u, p);
    if (res.ok) { enterGame(); } else { loginError.textContent = res.error; }
});

// Enter key on login password field
document.getElementById('loginPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btnLogin').click(); }
});

// Guest play button
document.getElementById('btnGuestPlay').addEventListener('click', async () => {
    const u = document.getElementById('guestUsername').value.trim();
    guestError.textContent = '';
    if (!u || u.length < 3) { guestError.textContent = 'Username must be at least 3 characters.'; return; }
    const res = await guestLogin(u);
    if (res.ok) { enterGame(); } else { guestError.textContent = res.error; }
});

// Enter key on guest username field
document.getElementById('guestUsername').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btnGuestPlay').click(); }
});

btnLogout.addEventListener('click', () => {
    stopGameTimer();
    logoutUser();
    authScreen.classList.remove('hidden');
    appContainer.classList.add('hidden');
    loginError.textContent = '';
    guestError.textContent = '';
});

function enterGame() {
    const user = getCurrentUser();
    if (!user) return;

    authScreen.classList.add('hidden');
    appContainer.classList.remove('hidden');

    // Set user display
    displayUsername.textContent = user.username;
    displayUserType.textContent = user.type === 'registered' ? 'Member' : 'Guest';
    displayUserType.className = 'user-type-badge ' + (user.type === 'registered' ? 'registered' : 'guest');

    refreshStatsDisplay();
    initStockfish();
    startNewGame();
}

function refreshStatsDisplay() {
    const user = getCurrentUser();
    if (!user) return;
    const s = user.stats || createDefaultStats();

    // Header chips
    statGames.textContent = s.gamesPlayed + ' games';
    statWins.textContent = s.wins + 'W';
    statLosses.textContent = s.losses + 'L';
    statDraws.textContent = s.draws + 'D';

    // Sidebar stats
    statTotalGames.textContent = s.gamesPlayed;
    const wr = s.gamesPlayed > 0 ? Math.round((s.wins / s.gamesPlayed) * 100) : 0;
    statWinRate.textContent = wr + '%';

    const totalMins = Math.floor(s.totalTimeSecs / 60);
    if (totalMins < 60) statTimePlayed.textContent = totalMins + 'm';
    else statTimePlayed.textContent = Math.floor(totalMins / 60) + 'h ' + (totalMins % 60) + 'm';

    statBestElo.textContent = s.bestWinElo > 0 ? s.bestWinElo : '--';
}

// ══════════════════════════════════════
// GAME TIMER
// ══════════════════════════════════════

function startGameTimer() {
    gameStartTime = Date.now();
    gameElapsedSecs = 0;
    if (gameTimerInterval) clearInterval(gameTimerInterval);
    gameTimerInterval = setInterval(() => {
        gameElapsedSecs = Math.floor((Date.now() - gameStartTime) / 1000);
        const mins = Math.floor(gameElapsedSecs / 60);
        const secs = gameElapsedSecs % 60;
        gameTimerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
    }, 1000);
}

function stopGameTimer() {
    if (gameTimerInterval) { clearInterval(gameTimerInterval); gameTimerInterval = null; }
}

// ══════════════════════════════════════
// BOARD RENDERING
// ══════════════════════════════════════

function getSquareName(row, col) { return String.fromCharCode(97 + col) + (8 - row); }
function getPieceImageKey(piece) { return piece ? (piece.color === 'w' ? 'w' : 'b') + piece.type.toUpperCase() : null; }

function renderLabels() {
    rankLabels.innerHTML = ''; fileLabels.innerHTML = '';
    const ranks = isFlipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
    const files = isFlipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
    ranks.forEach(r => { const l = document.createElement('div'); l.className = 'rank-label'; l.textContent = r; rankLabels.appendChild(l); });
    files.forEach(f => { const l = document.createElement('div'); l.className = 'file-label'; l.textContent = f; fileLabels.appendChild(l); });
}

function renderBoard() {
    boardEl.innerHTML = '';
    const board = game.board();
    let checkSquare = null;
    if (game.in_check()) {
        const t = game.turn();
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
            const p = board[r][c]; if (p && p.type === 'k' && p.color === t) checkSquare = getSquareName(r, c);
        }
    }

    for (let dr = 0; dr < 8; dr++) for (let dc = 0; dc < 8; dc++) {
        const row = isFlipped ? 7 - dr : dr, col = isFlipped ? 7 - dc : dc;
        const sq = getSquareName(row, col);
        const isLight = (row + col) % 2 === 0;
        const el = document.createElement('div');
        el.className = 'square ' + (isLight ? 'light' : 'dark');
        el.dataset.square = sq;
        if (selectedSquare === sq) el.classList.add('selected');
        if (lastMove && (lastMove.from === sq || lastMove.to === sq)) el.classList.add('last-move');
        if (checkSquare === sq) el.classList.add('in-check');

        const piece = board[row][col];
        if (piece) {
            const key = getPieceImageKey(piece);
            if (PIECE_IMAGES[key]) {
                const img = document.createElement('img');
                img.className = 'piece'; img.src = PIECE_IMAGES[key]; img.alt = key;
                img.draggable = false; img.dataset.square = sq; img.dataset.color = piece.color;
                img.addEventListener('mousedown', onPieceMouseDown);
                img.addEventListener('touchstart', onPieceTouchStart, { passive: false });
                if (dragFrom === sq) img.classList.add('dragging');
                el.appendChild(img);
            }
        }

        if (selectedSquare) {
            if (legalMoves.some(m => m.to === sq)) {
                const dot = document.createElement('div');
                dot.className = 'legal-dot' + (piece ? ' capture' : '');
                el.appendChild(dot);
            }
        }
        el.addEventListener('click', () => onSquareClick(sq));
        boardEl.appendChild(el);
    }
}

// ══════════════════════════════════════
// INTERACTION
// ══════════════════════════════════════

function onSquareClick(sq) {
    if (game.game_over() || isThinking || game.turn() !== playerColor) return;
    const piece = game.get(sq);

    if (selectedSquare && selectedSquare !== sq) {
        if (legalMoves.some(m => m.to === sq)) {
            const fp = game.get(selectedSquare);
            if (fp && fp.type === 'p' && ((fp.color === 'w' && sq[1] === '8') || (fp.color === 'b' && sq[1] === '1'))) {
                showPromotionModal(selectedSquare, sq); clearSelection(); return;
            }
            executePlayerMove(selectedSquare, sq); clearSelection(); return;
        }
    }
    if (piece && piece.color === playerColor) selectSquare(sq); else clearSelection();
}

function selectSquare(sq) { selectedSquare = sq; legalMoves = game.moves({ square: sq, verbose: true }); renderBoard(); }
function clearSelection() { selectedSquare = null; legalMoves = []; renderBoard(); }

function executePlayerMove(from, to, promo) {
    const moveObj = game.move({ from, to, promotion: promo || undefined });
    if (!moveObj) return;
    lastMove = { from, to }; moveHistory.push(moveObj.san); updateCapturedPieces(moveObj); updateUI();
    if (checkGameEnd()) return;
    if (!game.game_over()) { isThinking = true; showLoading(true); setTimeout(() => requestEngineMove(), 50); }
}

function updateCapturedPieces(moveObj) { if (moveObj.captured) capturedPieces[moveObj.color].push(moveObj.captured); }

// Drag & Drop
function onPieceMouseDown(e) {
    if (game.game_over() || isThinking) return; e.preventDefault();
    const sq = e.target.dataset.square; const p = game.get(sq);
    if (!p || p.color !== playerColor) return;
    startDrag(e.target, sq, e.clientX, e.clientY);
    const mm = (ev) => moveDrag(ev.clientX, ev.clientY);
    const mu = (ev) => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); endDrag(ev.clientX, ev.clientY); };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
}

function onPieceTouchStart(e) {
    if (game.game_over() || isThinking) return; e.preventDefault();
    const t = e.touches[0]; const sq = e.target.dataset.square; const p = game.get(sq);
    if (!p || p.color !== playerColor) return;
    startDrag(e.target, sq, t.clientX, t.clientY);
    const tm = (ev) => { ev.preventDefault(); moveDrag(ev.touches[0].clientX, ev.touches[0].clientY); };
    const te = (ev) => { document.removeEventListener('touchmove', tm); document.removeEventListener('touchend', te); endDrag(ev.changedTouches[0].clientX, ev.changedTouches[0].clientY); };
    document.addEventListener('touchmove', tm, { passive: false }); document.addEventListener('touchend', te);
}

function startDrag(el, sq, x, y) {
    dragFrom = sq; selectedSquare = sq; legalMoves = game.moves({ square: sq, verbose: true });
    ghostEl = document.createElement('img'); ghostEl.className = 'piece-ghost'; ghostEl.src = el.src; ghostEl.draggable = false;
    document.body.appendChild(ghostEl); moveDrag(x, y); renderBoard();
}

function moveDrag(x, y) { if (!ghostEl) return; const s = boardEl.getBoundingClientRect().width / 8; ghostEl.style.left = (x - s/2) + 'px'; ghostEl.style.top = (y - s/2) + 'px'; }

function endDrag(x, y) {
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }
    const t = document.elementFromPoint(x, y);
    if (t) {
        const se = t.closest('.square');
        if (se && dragFrom && se.dataset.square !== dragFrom) {
            const to = se.dataset.square;
            if (legalMoves.some(m => m.to === to)) {
                const fp = game.get(dragFrom);
                if (fp && fp.type === 'p' && ((fp.color === 'w' && to[1] === '8') || (fp.color === 'b' && to[1] === '1'))) {
                    const sf = dragFrom; dragFrom = null; showPromotionModal(sf, to); clearSelection(); return;
                }
                const sf = dragFrom; dragFrom = null; executePlayerMove(sf, to); clearSelection(); return;
            }
        }
    }
    dragFrom = null; renderBoard();
}

// Promotion
function showPromotionModal(from, to) {
    promotionModal.classList.add('active'); promotionChoices.innerHTML = '';
    const c = game.turn();
    ['q','r','b','n'].forEach(p => {
        const key = (c === 'w' ? 'w' : 'b') + p.toUpperCase();
        const btn = document.createElement('div'); btn.className = 'promotion-choice';
        const img = document.createElement('img'); img.src = PIECE_IMAGES[key]; img.style.width = '100%'; img.style.height = '100%'; img.draggable = false;
        btn.appendChild(img);
        btn.addEventListener('click', () => { promotionModal.classList.remove('active'); executePlayerMove(from, to, p); });
        promotionChoices.appendChild(btn);
    });
}

// ══════════════════════════════════════
// GAME END DETECTION & STATS
// ══════════════════════════════════════

function checkGameEnd() {
    if (!game.game_over()) return false;

    stopGameTimer();
    const diffLevel = parseInt(difficultySelect.value) || 3;
    const eloLevel = DIFFICULTY[diffLevel].elo;
    let result;

    if (game.in_checkmate()) {
        const loser = game.turn(); // the one who is checkmated
        result = loser !== playerColor ? 'win' : 'loss';
    } else {
        result = 'draw'; // stalemate, repetition, insufficient material, etc.
    }

    updateUserStats(result, eloLevel, gameElapsedSecs);
    refreshStatsDisplay();
    return true;
}

// ══════════════════════════════════════
// UI UPDATES
// ══════════════════════════════════════

function updateUI() { renderBoard(); updateTurnIndicator(); updateGameStatus(); updateCapturedDisplay(); updateMoveHistoryDisplay(); }

function updateTurnIndicator() {
    const t = game.turn(), n = t === 'w' ? 'White' : 'Black', c = t === 'w' ? '#f1f5f9' : '#1e1e2e';
    turnIndicator.innerHTML = '<span class="turn-dot" style="background:' + c + ';border:1px solid #64748b;"></span> ' + n + ' to move';
}

function updateGameStatus() {
    if (game.in_checkmate()) { const w = game.turn() === 'w' ? 'Black' : 'White'; gameStatus.textContent = 'Checkmate! ' + w + ' wins!'; gameStatus.style.color = '#ef4444'; }
    else if (game.in_stalemate()) { gameStatus.textContent = 'Stalemate'; gameStatus.style.color = '#f59e0b'; }
    else if (game.in_draw()) { gameStatus.textContent = 'Draw'; gameStatus.style.color = '#f59e0b'; }
    else if (game.in_check()) { gameStatus.textContent = 'Check!'; gameStatus.style.color = '#ef4444'; }
    else gameStatus.textContent = '';
}

function updateCapturedDisplay() {
    capturedByWhite.innerHTML = ''; capturedByBlack.innerHTML = '';
    capturedPieces.w.forEach(p => { const sp = document.createElement('span'); sp.className = 'captured-piece'; sp.textContent = CAPTURED_SYMBOLS['b' + p.toUpperCase()] || p; capturedByWhite.appendChild(sp); });
    capturedPieces.b.forEach(p => { const sp = document.createElement('span'); sp.className = 'captured-piece'; sp.textContent = CAPTURED_SYMBOLS['w' + p.toUpperCase()] || p; capturedByBlack.appendChild(sp); });
}

function updateMoveHistoryDisplay() {
    moveList.innerHTML = '';
    if (moveHistory.length === 0) { moveList.innerHTML = '<div class="move-placeholder">Play a move to begin...</div>'; return; }
    for (let i = 0; i < moveHistory.length; i += 2) {
        const num = Math.floor(i / 2) + 1, wm = moveHistory[i] || '', bm = moveHistory[i + 1] || '';
        const row = document.createElement('div'); row.className = 'move-row';
        const ne = document.createElement('span'); ne.className = 'move-number'; ne.textContent = num + '.';
        const we = document.createElement('span'); we.className = 'move-white'; we.textContent = wm;
        if (i === moveHistory.length - 1 && !bm) we.classList.add('latest');
        row.appendChild(ne); row.appendChild(we);
        if (bm) { const be = document.createElement('span'); be.className = 'move-black'; be.textContent = bm; if (i + 1 === moveHistory.length - 1) be.classList.add('latest'); row.appendChild(be); }
        moveList.appendChild(row);
    }
    moveList.scrollTop = moveList.scrollHeight;
}

function updateEvalDisplay(ev) {
    if (!ev) return; let ds, fp;
    if (ev.type === 'mate') { const m = ev.value; ds = (m > 0 ? '+' : '') + 'M' + Math.abs(m); fp = m > 0 ? 95 : 5; }
    else { const cp = ev.value || 0; ds = (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1); fp = Math.max(3, Math.min(97, (1 / (1 + Math.pow(10, -cp / 400))) * 100)); }
    evalScore.textContent = ds; evalFill.style.width = fp + '%';
    const c = ev.type === 'mate' ? (ev.value > 0 ? 9999 : -9999) : (ev.value || 0);
    evalScore.style.color = c > 100 ? '#22c55e' : c < -100 ? '#ef4444' : '#f1f5f9';
}

function showLoading(s) { loadingOverlay.classList[s ? 'add' : 'remove']('active'); }

// ══════════════════════════════════════
// GAME CONTROLS
// ══════════════════════════════════════

function startNewGame() {
    game = new Chess(); selectedSquare = null; legalMoves = []; lastMove = null;
    isThinking = false; moveHistory = []; capturedPieces = { w: [], b: [] };
    playerColor = colorSelect.value === 'white' ? 'w' : 'b';
    showLoading(false); gameStatus.textContent = ''; updateEvalDisplay({ type: 'cp', value: 0 });
    if (playerColor === 'b' && !isFlipped) { isFlipped = true; renderLabels(); }
    else if (playerColor === 'w' && isFlipped) { isFlipped = false; renderLabels(); }
    startGameTimer(); updateUI();
    if (playerColor === 'b') { isThinking = true; showLoading(true); setTimeout(() => requestEngineMove(), 100); }
}

function undoMove() {
    if (isThinking || moveHistory.length === 0) return;
    const n = moveHistory.length >= 2 ? 2 : 1;
    for (let i = 0; i < n; i++) { game.undo(); moveHistory.pop(); }
    capturedPieces = { w: [], b: [] };
    game.history({ verbose: true }).forEach(m => { if (m.captured) capturedPieces[m.color].push(m.captured); });
    lastMove = null; updateEvalDisplay({ type: 'cp', value: 0 }); updateUI();
}

btnNewGame.addEventListener('click', startNewGame);
btnUndo.addEventListener('click', undoMove);
btnFlip.addEventListener('click', () => { isFlipped = !isFlipped; renderLabels(); renderBoard(); });

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════

renderLabels();

// Auto-login if user exists in session
const existingUser = getCurrentUser();
if (existingUser) {
    enterGame();
} else {
    authScreen.classList.remove('hidden');
    appContainer.classList.add('hidden');
}
