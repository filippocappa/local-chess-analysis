import asyncio
import json
import logging
import subprocess
from typing import Dict, Any, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import chess

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

STOCKFISH_PATH = "/opt/homebrew/bin/stockfish"

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AsyncEngineManager:
    def __init__(self, stockfish_path: str, connection_manager):
        self.stockfish_path = stockfish_path
        self.process: Optional[asyncio.subprocess.Process] = None
        self.connection_manager = connection_manager
        self.search_task: Optional[asyncio.Task] = None
        self.is_searching = False

    async def start(self):
        if not self.process:
            try:
                self.process = await asyncio.create_subprocess_exec(
                    self.stockfish_path,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
                await self._send_command("uci")
                # Wait for uciok
                while True:
                    line = await self.process.stdout.readline()
                    if not line: break
                    if line.decode().strip() == "uciok":
                        break
                await self._send_command("isready")
                while True:
                    line = await self.process.stdout.readline()
                    if not line: break
                    if line.decode().strip() == "readyok":
                        break
                logger.info("Async Stockfish engine started successfully.")
                
                # Apply initial settings
                await self.apply_settings(
                    self.connection_manager.skill_level,
                    self.connection_manager.elo
                )
            except Exception as e:
                logger.error(f"Failed to start Stockfish: {e}")

    async def apply_settings(self, skill_level: int, elo: int):
        # Stop search if running to apply safely
        await self._send_command("stop")
        
        # Skill level is 0-20
        await self._send_command(f"setoption name Skill Level value {skill_level}")
        
        # Elo is tricky. Stockfish uses UCI_LimitStrength and UCI_Elo
        # But only if UCI_LimitStrength is true.
        # If elo > 0, we limit it. If elo == 0, we don't limit.
        if elo > 0:
            await self._send_command("setoption name UCI_LimitStrength value true")
            await self._send_command(f"setoption name UCI_Elo value {elo}")
        else:
            await self._send_command("setoption name UCI_LimitStrength value false")

    async def _send_command(self, command: str):
        if self.process and self.process.stdin:
            self.process.stdin.write((command + "\n").encode())
            await self.process.stdin.drain()

    async def _read_output(self, fen: str, active_color: str, user_color: str):
        if not self.process or not self.process.stdout: return
        
        while self.is_searching:
            try:
                line_bytes = await asyncio.wait_for(self.process.stdout.readline(), timeout=0.1)
                if not line_bytes: break
                line = line_bytes.decode().strip()
                
                if line.startswith("info depth"):
                    # Stream live thinking
                    await self.connection_manager.broadcast(json.dumps({
                        "type": "engine_info",
                        "info": line
                    }))
                elif line.startswith("bestmove"):
                    parts = line.split()
                    if len(parts) >= 2:
                        best_move = parts[1]
                        await self.connection_manager.broadcast(json.dumps({
                            "type": "best_move",
                            "move": best_move,
                            "fen": fen,
                            "active_color": active_color,
                            "user_color": user_color
                        }))
                    self.is_searching = False
                    break
            except asyncio.TimeoutError:
                continue

    async def search(self, fen: str, depth: int, movetime: int, active_color: str, user_color: str):
        if not self.process:
            await self.start()
        
        # Stop any ongoing search
        if self.is_searching:
            await self._send_command("stop")
            self.is_searching = False
            # Wait a tiny bit for it to stop
            await asyncio.sleep(0.1)

        await self._send_command(f"position fen {fen}")
        
        if movetime > 0:
            await self._send_command(f"go movetime {movetime}")
        else:
            await self._send_command(f"go depth {depth}")
            
        self.is_searching = True
        
        # Start background reader task for this search
        if self.search_task:
            self.search_task.cancel()
        self.search_task = asyncio.create_task(self._read_output(fen, active_color, user_color))

    async def stop(self):
        if self.process:
            await self._send_command("quit")
            try:
                self.process.terminate()
            except Exception:
                pass
            self.process = None

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        
        # Engine State
        self.depth = 15
        self.movetime = 0 # 0 means use depth
        self.skill_level = 20
        self.elo = 0 # 0 means max strength
        
        # App State
        self.observer_active = True
        self.overlay_enabled = True
        self.board_status = "disconnected"
        self.dom_config = {
            "boardSelector": "wc-chess-board",
            "pieceSelector": ".piece",
            "colorPieceRegex": "\\b([wb])([pnbrqk])\\b",
            "squareRegex": "square-(\\d)(\\d)"
        }
        self.moves_history = []
        self.last_fen = None
        
        self.engine = AsyncEngineManager(STOCKFISH_PATH, self)

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        await self.send_state(websocket)
        # Ensure engine is started
        if not self.engine.process:
            await self.engine.start()

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.warning(f"Error broadcasting message to client: {e}")
                self.disconnect(connection)

    async def send_state(self, websocket: WebSocket):
        state_msg = json.dumps({
            "type": "state",
            "depth": self.depth,
            "movetime": self.movetime,
            "skill_level": self.skill_level,
            "elo": self.elo,
            "observer_active": self.observer_active,
            "overlay_enabled": self.overlay_enabled,
            "dom_config": self.dom_config,
            "board_status": self.board_status,
            "moves_history": self.moves_history
        })
        await websocket.send_text(state_msg)

    async def handle_message(self, websocket: WebSocket, message: str):
        try:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "update_settings":
                settings_changed = False
                engine_settings_changed = False
                
                if "depth" in data:
                    self.depth = data["depth"]
                    settings_changed = True
                if "movetime" in data:
                    self.movetime = data["movetime"]
                    settings_changed = True
                if "skill_level" in data:
                    self.skill_level = data["skill_level"]
                    settings_changed = True
                    engine_settings_changed = True
                if "elo" in data:
                    self.elo = data["elo"]
                    settings_changed = True
                    engine_settings_changed = True
                if "observer_active" in data:
                    self.observer_active = data["observer_active"]
                    settings_changed = True
                if "overlay_enabled" in data:
                    self.overlay_enabled = data["overlay_enabled"]
                    settings_changed = True
                if "dom_config" in data:
                    self.dom_config = data["dom_config"]
                    settings_changed = True
                    
                if engine_settings_changed:
                    await self.engine.apply_settings(self.skill_level, self.elo)

                if settings_changed:
                    # Broadcast updated state
                    state_msg = json.dumps({
                        "type": "state",
                        "depth": self.depth,
                        "movetime": self.movetime,
                        "skill_level": self.skill_level,
                        "elo": self.elo,
                        "observer_active": self.observer_active,
                        "dom_config": self.dom_config,
                        "board_status": self.board_status
                    })
                    await self.broadcast(state_msg)

            elif msg_type == "log":
                await self.broadcast(message)
                
            elif msg_type == "board_status":
                self.board_status = data.get("status", "disconnected")
                await self.broadcast(message)

            elif msg_type == "toggle_turn":
                await self.broadcast(message)

            elif msg_type == "fen":
                if not self.observer_active:
                    return
                
                fen = data.get("fen")
                user_color = data.get("user_color", "w")
                if fen:
                    try:
                        board = chess.Board(fen)
                        active_color = "w" if board.turn else "b"
                        
                        # Reset history if starting position is detected
                        if board.board_fen() == chess.Board().board_fen():
                            self.moves_history = []
                            await self.broadcast(json.dumps({
                                "type": "move_history",
                                "moves": self.moves_history
                            }))

                        # Detect move made
                        move_san = None
                        if self.last_fen:
                            try:
                                prev_board = chess.Board(self.last_fen)
                                for move in prev_board.legal_moves:
                                    temp_board = prev_board.copy()
                                    temp_board.push(move)
                                    if temp_board.board_fen() == board.board_fen():
                                        move_san = prev_board.san(move)
                                        break
                            except Exception:
                                pass
                        
                        self.last_fen = fen
                        if move_san:
                            self.moves_history.append(move_san)
                            await self.broadcast(json.dumps({
                                "type": "move_history",
                                "moves": self.moves_history
                            }))

                        # Clear old best move on all dashboards instantly
                        await self.broadcast(json.dumps({
                            "type": "clear_best_move",
                            "active_color": active_color,
                            "user_color": user_color
                        }))
                        
                        # Trigger async search
                        await self.engine.search(fen, self.depth, self.movetime, active_color, user_color)
                        
                    except ValueError:
                        logger.warning(f"Invalid FEN received: {fen}")
                    except Exception as e:
                        logger.error(f"Error processing FEN or running search: {e}", exc_info=True)

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
        logger.error(f"WebSocket error: {e}", exc_info=True)
        manager.disconnect(websocket)

@app.on_event("shutdown")
async def shutdown_event():
    await manager.engine.stop()
