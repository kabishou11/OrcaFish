import React, { useState } from 'react';
import {
  GraphCanvas,
  SimulationControl,
  AgentProfileCard,
  SimulationTimeline,
  PredictionPanel
} from '../components/Simulation';

interface Node {
  id: string;
  label: string;
  type: 'Person' | 'Organization' | 'Event' | 'Location';
}

interface Link {
  source: string;
  target: string;
  label: string;
  type: string;
}

export const SimulationPage: React.FC = () => {
  const [nodes] = useState<Node[]>([]);
  const [links] = useState<Link[]>([]);
  const [simulationId, setSimulationId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'paused' | 'completed'>('idle');
  const [currentRound, setCurrentRound] = useState(0);
  const [totalRounds, setTotalRounds] = useState(0);
  const [agents, setAgents] = useState<any[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  const [events] = useState<any[]>([]);
  const [predictionData] = useState<any>({ trends: [], convergence: { score: 0, status: '' }, risks: [] });
  const [isPlaying, setIsPlaying] = useState(false);

  const API_BASE = 'http://localhost:8000/api';

  const handleStart = async (config: any) => {
    try {
      const createRes = await fetch(`${API_BASE}/simulation/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const { simulation_id } = await createRes.json();
      setSimulationId(simulation_id);
      setTotalRounds(config.rounds);

      await fetch(`${API_BASE}/simulation/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulation_id })
      });

      await fetch(`${API_BASE}/simulation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulation_id })
      });

      setStatus('running');
      pollStatus(simulation_id);
    } catch (error) {
      console.error('Failed to start simulation:', error);
    }
  };

  const pollStatus = async (id: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/simulation/${id}/status`);
        const data = await res.json();
        setCurrentRound(data.current_round);
        setAgents(data.agents || []);
        if (data.status === 'completed') {
          setStatus('completed');
          clearInterval(interval);
        }
      } catch (error) {
        clearInterval(interval);
      }
    }, 1000);
  };

  const handlePause = () => setStatus('paused');
  const handleStop = () => {
    setStatus('idle');
    setCurrentRound(0);
  };

  const handleExport = async () => {
    if (!simulationId) return;
    try {
      const res = await fetch(`${API_BASE}/report/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulation_id: simulationId })
      });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simulation_report_${simulationId}.pdf`;
      a.click();
    } catch (error) {
      console.error('Failed to export report:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <h1 className="text-3xl font-bold text-white mb-6">知识图谱仿真系统</h1>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 bg-gray-800 rounded-lg p-4" style={{ height: '600px' }}>
          <GraphCanvas
            nodes={nodes}
            links={links}
            onNodeClick={(node) => {
              const agent = agents.find(a => a.id === node.id);
              if (agent) setSelectedAgent(agent);
            }}
          />
        </div>

        <div className="col-span-4 space-y-4">
          <SimulationControl
            onStart={handleStart}
            onPause={handlePause}
            onStop={handleStop}
            status={status}
            currentRound={currentRound}
            totalRounds={totalRounds}
            agents={agents}
          />

          {selectedAgent && (
            <AgentProfileCard agent={selectedAgent} />
          )}
        </div>

        <div className="col-span-6">
          <SimulationTimeline
            totalRounds={totalRounds}
            currentRound={currentRound}
            events={events}
            onRoundChange={setCurrentRound}
            onPlayPause={() => setIsPlaying(!isPlaying)}
            isPlaying={isPlaying}
          />
        </div>

        <div className="col-span-6">
          <PredictionPanel data={predictionData} onExport={handleExport} />
        </div>
      </div>
    </div>
  );
};
