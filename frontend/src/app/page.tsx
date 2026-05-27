"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Play, Pause, Activity, Monitor } from "lucide-react";

export default function Dashboard() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [bestMove, setBestMove] = useState<string | null>(null);
  
  // Settings State
  const [depth, setDepth] = useState(15);
  const [observerActive, setObserverActive] = useState(true);
  const [domConfig, setDomConfig] = useState({
    boardSelector: "chess-board",
    pieceSelector: ".piece",
    colorPieceRegex: "\\b([wb])([pnbrqk])\\b",
    squareRegex: "square-(\\d)(\\d)"
  });

  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const connect = () => {
      const socket = new WebSocket("ws://localhost:8000/ws");

      socket.onopen = () => setIsConnected(true);
      
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "state") {
          setDepth(data.depth);
          setObserverActive(data.observer_active);
          setDomConfig(data.dom_config);
        } else if (data.type === "best_move") {
          setBestMove(data.move);
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        setTimeout(connect, 3000); // Reconnect logic
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

  const handleDepthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDepth = parseInt(e.target.value);
    setDepth(newDepth);
    sendSettingsUpdate({ depth: newDepth });
  };

  const toggleObserver = () => {
    const newState = !observerActive;
    setObserverActive(newState);
    sendSettingsUpdate({ observer_active: newState });
  };

  const handleDomConfigChange = (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    const newConfig = { ...domConfig, [key]: e.target.value };
    setDomConfig(newConfig);
    // Debounce this in a real app, but for local it's fine or we can use onBlur
  };

  const saveDomConfig = () => {
    sendSettingsUpdate({ dom_config: domConfig });
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-indigo-500/30">
      <div className="max-w-6xl mx-auto p-6 lg:p-12">
        {/* Header */}
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl bg-gradient-to-br ${isConnected ? 'from-emerald-500/20 to-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'from-rose-500/20 to-rose-500/10 text-rose-400 border-rose-500/20'} border`}>
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
                Nexus Engine
              </h1>
              <p className="text-sm text-neutral-500 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                {isConnected ? 'Engine Connected' : 'Waiting for connection...'}
              </p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Main Move Display */}
          <div className="lg:col-span-7 space-y-8">
            <div className="relative group rounded-3xl bg-white/[0.02] border border-white/10 p-8 overflow-hidden backdrop-blur-xl">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              
              <h2 className="text-sm font-medium text-neutral-400 tracking-widest uppercase mb-8">
                Optimal Sequence
              </h2>
              
              <div className="flex items-center justify-center min-h-[300px]">
                <AnimatePresence mode="wait">
                  {bestMove ? (
                    <motion.div
                      key={bestMove}
                      initial={{ opacity: 0, y: 20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -20, scale: 1.05 }}
                      transition={{ duration: 0.4, type: "spring", bounce: 0.4 }}
                      className="text-8xl md:text-9xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white via-white to-white/20 drop-shadow-2xl"
                    >
                      {bestMove}
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center gap-4 text-neutral-600"
                    >
                      <Monitor className="w-16 h-16 opacity-20" />
                      <p className="text-lg font-medium">Awaiting Position Data</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Settings Panel */}
          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-3xl bg-white/[0.02] border border-white/10 p-6 backdrop-blur-xl">
              <div className="flex items-center gap-3 mb-6">
                <Settings className="w-5 h-5 text-indigo-400" />
                <h3 className="text-lg font-semibold text-white/90">Engine Parameters</h3>
              </div>

              {/* Depth Slider */}
              <div className="space-y-4 mb-8">
                <div className="flex justify-between items-end">
                  <label className="text-sm font-medium text-neutral-400">Calculation Depth</label>
                  <span className="text-2xl font-bold text-indigo-400">{depth}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={depth}
                  onChange={handleDepthChange}
                  className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>

              {/* Observer Toggle */}
              <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/5">
                <div>
                  <p className="font-medium text-white/90">Userscript Observer</p>
                  <p className="text-sm text-neutral-500">Live board monitoring</p>
                </div>
                <button
                  onClick={toggleObserver}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors duration-300 focus:outline-none ${
                    observerActive ? 'bg-indigo-500' : 'bg-neutral-700'
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform duration-300 ${
                      observerActive ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* DOM Configuration */}
            <div className="rounded-3xl bg-white/[0.02] border border-white/10 p-6 backdrop-blur-xl">
              <h3 className="text-lg font-semibold text-white/90 mb-6">DOM Extraction Settings</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1.5 uppercase tracking-wider">Board Selector</label>
                  <input
                    type="text"
                    value={domConfig.boardSelector}
                    onChange={(e) => handleDomConfigChange(e, "boardSelector")}
                    className="w-full bg-neutral-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white/90 focus:outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1.5 uppercase tracking-wider">Piece Selector</label>
                  <input
                    type="text"
                    value={domConfig.pieceSelector}
                    onChange={(e) => handleDomConfigChange(e, "pieceSelector")}
                    className="w-full bg-neutral-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white/90 focus:outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1.5 uppercase tracking-wider">Color & Piece Regex</label>
                  <input
                    type="text"
                    value={domConfig.colorPieceRegex}
                    onChange={(e) => handleDomConfigChange(e, "colorPieceRegex")}
                    className="w-full bg-neutral-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono text-indigo-300 focus:outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1.5 uppercase tracking-wider">Square Regex</label>
                  <input
                    type="text"
                    value={domConfig.squareRegex}
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
