"""
Chess Engine Web App — Flask Backend
Powered by Stockfish via python-chess UCI interface.
"""

import os
import json
import chess
import chess.engine
from flask import Flask, render_template, request, jsonify, session, send_from_directory

import auth

app = Flask(__name__)
app.secret_key = "chess-engine-secret-key-2026"

DOCS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs")

# Stockfish path
STOCKFISH_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stockfish")
STOCKFISH_EXE = os.path.join(STOCKFISH_DIR, "stockfish.exe")

# Difficulty presets: (depth, time_limit_seconds)
DIFFICULTY_LEVELS = {
    1: {"name": "Beginner",     "depth": 1,  "time": 0.01, "elo": 800},
    2: {"name": "Easy",         "depth": 3,  "time": 0.05, "elo": 1200},
    3: {"name": "Medium",       "depth": 8,  "time": 0.2,  "elo": 1800},
    4: {"name": "Hard",         "depth": 15, "time": 1.0,  "elo": 2500},
    5: {"name": "Grandmaster",  "depth": 20, "time": 2.0,  "elo": 3500},
}

# In-memory game state (single user)
game_state = {
    "board": chess.Board(),
    "history": [],         # list of UCI move strings
    "difficulty": 3,
    "player_color": "white",
}


def get_engine():
    """Create a new Stockfish engine instance."""
    if not os.path.exists(STOCKFISH_EXE):
        raise FileNotFoundError(
            f"Stockfish not found at {STOCKFISH_EXE}. Run 'python setup.py' first."
        )
    return chess.engine.SimpleEngine.popen_uci(STOCKFISH_EXE)


def get_evaluation(board, engine, time_limit=0.5):
    """Get position evaluation in centipawns from white's perspective."""
    try:
        info = engine.analyse(board, chess.engine.Limit(time=time_limit))
        score = info["score"].white()
        if score.is_mate():
            mate_in = score.mate()
            # Return a large value for mate, scaled by distance
            return {"type": "mate", "value": mate_in}
        else:
            cp = score.score()
            return {"type": "cp", "value": cp}
    except Exception:
        return {"type": "cp", "value": 0}


def board_to_dict(board):
    """Convert board state to a JSON-serializable dict."""
    # Get all pieces on the board
    pieces = {}
    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece:
            square_name = chess.square_name(square)
            pieces[square_name] = {
                "type": piece.symbol().lower(),
                "color": "white" if piece.color == chess.WHITE else "black",
                "symbol": piece.symbol(),
            }

    # Get legal moves
    legal_moves = [move.uci() for move in board.legal_moves]

    # Check game status
    status = "playing"
    result = None
    if board.is_checkmate():
        status = "checkmate"
        result = "Black wins!" if board.turn == chess.WHITE else "White wins!"
    elif board.is_stalemate():
        status = "stalemate"
        result = "Draw by stalemate"
    elif board.is_insufficient_material():
        status = "draw"
        result = "Draw by insufficient material"
    elif board.is_fifty_moves():
        status = "draw"
        result = "Draw by fifty-move rule"
    elif board.is_repetition():
        status = "draw"
        result = "Draw by repetition"

    # Captured pieces
    captured_white = []  # white pieces captured by black
    captured_black = []  # black pieces captured by white
    initial_pieces = {
        chess.PAWN: 8, chess.KNIGHT: 2, chess.BISHOP: 2,
        chess.ROOK: 2, chess.QUEEN: 1, chess.KING: 1
    }
    piece_symbols = {
        chess.PAWN: "p", chess.KNIGHT: "n", chess.BISHOP: "b",
        chess.ROOK: "r", chess.QUEEN: "q", chess.KING: "k"
    }

    for piece_type, count in initial_pieces.items():
        white_count = len(board.pieces(piece_type, chess.WHITE))
        black_count = len(board.pieces(piece_type, chess.BLACK))
        sym = piece_symbols[piece_type]
        for _ in range(count - white_count):
            captured_white.append(sym.upper())
        for _ in range(count - black_count):
            captured_black.append(sym.lower())

    return {
        "fen": board.fen(),
        "pieces": pieces,
        "legal_moves": legal_moves,
        "turn": "white" if board.turn == chess.WHITE else "black",
        "in_check": board.is_check(),
        "status": status,
        "result": result,
        "captured_white": captured_white,
        "captured_black": captured_black,
        "move_number": board.fullmove_number,
        "history": game_state["history"],
    }


# ──────────────────────────────────────────
# CORS for auth API (docs client may run on another origin locally)
# ──────────────────────────────────────────

@app.after_request
def add_cors_headers(response):
    if request.path.startswith("/api/auth"):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/api/auth/<path:subpath>", methods=["OPTIONS"])
def auth_options(subpath):
    return "", 204


# ──────────────────────────────────────────
# Auth API (global username registry)
# ──────────────────────────────────────────

@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    data = request.get_json(silent=True) or {}
    ok, error = auth.register(data.get("username", ""), data.get("password", ""))
    if not ok:
        return jsonify({"ok": False, "error": error}), 409
    return jsonify({"ok": True})


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(silent=True) or {}
    ok, result = auth.login(data.get("username", ""), data.get("password", ""))
    if not ok:
        return jsonify({"ok": False, "error": result}), 401
    return jsonify({"ok": True, "username": result})


@app.route("/api/auth/guest", methods=["POST"])
def auth_guest():
    data = request.get_json(silent=True) or {}
    ok, result = auth.guest_login(data.get("username", ""))
    if not ok:
        return jsonify({"ok": False, "error": result}), 409
    return jsonify({"ok": True, "username": result})


@app.route("/api/auth/check", methods=["GET"])
def auth_check():
    ok, error = auth.check_username(request.args.get("username", ""))
    if not ok:
        return jsonify({"ok": False, "available": False, "error": error}), 200
    return jsonify({"ok": True, "available": True})


# ──────────────────────────────────────────
# Docs client (browser chess + auth UI)
# ──────────────────────────────────────────

@app.route("/play")
@app.route("/play/")
def play():
    return send_from_directory(DOCS_DIR, "index.html")


@app.route("/play/<path:filename>")
def play_static(filename):
    return send_from_directory(DOCS_DIR, filename)


# ──────────────────────────────────────────
# Routes
# ──────────────────────────────────────────

@app.route("/")
def index():
    """Serve the main chess page."""
    return render_template("index.html")


@app.route("/state", methods=["GET"])
def get_state():
    """Get current game state."""
    return jsonify(board_to_dict(game_state["board"]))


@app.route("/move", methods=["POST"])
def make_move():
    """Player makes a move, engine responds."""
    data = request.get_json()
    move_uci = data.get("move")
    difficulty = data.get("difficulty", game_state["difficulty"])
    game_state["difficulty"] = difficulty

    board = game_state["board"]

    # Validate and make player's move
    try:
        move = chess.Move.from_uci(move_uci)
        if move not in board.legal_moves:
            # Check for promotion — try adding 'q' suffix
            promo_move = chess.Move.from_uci(move_uci + "q")
            if promo_move in board.legal_moves:
                move = promo_move
            else:
                return jsonify({"error": "Illegal move"}), 400
    except (ValueError, chess.InvalidMoveError):
        return jsonify({"error": "Invalid move format"}), 400

    board.push(move)
    game_state["history"].append(move.uci())

    response_data = board_to_dict(board)
    response_data["player_move"] = move.uci()
    response_data["engine_move"] = None
    response_data["evaluation"] = {"type": "cp", "value": 0}

    # If game is over after player's move, return immediately
    if board.is_game_over():
        return jsonify(response_data)

    # Engine's turn
    diff = DIFFICULTY_LEVELS.get(difficulty, DIFFICULTY_LEVELS[3])
    try:
        engine = get_engine()
        try:
            result = engine.play(
                board,
                chess.engine.Limit(depth=diff["depth"], time=diff["time"])
            )
            engine_move = result.move
            board.push(engine_move)
            game_state["history"].append(engine_move.uci())

            # Get evaluation after engine move
            evaluation = get_evaluation(board, engine, time_limit=0.3)

            response_data = board_to_dict(board)
            response_data["player_move"] = move.uci()
            response_data["engine_move"] = engine_move.uci()
            response_data["evaluation"] = evaluation
        finally:
            engine.quit()
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Engine error: {str(e)}"}), 500

    return jsonify(response_data)


@app.route("/analyze", methods=["POST"])
def analyze():
    """Get evaluation for current position."""
    board = game_state["board"]
    try:
        engine = get_engine()
        try:
            evaluation = get_evaluation(board, engine, time_limit=1.0)

            # Also get the best move suggestion
            result = engine.play(board, chess.engine.Limit(time=0.5))
            best_move = result.move.uci() if result.move else None
        finally:
            engine.quit()

        return jsonify({
            "evaluation": evaluation,
            "best_move": best_move,
            "fen": board.fen(),
        })
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Analysis error: {str(e)}"}), 500


@app.route("/new_game", methods=["POST"])
def new_game():
    """Start a new game."""
    data = request.get_json() or {}
    difficulty = data.get("difficulty", game_state["difficulty"])
    player_color = data.get("player_color", "white")

    game_state["board"] = chess.Board()
    game_state["history"] = []
    game_state["difficulty"] = difficulty
    game_state["player_color"] = player_color

    response_data = board_to_dict(game_state["board"])
    response_data["evaluation"] = {"type": "cp", "value": 0}
    response_data["engine_move"] = None

    # If player chose black, engine makes the first move
    if player_color == "black":
        board = game_state["board"]
        diff = DIFFICULTY_LEVELS.get(difficulty, DIFFICULTY_LEVELS[3])
        try:
            engine = get_engine()
            try:
                result = engine.play(
                    board,
                    chess.engine.Limit(depth=diff["depth"], time=diff["time"])
                )
                engine_move = result.move
                board.push(engine_move)
                game_state["history"].append(engine_move.uci())

                response_data = board_to_dict(board)
                response_data["evaluation"] = get_evaluation(board, engine, 0.3)
                response_data["engine_move"] = engine_move.uci()
            finally:
                engine.quit()
        except Exception as e:
            response_data["error"] = str(e)

    return jsonify(response_data)


@app.route("/undo", methods=["POST"])
def undo():
    """Undo last move pair (player + engine)."""
    board = game_state["board"]

    moves_to_undo = 0
    if len(game_state["history"]) >= 2:
        moves_to_undo = 2
    elif len(game_state["history"]) == 1:
        moves_to_undo = 1

    for _ in range(moves_to_undo):
        board.pop()
        game_state["history"].pop()

    response_data = board_to_dict(board)
    response_data["evaluation"] = {"type": "cp", "value": 0}
    return jsonify(response_data)


@app.route("/legal_moves", methods=["POST"])
def legal_moves():
    """Get legal moves for a specific square."""
    data = request.get_json()
    square_name = data.get("square")

    board = game_state["board"]
    try:
        square = chess.parse_square(square_name)
    except ValueError:
        return jsonify({"moves": []})

    piece = board.piece_at(square)
    if not piece:
        return jsonify({"moves": []})

    moves = []
    for move in board.legal_moves:
        if move.from_square == square:
            moves.append({
                "to": chess.square_name(move.to_square),
                "uci": move.uci(),
                "is_capture": board.is_capture(move),
                "is_promotion": move.promotion is not None,
            })

    return jsonify({"moves": moves})


@app.route("/difficulty_levels", methods=["GET"])
def difficulty_levels():
    """Get available difficulty levels."""
    return jsonify(DIFFICULTY_LEVELS)


# ──────────────────────────────────────────
# Main
# ──────────────────────────────────────────

if __name__ == "__main__":
    # Check if Stockfish exists
    if not os.path.exists(STOCKFISH_EXE):
        print("=" * 60)
        print("  Stockfish not found!")
        print(f"  Expected at: {STOCKFISH_EXE}")
        print("  Run 'python setup.py' to download it automatically.")
        print("=" * 60)
    else:
        print(f"[OK] Stockfish found at: {STOCKFISH_EXE}")

    print("\n[*] Starting Chess Engine Server...")
    print("[*] Flask chess UI:  http://localhost:5000")
    print("[*] Browser client:  http://localhost:5000/play/\n")
    app.run(debug=True, host="0.0.0.0", port=5000)
