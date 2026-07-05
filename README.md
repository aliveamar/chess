# Chess Engine — Powered by Stockfish

A beautiful web-based chess app powered by **Stockfish** (~3500 ELO), built with **Python/Flask** and a premium dark-themed UI.

### [Play Now — Click Here](https://aliveamar.github.io/chess/)

![Python](https://img.shields.io/badge/Python-3.8+-blue?logo=python)
![Flask](https://img.shields.io/badge/Flask-Backend-green?logo=flask)
![Stockfish](https://img.shields.io/badge/Stockfish-18-orange)

## Features

- **Play against Stockfish** — the world's strongest chess engine
- **5 difficulty levels** — Beginner (~800 ELO) to Grandmaster (~3500 ELO)
- **Drag & drop** or click-to-move pieces
- **Live evaluation bar** — see who's winning in real-time
- **Move history** panel
- **Captured pieces** display
- **Play as White or Black**
- **Flip board**, **undo moves**, **analyze position**
- **Premium dark theme** with glassmorphism design
- **Responsive** — works on desktop and tablet

## Quick Start

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Download Stockfish engine

```bash
python setup.py
```

This automatically downloads Stockfish 17 for Windows and places it in the `stockfish/` folder.

### 3. Run the app

```bash
python app.py
```

### 4. Play

Open **http://localhost:5000** in your browser.

## Project Structure

```
chess/
├── app.py              # Flask backend + Stockfish integration
├── setup.py            # Auto-download Stockfish binary
├── requirements.txt    # Python dependencies
├── README.md           # This file
├── stockfish/          # Stockfish binary (auto-downloaded)
├── static/
│   ├── css/style.css   # Dark theme + glassmorphism styling
│   └── js/game.js      # Board rendering + game logic
└── templates/
    └── index.html      # Main page
```

## Difficulty Levels

| Level | Name | ~ELO | Description |
|:---|:---|:---|:---|
| 1 | Beginner | ~800 | Great for learning |
| 2 | Easy | ~1200 | Casual play |
| 3 | Medium | ~1800 | A decent challenge |
| 4 | Hard | ~2500 | Expert level |
| 5 | Grandmaster | ~3500 | Full Stockfish strength |

## Tech Stack

- **Backend:** Python, Flask, python-chess
- **Engine:** Stockfish (UCI protocol)
- **Frontend:** Vanilla HTML/CSS/JS
- **Design:** Dark theme, glassmorphism, Inter font

## License

This project uses [Stockfish](https://stockfishchess.org/), which is licensed under the GPL-3.0 license.
