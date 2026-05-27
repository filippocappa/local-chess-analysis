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

class WSLogHandler(logging.Handler):
    def __init__(self, manager):
        super().__init__()
        self.manager = manager

    def emit(self, record):
        try:
            log_entry = self.format(record)
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(self.manager.send_backend_log(log_entry, record.levelname.lower()))
        except Exception:
            pass

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
        self.current_board = chess.Board()
        self.user_color = "w"
        
        self.engine = AsyncEngineManager(STOCKFISH_PATH, self)
        
        # Add logging handler
        handler = WSLogHandler(self)
        handler.setFormatter(logging.Formatter('%(message)s'))
        logger.addHandler(handler)

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

    async def send_backend_log(self, message: str, level: str):
        payload = json.dumps({
            "type": "backend_log",
            "level": level,
            "message": message
        })
        for connection in list(self.active_connections):
            try:
                await connection.send_text(payload)
            except Exception:
                pass

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
                # Toggle active turn on authoritative board
                self.current_board.turn = not self.current_board.turn
                self.last_fen = self.current_board.fen()
                active_color = "w" if self.current_board.turn else "b"
                logger.info(f"Manual turn toggle requested. New active color: {active_color}")

                # Broadcast updated move history state
                await self.broadcast(json.dumps({
                    "type": "state",
                    "depth": self.depth,
                    "movetime": self.movetime,
                    "skill_level": self.skill_level,
                    "elo": self.elo,
                    "observer_active": self.observer_active,
                    "dom_config": self.dom_config,
                    "board_status": self.board_status,
                    "moves_history": self.moves_history
                }))

                # Clear old best move on all dashboards instantly with new active color
                await self.broadcast(json.dumps({
                    "type": "clear_best_move",
                    "active_color": active_color,
                    "user_color": self.user_color
                }))

                # Send toggle command to userscript to sync its activeTurn state
                await self.broadcast(json.dumps({
                    "type": "toggle_turn",
                    "active_color": active_color
                }))

                # Trigger new engine search on updated FEN
                await self.engine.search(self.current_board.fen(), self.depth, self.movetime, active_color, self.user_color)

            elif msg_type == "fen":
                if not self.observer_active:
                    return
                
                fen = data.get("fen")
                user_color = data.get("user_color", "w")
                self.user_color = user_color

                if fen:
                    try:
                        incoming_board = chess.Board(fen)
                        incoming_board_fen = incoming_board.board_fen()

                        # Skip duplicate states to prevent redundant calculations
                        simplified_incoming = f"{incoming_board_fen} {'w' if incoming_board.turn else 'b'}"
                        simplified_current = f"{self.current_board.board_fen()} {'w' if self.current_board.turn else 'b'}"
                        if simplified_incoming == simplified_current:
                            return
                        
                        # 1. Reset history if starting position is detected
                        if incoming_board_fen == chess.Board().board_fen():
                            self.current_board = chess.Board()
                            self.moves_history = []
                            self.last_fen = self.current_board.fen()
                            
                            await self.broadcast(json.dumps({
                                "type": "move_history",
                                "moves": self.moves_history
                            }))

                            # Clear best move and run search
                            active_color = "w"
                            await self.broadcast(json.dumps({
                                "type": "clear_best_move",
                                "active_color": active_color,
                                "user_color": self.user_color
                            }))
                            await self.engine.search(self.current_board.fen(), self.depth, self.movetime, active_color, self.user_color)
                            return

                        # 2. Check if this is a legal move from self.current_board
                        move_found = False
                        for move in self.current_board.legal_moves:
                            temp_board = self.current_board.copy()
                            temp_board.push(move)
                            if temp_board.board_fen() == incoming_board_fen:
                                # Found the move! Push it onto current_board
                                move_san = self.current_board.san(move)
                                self.current_board.push(move)
                                self.moves_history.append(move_san)
                                move_found = True
                                logger.info(f"Legal move detected on server: {move_san}. New active color: {'w' if self.current_board.turn else 'b'}")
                                break
                        
                        if move_found:
                            # Broadcast move history
                            await self.broadcast(json.dumps({
                                "type": "move_history",
                                "moves": self.moves_history
                            }))
                        else:
                            # 3. Game started from middle or desynchronized layout. Re-initialize board.
                            logger.info("Board discrepancy detected or game started from middle. Syncing board placement and turn.")
                            self.current_board = incoming_board
                            # Preserve historical move list or reset it depending on context
                            # For starting from middle, we can keep the history or leave it as is
                        
                        self.last_fen = self.current_board.fen()
                        active_color = "w" if self.current_board.turn else "b"

                        # Clear old best move on all dashboards instantly
                        await self.broadcast(json.dumps({
                            "type": "clear_best_move",
                            "active_color": active_color,
                            "user_color": self.user_color
                        }))
                        
                        # Trigger async search
                        await self.engine.search(self.current_board.fen(), self.depth, self.movetime, active_color, self.user_color)
                        
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
