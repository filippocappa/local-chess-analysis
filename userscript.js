// ==UserScript==
// @name         Local Chess Analysis Tool (Nexus Engine)
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  Passively observes the chess board, tracks turn via memory, and pipes data to the local WebSocket
// @match        *://chess.com/*
// @match        *://*.chess.com/*
// @match        *://lichess.org/*
// @match        *://*.lichess.org/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Inject Custom Overlay CSS for highlighting best moves
    function injectStyles() {
        const style = document.createElement('style');
        style.innerHTML = `
            .nexus-highlight {
                background-color: rgba(99, 102, 241, 0.15) !important;
                border: 2px dashed rgba(99, 102, 241, 0.85) !important;
                border-radius: 4px !important;
                box-shadow: 0 0 10px rgba(99, 102, 241, 0.4) !important;
                pointer-events: none !important;
                position: absolute !important;
                width: 12.5% !important;
                height: 12.5% !important;
                z-index: 3 !important;
            }
            .nexus-highlight-to {
                border-style: solid !important;
                background-color: rgba(16, 185, 129, 0.15) !important;
                border-color: rgba(16, 185, 129, 0.85) !important;
                box-shadow: 0 0 10px rgba(16, 185, 129, 0.4) !important;
            }
        `;
        if (document.head) {
            document.head.appendChild(style);
        } else {
            document.documentElement.appendChild(style);
        }
    }
    injectStyles();

    // --- Remote Console Logic ---
    let ws = null;
    const originalLog = console.log;
    const originalError = console.error;

    function remoteLog(level, ...args) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
                ws.send(JSON.stringify({ type: "log", level: level, message: message }));
            } catch (e) { }
        }
        if (level === 'error') {
            originalError.apply(console, args);
        } else {
            originalLog.apply(console, args);
        }
    }

    // Intercept ALL logs to show in dashboard for debugging
    console.log = (...args) => {
        remoteLog('info', ...args);
    };

    console.error = (...args) => {
        remoteLog('error', ...args);
    };

    console.log("[ChessTool] Script injected. V4 initialized with Board Overlay support.");

    // --- State ---
    let domConfig = {
        boardSelector: "wc-chess-board",
        pieceSelector: ".piece",
        colorPieceRegex: "\\b([wb])([pnbrqk])\\b",
        squareRegex: "square-(\\d)(\\d)"
    };
    
    let observer = null;
    let observerActive = true;
    let lastFen = "";
    let userColor = 'w';
    let activeTurn = 'w'; // Always assume White starts
    let previousBoard = null;
    let currentObservedBoard = null;

    // Highlight overlay element tracking
    let highlightFromEl = null;
    let highlightToEl = null;

    // --- Core Logic ---
    function setBoardStatus(status) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "board_status", status: status }));
        }
    }

    function connect() {
        console.log("[ChessTool] Connecting to WebSocket (ws://localhost:8000/ws)...");
        ws = new WebSocket("ws://localhost:8000/ws");

        ws.onopen = () => {
            console.log("[ChessTool] WebSocket connected successfully!");
            setBoardStatus("searching"); // Initialize as searching until we find it
            setupObserver();
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "state") {
                    console.log("[ChessTool] Received configuration update from dashboard.");
                    domConfig = data.dom_config;
                    observerActive = data.observer_active;
                    if (observerActive) {
                        setupObserver();
                        processBoard();
                    } else {
                        if (observer) {
                            observer.disconnect();
                            observer = null;
                            console.log("[ChessTool] Observer disconnected (Paused by dashboard).");
                            setBoardStatus("paused");
                        }
                    }
                } else if (data.type === "toggle_turn") {
                    console.log("[ChessTool] Toggle turn requested by dashboard.");
                    activeTurn = activeTurn === 'w' ? 'b' : 'w';
                    processBoard();
                } else if (data.type === "best_move") {
                    console.log(`[ChessTool] Received best move from engine: ${data.move}`);
                    applyHighlights(data.move);
                }
            } catch (err) {
                console.error("[ChessTool] JSON Parse error from WS message", err);
            }
        };

        ws.onclose = () => {
            console.log("[ChessTool] WebSocket disconnected. Reconnecting in 3s...");
            setTimeout(connect, 3000);
        };
        
        ws.onerror = (err) => {
            console.error("[ChessTool] WebSocket error occurred.");
            ws.close();
        };
    }

    function setupObserver() {
        if (observer) {
            observer.disconnect();
        }

        const boardElement = document.querySelector(domConfig.boardSelector);
        if (!boardElement) {
            console.log("[ChessTool] Board not found yet. Retrying in 2s...");
            setBoardStatus("searching");
            setTimeout(setupObserver, 2000);
            return;
        }

        console.log("[ChessTool] Board found! Setting up MutationObserver.");
        setBoardStatus("connected");
        currentObservedBoard = boardElement;

        observer = new MutationObserver((mutations) => {
            if (!observerActive) return;
            clearTimeout(window.fenTimeout);
            window.fenTimeout = setTimeout(() => {
                processBoard();
            }, 100);
        });

        observer.observe(boardElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    // Compare boards to infer whose turn it is
    function detectTurn(oldBoard, newBoard) {
        if (!oldBoard) return activeTurn; // Fallback to current memory instead of hardcoding White

        // Find which piece color changed position
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const oldPiece = oldBoard[r][f];
                const newPiece = newBoard[r][f];

                if (oldPiece && !newPiece) {
                    // A piece moved FROM here. The color of this piece is the one who just played.
                    // If a white piece moved, it is now Black's turn.
                    const isWhite = oldPiece === oldPiece.toUpperCase();
                    return isWhite ? 'b' : 'w';
                }
            }
        }
        return activeTurn; // Fallback
    }

    function algebraicToSquare(alg) {
        if (!alg || alg.length < 2) return null;
        const fileChar = alg.charAt(0);
        const rankChar = alg.charAt(1);
        const file = fileChar.charCodeAt(0) - 97 + 1; // 'a' code is 97
        const rank = parseInt(rankChar, 10);
        return `${file}${rank}`;
    }

    function applyHighlights(bestMove) {
        // Remove existing highlights
        if (highlightFromEl) {
            highlightFromEl.remove();
            highlightFromEl = null;
        }
        if (highlightToEl) {
            highlightToEl.remove();
            highlightToEl = null;
        }

        if (!bestMove || bestMove.length < 4) return;

        const boardElement = document.querySelector(domConfig.boardSelector);
        if (!boardElement) return;

        const fromSq = algebraicToSquare(bestMove.substring(0, 2));
        const toSq = algebraicToSquare(bestMove.substring(2, 4));

        if (!fromSq || !toSq) return;

        // Create overlay divs
        highlightFromEl = document.createElement("div");
        highlightFromEl.className = `highlight nexus-highlight nexus-highlight-from square-${fromSq}`;

        highlightToEl = document.createElement("div");
        highlightToEl.className = `highlight nexus-highlight nexus-highlight-to square-${toSq}`;

        boardElement.appendChild(highlightFromEl);
        boardElement.appendChild(highlightToEl);
    }

    function processBoard() {
        if (!observerActive || !ws || ws.readyState !== WebSocket.OPEN) return;

        const boardElement = document.querySelector(domConfig.boardSelector);
        if (!boardElement) {
            setBoardStatus("searching");
            return;
        }
        
        // Clear previous overlays immediately as the board is updated
        applyHighlights(null);

        // Make sure we inform dashboard we are connected
        setBoardStatus("connected");

        const pieces = boardElement.querySelectorAll(domConfig.pieceSelector);
        if (pieces.length === 0) return;
        
        const board = Array(8).fill(null).map(() => Array(8).fill(null));

        const cpRegex = new RegExp(domConfig.colorPieceRegex);
        const sqRegex = new RegExp(domConfig.squareRegex);

        if (boardElement.classList.contains("flipped")) {
            userColor = 'b';
        } else {
            userColor = 'w';
        }

        pieces.forEach(piece => {
            const className = piece.className || "";
            const cpMatch = className.match(cpRegex);
            const sqMatch = className.match(sqRegex);

            if (cpMatch && sqMatch) {
                const color = cpMatch[1]; 
                const type = cpMatch[2]; 
                
                const file = parseInt(sqMatch[1], 10);
                const rank = parseInt(sqMatch[2], 10);
                
                const f = file - 1;
                const r = rank - 1;
                
                if (f >= 0 && f < 8 && r >= 0 && r < 8) {
                    board[7 - r][f] = color === 'w' ? type.toUpperCase() : type.toLowerCase();
                }
            }
        });

        // Detect turn before updating previousBoard
        activeTurn = detectTurn(previousBoard, board);
        previousBoard = board;

        let fen = "";
        for (let r = 0; r < 8; r++) {
            let emptyCount = 0;
            for (let f = 0; f < 8; f++) {
                if (board[r][f] === null) {
                    emptyCount++;
                } else {
                    if (emptyCount > 0) {
                        fen += emptyCount;
                        emptyCount = 0;
                    }
                    fen += board[r][f];
                }
            }
            if (emptyCount > 0) {
                fen += emptyCount;
            }
            if (r < 7) fen += "/";
        }

        // Apply our detected turn!
        fen += ` ${activeTurn} KQkq - 0 1`;

        // Don't send FEN if it's an empty board 8/8/8/8/8/8/8/8
        if (fen !== lastFen && fen.split(" ")[0] !== "8/8/8/8/8/8/8/8") {
            lastFen = fen;
            console.log(`[ChessTool] Detected new board state. Extracted FEN: ${fen}`);
            ws.send(JSON.stringify({ 
                type: "fen", 
                fen: fen,
                user_color: userColor
            }));
        }
    }

    // Periodic check to detect board recreation or rematch actions
    function checkBoardExistence() {
        const boardElement = document.querySelector(domConfig.boardSelector);
        if (boardElement && boardElement !== currentObservedBoard) {
            console.log("[ChessTool] Board node changed/recreated. Re-initializing observer.");
            setupObserver();
            processBoard();
        }
    }
    setInterval(checkBoardExistence, 1000);

    connect();

})();
