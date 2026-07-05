/* ══════════════════════════════════════════
   Chess Engine — Pure Client-Side Game Logic
   Uses chess.js for rules + Stockfish.js WASM Web Worker
   ══════════════════════════════════════════ */

// ── Piece Images (Wikimedia Commons SVGs) ──
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

// Unicode for captured pieces display (small, doesn't need images)
const CAPTURED_SYMBOLS = {
    wP: '\u2659', wN: '\u2658', wB: '\u2657', wR: '\u2656', wQ: '\u2655',
    bP: '\u265F', bN: '\u265E', bB: '\u265D', bR: '\u265C', bQ: '\u265B',
};

// ── Difficulty: depth settings ──
const DIFFICULTY = {
    1: { depth: 1,  name: 'Beginner' },
    2: { depth: 3,  name: 'Easy' },
    3: { depth: 8,  name: 'Medium' },
    4: { depth: 15, name: 'Hard' },
    5: { depth: 20, name: 'Grandmaster' },
};

// ── Game State ──
let game = new Chess();
let selectedSquare = null;
let legalMoves = [];
let lastMove = null;
let isFlipped = false;
let isThinking = false;
let playerColor = 'w';
let capturedPieces = { w: [], b: [] };
let moveHistory = [];

// ── Stockfish Web Worker ──
let stockfish = null;
let engineReady = false;

function initStockfish() {
    try {
        const stockfishUrl = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
        const blob = new Blob(
            [`importScripts('${stockfishUrl}');`],
            { type: 'application/javascript' }
        );
        const workerUrl = URL.createObjectURL(blob);
        stockfish = new Worker(workerUrl);

        stockfish.onmessage = function (e) {
            const msg = e.data;
            if (msg === 'uciok') {
                engineReady = true;
                console.log('[Stockfish] Engine ready.');
            }
            if (typeof msg === 'string' && msg.startsWith('bestmove')) {
                const parts = msg.split(' ');
                const bestMove = parts[1];
                if (bestMove && bestMove !== '(none)') {
                    onEngineBestMove(bestMove);
                }
            }
            if (typeof msg === 'string' && msg.includes(' score ')) {
                parseEvaluation(msg);
            }
        };

        stockfish.onerror = function (err) {
            console.error('[Stockfish] Worker error:', err);
        };

        stockfish.postMessage('uci');
    } catch (err) {
        console.error('[Stockfish] Failed to init:', err);
    }
}

function parseEvaluation(infoLine) {
    const cpMatch = infoLine.match(/score cp (-?\d+)/);
    const mateMatch = infoLine.match(/score mate (-?\d+)/);

    if (mateMatch) {
        const mate = parseInt(mateMatch[1]);
        const displayMate = game.turn() === 'w' ? mate : -mate;
        updateEvalDisplay({ type: 'mate', value: displayMate });
    } else if (cpMatch) {
        let cp = parseInt(cpMatch[1]);
        if (game.turn() === 'b') cp = -cp;
        updateEvalDisplay({ type: 'cp', value: cp });
    }
}

function requestEngineMove() {
    if (!stockfish || !engineReady) {
        console.warn('[Stockfish] Engine not ready');
        isThinking = false;
        showLoading(false);
        return;
    }
    const diff = DIFFICULTY[parseInt(difficultySelect.value)] || DIFFICULTY[3];
    stockfish.postMessage('position fen ' + game.fen());
    stockfish.postMessage('go depth ' + diff.depth);
}

function onEngineBestMove(moveUci) {
    const from = moveUci.substring(0, 2);
    const to = moveUci.substring(2, 4);
    const promotion = moveUci.length > 4 ? moveUci[4] : undefined;
    const moveObj = game.move({ from, to, promotion });

    if (moveObj) {
        lastMove = { from, to };
        moveHistory.push(moveObj.san);
        updateCapturedPieces(moveObj);
    }

    isThinking = false;
    showLoading(false);
    updateUI();
}

// ── DOM Elements ──
const boardEl = document.getElementById('chessBoard');
const evalFill = document.getElementById('evalFill');
const evalScore = document.getElementById('evalScore');
const capturedByWhite = document.getElementById('capturedByWhite');
const capturedByBlack = document.getElementById('capturedByBlack');
const turnIndicator = document.getElementById('turnIndicator');
const gameStatus = document.getElementById('gameStatus');
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

// ── Drag State ──
let dragFrom = null;
let ghostEl = null;

// ══════════════════════════════════════
// Helpers
// ══════════════════════════════════════

function getSquareName(row, col) {
    return String.fromCharCode(97 + col) + (8 - row);
}

function getPieceImageKey(piece) {
    if (!piece) return null;
    return (piece.color === 'w' ? 'w' : 'b') + piece.type.toUpperCase();
}

// ══════════════════════════════════════
// Board Rendering
// ══════════════════════════════════════

function renderLabels() {
    rankLabels.innerHTML = '';
    fileLabels.innerHTML = '';
    const ranks = isFlipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
    const files = isFlipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];

    ranks.forEach(r => {
        const label = document.createElement('div');
        label.className = 'rank-label';
        label.textContent = r;
        rankLabels.appendChild(label);
    });
    files.forEach(f => {
        const label = document.createElement('div');
        label.className = 'file-label';
        label.textContent = f;
        fileLabels.appendChild(label);
    });
}

function renderBoard() {
    boardEl.innerHTML = '';
    const board = game.board();

    // Find king square if in check
    let checkSquare = null;
    if (game.in_check()) {
        const turn = game.turn();
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (p && p.type === 'k' && p.color === turn) {
                    checkSquare = getSquareName(r, c);
                }
            }
        }
    }

    for (let displayRow = 0; displayRow < 8; displayRow++) {
        for (let displayCol = 0; displayCol < 8; displayCol++) {
            const row = isFlipped ? 7 - displayRow : displayRow;
            const col = isFlipped ? 7 - displayCol : displayCol;
            const squareName = getSquareName(row, col);
            const isLight = (row + col) % 2 === 0;

            const squareEl = document.createElement('div');
            squareEl.className = 'square ' + (isLight ? 'light' : 'dark');
            squareEl.dataset.square = squareName;

            if (selectedSquare === squareName) squareEl.classList.add('selected');
            if (lastMove && (lastMove.from === squareName || lastMove.to === squareName)) {
                squareEl.classList.add('last-move');
            }
            if (checkSquare === squareName) squareEl.classList.add('in-check');

            // Piece (as image)
            const piece = board[row][col];
            if (piece) {
                const key = getPieceImageKey(piece);
                const imgUrl = PIECE_IMAGES[key];
                if (imgUrl) {
                    const imgEl = document.createElement('img');
                    imgEl.className = 'piece';
                    imgEl.src = imgUrl;
                    imgEl.alt = key;
                    imgEl.draggable = false;
                    imgEl.dataset.square = squareName;
                    imgEl.dataset.color = piece.color;

                    imgEl.addEventListener('mousedown', onPieceMouseDown);
                    imgEl.addEventListener('touchstart', onPieceTouchStart, { passive: false });

                    if (dragFrom === squareName) imgEl.classList.add('dragging');
                    squareEl.appendChild(imgEl);
                }
            }

            // Legal move dots
            if (selectedSquare) {
                const isTarget = legalMoves.some(m => m.to === squareName);
                if (isTarget) {
                    const dot = document.createElement('div');
                    dot.className = 'legal-dot' + (piece ? ' capture' : '');
                    squareEl.appendChild(dot);
                }
            }

            squareEl.addEventListener('click', () => onSquareClick(squareName));
            boardEl.appendChild(squareEl);
        }
    }
}

// ══════════════════════════════════════
// Interaction
// ══════════════════════════════════════

function onSquareClick(squareName) {
    if (game.game_over() || isThinking) return;
    if (game.turn() !== playerColor) return;

    const piece = game.get(squareName);

    if (selectedSquare && selectedSquare !== squareName) {
        const isLegal = legalMoves.some(m => m.to === squareName);
        if (isLegal) {
            const fromPiece = game.get(selectedSquare);
            if (fromPiece && fromPiece.type === 'p') {
                const destRank = parseInt(squareName[1]);
                if ((fromPiece.color === 'w' && destRank === 8) ||
                    (fromPiece.color === 'b' && destRank === 1)) {
                    showPromotionModal(selectedSquare, squareName);
                    clearSelection();
                    return;
                }
            }
            executePlayerMove(selectedSquare, squareName);
            clearSelection();
            return;
        }
    }

    if (piece && piece.color === playerColor) {
        selectSquare(squareName);
    } else {
        clearSelection();
    }
}

function selectSquare(squareName) {
    selectedSquare = squareName;
    legalMoves = game.moves({ square: squareName, verbose: true });
    renderBoard();
}

function clearSelection() {
    selectedSquare = null;
    legalMoves = [];
    renderBoard();
}

function executePlayerMove(from, to, promotion) {
    const moveObj = game.move({ from, to, promotion: promotion || undefined });
    if (!moveObj) return;

    lastMove = { from, to };
    moveHistory.push(moveObj.san);
    updateCapturedPieces(moveObj);
    updateUI();

    if (!game.game_over()) {
        isThinking = true;
        showLoading(true);
        setTimeout(() => requestEngineMove(), 50);
    }
}

function updateCapturedPieces(moveObj) {
    if (moveObj.captured) {
        capturedPieces[moveObj.color].push(moveObj.captured);
    }
}

// ── Drag & Drop ──

function onPieceMouseDown(e) {
    if (game.game_over() || isThinking) return;
    e.preventDefault();

    const square = e.target.dataset.square;
    const piece = game.get(square);
    if (!piece || piece.color !== playerColor) return;

    startDrag(e.target, square, e.clientX, e.clientY);

    const onMouseMove = (ev) => moveDrag(ev.clientX, ev.clientY);
    const onMouseUp = (ev) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        endDrag(ev.clientX, ev.clientY);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function onPieceTouchStart(e) {
    if (game.game_over() || isThinking) return;
    e.preventDefault();

    const touch = e.touches[0];
    const square = e.target.dataset.square;
    const piece = game.get(square);
    if (!piece || piece.color !== playerColor) return;

    startDrag(e.target, square, touch.clientX, touch.clientY);

    const onTouchMove = (ev) => { ev.preventDefault(); moveDrag(ev.touches[0].clientX, ev.touches[0].clientY); };
    const onTouchEnd = (ev) => {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        endDrag(ev.changedTouches[0].clientX, ev.changedTouches[0].clientY);
    };
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
}

function startDrag(pieceEl, square, x, y) {
    dragFrom = square;
    selectedSquare = square;
    legalMoves = game.moves({ square, verbose: true });

    ghostEl = document.createElement('img');
    ghostEl.className = 'piece-ghost';
    ghostEl.src = pieceEl.src;
    ghostEl.draggable = false;
    document.body.appendChild(ghostEl);
    moveDrag(x, y);
    renderBoard();
}

function moveDrag(x, y) {
    if (!ghostEl) return;
    const boardRect = boardEl.getBoundingClientRect();
    const sqSize = boardRect.width / 8;
    ghostEl.style.left = (x - sqSize / 2) + 'px';
    ghostEl.style.top = (y - sqSize / 2) + 'px';
}

function endDrag(x, y) {
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }

    const target = document.elementFromPoint(x, y);
    if (target) {
        const squareEl = target.closest('.square');
        if (squareEl) {
            const toSquare = squareEl.dataset.square;
            if (dragFrom && toSquare && dragFrom !== toSquare) {
                const isLegal = legalMoves.some(m => m.to === toSquare);
                if (isLegal) {
                    const fromPiece = game.get(dragFrom);
                    if (fromPiece && fromPiece.type === 'p') {
                        const destRank = parseInt(toSquare[1]);
                        if ((fromPiece.color === 'w' && destRank === 8) ||
                            (fromPiece.color === 'b' && destRank === 1)) {
                            const savedFrom = dragFrom;
                            dragFrom = null;
                            showPromotionModal(savedFrom, toSquare);
                            clearSelection();
                            return;
                        }
                    }
                    const savedFrom = dragFrom;
                    dragFrom = null;
                    executePlayerMove(savedFrom, toSquare);
                    clearSelection();
                    return;
                }
            }
        }
    }
    dragFrom = null;
    renderBoard();
}

// ── Promotion ──

function showPromotionModal(from, to) {
    promotionModal.classList.add('active');
    promotionChoices.innerHTML = '';

    const color = game.turn();
    const pieces = ['q', 'r', 'b', 'n'];

    pieces.forEach(p => {
        const key = (color === 'w' ? 'w' : 'b') + p.toUpperCase();
        const btn = document.createElement('div');
        btn.className = 'promotion-choice';
        const img = document.createElement('img');
        img.src = PIECE_IMAGES[key];
        img.alt = key;
        img.style.width = '100%';
        img.style.height = '100%';
        img.draggable = false;
        btn.appendChild(img);
        btn.addEventListener('click', () => {
            promotionModal.classList.remove('active');
            executePlayerMove(from, to, p);
        });
        promotionChoices.appendChild(btn);
    });
}

// ══════════════════════════════════════
// UI Updates
// ══════════════════════════════════════

function updateUI() {
    renderBoard();
    updateTurnIndicator();
    updateGameStatus();
    updateCapturedDisplay();
    updateMoveHistoryDisplay();
}

function updateTurnIndicator() {
    const turn = game.turn();
    const turnName = turn === 'w' ? 'White' : 'Black';
    const dotColor = turn === 'w' ? '#f1f5f9' : '#1e1e2e';
    turnIndicator.innerHTML = '<span class="turn-dot" style="background:' + dotColor + ';border:1px solid #64748b;"></span> ' + turnName + ' to move';
}

function updateGameStatus() {
    if (game.in_checkmate()) {
        const winner = game.turn() === 'w' ? 'Black' : 'White';
        gameStatus.textContent = 'Checkmate! ' + winner + ' wins!';
        gameStatus.style.color = '#ef4444';
    } else if (game.in_stalemate()) {
        gameStatus.textContent = 'Stalemate — Draw';
        gameStatus.style.color = '#f59e0b';
    } else if (game.in_draw()) {
        gameStatus.textContent = 'Draw';
        gameStatus.style.color = '#f59e0b';
    } else if (game.in_check()) {
        gameStatus.textContent = 'Check!';
        gameStatus.style.color = '#ef4444';
    } else {
        gameStatus.textContent = '';
    }
}

function updateCapturedDisplay() {
    capturedByWhite.innerHTML = '';
    capturedByBlack.innerHTML = '';

    // White captured these black pieces
    capturedPieces.w.forEach(p => {
        const key = 'b' + p.toUpperCase();
        const span = document.createElement('span');
        span.className = 'captured-piece';
        span.textContent = CAPTURED_SYMBOLS[key] || p;
        capturedByWhite.appendChild(span);
    });

    // Black captured these white pieces
    capturedPieces.b.forEach(p => {
        const key = 'w' + p.toUpperCase();
        const span = document.createElement('span');
        span.className = 'captured-piece';
        span.textContent = CAPTURED_SYMBOLS[key] || p;
        capturedByBlack.appendChild(span);
    });
}

function updateMoveHistoryDisplay() {
    moveList.innerHTML = '';

    if (moveHistory.length === 0) {
        moveList.innerHTML = '<div class="move-placeholder">Play a move to begin...</div>';
        return;
    }

    for (let i = 0; i < moveHistory.length; i += 2) {
        const moveNum = Math.floor(i / 2) + 1;
        const whiteMove = moveHistory[i] || '';
        const blackMove = moveHistory[i + 1] || '';

        const row = document.createElement('div');
        row.className = 'move-row';

        const numEl = document.createElement('span');
        numEl.className = 'move-number';
        numEl.textContent = moveNum + '.';

        const whiteEl = document.createElement('span');
        whiteEl.className = 'move-white';
        whiteEl.textContent = whiteMove;
        if (i === moveHistory.length - 1 && !blackMove) whiteEl.classList.add('latest');

        row.appendChild(numEl);
        row.appendChild(whiteEl);

        if (blackMove) {
            const blackEl = document.createElement('span');
            blackEl.className = 'move-black';
            blackEl.textContent = blackMove;
            if (i + 1 === moveHistory.length - 1) blackEl.classList.add('latest');
            row.appendChild(blackEl);
        }

        moveList.appendChild(row);
    }
    moveList.scrollTop = moveList.scrollHeight;
}

function updateEvalDisplay(evaluation) {
    if (!evaluation) return;
    let displayScore, fillPct;

    if (evaluation.type === 'mate') {
        const mate = evaluation.value;
        displayScore = (mate > 0 ? '+' : '') + 'M' + Math.abs(mate);
        fillPct = mate > 0 ? 95 : 5;
    } else {
        const cp = evaluation.value || 0;
        displayScore = (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1);
        const winrate = 1 / (1 + Math.pow(10, -cp / 400));
        fillPct = Math.max(3, Math.min(97, winrate * 100));
    }

    evalScore.textContent = displayScore;
    evalFill.style.width = fillPct + '%';

    const cp = evaluation.type === 'mate' ? (evaluation.value > 0 ? 9999 : -9999) : (evaluation.value || 0);
    if (cp > 100) evalScore.style.color = '#22c55e';
    else if (cp < -100) evalScore.style.color = '#ef4444';
    else evalScore.style.color = '#f1f5f9';
}

function showLoading(show) {
    loadingOverlay.classList[show ? 'add' : 'remove']('active');
}

// ══════════════════════════════════════
// Game Controls
// ══════════════════════════════════════

function newGame() {
    game = new Chess();
    selectedSquare = null;
    legalMoves = [];
    lastMove = null;
    isThinking = false;
    moveHistory = [];
    capturedPieces = { w: [], b: [] };
    playerColor = colorSelect.value === 'white' ? 'w' : 'b';

    showLoading(false);
    gameStatus.textContent = '';
    updateEvalDisplay({ type: 'cp', value: 0 });

    if (playerColor === 'b' && !isFlipped) {
        isFlipped = true;
        renderLabels();
    } else if (playerColor === 'w' && isFlipped) {
        isFlipped = false;
        renderLabels();
    }

    updateUI();

    if (playerColor === 'b') {
        isThinking = true;
        showLoading(true);
        setTimeout(() => requestEngineMove(), 100);
    }
}

function undoMove() {
    if (isThinking || moveHistory.length === 0) return;

    const undoCount = moveHistory.length >= 2 ? 2 : 1;
    for (let i = 0; i < undoCount; i++) {
        game.undo();
        moveHistory.pop();
    }

    recalculateCaptured();
    lastMove = null;
    updateEvalDisplay({ type: 'cp', value: 0 });
    updateUI();
}

function recalculateCaptured() {
    capturedPieces = { w: [], b: [] };
    const history = game.history({ verbose: true });
    history.forEach(m => {
        if (m.captured) {
            capturedPieces[m.color].push(m.captured);
        }
    });
}

// ══════════════════════════════════════
// Event Listeners
// ══════════════════════════════════════

btnNewGame.addEventListener('click', newGame);
btnUndo.addEventListener('click', undoMove);
btnFlip.addEventListener('click', () => {
    isFlipped = !isFlipped;
    renderLabels();
    renderBoard();
});

// ══════════════════════════════════════
// Init
// ══════════════════════════════════════

initStockfish();
renderLabels();
updateUI();
