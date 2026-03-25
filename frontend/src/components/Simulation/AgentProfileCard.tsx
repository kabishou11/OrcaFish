import React from 'react';

interface Agent {
  id: string;
  name: string;
  belief: number;
  influence: number;
  position: string;
  behaviors: Array<{ round: number; action: string; impact: number }>;
  relations: Array<{ target: string; strength: number }>;
}

interface AgentProfileCardProps {
  agent: Agent;
  onEdit?: (agent: Agent) => void;
}

export const AgentProfileCard: React.FC<AgentProfileCardProps> = ({ agent, onEdit }) => {
  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      <div className="flex justify-between items-start">
        <h3 className="text-lg font-bold text-white">{agent.name}</h3>
        {onEdit && (
          <button onClick={() => onEdit(agent)} className="text-blue-400 hover:text-blue-300 text-sm">
            编辑
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-700 p-2 rounded">
          <div className="text-xs text-gray-400">信念</div>
          <div className="text-white font-semibold">{agent.belief.toFixed(2)}</div>
        </div>
        <div className="bg-gray-700 p-2 rounded">
          <div className="text-xs text-gray-400">影响力</div>
          <div className="text-white font-semibold">{agent.influence.toFixed(2)}</div>
        </div>
        <div className="bg-gray-700 p-2 rounded">
          <div className="text-xs text-gray-400">立场</div>
          <div className="text-white font-semibold text-xs">{agent.position}</div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-white mb-2">行为历史</h4>
        <div className="space-y-2 max-h-32 overflow-y-auto">
          {agent.behaviors.map((behavior, idx) => (
            <div key={idx} className="bg-gray-700 p-2 rounded text-xs">
              <div className="flex justify-between text-gray-300">
                <span>轮次 {behavior.round}</span>
                <span className={behavior.impact > 0 ? 'text-green-400' : 'text-red-400'}>
                  {behavior.impact > 0 ? '+' : ''}{behavior.impact.toFixed(2)}
                </span>
              </div>
              <div className="text-white mt-1">{behavior.action}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-white mb-2">关系网络</h4>
        <div className="space-y-1">
          {agent.relations.map((rel, idx) => (
            <div key={idx} className="flex justify-between items-center text-xs">
              <span className="text-gray-300">{rel.target}</span>
              <div className="flex-1 mx-2 bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-blue-500 h-1.5 rounded-full"
                  style={{ width: `${Math.abs(rel.strength) * 100}%` }}
                />
              </div>
              <span className="text-white">{rel.strength.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
