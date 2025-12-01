import React from 'react';
import { AudioSegment, SegmentStatus } from '../types';
import { Download, RefreshCw, AlertCircle, X, Volume2 } from 'lucide-react';

interface SegmentListProps {
  segments: AudioSegment[];
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  onVolumeChange: (id: string, volume: number) => void;
  onToggleSelect: (id: string) => void;
}

const SegmentList: React.FC<SegmentListProps> = ({ segments, onRetry, onDelete, onVolumeChange, onToggleSelect }) => {
  if (segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8 text-center border-2 border-dashed border-slate-700 rounded-xl">
        <p className="text-lg mb-2">No audio generated yet.</p>
        <p className="text-sm">Enter your Bengali text on the left and click "Analyze & Chunk" to begin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-20">
      {segments.map((segment, index) => (
        <div 
          key={segment.id} 
          className={`relative p-4 rounded-lg border group transition-all duration-300 shadow-sm hover:shadow-md ${
            segment.isSelected ? 'border-blue-500/50 bg-blue-900/5 ring-1 ring-blue-500/20' : 
            segment.status === SegmentStatus.PROCESSING ? 'border-blue-500 bg-blue-900/10' :
            segment.status === SegmentStatus.COMPLETED ? 'border-green-500/30 bg-green-900/10' :
            segment.status === SegmentStatus.ERROR ? 'border-red-500/50 bg-red-900/10' :
            'border-slate-700 bg-slate-800'
          }`}
        >
          <div className="flex justify-between items-start mb-2 pl-6">
            <div className="absolute top-4 left-3 z-20">
              <input 
                type="checkbox" 
                checked={!!segment.isSelected} 
                onChange={() => onToggleSelect(segment.id)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-offset-slate-800 cursor-pointer"
              />
            </div>
            
            <span className="text-xs font-mono text-slate-400 bg-slate-800/50 px-2 py-0.5 rounded border border-slate-700/50">
              #{index + 1}
            </span>
            <div className="flex gap-2 z-10">
              {segment.status === SegmentStatus.ERROR && (
                <button 
                  onClick={() => onRetry(segment.id)}
                  className="p-2 hover:bg-slate-700 rounded-md text-amber-400 transition-colors cursor-pointer" 
                  title="Retry"
                  type="button"
                >
                  <RefreshCw size={18} className="pointer-events-none" />
                </button>
              )}
              {segment.status === SegmentStatus.COMPLETED && segment.audioUrl && (
                 <a 
                 href={segment.audioUrl} 
                 download={`bangla-part-${index + 1}.wav`}
                 className="p-2 hover:bg-slate-700 rounded-md text-blue-400 transition-colors cursor-pointer"
                 title="Download"
               >
                 <Download size={18} className="pointer-events-none" />
               </a>
              )}
              
              {/* DELETE BUTTON */}
              <button 
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(segment.id);
                }}
                className="p-2 hover:bg-red-500/20 rounded-md text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                title="Remove segment"
              >
                <X size={18} className="pointer-events-none" />
              </button>
            </div>
          </div>
          
          <p className="text-slate-300 text-sm mb-3 font-bengali leading-relaxed pr-8 pl-6">
            {segment.text}
          </p>

          <div className="flex flex-col gap-3 pl-6">
            <div className="flex items-center gap-3 h-6">
              {segment.status === SegmentStatus.QUEUED && (
                <span className="text-xs text-slate-500 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-500"></span> Queued
                </span>
              )}
              {segment.status === SegmentStatus.PROCESSING && (
                <span className="text-xs text-blue-400 flex items-center gap-2 animate-pulse">
                  <RefreshCw size={12} className="animate-spin" /> Generating...
                </span>
              )}
              {segment.status === SegmentStatus.COMPLETED && segment.audioUrl && (
                <audio controls className="w-full h-6 opacity-80" src={segment.audioUrl} />
              )}
              {segment.status === SegmentStatus.ERROR && (
                <div className="flex items-center gap-2 text-xs text-red-400 w-full">
                  <AlertCircle size={12} className="shrink-0" /> 
                  <span title={segment.error} className="truncate block flex-1">{segment.error || "Failed"}</span>
                </div>
              )}
            </div>

            {/* Volume Slider for Individual Segment */}
            <div className="flex items-center gap-2 mt-1 bg-slate-900/30 p-1.5 rounded-md border border-slate-700/30 w-fit">
              <Volume2 size={14} className={segment.volume === 0 ? "text-slate-600" : "text-slate-400"} />
              <input 
                type="range" 
                min="0" 
                max="2" 
                step="0.1" 
                value={segment.volume} 
                onChange={(e) => onVolumeChange(segment.id, parseFloat(e.target.value))}
                className="w-24 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                title={`Volume: ${Math.round(segment.volume * 100)}%`}
              />
              <span className="text-[10px] font-mono text-slate-500 w-8 text-right">
                {Math.round(segment.volume * 100)}%
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SegmentList;