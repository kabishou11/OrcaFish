import React, { useState } from 'react';
import { Play, Pause, Square } from 'lucide-react';

interface SimulationConfig {
  name: string;
  rounds: number;
  agentCount: number;
  scenario: string;
}

interface SimulationControlProps {
  onStart: (config: SimulationConfig) => void;
  onPause: () => void;
  onStop: () => void;
  status: 'idle' | 'running' | 'paused' | 'completed';
  currentRound: number;
  totalRounds: number;
  agents: Array<{ id: string; name: string; status: string }>;
}

export const SimulationControl: React.FC<SimulationControlProps> = ({
  onStart, onPause, onStop, status, currentRound, totalRounds, agents
}) => {
  const [config, setConfig] = useState<SimulationConfig>({
    name: '',
    rounds: 10,
    agentCount: 5,
    scenario: ''
  });

  const progress = totalRounds > 0 ? (currentRound / totalRounds) * 100 : 0;

  return (
    <div className="bg-gray-800 rounded-lg p-6 space-y-4">
      <h3 className="text-xl font-bold text-white">仿真控制</h3>

      {status === 'idle' && (
        <div className="space-y-3">
          <input
            type="text"
            placeholder="仿真名称"
            value={config.name}
            onChange={(e) => setConfig({ ...config, name: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 text-white rounded"
          />
          <input
            type="number"
            placeholder="轮次"
            value={config.rounds}
            onChange={(e) => setConfig({ ...config, rounds: parseInt(e.target.value) })}
            className="w-full px-3 py-2 bg-gray-700 text-white rounded"
          />
          <input
            type="number"
            placeholder="Agent 数量"
            value={config.agentCount}
            onChange={(e) => setConfig({ ...config, agentCount: parseInt(e.target.value) })}
            className="w-full px-3 py-2 bg-gray-700 text-white rounded"
          />
          <textarea
            placeholder="场景描述"
            value={config.scenario}
            onChange={(e) => setConfig({ ...config, scenario: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 text-white rounded h-24"
          />
          <button
            onClick={() => onStart(config)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded flex items-center justify-center gap-2"
          >
            <Play size={20} /> 启动仿真
          </button>
        </div>
      )}

      {(status === 'running' || status === 'paused') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-white">
            <span>进度: {currentRound} / {totalRounds}</span>
            <span>{progress.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex gap-2">
            <button
              onClick={status === 'running' ? onPause : () => onStart(config)}
              className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white py-2 rounded flex items-center justify-center gap-2"
            >
              {status === 'running' ? <><Pause size={20} /> 暂停</> : <><Play size={20} /> 继续</>}
            </button>
            <button
              onClick={onStop}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded flex items-center justify-center gap-2"
            >
              <Square size={20} /> 停止
            </button>
          </div>
        </div>
      )}

      {agents.length > 0 && (
        <div className="mt-4">
          <h4 className="text-white font-semibold mb-2">Agent 列表</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {agents.map(agent => (
              <div key={agent.id} className="bg-gray-700 p-2 rounded flex justify-between items-center">
                <span className="text-white text-sm">{agent.name}</span>
                <span className="text-xs text-gray-400">{agent.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
