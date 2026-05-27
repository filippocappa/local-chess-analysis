# Local Chess Analysis Tool

A highly optimized, fully local chess analysis tool that bridges a web browser with a local Stockfish engine. It consists of a Python FastAPI backend, a sleek Next.js dashboard, and a passive Tampermonkey userscript for automated board monitoring.

## Architecture

The system runs entirely locally on your machine for zero-latency analysis without API costs or rate limits:

1. **Backend (Python / FastAPI)**
   - Acts as the central hub.
   - Manages a persistent WebSocket server.
   - Keeps a local Stockfish instance running via a persistent `subprocess`.
   - Validates incoming FENs using `python-chess`.
2. **Frontend (Next.js App Router)**
   - A dark-themed, highly responsive dashboard built with Tailwind CSS and Framer Motion.
   - Connects to the WebSocket to display the current "best move" in real-time.
   - Allows live adjustments to engine calculation depth, pausing the observer, and re-configuring the DOM extraction logic on the fly.
3. **Userscript (Tampermonkey)**
   - Injected into your target chess websites (e.g., chess.com or lichess.org).
   - Entirely passive: it draws no arrows and alters no HTML, keeping your board clean.
   - Uses a `MutationObserver` to watch for board changes based on the dynamic CSS selectors sent from the backend.
   - Calculates the FEN string from the visible pieces and pipes it to the backend.

## Prerequisites

- **Python 3.8+**
- **Node.js 18+**
- **Stockfish**: A local binary (e.g., installed via `brew install stockfish` on macOS).
- **Tampermonkey**: Browser extension.

## Setup Instructions

### 1. Python Backend

Open a terminal and set up the backend:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Start the server (runs on localhost:8000)
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Next.js Dashboard

Open a second terminal window and set up the frontend:

```bash
cd frontend
npm install
npm run dev
```

The dashboard will be available at [http://localhost:3000](http://localhost:3000).

### 3. Userscript Installation

1. Open your browser and navigate to the Tampermonkey dashboard.
2. Create a new script.
3. Copy the contents of `userscript.js` from the root of this repository.
4. Paste it into the editor, save it, and ensure it's enabled.

## Usage

1. **Configure Extractors**: In the dashboard, configure your DOM selectors if needed (defaults are tailored for standard chess.com boards).
2. **Play**: Open a game on your target site. The userscript will automatically connect to the backend.
3. **Analyze**: As the board changes, the dashboard will animate and update with the optimal sequence calculated by Stockfish.
4. **Settings**: Adjust the calculation depth on the dashboard. Higher depth = better moves but slower calculation.

## License

MIT
