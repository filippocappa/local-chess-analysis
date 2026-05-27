// ==UserScript==
// @name         Local Chess Analysis Tool (Nexus Engine)
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Passively observes the chess board, detects turn/color, and pipes data to the local WebSocket
// @match        *://*.chess.com/*
// @match        *://lichess.org/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- Remote Console Logic ---
    let ws = null;
    const originalLog = console.log;
    const originalError = console.error;

    function remoteLog(level, ...args) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
                ws.send(JSON.stringify({ type: "log", level: level, message: message }));
            } catch (e) {
                // Ignore circular json errors
            }
        }
        if (level === 'error') {
            originalError.apply(console, args);
        } else {
            originalLog.apply(console, args);
        }
    }

    console.log = (...args) => {
        if (args[0] && typeof args[0] === 'string' && args[0].startsWith("[ChessTool]")) {
            remoteLog('info', ...args);
        } else {
            originalLog.apply(console, args);
        }
    };

    console.error = (...args) => {
        if (args[0] && typeof args[0] === 'string' && args[0].startsWith("[ChessTool]")) {
            remoteLog('error', ...args);
        } else {
            originalError.apply(console, args);
        }
    };

    console.log("[ChessTool] Script injected. V2 initialized.");

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
    let userColor = 'w'; // Default

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
                }
            } catch (err) {
                console.error("[ChessTool] JSON Parse error from WS message", err);
            }
        };

        ws.onclose = () => {
            console.log("[ChessTool] WebSocket disconnected. Reconnecting in 3s...");
            setBoardStatus("disconnected");
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

    function processBoard() {
        if (!observerActive || !ws || ws.readyState !== WebSocket.OPEN) return;

        const boardElement = document.querySelector(domConfig.boardSelector);
        if (!boardElement) {
            setBoardStatus("searching");
            return;
        }

        const pieces = boardElement.querySelectorAll(domConfig.pieceSelector);
        if (pieces.length === 0) return;
        
        const board = Array(8).fill(null).map(() => Array(8).fill(null));

        const cpRegex = new RegExp(domConfig.colorPieceRegex);
        const sqRegex = new RegExp(domConfig.squareRegex);

        let whitePiecesCount = 0;
        let blackPiecesCount = 0;

        // Determine orientation by checking if board has a flipped class (chess.com specific fallback)
        // A better way is to see if piece coordinates indicate orientation, but let's pass a generic FEN
        // and let the backend/dashboard handle turn logic if needed.
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
                
                if (color === 'w') whitePiecesCount++;
                if (color === 'b') blackPiecesCount++;

                const file = parseInt(sqMatch[1], 10);
                const rank = parseInt(sqMatch[2], 10);
                
                const f = file - 1;
                const r = rank - 1;
                
                if (f >= 0 && f < 8 && r >= 0 && r < 8) {
                    board[7 - r][f] = color === 'w' ? type.toUpperCase() : type.toLowerCase();
                }
            }
        });

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

        // Extremely basic turn inference based on pieces missing (not perfect, but a start).
        // Standard FEN requires turn. Since we don't have move history in this pure DOM reader,
        // we append the default string and let the backend figure out the rest.
        fen += " w KQkq - 0 1";

        if (fen !== lastFen && fen.split(" ")[0] !== "8/8/8/8/8/8/8/8") {
            lastFen = fen;
            console.log(`[ChessTool] Detected new board state (${whitePiecesCount}W vs ${blackPiecesCount}B).`);
            ws.send(JSON.stringify({ 
                type: "fen", 
                fen: fen,
                user_color: userColor
            }));
        }
    }

    connect();

})();
