import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AudioSegment, SegmentStatus, VOICES, ProjectState } from './types';
import { generateSpeechSegment, createWavUrl } from './services/geminiService';
import SegmentList from './components/SegmentList';
import { Split, PlayCircle, Loader2, Trash2, StopCircle, FileAudio, RotateCcw, Plus, X, FolderOpen, Edit2, Volume2, Square, Settings } from 'lucide-react';

// Maximum characters per chunk (approx 1.5 mins of speech depending on speed)
const MAX_CHUNK_LENGTH = 1000;

// Simple, robust ID generator that works in all contexts
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

const STYLE_PRESETS = [
  { label: 'Romantic', text: 'Say it romantically.' },
  { label: 'Sylheti', text: 'Speak with a Sylheti accent.' },
  { label: 'News Anchor', text: 'Speak like a professional news anchor.' },
  { label: 'Storyteller', text: 'Speak like an engaging storyteller.' },
  { label: 'Sad', text: 'Speak in a sad tone.' },
  { label: 'Excited', text: 'Speak with excitement.' },
];

const createNewProject = (index: number): ProjectState => ({
  id: generateId(),
  name: `Project ${index + 1}`,
  inputText: '',
  styleInstruction: '',
  segments: [],
  isProcessing: false,
  isExporting: false,
  hasExported: false,
  selectedVoice: VOICES[0].name,
  speakingRate: 'Normal',
  exportFilename: "",
  progress: { current: 0, total: 0 },
});

function App() {
  // State for managing multiple projects
  const [projects, setProjects] = useState<ProjectState[]>([createNewProject(0)]);
  const [activeProjectId, setActiveProjectId] = useState<string>(projects[0].id);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editNameText, setEditNameText] = useState("");

  // Global Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [apiKeyInput, setApiKeyInput] = useState(""); // For the textarea input

  // Preview state
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Refs for managing independent processing loops
  const stopSignalsRef = useRef<Record<string, boolean>>({});

  // Derived state: The currently active project
  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0];

  // Load API Keys from local storage on mount
  useEffect(() => {
    const storedKeys = localStorage.getItem('gemini_api_keys');
    if (storedKeys) {
        try {
            const parsed = JSON.parse(storedKeys);
            if (Array.isArray(parsed)) {
                setApiKeys(parsed);
                setApiKeyInput(parsed.join('\n'));
            }
        } catch (e) {
            // Fallback for migration from single key string if needed, or just ignore
            if (!storedKeys.startsWith('[')) {
                setApiKeys([storedKeys]);
                setApiKeyInput(storedKeys);
            }
        }
    } else {
        // Fallback: check old single key storage
        const oldKey = localStorage.getItem('gemini_api_key');
        if (oldKey) {
            setApiKeys([oldKey]);
            setApiKeyInput(oldKey);
        }
    }
  }, []);

  // Cleanup preview audio on unmount
  useEffect(() => {
    return () => {
      if (previewAudio) {
        previewAudio.pause();
      }
    };
  }, [previewAudio]);

  const saveApiKeys = () => {
      // Split by newline, trim, remove empty lines
      const keys = apiKeyInput
        .split('\n')
        .map(k => k.trim())
        .filter(k => k.length > 0);
      
      setApiKeys(keys);
      localStorage.setItem('gemini_api_keys', JSON.stringify(keys));
      // Clean up old single key storage
      localStorage.removeItem('gemini_api_key');
      setShowSettings(false);
  };

  // Helper to update a specific project by ID
  const updateProject = (id: string, updates: Partial<ProjectState> | ((prev: ProjectState) => Partial<ProjectState>)) => {
    setProjects(prevProjects => prevProjects.map(p => {
      if (p.id !== id) return p;
      const newValues = typeof updates === 'function' ? updates(p) : updates;
      return { ...p, ...newValues };
    }));
  };

  // Helper to update the CURRENT active project
  const updateActiveProject = (updates: Partial<ProjectState> | ((prev: ProjectState) => Partial<ProjectState>)) => {
    updateProject(activeProjectId, updates);
  };

  // Reset export status if segments change
  useEffect(() => {
    if (activeProject.hasExported) {
       // We only check if segments actually changed significantly, but for simplicity, 
       // any re-render that might imply a change logic is handled in the handlers usually.
    }
  }, [activeProject.segments]); 

  // --- PROJECT MANAGEMENT HANDLERS ---

  const handleAddProject = () => {
    const newProject = createNewProject(projects.length);
    setProjects(prev => [...prev, newProject]);
    setActiveProjectId(newProject.id);
  };

  const handleDeleteProject = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation(); // Prevent tab switching when clicking delete
    
    if (projects.length === 1) {
      alert("You must have at least one open project.");
      return;
    }
    
    // Stop any processing on this project before deleting
    stopSignalsRef.current[projectId] = true;

    const newProjects = projects.filter(p => p.id !== projectId);
    setProjects(newProjects);
    
    if (activeProjectId === projectId) {
      setActiveProjectId(newProjects[newProjects.length - 1].id);
    }
  };

  const startRenaming = (e: React.MouseEvent, project: ProjectState) => {
      e.stopPropagation();
      setEditingProjectId(project.id);
      setEditNameText(project.name);
  };

  const finishRenaming = () => {
      if (editingProjectId && editNameText.trim()) {
          updateProject(editingProjectId, { name: editNameText.trim() });
      }
      setEditingProjectId(null);
  };

  // --- PREVIEW HANDLER ---
  const handlePreviewVoice = async () => {
    // If currently playing, stop it
    if (previewAudio) {
      previewAudio.pause();
      setPreviewAudio(null);
      return;
    }

    setIsPreviewLoading(true);
    try {
      // Pick a random key from the list to spread load, or undefined if list empty
      const keyToUse = apiKeys.length > 0 
        ? apiKeys[Math.floor(Math.random() * apiKeys.length)] 
        : undefined;

      const previewText = "হ্যালো, আমি আপনার নির্বাচিত ভয়েস।";
      const url = await generateSpeechSegment(
        previewText, 
        activeProject.selectedVoice, 
        activeProject.styleInstruction,
        activeProject.speakingRate,
        keyToUse
      );
      
      const audio = new Audio(url);
      audio.onended = () => {
        setPreviewAudio(null);
      };
      
      await audio.play();
      setPreviewAudio(audio);
    } catch (error) {
      console.error("Preview failed", error);
      alert("Could not generate preview. Please check your API Keys in settings.");
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // --- AUDIO LOGIC HANDLERS ---

  const handleChunkText = () => {
    if (!activeProject.inputText.trim()) return;

    // Simple heuristic to split by sentence endings while respecting max length
    const rawSegments = activeProject.inputText
      .replace(/([।?!])/g, "$1|")
      .split("|")
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const newSegments: AudioSegment[] = [];
    let currentChunk = "";

    rawSegments.forEach((sentence) => {
      if ((currentChunk.length + sentence.length) < MAX_CHUNK_LENGTH) {
        currentChunk += (currentChunk ? " " : "") + sentence;
      } else {
        if (currentChunk) {
          newSegments.push({
            id: generateId(),
            text: currentChunk,
            status: SegmentStatus.IDLE,
            volume: 1.0,
            isSelected: false,
          });
        }
        currentChunk = sentence;
      }
    });
    
    if (currentChunk) {
      newSegments.push({
        id: generateId(),
        text: currentChunk,
        status: SegmentStatus.IDLE,
        volume: 1.0,
        isSelected: false,
      });
    }

    updateActiveProject((prev) => ({
      segments: [...prev.segments, ...newSegments],
      inputText: "", // Clear input after chunking
      hasExported: false
    }));
  };

  const processQueue = useCallback(async (projectIdToRun: string) => {
    const currentProject = projects.find(p => p.id === projectIdToRun);
    if (!currentProject || currentProject.isProcessing) return;

    updateProject(projectIdToRun, { isProcessing: true });
    stopSignalsRef.current[projectIdToRun] = false;

    const segmentsToProcess = currentProject.segments.filter(s => s.status === SegmentStatus.IDLE || s.status === SegmentStatus.QUEUED);
    const total = segmentsToProcess.length;

    if (total === 0) {
        updateProject(projectIdToRun, { isProcessing: false });
        return;
    }

    setProjects(prev => prev.map(p => {
        if (p.id !== projectIdToRun) return p;
        return {
            ...p,
            progress: { current: 0, total },
            segments: p.segments.map(s => 
                segmentsToProcess.some(sp => sp.id === s.id) 
                ? { ...s, status: SegmentStatus.PROCESSING, error: undefined } 
                : s
            )
        };
    }));

    const { selectedVoice, styleInstruction, speakingRate } = currentProject;
    const CONCURRENCY_LIMIT = 2; 
    const executing = new Set<Promise<void>>();
    let completedCount = 0;
    
    // Round Robin Key Index
    let keyIndex = 0;

    for (const segment of segmentsToProcess) {
      if (stopSignalsRef.current[projectIdToRun]) break;

      // Select Key for this specific request
      const keyToUse = apiKeys.length > 0 
        ? apiKeys[keyIndex++ % apiKeys.length] 
        : undefined;

      const p = (async () => {
        try {
            const audioUrl = await generateSpeechSegment(segment.text, selectedVoice, styleInstruction, speakingRate, keyToUse);
            
            if (stopSignalsRef.current[projectIdToRun]) return;
            
            setProjects(prev => prev.map(p => {
                if (p.id !== projectIdToRun) return p;
                return {
                    ...p,
                    segments: p.segments.map(s => s.id === segment.id ? { ...s, status: SegmentStatus.COMPLETED, audioUrl } : s)
                };
            }));

        } catch (error: any) {
            if (stopSignalsRef.current[projectIdToRun]) return;
            
            console.error(`Segment ${segment.id} failed:`, error);
            setProjects(prev => prev.map(p => {
                if (p.id !== projectIdToRun) return p;
                return {
                    ...p,
                    segments: p.segments.map(s => s.id === segment.id ? { ...s, status: SegmentStatus.ERROR, error: error.message || 'Generation failed' } : s)
                };
            }));
        } finally {
            if (!stopSignalsRef.current[projectIdToRun]) {
                completedCount++;
                setProjects(prev => prev.map(p => {
                    if (p.id !== projectIdToRun) return p;
                    return { ...p, progress: { ...p.progress, current: completedCount } };
                }));
            }
        }
      })();

      executing.add(p);
      const clean = () => executing.delete(p);
      p.then(clean).catch(clean);

      if (executing.size >= CONCURRENCY_LIMIT) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);

    updateProject(projectIdToRun, { 
        isProcessing: false, 
        progress: { current: 0, total: 0 } 
    });

  }, [projects, apiKeys]); 

  const handleStop = () => {
    stopSignalsRef.current[activeProjectId] = true;
    updateActiveProject({ isProcessing: false });
  };

  const handleClearAll = () => {
    if (activeProject.segments.length > 0) {
      handleStop();
      updateActiveProject({
          segments: [],
          hasExported: false
      });
    }
  };

  const handleRetry = useCallback((id: string) => {
    updateActiveProject((prev) => ({
        hasExported: false,
        segments: prev.segments.map(s => s.id === id ? { ...s, status: SegmentStatus.IDLE, error: undefined } : s)
    }));
    
    setTimeout(() => {
        processQueue(activeProjectId);
    }, 100);
  }, [activeProjectId, processQueue]); 

  const handleDeleteSegment = useCallback((id: string) => {
    updateActiveProject((prev) => ({
        hasExported: false,
        segments: prev.segments.filter(s => s.id !== id)
    }));
  }, [activeProjectId]);

  const handleVolumeChange = (id: string, newVolume: number) => {
    updateActiveProject(prev => ({
        segments: prev.segments.map(s => s.id === id ? { ...s, volume: newVolume } : s),
        hasExported: false
    }));
  };

  const handleToggleSelect = (id: string) => {
    updateActiveProject(prev => ({
        segments: prev.segments.map(s => s.id === id ? { ...s, isSelected: !s.isSelected } : s)
    }));
  };

  const handleSelectAll = (shouldSelect: boolean) => {
      updateActiveProject(prev => ({
          segments: prev.segments.map(s => ({ ...s, isSelected: shouldSelect }))
      }));
  };

  const handleBulkVolumeChange = (newVolume: number) => {
      updateActiveProject(prev => {
          const hasSelection = prev.segments.some(s => s.isSelected);
          return {
              segments: prev.segments.map(s => {
                  if (hasSelection && !s.isSelected) return s; 
                  return { ...s, volume: newVolume };
              }),
              hasExported: false
          };
      });
  };

  const handleExportMerged = async () => {
    const completedSegments = activeProject.segments.filter(s => s.status === SegmentStatus.COMPLETED && s.audioUrl);
    
    if (completedSegments.length === 0) {
      alert("No audio generated yet to export.");
      return;
    }

    updateActiveProject({ isExporting: true });

    try {
      const buffers: Uint8Array[] = [];
      let totalLength = 0;

      for (const segment of completedSegments) {
        if (!segment.audioUrl) continue;
        const response = await fetch(segment.audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        
        if (arrayBuffer.byteLength > 44) {
             const rawData = new Uint8Array(arrayBuffer.slice(44));
             const volume = segment.volume !== undefined ? segment.volume : 1.0;
             
             if (Math.abs(volume - 1.0) > 0.01) {
                const int16View = new Int16Array(rawData.buffer, rawData.byteOffset, rawData.byteLength / 2);
                for (let i = 0; i < int16View.length; i++) {
                    let val = int16View[i] * volume;
                    if (val > 32767) val = 32767;
                    if (val < -32768) val = -32768;
                    int16View[i] = val;
                }
             }
             buffers.push(rawData);
             totalLength += rawData.length;
        }
      }

      if (totalLength === 0) {
        alert("No valid audio data to export.");
        updateActiveProject({ isExporting: false });
        return;
      }

      const mergedBuffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const buffer of buffers) {
        mergedBuffer.set(buffer, offset);
        offset += buffer.length;
      }

      const mergedUrl = createWavUrl(mergedBuffer, 24000);
      const link = document.createElement('a');
      link.href = mergedUrl;
      
      let fileName = activeProject.exportFilename.trim() || "rakib";
      if (!fileName.toLowerCase().endsWith('.wav')) {
        fileName += '.wav';
      }
      
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      updateActiveProject({ hasExported: true });

    } catch (e) {
      console.error("Merge failed", e);
      alert("Failed to merge audio files.");
    } finally {
      updateActiveProject({ isExporting: false });
    }
  };

  const completedCount = activeProject.segments.filter(s => s.status === SegmentStatus.COMPLETED).length;
  const hasCompleted = completedCount > 0;
  
  const selectedCount = activeProject.segments.filter(s => s.isSelected).length;
  const allSelected = activeProject.segments.length > 0 && selectedCount === activeProject.segments.length;
  const isIndeterminate = selectedCount > 0 && !allSelected;
  
  let displayVolume = 1.0;
  const targetSegments = selectedCount > 0 ? activeProject.segments.filter(s => s.isSelected) : activeProject.segments;
  if (targetSegments.length > 0) {
      displayVolume = targetSegments[0].volume;
  }

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100 overflow-hidden">
      
      {/* --- TAB BAR --- */}
      <div className="h-10 bg-slate-900 border-b border-slate-800 flex items-center px-2 gap-1 overflow-x-auto select-none">
        {projects.map((project) => (
          <div 
            key={project.id}
            onClick={() => setActiveProjectId(project.id)}
            onDoubleClick={(e) => startRenaming(e, project)}
            className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-t-lg border-t border-x border-transparent cursor-pointer min-w-[120px] max-w-[200px] transition-all ${
              activeProjectId === project.id 
                ? 'bg-slate-800 border-slate-700 text-blue-400' 
                : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
            }`}
          >
             <FolderOpen size={14} className={activeProjectId === project.id ? 'text-blue-500' : 'text-slate-500'} />
             
             {editingProjectId === project.id ? (
                 <input 
                    autoFocus
                    type="text"
                    value={editNameText}
                    onChange={(e) => setEditNameText(e.target.value)}
                    onBlur={finishRenaming}
                    onKeyDown={(e) => e.key === 'Enter' && finishRenaming()}
                    className="bg-transparent border-b border-blue-500 outline-none text-xs w-20 text-white"
                    onClick={(e) => e.stopPropagation()}
                 />
             ) : (
                <span className="text-xs font-medium truncate flex-1" title="Double click to rename">
                    {project.name}
                </span>
             )}

             <button 
                onClick={(e) => handleDeleteProject(e, project.id)}
                className={`opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 transition-all ${projects.length === 1 ? 'hidden' : ''}`}
             >
                <X size={12} />
             </button>
             
             {/* Active Indicator Line */}
             {activeProjectId === project.id && (
               <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"></div>
             )}
          </div>
        ))}

        <button 
          onClick={handleAddProject}
          className="p-1.5 rounded-full hover:bg-slate-800 text-slate-500 hover:text-white transition-all ml-1"
          title="Create New Project"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* --- MAIN CONTENT AREA --- */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Panel: Input & Controls */}
        <div className="w-1/2 flex flex-col border-r border-slate-800 p-6">
          <header className="mb-6 flex justify-between items-start">
            <div>
                <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 mb-2">
                BANGLA VOICE TOOLS
                </h1>
                <p className="text-slate-400 text-sm font-medium">
                i am rakib
                </p>
                <p className="text-slate-500 text-xs mt-1 font-mono">
                01733263106
                </p>
            </div>
            <div className="flex flex-col items-end gap-2">
                <div className="text-right">
                    <span className="text-xs font-mono text-slate-500 block uppercase tracking-wider">Current Project</span>
                    <span className="text-sm font-semibold text-blue-300">{activeProject.name}</span>
                </div>
                <button 
                  onClick={() => setShowSettings(true)}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-400 transition-colors bg-slate-900 hover:bg-slate-800 px-2 py-1 rounded border border-slate-700"
                >
                   <Settings size={14} />
                   <span>Settings</span>
                </button>
            </div>
          </header>

          <div className="flex flex-col gap-4 mb-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Voice Selection
                </label>
                <div className="flex gap-2">
                    <select 
                      value={activeProject.selectedVoice} 
                      onChange={(e) => updateActiveProject({ selectedVoice: e.target.value })}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-blue-500 outline-none"
                    >
                      {VOICES.map(v => (
                        <option key={v.name} value={v.name}>{v.label}</option>
                      ))}
                    </select>
                    <button
                        onClick={handlePreviewVoice}
                        disabled={isPreviewLoading}
                        className={`p-2 rounded border border-slate-700 ${
                            previewAudio ? 'bg-amber-900/30 text-amber-500 border-amber-800' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                        } transition-colors cursor-pointer`}
                        title="Preview Voice"
                    >
                        {isPreviewLoading ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : previewAudio ? (
                            <Square size={18} fill="currentColor" />
                        ) : (
                            <Volume2 size={18} />
                        )}
                    </button>
                </div>
              </div>
              
              <div className="w-1/3">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Pace
                </label>
                <select 
                  value={activeProject.speakingRate} 
                  onChange={(e) => updateActiveProject({ speakingRate: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-blue-500 outline-none"
                >
                  <option value="Slow">Slow</option>
                  <option value="Normal">Normal</option>
                  <option value="Fast">Fast</option>
                  <option value="Very Fast">Very Fast</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Style Instructions (Optional)
              </label>
              
              <div className="flex flex-wrap gap-2 mb-2">
                {STYLE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => updateActiveProject({ styleInstruction: preset.text })}
                    className="px-2.5 py-1 text-xs font-medium rounded-full border border-slate-700 bg-slate-800/50 text-slate-400 hover:bg-blue-900/30 hover:text-blue-300 hover:border-blue-800 transition-all cursor-pointer"
                    title={preset.text}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <textarea 
                value={activeProject.styleInstruction} 
                onChange={(e) => updateActiveProject({ styleInstruction: e.target.value })}
                placeholder="e.g. Speak calm and clearly suitable for a documentary narration..."
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-blue-500 outline-none resize-none h-20 placeholder-slate-600"
              />
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0 mb-4">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Input Text (Bengali)
            </label>
            <textarea
              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-200 resize-none focus:ring-2 focus:ring-blue-500/50 outline-none font-bengali leading-relaxed text-lg"
              placeholder="আপনার বাংলা পাঠ্য এখানে পেস্ট করুন (Paste your Bangla text here)..."
              value={activeProject.inputText}
              onChange={(e) => updateActiveProject({ inputText: e.target.value })}
            ></textarea>
            <p className="text-right text-xs text-slate-500 mt-2">
              {activeProject.inputText.length} characters
            </p>
          </div>

          <button
            onClick={handleChunkText}
            disabled={!activeProject.inputText.trim()}
            className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg flex items-center justify-center gap-2 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700 cursor-pointer"
          >
            <Split size={18} />
            Analyze & Add to Queue
          </button>
        </div>

        {/* Right Panel: Segments & Output */}
        <div className="w-1/2 flex flex-col bg-slate-900/50 relative">
          <div className="p-4 border-b border-slate-800 flex flex-col bg-slate-900 sticky top-0 z-10 shadow-lg gap-4">
            {/* Top Row: Title, Processing status, Main Buttons */}
            <div className="flex justify-between items-center w-full">
                <div className="flex flex-col">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    Audio Queue 
                    <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">
                    {activeProject.segments.length}
                    </span>
                </h2>
                {activeProject.isProcessing && (
                    <p className="text-xs text-blue-400 mt-1 animate-pulse">
                    Processing {activeProject.progress.current} of {activeProject.progress.total}...
                    </p>
                )}
                {activeProject.isExporting && (
                    <p className="text-xs text-emerald-400 mt-1 animate-pulse">
                    Merging {completedCount} clips...
                </p>
                )}
                </div>
                
                <div className="flex items-center gap-2">
                {/* Filename Input */}
                <div className="flex items-center mr-1 group">
                    <input 
                        type="text" 
                        value={activeProject.exportFilename}
                        onChange={(e) => updateActiveProject({ exportFilename: e.target.value })}
                        placeholder="filename"
                        className="w-32 bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-l px-3 py-2 outline-none focus:border-blue-500 placeholder-slate-600 transition-all focus:w-48"
                        title="Export filename"
                    />
                    <span className="bg-slate-800 border border-l-0 border-slate-700 text-slate-500 text-xs px-2 py-2.5 rounded-r select-none">.wav</span>
                </div>

                {/* Merge / New Project Button */}
                {activeProject.hasExported ? (
                    <button 
                    onClick={handleClearAll}
                    className="px-4 py-2 bg-slate-700 hover:bg-red-600 text-white rounded text-sm flex items-center gap-2 transition-all font-semibold shadow-lg cursor-pointer"
                    title="Clear all segments and start a new project"
                    >
                        <RotateCcw size={18} />
                        Start New Project
                    </button>
                ) : (
                    <button 
                    onClick={handleExportMerged}
                    disabled={activeProject.isProcessing || activeProject.isExporting || !hasCompleted}
                    className={`px-4 py-2 rounded text-sm flex items-center gap-2 transition-all font-semibold shadow-lg ${
                        hasCompleted && !activeProject.isProcessing && !activeProject.isExporting
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-900/20 cursor-pointer' 
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                    title="Join all completed segments serially into one WAV file"
                    >
                        {activeProject.isExporting ? <Loader2 size={18} className="animate-spin" /> : <FileAudio size={18} />}
                        Merge & Download
                    </button>
                )}

                {activeProject.isProcessing ? (
                    <button 
                    onClick={handleStop}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm flex items-center gap-2 cursor-pointer"
                    >
                    <StopCircle size={16} /> Stop
                    </button>
                ) : (
                    <button 
                    onClick={() => processQueue(activeProjectId)}
                    disabled={activeProject.segments.every(s => s.status === SegmentStatus.COMPLETED) || activeProject.segments.length === 0}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                    {activeProject.segments.some(s => s.status === SegmentStatus.PROCESSING) ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
                    Generate All
                    </button>
                )}
                
                {/* Conditional small trash button */}
                {!activeProject.hasExported && (
                    <button 
                        type="button"
                        onClick={handleClearAll}
                        disabled={activeProject.segments.length === 0}
                        className="px-3 py-2 bg-slate-800 hover:bg-red-600 text-slate-400 hover:text-white rounded border border-slate-700 transition-colors disabled:opacity-30 cursor-pointer"
                        title="Clear All"
                    >
                        <Trash2 size={16} />
                    </button>
                )}
                </div>
            </div>

            {/* Bulk Controls Toolbar */}
            {activeProject.segments.length > 0 && (
                <div className="flex items-center gap-4 py-2 border-t border-slate-800/50">
                     <label className="flex items-center gap-2 cursor-pointer select-none">
                         <input 
                            type="checkbox" 
                            checked={allSelected} 
                            ref={input => { if(input) input.indeterminate = isIndeterminate; }}
                            onChange={(e) => handleSelectAll(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-offset-slate-900 cursor-pointer"
                         />
                         <span className="text-xs text-slate-400 hover:text-slate-300">Select All</span>
                     </label>

                     <div className="h-4 w-px bg-slate-700 mx-2"></div>

                     <div className="flex items-center gap-2 flex-1">
                         <Volume2 size={16} className={selectedCount > 0 ? "text-blue-400" : "text-slate-400"} />
                         <input 
                            type="range" 
                            min="0" 
                            max="2" 
                            step="0.1" 
                            value={displayVolume} 
                            onChange={(e) => handleBulkVolumeChange(parseFloat(e.target.value))}
                            className="w-32 accent-blue-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                            title={selectedCount > 0 ? `Adjust volume for ${selectedCount} selected items` : "Adjust Global Volume"}
                         />
                         <span className="text-xs font-mono text-slate-400 w-10 text-right">{Math.round(displayVolume * 100)}%</span>
                         
                         <span className="text-xs text-slate-500 ml-3">
                            {selectedCount > 0 
                                ? `Adjusting ${selectedCount} selected` 
                                : "Adjusting All"}
                         </span>
                     </div>
                </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
            <SegmentList 
              segments={activeProject.segments} 
              onRetry={handleRetry} 
              onDelete={handleDeleteSegment}
              onVolumeChange={handleVolumeChange}
              onToggleSelect={handleToggleSelect}
            />
          </div>
          
          {/* Footer info */}
          <div className="p-2 text-center text-xs text-slate-600 border-t border-slate-800 bg-slate-950">
            Audio Format: WAV 24kHz. Merging happens locally in browser.
          </div>
        </div>
      </div>

      {/* API Key Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md shadow-2xl relative animate-in fade-in zoom-in duration-200">
            <button 
              onClick={() => setShowSettings(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white"
            >
              <X size={20} />
            </button>
            
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Settings className="text-blue-400" /> API Configuration
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">
                  Custom Gemini API Keys (Bulk)
                </label>
                <textarea 
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="AIzaSy... (Key 1)&#10;AIzaSy... (Key 2)&#10;AIzaSy... (Key 3)"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm h-32 resize-none leading-relaxed"
                />
                <div className="flex justify-between items-start mt-2">
                    <p className="text-xs text-slate-500">
                    Enter one key per line. The app will cycle through them automatically to distribute the load.
                    </p>
                    <span className="text-xs text-blue-400 bg-blue-900/20 px-2 py-0.5 rounded border border-blue-900/50 whitespace-nowrap">
                        {apiKeyInput.split('\n').filter(k => k.trim()).length} keys loaded
                    </span>
                </div>
              </div>
              
              <div className="bg-blue-900/20 border border-blue-900/50 rounded-lg p-3 text-xs text-blue-200">
                Don't have a key? Get one for free at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="underline hover:text-white">Google AI Studio</a>.
              </div>

              <div className="flex justify-end pt-2">
                <button 
                  onClick={saveApiKeys}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Save & Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;