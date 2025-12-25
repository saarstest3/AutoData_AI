
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  VehicleRecord, 
  AgentStatus, 
  ExpansionSuggestion 
} from './types';
import { 
  initializeDatabase, 
  suggestExpansion 
} from './geminiService';
import { 
  sortDatabase, 
  convertToCSV, 
  parseCSV,
  downloadCSV, 
  isDuplicate 
} from './utils';
import { INTERNAL_DB_MAIN, INTERNAL_DB_PREMIUM } from './internalData';

const PREDEFINED_MANUFACTURERS = ['Toyota', 'Hyundai', 'Skoda', 'Suzuki', 'BMW', 'Mercedes-Benz'];
const RECORDS_PER_PAGE: number = 50;
const STORAGE_KEY = 'autodata_agent_db';

const App: React.FC = () => {
  const [database, setDatabase] = useState<VehicleRecord[]>([]);
  const [status, setStatus] = useState<AgentStatus>(AgentStatus.IDLE);
  const [logs, setLogs] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<ExpansionSuggestion[]>([]);
  
  // Selection State
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());

  // AI Expansion States
  const [selectedManufacturer, setSelectedManufacturer] = useState<string>('ALL');
  const [selectedModel, setSelectedModel] = useState<string>('ALL');
  const [customManufacturer, setCustomManufacturer] = useState<string>('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [isManufacturerSearchOpen, setIsManufacturerSearchOpen] = useState(false);
  
  // Table Filtering States (Facets)
  const [searchTerm, setSearchTerm] = useState('');
  const [filterManufacturers, setFilterManufacturers] = useState<string[]>([]);
  const [filterYearRange, setFilterYearRange] = useState<[number, number]>([1950, 2025]);
  
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [showNoResultsModal, setShowNoResultsModal] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = useCallback((message: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev].slice(0, 50));
  }, []);

  // Initial Data Load
  useEffect(() => {
    addLog('מערכת עולה: בודק נתונים שמורים...');
    const savedData = localStorage.getItem(STORAGE_KEY);
    
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        setDatabase(parsed);
        addLog(`נטענו ${parsed.length} רשומות מהאחסון המקומי המעודכן.`);
      } catch (e) {
        addLog('שגיאה בטעינת נתונים שמורים. טוען בסיס נתונים פנימי...');
        const combined = sortDatabase([...INTERNAL_DB_MAIN, ...INTERNAL_DB_PREMIUM]);
        setDatabase(combined);
      }
    } else {
      addLog('לא נמצאו נתונים שמורים. טוען מאגרי מידע פנימיים כבסיס...');
      const combined = sortDatabase([...INTERNAL_DB_MAIN, ...INTERNAL_DB_PREMIUM]);
      setDatabase(combined);
      addLog(`נטענו ${combined.length} רשומות התחלתיות.`);
    }
  }, [addLog]);

  // Persistent Auto-Save
  useEffect(() => {
    if (database.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
    }
  }, [database]);

  // Reset page when filtering changes
  useEffect(() => {
    setCurrentPage(1);
    setSelectedRowKeys(new Set()); 
  }, [searchTerm, filterManufacturers, filterYearRange]);

  // Robust unique key generator for a vehicle record
  const getRecordKey = useCallback((v: VehicleRecord) => {
    if (!v) return '';
    const parts = [
      v.Manufacturer,
      v.Model,
      v.Generation,
      v.Model_Code,
      v.Start_Year,
      v.End_Year
    ];
    return parts.map(p => String(p || '').trim().toLowerCase()).join('##');
  }, []);

  // Dynamic Manufacturer List for Selectors
  const availableManufacturers = useMemo(() => {
    const dbManufacturers = database.map(v => v.Manufacturer);
    const combined = [...PREDEFINED_MANUFACTURERS, ...dbManufacturers];
    return Array.from(new Set(combined)).sort((a, b) => (a as string).localeCompare(b as string));
  }, [database]);

  // Facet Data: Counts per Manufacturer
  const manufacturerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    database.forEach(v => {
      counts[v.Manufacturer] = (counts[v.Manufacturer] || 0) + 1;
    });
    return counts;
  }, [database]);

  // Dynamic Model List for AI Target
  const availableModels = useMemo(() => {
    if (selectedManufacturer === 'ALL' || selectedManufacturer === 'NEW') return [];
    const modelsForBrand = database
      .filter(v => v.Manufacturer.toLowerCase() === selectedManufacturer.toLowerCase())
      .map(v => v.Model);
    return Array.from(new Set(modelsForBrand)).sort((a, b) => (a as string).localeCompare(b as string));
  }, [database, selectedManufacturer]);

  // Advanced Table Data Filtering
  const filteredData = useMemo(() => {
    return database.filter(record => {
      const matchesSearch = searchTerm === '' || 
        record.Manufacturer.toLowerCase().includes(searchTerm.toLowerCase()) ||
        record.Model.toLowerCase().includes(searchTerm.toLowerCase()) ||
        record.Model_Code.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesManufacturer = filterManufacturers.length === 0 || 
        filterManufacturers.includes(record.Manufacturer);
        
      const matchesYear = record.Start_Year >= filterYearRange[0] && 
        record.Start_Year <= filterYearRange[1];

      return matchesSearch && matchesManufacturer && matchesYear;
    });
  }, [database, searchTerm, filterManufacturers, filterYearRange]);

  // Pagination Logic
  const totalPages = Math.max(1, Math.ceil(filteredData.length / RECORDS_PER_PAGE));
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * RECORDS_PER_PAGE;
    return filteredData.slice(start, start + RECORDS_PER_PAGE);
  }, [filteredData, currentPage]);

  // Page bounds check: If records are deleted and current page is empty, go back
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const startRange: number = filteredData.length === 0 ? 0 : ((currentPage - 1) * RECORDS_PER_PAGE) + 1;
  const endRange: number = Math.min(currentPage * RECORDS_PER_PAGE, filteredData.length);

  const handleCreateNew = () => {
    if (window.confirm('האם אתה בטוח שברצונך למחוק את כל הנתונים וליצור מאגר ריק?')) {
      setDatabase([]);
      localStorage.removeItem(STORAGE_KEY);
      setSelectedRowKeys(new Set());
      addLog('המאגר נוקה לחלוטין מהזיכרון.');
    }
  };

  const handleSuggest = async () => {
    const target = showCustomInput ? customManufacturer : selectedManufacturer;
    if (!target || target === 'NEW') {
      addLog('נא להזין שם יצרן חוקי.');
      return;
    }

    setStatus(AgentStatus.ANALYZING);
    let logMsg = target === 'ALL' ? 'סורק את כל המאגר להצעות הרחבה כלליות...' : `סורק נתונים קיימים עבור ${target}...`;
    if (selectedModel !== 'ALL') {
      logMsg = `סורק דורות חסרים ספציפית עבור ${target} ${selectedModel}...`;
    }
    addLog(logMsg);
    
    try {
      const newSuggestions = await suggestExpansion(target, database, selectedModel);
      if (newSuggestions.length === 0) {
        addLog(`ניתוח הושלם. לא נמצאו נתונים חדשים להוספה עבור ${target}.`);
        setShowNoResultsModal(true);
        setStatus(AgentStatus.IDLE);
      } else {
        setSuggestions(newSuggestions);
        addLog(`ניתוח הושלם. נמצאו ${newSuggestions.length} הצעות להוספה.`);
        setStatus(AgentStatus.READY_FOR_EXPANSION);
      }
    } catch (error) {
      addLog('שגיאה בניתוח הרחבת המאגר.');
      setStatus(AgentStatus.ERROR);
    }
  };

  const confirmAddition = async () => {
    setStatus(AgentStatus.UPDATING);
    addLog('מטמיע נתונים חדשים ומבצע בדיקת כפילויות...');
    
    const newRecords: VehicleRecord[] = [];
    suggestions.forEach(s => {
      if (!isDuplicate(database, s)) {
        newRecords.push(s);
      } else {
        addLog(`רשומה כפולה דולגה: ${s.Manufacturer} ${s.Model}`);
      }
    });

    const updatedDb = sortDatabase([...database, ...newRecords]);
    setDatabase(updatedDb);
    setSuggestions([]);
    
    addLog(`המאגר עודכן ונשמר. נוספו ${newRecords.length} רשומות חדשות.`);
    setStatus(AgentStatus.IDLE);
    setShowCustomInput(false);
    setIsManufacturerSearchOpen(false);
    setCustomManufacturer('');
    setSelectedModel('ALL');
  };

  const handleManufacturerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedModel('ALL');
    if (val === 'NEW') {
      setShowCustomInput(true);
      setIsManufacturerSearchOpen(false);
      setSelectedManufacturer('NEW');
    } else {
      setShowCustomInput(false);
      setSelectedManufacturer(val);
    }
  };

  const toggleManufacturerSearch = () => {
    setIsManufacturerSearchOpen(!isManufacturerSearchOpen);
    if (!isManufacturerSearchOpen) {
      setShowCustomInput(true);
      setSelectedManufacturer('NEW');
    } else {
      setShowCustomInput(false);
      setSelectedManufacturer('ALL');
    }
  };

  const toggleFilterManufacturer = (m: string) => {
    setFilterManufacturers(prev => 
      prev.includes(m) ? prev.filter(item => item !== m) : [...prev, m]
    );
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      addLog(`מייבא קובץ: ${file.name}...`);
      try {
        const importedData = parseCSV(content);
        addLog(`נקראו ${importedData.length} רשומות מהקובץ. מבצע מיזוג...`);
        
        const mergedData = [...database];
        let addedCount = 0;
        importedData.forEach(record => {
          if (!isDuplicate(mergedData, record)) {
            mergedData.push(record);
            addedCount++;
          }
        });

        const sorted = sortDatabase(mergedData);
        setDatabase(sorted);
        addLog(`ייבוא הושלם. המאגר המעודכן נשמר בזיכרון המערכת.`);
      } catch (err: any) {
        addLog(`שגיאה בייבוא הקובץ: ${err.message}`);
        alert(`שגיאה בייבוא: ${err.message}`);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const exportData = () => {
    const csv = convertToCSV(database);
    downloadCSV(csv, 'vehicle_database_export.csv');
    addLog('מייצא נתונים לקובץ CSV מקומי...');
  };

  const clearFilters = () => {
    setFilterManufacturers([]);
    setSearchTerm('');
    setFilterYearRange([1950, 2025]);
  };

  const handleToggleRow = useCallback((key: string) => {
    setSelectedRowKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleToggleSelectPage = useCallback(() => {
    const pageKeys = paginatedData.map(getRecordKey);
    const allOnPageSelected = pageKeys.every(k => selectedRowKeys.has(k));

    setSelectedRowKeys(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        pageKeys.forEach(k => next.delete(k));
      } else {
        pageKeys.forEach(k => next.add(k));
      }
      return next;
    });
  }, [paginatedData, selectedRowKeys, getRecordKey]);

  // STABLE DELETE HANDLER
  const handleDeleteSelected = useCallback((e: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    const count = selectedRowKeys.size;
    if (count === 0) return;

    if (window.confirm(`האם למחוק ${count} רשומות שנבחרו מהמאגר?`)) {
      const keysToDelete = new Set(selectedRowKeys);
      setDatabase(prevDb => prevDb.filter(record => !keysToDelete.has(getRecordKey(record))));
      setSelectedRowKeys(new Set());
      addLog(`המחיקה הושלמה: ${count} רשומות הוסרו.`);
    }
  }, [selectedRowKeys, getRecordKey, addLog]);

  const canEditModel = selectedManufacturer !== 'ALL' && selectedManufacturer !== 'NEW';
  const allOnPageSelected = paginatedData.length > 0 && paginatedData.every(v => selectedRowKeys.has(getRecordKey(v)));

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" dir="rtl">
      <input type="file" accept=".csv" ref={fileInputRef} className="hidden" onChange={handleImportCSV} />

      {/* No Results Modal */}
      {showNoResultsModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-10 text-center space-y-6 border border-slate-100">
            <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-search-minus text-3xl text-amber-500"></i>
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-slate-900">לא נמצאו תוצאות</h2>
              <p className="text-slate-500 font-medium leading-relaxed">
                הסוכן החכם בודק את מקורות המידע ולא מצא דגמים או דורות חדשים להוסיף למאגר עבור החיפוש הנוכחי.
              </p>
            </div>
            <button 
              onClick={() => setShowNoResultsModal(false)}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-2xl shadow-lg transition-all transform hover:scale-[1.02] active:scale-100"
            >
              הבנתי, תודה
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-50 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white text-2xl shadow-lg rotate-3">
            <i className="fas fa-car-side"></i>
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">AutoData AI Agent</h1>
            <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest mt-0.5">ניהול דגמי רכב עם סנכרון אוטומטי</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Delete Button - Fixed Interaction */}
          {selectedRowKeys.size > 0 && (
            <button 
              type="button"
              onClick={handleDeleteSelected}
              className="relative z-[60] flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-md transform active:scale-95 cursor-pointer pointer-events-auto"
            >
              <i className="fas fa-trash-alt"></i>
              מחק {selectedRowKeys.size} רשומות
            </button>
          )}

          <button 
            type="button"
            onClick={handleCreateNew}
            className="flex items-center gap-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-100 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm"
          >
            <i className="fas fa-trash-alt"></i>
            נקה מאגר
          </button>
          <button 
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm"
          >
            <i className="fas fa-file-import"></i>
            ייבוא CSV
          </button>
          <button 
            type="button"
            onClick={exportData}
            disabled={database.length === 0}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 shadow-md shadow-slate-200"
          >
            <i className="fas fa-download ml-1"></i>
            ייצוא CSV
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-4 gap-6 overflow-hidden">
        
        {/* Right Sidebar */}
        <div className="lg:col-span-1 space-y-6 overflow-y-auto max-h-[calc(100vh-140px)] scrollbar-hide">
          
          {/* AI Expansion Actions */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-5">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 pb-3">פעולות סוכן AI</h2>
            
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">טווח הרחבה (יצרן)</label>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={toggleManufacturerSearch}
                      className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${isManufacturerSearchOpen ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-400 border border-slate-200 hover:border-indigo-300 hover:text-indigo-500'}`}
                    >
                      <i className={`fas ${isManufacturerSearchOpen ? 'fa-times' : 'fa-search'} text-[10px]`}></i>
                    </button>
                    <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                      {availableManufacturers.length} יצרנים
                    </span>
                  </div>
                </div>

                {!isManufacturerSearchOpen ? (
                  <select 
                    value={selectedManufacturer}
                    onChange={handleManufacturerChange}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none appearance-none"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'left 1rem center', backgroundSize: '1em' }}
                  >
                    <option value="ALL">כל היצרנים (סקירה גלובלית)</option>
                    {availableManufacturers.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    <option value="NEW" className="text-indigo-600 font-bold tracking-tight">+ הוסף יצרן חדש...</option>
                  </select>
                ) : (
                  <div className="flex flex-col gap-2">
                    <input 
                      type="text" 
                      placeholder="הזן שם יצרן..."
                      value={customManufacturer}
                      onChange={(e) => setCustomManufacturer(e.target.value)}
                      autoFocus
                      className="w-full bg-white border border-indigo-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                    />
                    <button 
                      onClick={handleSuggest}
                      disabled={!customManufacturer.trim() || status !== AgentStatus.IDLE}
                      className="w-full bg-slate-900 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 shadow-lg"
                    >
                      <i className="fas fa-search"></i>
                      חפש והרחב ב-AI
                    </button>
                  </div>
                )}

                {(showCustomInput && !isManufacturerSearchOpen) && (
                  <div>
                    <input 
                      type="text" 
                      placeholder="שם יצרן ידני..."
                      value={customManufacturer}
                      onChange={(e) => setCustomManufacturer(e.target.value)}
                      className="w-full bg-white border border-indigo-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                    />
                  </div>
                )}
              </div>

              {!isManufacturerSearchOpen && (
                <div className={`space-y-3 transition-opacity duration-300 ${canEditModel ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                  <label className="block text-[10px] font-black text-slate-400 mb-1 uppercase tracking-widest">בחר דגם ספציפי</label>
                  <select 
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    disabled={!canEditModel}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none appearance-none disabled:bg-slate-100 disabled:text-slate-400"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'left 1rem center', backgroundSize: '1em' }}
                  >
                    <option value="ALL">כל הדגמים</option>
                    {availableModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
              )}
              
              {!isManufacturerSearchOpen && (
                <button 
                  onClick={handleSuggest}
                  disabled={status !== AgentStatus.IDLE}
                  className="w-full flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3.5 rounded-2xl font-bold transition-all disabled:opacity-50 shadow-xl shadow-indigo-100"
                >
                  <i className="fas fa-bolt"></i>
                  הרץ הרחבה חכמה
                </button>
              )}
            </div>
          </section>

          {/* Table Filters (Facets) */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-5">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">סינוני מאגר</h2>
              <button 
                onClick={clearFilters}
                className="text-[10px] font-bold text-rose-500 hover:text-rose-600"
              >
                נקה הכל
              </button>
            </div>

            <div className="space-y-6">
              {/* Year Facet */}
              <div className="space-y-3">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">טווח שנים: {filterYearRange[0]} - {filterYearRange[1]}</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="range" 
                    min="1950" 
                    max="2025" 
                    value={filterYearRange[0]}
                    onChange={(e) => setFilterYearRange([parseInt(e.target.value), filterYearRange[1]])}
                    className="w-full accent-indigo-600 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                  />
                  <input 
                    type="range" 
                    min="1950" 
                    max="2025" 
                    value={filterYearRange[1]}
                    onChange={(e) => setFilterYearRange([filterYearRange[0], parseInt(e.target.value)])}
                    className="w-full accent-indigo-600 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                <div className="flex justify-between text-[10px] font-bold text-slate-400 px-1">
                  <span>1950</span>
                  <span>2025</span>
                </div>
              </div>

              {/* Manufacturer Facet */}
              <div className="space-y-3">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">פילטר יצרנים</label>
                <div className="max-h-56 overflow-y-auto space-y-1 pr-1 scrollbar-thin scrollbar-thumb-slate-200">
                  {Object.entries(manufacturerCounts)
                    .sort((a, b) => Number(b[1]) - Number(a[1]))
                    .map(([m, count]) => (
                    <button 
                      key={m}
                      onClick={() => toggleFilterManufacturer(m)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-all border ${filterManufacturers.includes(m) ? 'bg-indigo-600 border-indigo-600 text-white font-bold shadow-md' : 'bg-slate-50 border-transparent text-slate-600 hover:bg-slate-100'}`}
                    >
                      <span>{m}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${filterManufacturers.includes(m) ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-500 font-bold'}`}>
                        {count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Activity Log */}
          <section className="bg-slate-900 rounded-2xl shadow-2xl p-5 space-y-4 text-white overflow-hidden border border-slate-800">
             <div className="flex items-center justify-between border-b border-slate-800 pb-3">
               <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                 <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                 לוג פעילות
               </h2>
             </div>
             <div className="h-40 overflow-y-auto font-mono text-[10px] space-y-2 scrollbar-thin scrollbar-thumb-slate-800" dir="ltr">
               {logs.length === 0 ? (
                 <p className="text-slate-700 italic">No activity logs...</p>
               ) : (
                 logs.map((log, idx) => (
                   <p key={idx} className={`${idx === 0 ? 'text-indigo-400' : 'text-slate-500'}`}>
                     {log}
                   </p>
                 ))
               )}
             </div>
          </section>
        </div>

        {/* Main Content Area */}
        <div className="lg:col-span-3 flex flex-col min-h-0">
          {status === AgentStatus.READY_FOR_EXPANSION ? (
            <div className="bg-white rounded-3xl shadow-2xl border border-indigo-100 overflow-hidden flex flex-col h-full">
              <div className="bg-indigo-600 px-8 py-5 flex items-center justify-between text-white shadow-lg">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                    <i className="fas fa-magic text-xl"></i>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">הצעות הרחבה: {showCustomInput ? customManufacturer : selectedManufacturer}</h2>
                    <p className="text-xs text-indigo-100 opacity-80 uppercase tracking-widest font-bold">נמצאו {suggestions.length} רשומות חדשות להטמעה</p>
                  </div>
                </div>
                <button 
                  onClick={() => { setSuggestions([]); setStatus(AgentStatus.IDLE); }}
                  className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
              
              <div className="overflow-auto flex-1 p-6">
                <table className="w-full text-right border-separate border-spacing-y-2">
                  <thead>
                    <tr className="text-slate-400 text-[10px] font-black uppercase tracking-widest">
                      <th className="px-6 py-2">יצרן</th>
                      <th className="px-6 py-2">דגם</th>
                      <th className="px-6 py-2">דור</th>
                      <th className="px-6 py-2">קוד שלדה</th>
                      <th className="px-6 py-2 text-center">שנים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.map((s, idx) => (
                      <tr key={`suggestion-${idx}`} className="bg-slate-50 hover:bg-indigo-50 transition-all rounded-2xl">
                        <td className="px-6 py-4 font-black text-xs uppercase text-indigo-700 first:rounded-r-2xl">{s.Manufacturer}</td>
                        <td className="px-6 py-4 font-bold text-slate-900">{s.Model}</td>
                        <td className="px-6 py-4 text-slate-600 font-medium">{s.Generation}</td>
                        <td className="px-6 py-4 font-mono text-indigo-600 text-sm">{s.Model_Code}</td>
                        <td className="px-6 py-4 last:rounded-l-2xl text-center">
                          <span className="bg-white border border-slate-200 text-slate-700 text-[10px] px-3 py-1 rounded-full font-bold shadow-sm">
                            {s.Start_Year} - {s.End_Year}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-8 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <div className="text-slate-500 text-sm font-medium">
                  אישור יוסיף את הרשומות וישמור אותן בזיכרון המערכת לצמיתות.
                </div>
                <div className="flex gap-4">
                  <button 
                    onClick={() => { setSuggestions([]); setStatus(AgentStatus.IDLE); }}
                    className="px-8 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-200 transition-colors"
                  >
                    ביטול
                  </button>
                  <button 
                    onClick={confirmAddition}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-3 rounded-xl font-bold shadow-xl shadow-indigo-100 transition-all transform hover:scale-105"
                  >
                    אשר והטמע נתונים
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full">
              {/* Top Bar for Table */}
              <div className="px-6 py-5 border-b border-slate-100 flex flex-col gap-4 bg-slate-50/50 relative z-30">
                <div className="flex items-center justify-between">
                  <div className="relative flex-1 max-w-lg">
                    <i className="fas fa-search absolute right-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input 
                      type="text" 
                      placeholder="חיפוש חופשי (יצרן, דגם, שלדה)..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pr-12 pl-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-sm"
                    />
                  </div>
                  
                  <div className="flex items-center gap-6">
                    {(filterManufacturers.length > 0 || searchTerm !== '' || filterYearRange[0] > 1950) && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-indigo-500 uppercase">פילטר פעיל</span>
                        <button onClick={clearFilters} className="w-5 h-5 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center text-[8px] hover:bg-indigo-100">
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                    )}
                    <div className="h-10 w-px bg-slate-200"></div>
                    
                    {/* Selected Count label precisely next to Total Found */}
                    {selectedRowKeys.size > 0 && (
                      <div className="text-right ml-4" dir="ltr">
                        <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest leading-none mb-1">Selected</p>
                        <p className="text-xl font-black text-rose-600 leading-none">{selectedRowKeys.size}</p>
                      </div>
                    )}

                    <div className="text-left" dir="ltr">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Total Found</p>
                      <p className="text-xl font-black text-indigo-600 leading-none">{filteredData.length}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Data Table */}
              <div className="overflow-auto flex-1 scrollbar-thin scrollbar-thumb-slate-200 p-2 relative z-10">
                {filteredData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-300 py-20">
                    <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                      <i className="fas fa-filter text-4xl opacity-20"></i>
                    </div>
                    <p className="text-lg font-bold text-slate-400">אין תוצאות התואמות לסינון</p>
                    <button onClick={clearFilters} className="text-indigo-500 font-bold mt-2 hover:underline">נקה פילטרים</button>
                  </div>
                ) : (
                  <div className="h-full flex flex-col justify-between">
                    <div className="overflow-auto">
                      <table className="w-full text-right border-separate border-spacing-y-0.5">
                        <thead className="sticky top-0 z-20 bg-white shadow-sm">
                          <tr className="text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                            <th className="px-6 py-4 w-10 text-center">
                              <input 
                                type="checkbox"
                                checked={allOnPageSelected}
                                onChange={handleToggleSelectPage}
                                className="w-4 h-4 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                            </th>
                            <th className="px-6 py-4">יצרן</th>
                            <th className="px-6 py-4">דגם</th>
                            <th className="px-6 py-4">דור</th>
                            <th className="px-6 py-4">קוד שלדה</th>
                            <th className="px-6 py-4 text-center">שנת התחלה</th>
                            <th className="px-6 py-4 text-center">שנת סיום</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {paginatedData.map((v) => {
                            const key = getRecordKey(v);
                            const isSelected = selectedRowKeys.has(key);
                            return (
                              <tr key={key} className={`hover:bg-slate-50/80 transition-colors group ${isSelected ? 'bg-indigo-50/40' : ''}`}>
                                <td className="px-6 py-5 text-center">
                                  <input 
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => handleToggleRow(key)}
                                    className="w-4 h-4 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                  />
                                </td>
                                <td className="px-6 py-5">
                                  <span className="inline-block px-3 py-1 bg-slate-900 text-white text-[10px] font-black uppercase rounded-lg tracking-widest">
                                    {v.Manufacturer}
                                  </span>
                                </td>
                                <td className="px-6 py-5 font-bold text-slate-800 text-base">{v.Model}</td>
                                <td className="px-6 py-5 text-slate-500 font-medium text-sm">{v.Generation}</td>
                                <td className="px-6 py-5 text-indigo-600 font-mono text-sm font-bold bg-indigo-50/20 rounded-md">{v.Model_Code}</td>
                                <td className="px-6 py-5 text-center font-bold text-slate-600">{v.Start_Year}</td>
                                <td className="px-6 py-5 text-center font-bold text-slate-600">{v.End_Year}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                          מציג {startRange} - {endRange}
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => setCurrentPage((prev: number) => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-indigo-600 hover:text-white disabled:opacity-40 transition-all"
                          >
                            <i className="fas fa-chevron-right text-[10px]"></i>
                          </button>
                          <span className="px-4 text-sm font-black text-slate-600">{currentPage} / {totalPages}</span>
                          <button 
                            onClick={() => setCurrentPage((prev: number) => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-indigo-600 hover:text-white disabled:opacity-40 transition-all"
                          >
                            <i className="fas fa-chevron-left text-[10px]"></i>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Global Status Overlays */}
      {(status === AgentStatus.ANALYZING || status === AgentStatus.UPDATING) && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[200] flex items-center justify-center p-6 text-center">
          <div className="bg-white rounded-[2.5rem] p-12 max-w-sm w-full shadow-2xl space-y-8 border border-slate-100">
            <div className="relative w-28 h-28 mx-auto">
              <div className="absolute inset-0 border-[6px] border-slate-50 rounded-full"></div>
              <div className="absolute inset-0 border-[6px] rounded-full border-t-transparent animate-spin border-indigo-600"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <i className="fas fa-brain text-3xl text-indigo-600"></i>
              </div>
            </div>
            <div className="space-y-3">
              <h3 className="text-2xl font-black text-slate-900">
                {status === AgentStatus.ANALYZING ? 'מנתח נתונים...' : 'מעדכן מאגר...'}
              </h3>
              <p className="text-sm text-slate-500 font-medium">הסוכן החכם בודק מידע גלובלי ומכין את התוצאות.</p>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-slate-100 px-8 py-3 flex items-center justify-between">
        <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.3em]">
          AUTO-DATA AGENT ENGINE v2.2.9 • STABLE INTERACTION REPAIRED
        </p>
        <div className="flex gap-4 text-slate-300">
          <i className="fab fa-react"></i>
          <i className="fas fa-microchip"></i>
          <i className="fab fa-google"></i>
        </div>
      </footer>
    </div>
  );
};

export default App;
