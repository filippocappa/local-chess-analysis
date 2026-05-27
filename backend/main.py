import asyncio
import json
import logging
import subprocess
from typing import Dict, Any, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import chess

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Constants
STOCKFISH_PATH = "/opt/homebrew/bin/stockfish"

app = FastAPI()

# Allow CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class EngineManager:
    def __init__(self, stockfish_path: str):
        self.stockfish_path = stockfish_path
        self.process: Optional[subprocess.Popen] = None

    def start(self):
        """Starts the Stockfish engine process."""
        if not self.process:
            try:
                self.process = subprocess.Popen(
                    [self.stockfish_path],
                    universal_newlines=True,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                )
                self._send_command("uci")
                # Wait for uciok
                while True:
                    line = self.process.stdout.readline().strip()
                    if line == "uciok":
                        break
                self._send_command("isready")
                while True:
                    line = self.process.stdout.readline().strip()
                    if line == "readyok":
                        break
                logger.info("Stockfish engine started successfully.")
            except Exception as e:
                logger.error(f"Failed to start Stockfish: {e}")

    def _send_command(self, command: str):
        """Sends a command to the engine."""
        if self.process and self.process.stdin:
            self.process.stdin.write(command + "\n")
            self.process.stdin.flush()

    def get_best_move(self, fen: str, depth: int) -> Optional[str]:
        """Asks Stockfish for the best move for a given FEN and depth."""
        if not self.process:
            self.start()
        
        self._send_command(f"position fen {fen}")
        self._send_command(f"go depth {depth}")
        
        best_move = None
        while True:
            line = self.process.stdout.readline().strip()
            if line.startswith("bestmove"):
                parts = line.split()
                if len(parts) >= 2:
                    best_move = parts[1]
                break
        return best_move

    def stop(self):
        """Stops the engine."""
        if self.process:
            self._send_command("quit")
            self.process.terminate()
            self.process = None

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        # State
        self.depth = 15
        self.observer_active = True
        self.board_status = "disconnected"
        self.dom_config = {
            "boardSelector": "wc-chess-board",
            "pieceSelector": ".piece",
            "colorPieceRegex": "\\b([wb])([pnbrqk])\\b",
            "squareRegex": "square-(\\d)(\\d)"
        }
        self.engine = EngineManager(STOCKFISH_PATH)
        self.engine.start()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Send initial state to the client
        await self.send_state(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except WebSocketDisconnect:
                self.disconnect(connection)

    async def send_state(self, websocket: WebSocket):
        state_msg = json.dumps({
            "type": "state",
            "depth": self.depth,
            "observer_active": self.observer_active,
            "dom_config": self.dom_config
        })
        await websocket.send_text(state_msg)

    async def handle_message(self, websocket: WebSocket, message: str):
        try:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "update_settings":
                if "depth" in data:
                    self.depth = data["depth"]
                if "observer_active" in data:
                    self.observer_active = data["observer_active"]
                if "dom_config" in data:
                    self.dom_config = data["dom_config"]
                # Broadcast updated state to all connected clients
                state_msg = json.dumps({
                    "type": "state",
                    "depth": self.depth,
                    "observer_active": self.observer_active,
                    "dom_config": self.dom_config
                })
                await self.broadcast(state_msg)

            elif msg_type == "log":
                await self.broadcast(message)
                
            elif msg_type == "board_status":
                self.board_status = data.get("status", "disconnected")
                await self.broadcast(message)

            elif msg_type == "fen":
                if not self.observer_active:
                    return
                
                fen = data.get("fen")
                user_color = data.get("user_color", "w")
                if fen:
                    # Validate FEN
                    try:
                        board = chess.Board(fen)
                        # Determine active turn
                        active_color = "w" if board.turn else "b"
                        
                        # Valid FEN, get best move
                        best_move = self.engine.get_best_move(fen, self.depth)
                        if best_move:
                            move_msg = json.dumps({
                                "type": "best_move",
                                "move": best_move,
                                "fen": fen,
                                "active_color": active_color,
                                "user_color": user_color
                            })
                            await self.broadcast(move_msg)
                    except ValueError:
                        logger.warning(f"Invalid FEN received: {fen}")

        except json.JSONDecodeError:
            logger.error("Invalid JSON received")

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.handle_message(websocket, data)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

@app.on_event("shutdown")
def shutdown_event():
    manager.engine.stop()
