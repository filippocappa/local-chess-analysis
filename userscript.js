// ==UserScript==
// @name         Local Chess Analysis Tool
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Passively observes the chess board and sends FEN to local WebSocket
// @match        *://*.chess.com/*
// @match        *://lichess.org/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    console.log("[ChessTool] Script injected.");

    let ws = null;
    let domConfig = {
        boardSelector: "chess-board",
        pieceSelector: ".piece",
        // Example for chess.com: piece classes are like "piece wp square-52"
        // colorPieceRegex: match[1] = color (w/b), match[2] = piece (p, n, b, r, q, k)
        colorPieceRegex: "\\b([wb])([pnbrqk])\\b",
        // squareRegex: match[1] = file (1-8), match[2] = rank (1-8)
        squareRegex: "square-(\\d)(\\d)"
    };
    
    let observer = null;
    let observerActive = true;
    let lastFen = "";

    function connect() {
        console.log("[ChessTool] Connecting to WebSocket...");
        ws = new WebSocket("ws://localhost:8000/ws");

        ws.onopen = () => {
            console.log("[ChessTool] WebSocket connected!");
            setupObserver();
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "state") {
                    console.log("[ChessTool] Received state update:", data);
                    domConfig = data.dom_config;
                    observerActive = data.observer_active;
                    if (observerActive) {
                        setupObserver();
                        processBoard(); // Trigger immediately
                    } else {
                        if (observer) {
                            observer.disconnect();
                            observer = null;
                            console.log("[ChessTool] Observer disconnected.");
                        }
                    }
                }
            } catch (err) {
                console.error("[ChessTool] JSON Parse error", err);
            }
        };

        ws.onclose = () => {
            console.log("[ChessTool] WebSocket disconnected. Reconnecting in 3s...");
            setTimeout(connect, 3000);
        };
        
        ws.onerror = (err) => {
            console.error("[ChessTool] WebSocket error:", err);
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
            setTimeout(setupObserver, 2000);
            return;
        }

        console.log("[ChessTool] Board found! Setting up MutationObserver.");
        observer = new MutationObserver((mutations) => {
            if (!observerActive) return;
            // Debounce to avoid sending too many FENs during a single move animation
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
        if (!boardElement) return;

        const pieces = boardElement.querySelectorAll(domConfig.pieceSelector);
        
        // Initialize empty 8x8 board
        const board = Array(8).fill(null).map(() => Array(8).fill(null));

        const cpRegex = new RegExp(domConfig.colorPieceRegex);
        const sqRegex = new RegExp(domConfig.squareRegex);

        pieces.forEach(piece => {
            const className = piece.className || "";
            const cpMatch = className.match(cpRegex);
            const sqMatch = className.match(sqRegex);

            if (cpMatch && sqMatch) {
                const color = cpMatch[1]; // 'w' or 'b'
                const type = cpMatch[2]; // 'p', 'n', 'b', 'r', 'q', 'k'
                
                // Assuming square format where file is 1-8 (a-h) and rank is 1-8
                // Some boards use 0-7, some use 1-8. We'll assume chess.com format: file(1-8)rank(1-8) where 'square-11' is a1
                const file = parseInt(sqMatch[1], 10);
                const rank = parseInt(sqMatch[2], 10);
                
                // Convert to 0-indexed (0,0 is a1, top-left in standard representation is a8)
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

        // Add basic FEN suffixes. Inferring the active turn perfectly purely from the static board is hard
        // without a history of moves, but we'll add 'w KQkq - 0 1' as a dummy to make it a valid FEN string 
        // for Stockfish to process. For a perfect tool, we'd infer turn from move indicators.
        // For now, let's assume it's white's turn, or infer from board orientation.
        fen += " w KQkq - 0 1";

        if (fen !== lastFen && fen.split(" ")[0] !== "8/8/8/8/8/8/8/8") {
            lastFen = fen;
            console.log("[ChessTool] Sending FEN:", fen);
            ws.send(JSON.stringify({ type: "fen", fen: fen }));
        }
    }

    // Start
    connect();

})();
