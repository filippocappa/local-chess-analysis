# Local Chess Analysis Tool (Nexus Engine)

A highly optimized, fully local chess analysis tool that bridges a web browser with a local Stockfish engine. It consists of a Python FastAPI backend, a sleek Next.js dashboard, and a passive Tampermonkey userscript for automated board monitoring.

## Setup Instructions

### Prerequisites
- **Python 3.8+**
- **Node.js 18+**
- **Stockfish**: A local binary (e.g., installed via `brew install stockfish` on macOS).
- **Tampermonkey**: Browser extension.

### 1. One-Click Start (macOS/Linux)
Open a terminal in the root of this repository and run:
```bash
./start.sh
```
*This script will automatically create the Python virtual environment, install all Node modules, and launch both the backend and frontend servers in the background. Press `Ctrl+C` to cleanly exit everything.*

The dashboard will be available at [http://localhost:3000](http://localhost:3000).

### 2. Userscript Installation
1. Open your browser and navigate to the Tampermonkey dashboard.
2. Create a new script.
3. Copy the contents of `userscript.js` from the root of this repository.
4. Paste it into the editor, save it, and ensure it's enabled.

## Architecture

The system runs entirely locally on your machine for zero-latency analysis without API costs or rate limits:

1. **Backend (Python / FastAPI)**
   - Acts as the central hub.
   - Manages a persistent WebSocket server.
   - Keeps an asynchronous local Stockfish instance running via `asyncio.subprocess` to stream live calculations.
   - Validates incoming FENs using `python-chess` and manages UCI engine configurations dynamically.
2. **Frontend (Next.js App Router)**
   - A dark-themed, highly responsive dashboard built with Tailwind CSS and Framer Motion.
   - Connects to the WebSocket to display the optimal sequence and stream the engine's live thinking process.
   - Allows live adjustments to Target ELO, Skill Level, calculation depth, move times, and DOM extraction logic.
   - Includes a built-in remote console to see debug logs directly from the userscript.
3. **Userscript (Tampermonkey)**
   - Injected into your target chess websites (e.g., chess.com or lichess.org).
   - Entirely passive: it draws no arrows and alters no HTML, keeping your board clean.
   - Uses a `MutationObserver` to watch for board changes based on the dynamic CSS selectors sent from the backend.
   - Automatically detects active turns by comparing previous board states and pipes the FEN string to the backend.

## Usage

1. **Configure Extractors**: In the dashboard, configure your DOM selectors if needed (defaults are tailored for standard `wc-chess-board` chess.com elements).
2. **Play**: Open a game on your target site. The userscript will automatically connect to the backend and the dashboard will show "Board Detected".
3. **Analyze**: As the board changes, the dashboard will animate and update with the optimal sequence. The engine's live calculations will stream directly into the dashboard console.
4. **Tune the Engine**: Adjust the Skill Level, ELO, Depth, or Time Limit dynamically without needing to restart anything!

## License
MIT
