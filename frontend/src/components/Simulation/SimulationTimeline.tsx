import React, { useState } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';

interface TimelineEvent {
  round: number;
  type: 'critical' | 'normal';
  description: string;
}

interface SimulationTimelineProps {
  totalRounds: number;
  currentRound: number;
  events: TimelineEvent[];
  onRoundChange: (round: number) => void;
  onPlayPause: () => void;
  isPlaying: boolean;
}

export const SimulationTimeline: React.FC<SimulationTimelineProps> = ({
  totalRounds, currentRound, events, onRoundChange, onPlayPause, isPlaying
}) => {
  const [selectedRound, setSelectedRound] = useState(currentRound);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const round = parseInt(e.target.value);
    setSelectedRound(round);
    onRoundChange(round);
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      <h3 className="text-lg font-bold text-white">仿真时间轴</h3>

      <div className="flex items-center gap-3">
        <button
          onClick={() => onRoundChange(Math.max(0, currentRound - 1))}
          className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
        >
          <SkipBack size={20} />
        </button>
        <button
          onClick={onPlayPause}
          className="p-2 bg-blue-600 hover:bg-blue-700 rounded text-white"
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button
          onClick={() => onRoundChange(Math.min(totalRounds, currentRound + 1))}
          className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
        >
          <SkipForward size={20} />
        </button>
        <span className="text-white font-semibold">轮次 {currentRound} / {totalRounds}</span>
      </div>

      <div className="relative">
        <input
          type="range"
          min="0"
          max={totalRounds}
          value={selectedRound}
          onChange={handleSliderChange}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
        />
        <div className="absolute top-6 w-full">
          {events.map((event, idx) => (
            <div
              key={idx}
              className="absolute"
              style={{ left: `${(event.round / totalRounds) * 100}%` }}
            >
              <div className={`w-2 h-2 rounded-full ${event.type === 'critical' ? 'bg-red-500' : 'bg-yellow-500'}`} />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 space-y-2 max-h-40 overflow-y-auto">
        <h4 className="text-sm font-semibold text-white">关键事件</h4>
        {events.filter(e => e.round <= currentRound).map((event, idx) => (
          <div key={idx} className="bg-gray-700 p-2 rounded">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-400">轮次 {event.round}</span>
              <span className={`text-xs px-2 py-0.5 rounded ${event.type === 'critical' ? 'bg-red-600' : 'bg-yellow-600'}`}>
                {event.type === 'critical' ? '关键' : '普通'}
              </span>
            </div>
            <p className="text-white text-sm mt-1">{event.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
