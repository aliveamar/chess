/* ══════════════════════════════════════════
   Chess Engine — Game Logic & Board UI
   ══════════════════════════════════════════ */

// ── Piece Unicode Characters ──
const PIECE_UNICODE = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟',
};

// Map piece symbol to unicode for captured display
const CAPTURED_UNICODE = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟',
};

// ── State ──
let boardState = {};       // { "e2": { type: "p", color: "white", symbol: "P" }, ... }
let selectedSquare = null;
let legalMoves = [];       // legal moves from selected square
let lastMove = null;       // { from, to }
let isFlipped = false;
let gameOver = false;
let isThinking = false;
let moveHistory = [];      // SAN-like display
let playerColor = 'white';
let inCheck = false;
let checkSquare = null;

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
const btnAnalyze = document.getElementById('btnAnalyze');
const difficultySelect = document.getElementById('difficultySelect');
const colorSelect = document.getElementById('colorSelect');

// ── Drag State ──
let dragPiece = null;
let dragFrom = null;
let ghostEl = null;

// ══════════════════════════════════════
// Board Rendering
// ══════════════════════════════════════

function getSquareName(row, col) {
    const file = String.fromCharCode(97 + col); // a-h
    const rank = 8 - row;                       // 8-1
    return file + rank;
}

function getRowCol(squareName) {
    const col = squareName.charCodeAt(0) - 97;
    const row = 8 - parseInt(squareName[1]);
    return [row, col];
}

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

    for (let displayRow = 0; displayRow < 8; displayRow++) {
        for (let displayCol = 0; displayCol < 8; displayCol++) {
            const row = isFlipped ? 7 - displayRow : displayRow;
            const col = isFlipped ? 7 - displayCol : displayCol;
            const squareName = getSquareName(row, col);
            const isLight = (row + col) % 2 === 0;

            const squareEl = document.createElement('div');
            squareEl.className = `square ${isLight ? 'light' : 'dark'}`;
            squareEl.dataset.square = squareName;

            // Highlights
            if (selectedSquare === squareName) {
                squareEl.classList.add('selected');
            }
            if (lastMove && (lastMove.from === squareName || lastMove.to === squareName)) {
                squareEl.classList.add('last-move');
            }
            if (inCheck && checkSquare === squareName) {
                squareEl.classList.add('in-check');
            }

            // Piece
            const pieceData = boardState[squareName];
            if (pieceData) {
                const pieceEl = document.createElement('span');
                pieceEl.className = 'piece';
                pieceEl.textContent = PIECE_UNICODE[pieceData.symbol] || pieceData.symbol;
                pieceEl.dataset.square = squareName;
                pieceEl.dataset.color = pieceData.color;

                // Drag events
                pieceEl.addEventListener('mousedown', onPieceMouseDown);
                pieceEl.addEventListener('touchstart', onPieceTouchStart, { passive: false });

                if (dragFrom === squareName) {
                    pieceEl.classList.add('dragging');
                }

                squareEl.appendChild(pieceEl);
            }

            // Legal move dots
            if (selectedSquare) {
                const isLegalTarget = legalMoves.some(m => m.to === squareName);
                if (isLegalTarget) {
                    const dot = document.createElement('div');
                    const isCapture = boardState[squareName] != null;
                    dot.className = `legal-dot ${isCapture ? 'capture' : ''}`;
                    squareEl.appendChild(dot);
                }
            }

            // Click handler
            squareEl.addEventListener('click', () => onSquareClick(squareName));

            boardEl.appendChild(squareEl);
        }
    }
}

// ══════════════════════════════════════
// Piece Interaction (Click & Drag)
// ══════════════════════════════════════

function onSquareClick(squareName) {
    if (gameOver || isThinking) return;

    const piece = boardState[squareName];

    // If a piece is selected and this is a legal target → make move
    if (selectedSquare && selectedSquare !== squareName) {
        const isLegal = legalMoves.some(m => m.to === squareName);
        if (isLegal) {
            const moveUci = selectedSquare + squareName;
            // Check for pawn promotion
            const fromPiece = boardState[selectedSquare];
            if (fromPiece && fromPiece.type === 'p') {
                const destRank = parseInt(squareName[1]);
                if ((fromPiece.color === 'white' && destRank === 8) ||
                    (fromPiece.color === 'black' && destRank === 1)) {
                    showPromotionModal(moveUci, fromPiece.color);
                    clearSelection();
                    return;
                }
            }
            makeMove(moveUci);
            clearSelection();
            return;
        }
    }

    // If clicking own piece → select it
    if (piece && piece.color === playerColor) {
        selectSquare(squareName);
    } else {
        clearSelection();
    }
}

function selectSquare(squareName) {
    selectedSquare = squareName;
    fetchLegalMoves(squareName);
}

function clearSelection() {
    selectedSquare = null;
    legalMoves = [];
    renderBoard();
}

// ── Drag & Drop ──

function onPieceMouseDown(e) {
    if (gameOver || isThinking) return;
    e.preventDefault();

    const square = e.target.dataset.square;
    const piece = boardState[square];
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
    if (gameOver || isThinking) return;
    e.preventDefault();

    const touch = e.touches[0];
    const square = e.target.dataset.square;
    const piece = boardState[square];
    if (!piece || piece.color !== playerColor) return;

    startDrag(e.target, square, touch.clientX, touch.clientY);

    const onTouchMove = (ev) => {
        ev.preventDefault();
        const t = ev.touches[0];
        moveDrag(t.clientX, t.clientY);
    };
    const onTouchEnd = (ev) => {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        const t = ev.changedTouches[0];
        endDrag(t.clientX, t.clientY);
    };

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
}

function startDrag(pieceEl, square, x, y) {
    dragFrom = square;
    selectedSquare = square;
    fetchLegalMoves(square);

    // Create ghost
    ghostEl = document.createElement('span');
    ghostEl.className = 'piece-ghost';
    ghostEl.textContent = pieceEl.textContent;
    document.body.appendChild(ghostEl);
    moveDrag(x, y);
}

function moveDrag(x, y) {
    if (!ghostEl) return;
    const size = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--square-size')) || 60;
    ghostEl.style.left = (x - size / 2) + 'px';
    ghostEl.style.top = (y - size / 2) + 'px';
}

function endDrag(x, y) {
    if (ghostEl) {
        ghostEl.remove();
        ghostEl = null;
    }

    // Find which square the piece was dropped on
    const target = document.elementFromPoint(x, y);
    if (target) {
        const squareEl = target.closest('.square');
        if (squareEl) {
            const toSquare = squareEl.dataset.square;
            if (dragFrom && toSquare && dragFrom !== toSquare) {
                const isLegal = legalMoves.some(m => m.to === toSquare);
                if (isLegal) {
                    const moveUci = dragFrom + toSquare;
                    const fromPiece = boardState[dragFrom];
                    if (fromPiece && fromPiece.type === 'p') {
                        const destRank = parseInt(toSquare[1]);
                        if ((fromPiece.color === 'white' && destRank === 8) ||
                            (fromPiece.color === 'black' && destRank === 1)) {
                            showPromotionModal(moveUci, fromPiece.color);
                            dragFrom = null;
                            clearSelection();
                            return;
                        }
                    }
                    dragFrom = null;
                    makeMove(moveUci);
                    clearSelection();
                    return;
                }
            }
        }
    }

    dragFrom = null;
    renderBoard();
}

// ══════════════════════════════════════
// Promotion
// ══════════════════════════════════════

function showPromotionModal(moveUci, color) {
    promotionModal.classList.add('active');
    promotionChoices.innerHTML = '';

    const pieces = color === 'white'
        ? [['Q', '♕'], ['R', '♖'], ['B', '♗'], ['N', '♘']]
        : [['q', '♛'], ['r', '♜'], ['b', '♝'], ['n', '♞']];

    pieces.forEach(([code, symbol]) => {
        const btn = document.createElement('div');
        btn.className = 'promotion-choice';
        btn.textContent = symbol;
        btn.addEventListener('click', () => {
            promotionModal.classList.remove('active');
            makeMove(moveUci + code.toLowerCase());
        });
        promotionChoices.appendChild(btn);
    });
}

// ══════════════════════════════════════
// API Communication
// ══════════════════════════════════════

async function fetchState() {
    try {
        const res = await fetch('/state');
        const data = await res.json();
        updateState(data);
    } catch (err) {
        console.error('Failed to fetch state:', err);
    }
}

async function fetchLegalMoves(square) {
    try {
        const res = await fetch('/legal_moves', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ square }),
        });
        const data = await res.json();
        legalMoves = data.moves || [];
        renderBoard();
    } catch (err) {
        console.error('Failed to fetch legal moves:', err);
    }
}

async function makeMove(moveUci) {
    if (isThinking) return;
    isThinking = true;
    showLoading(true);

    try {
        const difficulty = parseInt(difficultySelect.value);
        const res = await fetch('/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ move: moveUci, difficulty }),
        });

        if (!res.ok) {
            const err = await res.json();
            console.error('Move error:', err.error);
            isThinking = false;
            showLoading(false);
            return;
        }

        const data = await res.json();

        // Set last move for highlight
        if (data.engine_move) {
            lastMove = {
                from: data.engine_move.substring(0, 2),
                to: data.engine_move.substring(2, 4),
            };
        } else {
            lastMove = {
                from: moveUci.substring(0, 2),
                to: moveUci.substring(2, 4),
            };
        }

        updateState(data);
        updateEvaluation(data.evaluation);
    } catch (err) {
        console.error('Failed to make move:', err);
    }

    isThinking = false;
    showLoading(false);
}

async function newGame() {
    isThinking = true;
    showLoading(true);
    const difficulty = parseInt(difficultySelect.value);
    playerColor = colorSelect.value;

    try {
        const res = await fetch('/new_game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ difficulty, player_color: playerColor }),
        });
        const data = await res.json();

        lastMove = null;
        gameOver = false;
        selectedSquare = null;
        legalMoves = [];
        moveHistory = [];

        if (data.engine_move) {
            lastMove = {
                from: data.engine_move.substring(0, 2),
                to: data.engine_move.substring(2, 4),
            };
        }

        updateState(data);
        updateEvaluation(data.evaluation || { type: 'cp', value: 0 });

        // Flip board if playing as black
        if (playerColor === 'black' && !isFlipped) {
            isFlipped = true;
            renderLabels();
        } else if (playerColor === 'white' && isFlipped) {
            isFlipped = false;
            renderLabels();
        }
    } catch (err) {
        console.error('Failed to start new game:', err);
    }

    isThinking = false;
    showLoading(false);
}

async function undoMove() {
    if (isThinking) return;

    try {
        const res = await fetch('/undo', { method: 'POST' });
        const data = await res.json();
        lastMove = null;
        gameOver = false;
        updateState(data);
        updateEvaluation(data.evaluation || { type: 'cp', value: 0 });
    } catch (err) {
        console.error('Failed to undo:', err);
    }
}

async function analyzePosition() {
    if (isThinking) return;
    isThinking = true;
    showLoading(true);

    try {
        const res = await fetch('/analyze', { method: 'POST' });
        const data = await res.json();
        if (data.evaluation) {
            updateEvaluation(data.evaluation);
        }
        if (data.best_move) {
            // Briefly highlight the best move
            const from = data.best_move.substring(0, 2);
            const to = data.best_move.substring(2, 4);
            highlightBestMove(from, to);
        }
    } catch (err) {
        console.error('Analysis failed:', err);
    }

    isThinking = false;
    showLoading(false);
}

// ══════════════════════════════════════
// State Update
// ══════════════════════════════════════

function updateState(data) {
    boardState = data.pieces || {};
    inCheck = data.in_check || false;

    // Find king square if in check
    checkSquare = null;
    if (inCheck) {
        const turn = data.turn; // who is in check
        for (const [sq, piece] of Object.entries(boardState)) {
            if (piece.type === 'k' && piece.color === turn) {
                checkSquare = sq;
                break;
            }
        }
    }

    // Update turn indicator
    const turn = data.turn || 'white';
    turnIndicator.innerHTML = `
        <span class="turn-dot" style="background: ${turn === 'white' ? '#f1f5f9' : '#1e1e2e'}; border: 1px solid #64748b;"></span>
        ${turn.charAt(0).toUpperCase() + turn.slice(1)} to move
    `;

    // Game status
    if (data.status !== 'playing' && data.result) {
        gameOver = true;
        gameStatus.textContent = data.result;
        gameStatus.style.color = data.status === 'checkmate' ? '#ef4444' : '#f59e0b';
    } else if (inCheck) {
        gameStatus.textContent = 'Check!';
        gameStatus.style.color = '#ef4444';
    } else {
        gameStatus.textContent = '';
    }

    // Captured pieces
    updateCaptured(data.captured_white || [], data.captured_black || []);

    // Move history
    updateMoveHistory(data.history || []);

    renderBoard();
}

function updateCaptured(white, black) {
    capturedByWhite.innerHTML = '';
    capturedByBlack.innerHTML = '';

    // "captured_white" = white pieces that were captured (shown in black's tray)
    // "captured_black" = black pieces that were captured (shown in white's tray)

    black.forEach(sym => {
        const span = document.createElement('span');
        span.className = 'captured-piece';
        span.textContent = CAPTURED_UNICODE[sym] || sym;
        capturedByWhite.appendChild(span); // white captured these black pieces
    });

    white.forEach(sym => {
        const span = document.createElement('span');
        span.className = 'captured-piece';
        span.textContent = CAPTURED_UNICODE[sym] || sym;
        capturedByBlack.appendChild(span); // black captured these white pieces
    });
}

function updateMoveHistory(history) {
    moveList.innerHTML = '';

    if (!history || history.length === 0) {
        moveList.innerHTML = '<div class="move-placeholder">Play a move to begin...</div>';
        return;
    }

    for (let i = 0; i < history.length; i += 2) {
        const moveNum = Math.floor(i / 2) + 1;
        const whiteMove = history[i] || '';
        const blackMove = history[i + 1] || '';

        const row = document.createElement('div');
        row.className = 'move-row';

        const numEl = document.createElement('span');
        numEl.className = 'move-number';
        numEl.textContent = moveNum + '.';

        const whiteEl = document.createElement('span');
        whiteEl.className = 'move-white';
        whiteEl.textContent = whiteMove;
        if (i === history.length - 1 || i === history.length - 2) {
            // Latest move pair
        }
        if (i === history.length - 1 && !blackMove) {
            whiteEl.classList.add('latest');
        }

        row.appendChild(numEl);
        row.appendChild(whiteEl);

        if (blackMove) {
            const blackEl = document.createElement('span');
            blackEl.className = 'move-black';
            blackEl.textContent = blackMove;
            if (i + 1 === history.length - 1) {
                blackEl.classList.add('latest');
            }
            row.appendChild(blackEl);
        }

        moveList.appendChild(row);
    }

    // Scroll to bottom
    moveList.scrollTop = moveList.scrollHeight;
}

function updateEvaluation(evaluation) {
    if (!evaluation) return;

    let displayScore;
    let fillPct;

    if (evaluation.type === 'mate') {
        const mate = evaluation.value;
        displayScore = (mate > 0 ? '+' : '') + 'M' + Math.abs(mate);
        fillPct = mate > 0 ? 95 : 5;
    } else {
        const cp = evaluation.value || 0;
        displayScore = (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1);

        // Sigmoid-ish mapping: cp → percentage (50% = even)
        // Use a winrate-like formula
        const winrate = 1 / (1 + Math.pow(10, -cp / 400));
        fillPct = Math.max(3, Math.min(97, winrate * 100));
    }

    evalScore.textContent = displayScore;
    evalFill.style.width = fillPct + '%';

    // Color the score
    const cp = evaluation.type === 'mate' ? (evaluation.value > 0 ? 9999 : -9999) : (evaluation.value || 0);
    if (cp > 100) {
        evalScore.style.color = '#22c55e';
    } else if (cp < -100) {
        evalScore.style.color = '#ef4444';
    } else {
        evalScore.style.color = '#f1f5f9';
    }
}

function highlightBestMove(from, to) {
    // Briefly highlight squares
    const fromEl = boardEl.querySelector(`[data-square="${from}"]`);
    const toEl = boardEl.querySelector(`[data-square="${to}"]`);

    if (fromEl) {
        fromEl.style.boxShadow = 'inset 0 0 12px rgba(34, 197, 94, 0.6)';
        setTimeout(() => { fromEl.style.boxShadow = ''; }, 2000);
    }
    if (toEl) {
        toEl.style.boxShadow = 'inset 0 0 12px rgba(34, 197, 94, 0.6)';
        setTimeout(() => { toEl.style.boxShadow = ''; }, 2000);
    }
}

function showLoading(show) {
    if (show) {
        loadingOverlay.classList.add('active');
    } else {
        loadingOverlay.classList.remove('active');
    }
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
btnAnalyze.addEventListener('click', analyzePosition);

// ══════════════════════════════════════
// Initialization
// ══════════════════════════════════════

renderLabels();
fetchState();
