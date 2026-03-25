import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { Download } from 'lucide-react';

interface PredictionData {
  trends: Array<{ round: number; value: number; label: string }>;
  convergence: { score: number; status: string };
  risks: Array<{ category: string; level: number; description: string }>;
}

interface PredictionPanelProps {
  data: PredictionData;
  onExport: () => void;
}

export const PredictionPanel: React.FC<PredictionPanelProps> = ({ data, onExport }) => {
  const trendChartRef = useRef<HTMLDivElement>(null);
  const riskChartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!trendChartRef.current || !data.trends.length) return;

    const chart = echarts.init(trendChartRef.current);
    const option = {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: { data: [...new Set(data.trends.map(t => t.label))], textStyle: { color: '#fff' } },
      xAxis: { type: 'category', data: [...new Set(data.trends.map(t => t.round))], axisLabel: { color: '#999' } },
      yAxis: { type: 'value', axisLabel: { color: '#999' } },
      series: [...new Set(data.trends.map(t => t.label))].map(label => ({
        name: label,
        type: 'line',
        smooth: true,
        data: data.trends.filter(t => t.label === label).map(t => t.value)
      }))
    };
    chart.setOption(option);

    return () => chart.dispose();
  }, [data.trends]);

  useEffect(() => {
    if (!riskChartRef.current || !data.risks.length) return;

    const chart = echarts.init(riskChartRef.current);
    const option = {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', max: 100, axisLabel: { color: '#999' } },
      yAxis: { type: 'category', data: data.risks.map(r => r.category), axisLabel: { color: '#fff' } },
      series: [{
        type: 'bar',
        data: data.risks.map(r => ({
          value: r.level * 100,
          itemStyle: { color: r.level > 0.7 ? '#ef4444' : r.level > 0.4 ? '#f59e0b' : '#10b981' }
        }))
      }]
    };
    chart.setOption(option);

    return () => chart.dispose();
  }, [data.risks]);

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-white">预测分析</h3>
        <button onClick={onExport} className="flex items-center gap-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm">
          <Download size={16} /> 导出报告
        </button>
      </div>

      <div className="bg-gray-700 p-3 rounded">
        <div className="text-sm text-gray-400">收敛性分析</div>
        <div className="flex items-center gap-3 mt-2">
          <div className="text-2xl font-bold text-white">{(data.convergence.score * 100).toFixed(1)}%</div>
          <div className={`px-2 py-1 rounded text-xs ${data.convergence.score > 0.7 ? 'bg-green-600' : 'bg-yellow-600'}`}>
            {data.convergence.status}
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-white mb-2">趋势图表</h4>
        <div ref={trendChartRef} className="w-full h-64" />
      </div>

      <div>
        <h4 className="text-sm font-semibold text-white mb-2">风险评估</h4>
        <div ref={riskChartRef} className="w-full h-48" />
      </div>
    </div>
  );
};
