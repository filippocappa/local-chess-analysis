"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Activity, Monitor, Terminal, Radio, User, Cpu, RefreshCw } from "lucide-react";

type LogEntry = {
  timestamp: string;
  level: string;
  message: string;
};

export default function Dashboard() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  // App State
  const [bestMove, setBestMove] = useState<string | null>(null);
  const [activeColor, setActiveColor] = useState<string>("w");
  const [userColor, setUserColor] = useState<string>("w");
  const [boardStatus, setBoardStatus] = useState<string>("disconnected");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [engineInfo, setEngineInfo] = useState<string[]>([]);
  const [movesHistory, setMovesHistory] = useState<string[]>([]);
  const [backendLogs, setBackendLogs] = useState<LogEntry[]>([]);
  
  // Settings State
  const [depth, setDepth] = useState(15);
  const [movetime, setMovetime] = useState(0); // 0 = disabled (use depth)
  const [skillLevel, setSkillLevel] = useState(20);
  const [elo, setElo] = useState(0); // 0 = maximum strength
  
  const [observerActive, setObserverActive] = useState(true);
  const [overlayEnabled, setOverlayEnabled] = useState(true);
  const [domConfig, setDomConfig] = useState({
    boardSelector: "wc-chess-board",
    pieceSelector: ".piece",
    colorPieceRegex: "\\b([wb])([pnbrqk])\\b",
    squareRegex: "square-(\\d)(\\d)"
  });

  const logsContainerRef = useRef<HTMLDivElement>(null);
  const infoContainerRef = useRef<HTMLDivElement>(null);
  const backendLogsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = logsContainerRef.current;
    if (container) {
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (isAtBottom || logs.length <= 1) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [logs]);

  useEffect(() => {
    const container = infoContainerRef.current;
    if (container) {
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (isAtBottom || engineInfo.length <= 1) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [engineInfo]);

  useEffect(() => {
    const container = backendLogsContainerRef.current;
    if (container) {
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (isAtBottom || backendLogs.length <= 1) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [backendLogs]);

  useEffect(() => {
    const connect = () => {
      const socket = new WebSocket("ws://localhost:8000/ws");

      socket.onopen = () => setIsConnected(true);
      
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === "state") {
          setDepth(data.depth);
          setMovetime(data.movetime || 0);
          setSkillLevel(data.skill_level !== undefined ? data.skill_level : 20);
          setElo(data.elo || 0);
          setObserverActive(data.observer_active);
          if (data.overlay_enabled !== undefined) setOverlayEnabled(data.overlay_enabled);
          setDomConfig(data.dom_config);
          if (data.board_status) setBoardStatus(data.board_status);
          if (data.moves_history) setMovesHistory(data.moves_history);
        } else if (data.type === "best_move") {
          setBestMove(data.move);
          if (data.active_color) setActiveColor(data.active_color);
          if (data.user_color) setUserColor(data.user_color);
        } else if (data.type === "clear_best_move") {
          setBestMove(null);
          if (data.active_color) setActiveColor(data.active_color);
          if (data.user_color) setUserColor(data.user_color);
          // Clear engine info when we get a final move
          // setEngineInfo([]); 
        } else if (data.type === "move_history") {
          setMovesHistory(data.moves);
        } else if (data.type === "engine_info") {
          setEngineInfo(prev => [...prev, data.info].slice(-20)); // Keep last 20 depth lines
        } else if (data.type === "log") {
          setLogs(prev => [...prev, {
            timestamp: new Date().toLocaleTimeString(),
            level: data.level,
            message: data.message
          }].slice(-50));
        } else if (data.type === "board_status") {
          setBoardStatus(data.status);
        } else if (data.type === "backend_log") {
          setBackendLogs(prev => [...prev, {
            timestamp: new Date().toLocaleTimeString(),
            level: data.level,
            message: data.message
          }].slice(-50));
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        setBoardStatus("disconnected");
        setTimeout(connect, 3000);
      };

      setWs(socket);
      return socket;
    };

    const socket = connect();
    return () => socket.close();
  }, []);

  const sendSettingsUpdate = (updates: any) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "update_settings",
        ...updates
      }));
    }
  };

  const handleSliderChange = (setter: any, key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setter(val);
    sendSettingsUpdate({ [key]: val });
  };

  const toggleObserver = () => {
    const newState = !observerActive;
    setObserverActive(newState);
    sendSettingsUpdate({ observer_active: newState });
  };

  const toggleTurn = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "toggle_turn" }));
    }
  };

  const toggleOverlay = () => {
    const newState = !overlayEnabled;
    setOverlayEnabled(newState);
    sendSettingsUpdate({ overlay_enabled: newState });
  };

  const handleDomConfigChange = (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    const newConfig = { ...domConfig, [key]: e.target.value };
    setDomConfig(newConfig);
  };

  const saveDomConfig = () => {
    sendSettingsUpdate({ dom_config: domConfig });
  };

  // UI Helpers
  const getBoardStatusConfig = () => {
    switch (boardStatus) {
      case "connected": return { color: "text-emerald-400", bg: "bg-emerald-500", text: "Board Detected & Observing" };
      case "searching": return { color: "text-amber-400", bg: "bg-amber-500", text: "Searching for Board..." };
      case "paused": return { color: "text-neutral-400", bg: "bg-neutral-500", text: "Observer Paused" };
      default: return { color: "text-rose-400", bg: "bg-rose-500", text: "Disconnected" };
    }
  };
  const statusConfig = getBoardStatusConfig();

  const isPlayerTurn = userColor === activeColor;
  const moveColorTheme = activeColor === 'w' 
    ? 'bg-gradient-to-r from-white via-neutral-200 to-neutral-400 text-transparent' 
    : 'bg-gradient-to-r from-neutral-200 via-neutral-350 to-neutral-500 text-transparent';

  // Parse engine info to make it readable
  const formatEngineInfo = (info: string) => {
    const depthMatch = info.match(/depth (\d+)/);
    const scoreMatch = info.match(/score (cp|mate) (-?\d+)/);
    const pvMatch = info.match(/pv (.+)/);
    
    let formatted = "";
    if (depthMatch) formatted += `Depth ${depthMatch[1]} `;
    if (scoreMatch) {
      const type = scoreMatch[1];
      const val = parseInt(scoreMatch[2]);
      if (type === 'mate') {
        formatted += `[Mate in ${val}] `;
      } else {
        formatted += `[${(val / 100).toFixed(2)}] `;
      }
    }
    if (pvMatch) {
      // Show first 4 moves of PV
      const moves = pvMatch[1].split(' ').slice(0, 4).join(' ');
      formatted += `Best line: ${moves}...`;
    }
    return formatted || info;
  };

  const getLatestEvaluation = () => {
    for (let i = engineInfo.length - 1; i >= 0; i--) {
      const info = engineInfo[i];
      if (info.includes("score")) {
        const cpMatch = info.match(/score cp (-?\d+)/);
        const mateMatch = info.match(/score mate (-?\d+)/);
        if (cpMatch) {
          const cp = parseInt(cpMatch[1]);
          const absoluteCp = activeColor === 'w' ? cp : -cp;
          const winChanceWhite = Math.round(100 / (1 + Math.exp(-0.00368 * absoluteCp)));
          return {
            winChanceWhite,
            winChanceBlack: 100 - winChanceWhite,
            score: (absoluteCp / 100).toFixed(2),
            isMate: false,
            mateVal: null
          };
        }
        if (mateMatch) {
          const mateVal = parseInt(mateMatch[1]);
          const absoluteMate = activeColor === 'w' ? mateVal : -mateVal;
          const winChanceWhite = absoluteMate > 0 ? 100 : 0;
          return {
            winChanceWhite,
            winChanceBlack: 100 - winChanceWhite,
            score: `M${Math.abs(mateVal)}`,
            isMate: true,
            mateVal: absoluteMate
          };
        }
      }
    }
    return null;
  };
  const evalData = getLatestEvaluation();

  const renderMovePairs = () => {
    const pairs = [];
    for (let i = 0; i < movesHistory.length; i += 2) {
      pairs.push({
        num: Math.floor(i / 2) + 1,
        white: movesHistory[i],
        black: movesHistory[i + 1] || "..."
      });
    }
    
    if (pairs.length === 0) {
      return <div className="text-neutral-600 italic text-xs text-center py-4">No moves recorded yet.</div>;
    }

    return (
      <div className="grid grid-cols-3 gap-y-2 text-sm font-mono max-h-[150px] overflow-y-auto pr-1">
        {pairs.map((pair, index) => (
          <React.Fragment key={index}>
            <span className="text-neutral-600 font-semibold">{pair.num}.</span>
            <span className="text-neutral-200 font-medium">{pair.white}</span>
            <span className="text-neutral-400 font-medium">{pair.black}</span>
          </React.Fragment>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-indigo-500/30">
      <div className="max-w-7xl mx-auto p-4 lg:p-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl bg-gradient-to-br ${isConnected ? 'from-indigo-500/20 to-indigo-500/10 text-indigo-400 border-indigo-500/20' : 'from-rose-500/20 to-rose-500/10 text-rose-400 border-rose-500/20'} border`}>
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
                Nexus Engine
              </h1>
              <p className="text-sm text-neutral-500 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-indigo-500 animate-pulse' : 'bg-rose-500'}`} />
                {isConnected ? 'Backend Link Active' : 'Connecting to Backend...'}
              </p>
            </div>
          </div>

          <div className={`flex items-center gap-2 px-4 py-2 rounded-full border border-white/5 bg-white/[0.02] ${statusConfig.color}`}>
            <Radio className="w-4 h-4" />
            <span className="text-sm font-medium">{statusConfig.text}</span>
            <span className={`w-2 h-2 rounded-full ${statusConfig.bg} ${boardStatus === 'searching' ? 'animate-ping' : ''} ml-1`} />
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Main Visual Area */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            
            {/* Optimal Sequence */}
            <div className="relative group rounded-3xl bg-white/[0.02] border border-white/10 p-8 overflow-hidden backdrop-blur-xl shrink-0">
              <div className={`absolute inset-0 bg-gradient-to-br ${activeColor === 'w' ? 'from-white/5 via-white/2' : 'from-black/10 via-black/5'} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
              
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-sm font-medium text-neutral-400 tracking-widest uppercase flex items-center gap-2">
                  Optimal Sequence
                </h2>
                
                <div className="flex items-center gap-2">
                  {isConnected && (
                    <button
                      onClick={toggleTurn}
                      className="flex items-center gap-1.5 text-xs font-semibold bg-indigo-500/10 hover:bg-indigo-500/25 border border-indigo-500/20 text-indigo-300 px-3 py-1.5 rounded-lg transition-colors focus:outline-none cursor-pointer"
                      title="Manually switch active turn if desynchronized"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Toggle Turn
                    </button>
                  )}
                  
                  {bestMove && (
                    <div className="flex items-center gap-2 text-sm font-medium bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
                      <User className="w-4 h-4 text-neutral-400" />
                      <span className="text-neutral-400">You:</span>
                      <span className={userColor === 'w' ? 'text-white font-bold' : 'text-neutral-300 font-bold'}>
                        {userColor === 'w' ? 'White' : 'Black'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex flex-col items-center justify-center min-h-[200px] relative z-10">
                <AnimatePresence mode="wait">
                  {bestMove ? (
                    <motion.div
                      key={bestMove + activeColor}
                      initial={{ opacity: 0, y: 20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -20, scale: 1.05 }}
                      transition={{ duration: 0.4, type: "spring", bounce: 0.4 }}
                      className="flex flex-col items-center"
                    >
                      <div className={`text-sm font-semibold tracking-widest uppercase mb-4 ${isPlayerTurn ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isPlayerTurn ? 'Your Turn to Play' : "Opponent's Turn"}
                      </div>
                      <div className={`text-8xl md:text-9xl font-black tracking-tighter bg-clip-text ${moveColorTheme} drop-shadow-2xl`}>
                        {bestMove}
                      </div>
                      <div className="mt-4 text-neutral-500 font-medium">
                        {activeColor === 'w' ? 'White' : 'Black'} to move
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center gap-4 text-neutral-600"
                    >
                      <Monitor className="w-16 h-16 opacity-20" />
                      <p className="text-lg font-medium">Awaiting Board Data...</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Win Probability Bar */}
              {evalData && (
                <div className="mt-6 pt-6 border-t border-white/5 w-full flex flex-col items-center">
                  <div className="flex justify-between items-center text-xs font-semibold text-neutral-400 mb-2.5 w-full max-w-md">
                    <span className={userColor === 'w' ? 'text-indigo-400 font-bold' : 'text-neutral-400'}>
                      White: {evalData.winChanceWhite}%
                    </span>
                    <span className="bg-white/5 border border-white/10 px-2.5 py-0.5 rounded-full text-[10px] text-neutral-300 font-mono">
                      Eval: {evalData.score}
                    </span>
                    <span className={userColor === 'b' ? 'text-indigo-400 font-bold' : 'text-neutral-400'}>
                      Black: {evalData.winChanceBlack}%
                    </span>
                  </div>
                  <div className="h-2.5 w-full max-w-md bg-neutral-900 rounded-full overflow-hidden flex border border-white/5 p-0.5">
                    <div 
                      style={{ width: `${evalData.winChanceWhite}%` }} 
                      className="h-full bg-white rounded-l-full transition-all duration-500 ease-out" 
                    />
                    <div 
                      style={{ width: `${evalData.winChanceBlack}%` }} 
                      className="h-full bg-neutral-700 rounded-r-full transition-all duration-500 ease-out" 
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Live Stockfish Analysis */}
            <div className="rounded-3xl bg-[#0a0a0a] border border-white/10 p-6 flex flex-col h-[200px]">
              <div className="flex items-center gap-2 mb-4 text-neutral-400 border-b border-white/5 pb-4">
                <Cpu className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-semibold tracking-wider uppercase">Live Engine Thinking</h3>
              </div>
              <div ref={infoContainerRef} className="flex-1 overflow-y-auto space-y-1.5 font-mono text-xs p-3 rounded-xl bg-black/50 border border-white/5 text-indigo-200/80">
                {engineInfo.length === 0 ? (
                  <div className="text-neutral-600 italic">Engine idle...</div>
                ) : (
                  engineInfo.map((info, i) => (
                    <div key={i} className="break-words">
                      {formatEngineInfo(info)}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Remote Console */}
            <div className="rounded-3xl bg-[#0a0a0a] border border-white/10 p-6 flex flex-col h-[200px]">
              <div className="flex items-center gap-2 mb-4 text-neutral-400 border-b border-white/5 pb-4">
                <Terminal className="w-5 h-5" />
                <h3 className="text-sm font-semibold tracking-wider uppercase">Userscript Logs</h3>
              </div>
              <div ref={logsContainerRef} className="flex-1 overflow-y-auto space-y-1.5 font-mono text-xs p-3 rounded-xl bg-black/50 border border-white/5">
                {logs.length === 0 ? (
                  <div className="text-neutral-600 italic">No logs yet. Waiting for userscript...</div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={`break-words ${log.level === 'error' ? 'text-rose-400' : 'text-emerald-300/80'}`}>
                      <span className="text-neutral-600 mr-2">[{log.timestamp}]</span>
                      {log.message}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Backend System Logs */}
            <div className="rounded-3xl bg-[#0a0a0a] border border-white/10 p-6 flex flex-col h-[200px]">
              <div className="flex items-center gap-2 mb-4 text-neutral-400 border-b border-white/5 pb-4">
                <Terminal className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-semibold tracking-wider uppercase">Backend System Logs</h3>
              </div>
              <div ref={backendLogsContainerRef} className="flex-1 overflow-y-auto space-y-1.5 font-mono text-xs p-3 rounded-xl bg-black/50 border border-white/5">
                {backendLogs.length === 0 ? (
                  <div className="text-neutral-600 italic">No backend logs yet...</div>
                ) : (
                  backendLogs.map((log, i) => (
                    <div key={i} className={`break-words ${log.level === 'error' ? 'text-rose-400' : log.level === 'warning' ? 'text-amber-400' : 'text-indigo-300/80'}`}>
                      <span className="text-neutral-600 mr-2">[{log.timestamp}]</span>
                      {log.message}
                    </div>
                  ))
                )}
              </div>
            </div>
            
          </div>

          {/* Settings Panel */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Move History */}
            <div className="rounded-3xl bg-white/[0.02] border border-white/10 p-6 backdrop-blur-xl">
              <h3 className="text-lg font-semibold text-white/90 mb-4">Move History</h3>
              {renderMovePairs()}
            </div>

            <div className="rounded-3xl bg-white/[0.02] border border-white/10 p-6 backdrop-blur-xl">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Settings className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-lg font-semibold text-white/90">Engine Parameters</h3>
                </div>
                <div className="flex items-center gap-4">
                  {/* Overlay Toggle */}
                  <div className="flex items-center gap-2" title="Toggle Board Overlay">
                    <span className="text-xs text-neutral-500 font-medium">Overlay</span>
                    <button
                      onClick={toggleOverlay}
                      className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors duration-300 focus:outline-none ${
                        overlayEnabled ? 'bg-indigo-500' : 'bg-neutral-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${
                          overlayEnabled ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  
                  {/* Observer Toggle */}
                  <div className="flex items-center gap-2" title="Toggle Live Observer">
                    <span className="text-xs text-neutral-500 font-medium">Observer</span>
                    <button
                      onClick={toggleObserver}
                      className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors duration-300 focus:outline-none ${
                        observerActive ? 'bg-emerald-500' : 'bg-neutral-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${
                          observerActive ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Depth Slider */}
              <div className="space-y-4 mb-6">
                <div className="flex justify-between items-end">
                  <label className="text-sm font-medium text-neutral-400">Calculation Depth</label>
                  <span className="text-lg font-bold text-white">{depth}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="30"
                  value={depth}
                  onChange={handleSliderChange(setDepth, "depth")}
                  className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>

              {/* MoveTime Slider */}
              <div className="space-y-4 mb-6">
                <div className="flex justify-between items-end">
                  <label className="text-sm font-medium text-neutral-400">Move Time Limit (ms)</label>
                  <span className="text-lg font-bold text-white">{movetime === 0 ? 'Disabled' : movetime}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10000"
                  step="100"
                  value={movetime}
                  onChange={handleSliderChange(setMovetime, "movetime")}
                  className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <p className="text-xs text-neutral-600 mt-1">If &gt; 0, overrides calculation depth.</p>
              </div>

              {/* ELO Slider */}
              <div className="space-y-4 mb-6">
                <div className="flex justify-between items-end">
                  <label className="text-sm font-medium text-neutral-400">Target ELO</label>
                  <span className="text-lg font-bold text-white">{elo === 0 ? 'Maximum' : elo}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="3200"
                  step="100"
                  value={elo}
                  onChange={handleSliderChange(setElo, "elo")}
                  className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <p className="text-xs text-neutral-600 mt-1">Set to 0 for unlimited strength.</p>
              </div>

              {/* Skill Level Slider */}
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <label className="text-sm font-medium text-neutral-400">Skill Level</label>
                  <span className="text-lg font-bold text-white">{skillLevel}/20</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="20"
                  value={skillLevel}
                  onChange={handleSliderChange(setSkillLevel, "skill_level")}
                  className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <p className="text-xs text-neutral-600 mt-1">Lower values make more tactical errors.</p>
              </div>
            </div>

            {/* DOM Configuration */}
            <div className="rounded-3xl bg-white/[0.02] border border-white/10 p-6 backdrop-blur-xl">
              <h3 className="text-lg font-semibold text-white/90 mb-2">DOM Extraction Settings</h3>
              
              <div className="text-xs text-neutral-400 leading-relaxed bg-white/[0.01] border border-white/5 rounded-2xl p-4 mb-6 space-y-2">
                <p className="font-semibold text-neutral-300">What are these settings?</p>
                <p>
                  They instruct the Tampermonkey userscript how to scrape the chess board state from the page's HTML, allowing it to adapt dynamically:
                </p>
                <ul className="list-disc pl-4 space-y-1.5 text-neutral-500">
                  <li><strong className="text-neutral-400">Board Selector</strong>: HTML tag or class name of the board container (e.g., <code className="text-indigo-400 font-mono text-[10px]">wc-chess-board</code> for Chess.com, <code className="text-indigo-400 font-mono text-[10px]">cg-board</code> for Lichess).</li>
                  <li><strong className="text-neutral-400">Piece Selector</strong>: The CSS selector targeting active pieces on the board (e.g., <code className="text-indigo-400 font-mono text-[10px]">.piece</code>).</li>
                  <li><strong className="text-neutral-400">Color & Piece Regex</strong>: Pattern to extract piece color (<code className="text-indigo-400 font-mono text-[10px]">w/b</code>) and type (<code className="text-indigo-400 font-mono text-[10px]">p, r, n, b, q, k</code>) from its class names.</li>
                  <li><strong className="text-neutral-400">Square Regex</strong>: Pattern to extract coordinates (e.g., <code className="text-indigo-400 font-mono text-[10px]">square-52</code> for column 5, row 2) to construct the game state.</li>
                </ul>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1.5 uppercase tracking-wider">Board Selector</label>
                  <input
                    type="text"
                    value={domConfig.boardSelector || ""}
                    onChange={(e) => handleDomConfigChange(e, "boardSelector")}
                    className="w-full bg-neutral-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white/90 focus:outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1.5 uppercase tracking-wider">Piece Selector</label>
                  <input
                    type="text"
                    value={domConfig.pieceSelector || ""}
                    onChange={(e) => handleDomConfigChange(e, "pieceSelector")}
                    className="w-full bg-neutral-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white/90 focus:outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1.5 uppercase tracking-wider">Color & Piece Regex</label>
                  <input
                    type="text"
                    value={domConfig.colorPieceRegex || ""}
                    onChange={(e) => handleDomConfigChange(e, "colorPieceRegex")}
                    className="w-full bg-neutral-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono text-indigo-300 focus:outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1.5 uppercase tracking-wider">Square Regex</label>
                  <input
                    type="text"
                    value={domConfig.squareRegex || ""}
                    onChange={(e) => handleDomConfigChange(e, "squareRegex")}
                    className="w-full bg-neutral-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono text-indigo-300 focus:outline-none focus:border-indigo-500/50 transition-colors mb-4"
                  />
                </div>
                
                <button
                  onClick={saveDomConfig}
                  className="w-full py-3 px-4 bg-white/10 hover:bg-white/15 text-white font-medium rounded-xl transition-colors focus:outline-none"
                >
                  Apply Configuration
                </button>
              </div>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  );
}
