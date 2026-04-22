/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, AnimatePresence } from "motion/react";
import { Mic, GraduationCap, Trophy, LayoutDashboard, Database, User, BookOpen, Search, ChevronRight, TrendingUp, CheckCircle2, AlertCircle, FileSpreadsheet, Plus, X, Settings2, Download, ArrowLeft } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import * as XLSX from 'xlsx';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, query, where, orderBy, limit, serverTimestamp, Timestamp, onSnapshot } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

type AppState = 'SETUP' | 'ENTRY' | 'RANKING';

interface Student {
  id: string;
  name: string;
  registration: string;
}

interface ExamEntry {
  studentId: string;
  scores: number[];
  total: number;
}

export default function App() {
  const [appState, setAppState] = useState<AppState>(() => (localStorage.getItem('app_state') as AppState) || 'SETUP');
  const [discipline, setDiscipline] = useState(() => localStorage.getItem('last_discipline') || "");
  const [professor, setProfessor] = useState(() => localStorage.getItem('last_professor') || "");
  const [questionCount, setQuestionCount] = useState(() => Number(localStorage.getItem('last_qcount')) || 5);
  
  useEffect(() => {
    localStorage.setItem('app_state', appState);
  }, [appState]);

  useEffect(() => {
    localStorage.setItem('last_discipline', discipline);
  }, [discipline]);

  useEffect(() => {
    localStorage.setItem('last_professor', professor);
  }, [professor]);

  useEffect(() => {
    localStorage.setItem('last_qcount', questionCount.toString());
  }, [questionCount]);

  const [students, setStudents] = useState<Student[]>([]);
  const [examEntries, setExamEntries] = useState<Record<string, ExamEntry>>(() => {
    try {
      const saved = localStorage.getItem('current_exam_entries');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem('current_exam_entries', JSON.stringify(examEntries));
  }, [examEntries]);

  const examEntriesRef = useRef<Record<string, ExamEntry>>(examEntries);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [historicalEntries, setHistoricalEntries] = useState<any[]>([]);
  const [allHistoricalScores, setAllHistoricalScores] = useState<Record<string, number[]>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [sessionId, setSessionId] = useState(() => localStorage.getItem('current_session_id') || "");

  useEffect(() => {
    localStorage.setItem('current_session_id', sessionId);
  }, [sessionId]);

  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<any>(null);
  const selectedStudentIdRef = useRef<string | null>(null);
  const questionCountRef = useRef<number>(5);
  const isActiveRef = useRef(false);

  // Fetch Current Session Status from Firestore
  useEffect(() => {
    const restoreSession = async () => {
      // If we have a session ID and matching metadata, ensure we have the latest server data
      if (sessionId && appState === 'ENTRY' && discipline && professor) {
        try {
          const q = query(
            collection(db, "exam_entries"),
            where("discipline", "==", discipline.trim()),
            where("professor", "==", professor.trim()),
            where("sessionId", "==", sessionId)
          );
          const querySnapshot = await getDocs(q);
          const serverMap: Record<string, ExamEntry> = {};
          querySnapshot.forEach(doc => {
            const data = doc.data();
            serverMap[data.studentId] = {
              studentId: data.studentId,
              scores: data.scores,
              total: data.total
            };
          });
          
          // Merge server data with local data (server wins for conflicts)
          setExamEntries(prev => {
            const merged = { ...prev, ...serverMap };
            examEntriesRef.current = merged;
            return merged;
          });
        } catch (e) {
          console.error("Error restoring session from server:", e);
        }
      }
    };
    restoreSession();
  }, [sessionId, appState]);

  const [syncStatus, setSyncStatus] = useState<'IDLE' | 'SYNCING' | 'ERROR'>('IDLE');

  // Persistence: Real-time sync for students
  const refreshStudents = async () => {
    setSyncStatus('SYNCING');
    try {
      const q = query(collection(db, "students"));
      const querySnapshot = await getDocs(q);
      const fetched: Student[] = [];
      querySnapshot.forEach((doc) => {
        fetched.push(doc.data() as Student);
      });
      fetched.sort((a, b) => a.name.localeCompare(b.name));
      setStudents(fetched);
      setSyncStatus('IDLE');
    } catch (e) {
      console.error("Error refreshing students:", e);
      setSyncStatus('ERROR');
    }
  };

  useEffect(() => {
    const q = query(collection(db, "students"));
    setSyncStatus('SYNCING');
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const fetched: Student[] = [];
      querySnapshot.forEach((doc) => {
        fetched.push(doc.data() as Student);
      });
      fetched.sort((a, b) => a.name.localeCompare(b.name));
      setStudents(fetched);
      setSyncStatus('IDLE');
    }, (error) => {
      console.error("Error listening to students:", error);
      setSyncStatus('ERROR');
      // Fallback on error
      refreshStudents();
    });
    return () => unsubscribe();
  }, []);

  // Fetch all historical scores for the sidebar summary
  useEffect(() => {
    const fetchAllHistory = async () => {
      if (appState === 'ENTRY' && discipline && professor) {
        try {
          const q = query(
            collection(db, "exam_entries"),
            where("discipline", "==", discipline.trim()),
            where("professor", "==", professor.trim())
          );
          const querySnapshot = await getDocs(q);
          const allEntries: any[] = [];
          querySnapshot.forEach(doc => {
            allEntries.push({ id: doc.id, ...doc.data() });
          });

          // Sort in memory to avoid mandatory composite index
          allEntries.sort((a, b) => {
            const timeA = a.updatedAt?.seconds || 0;
            const timeB = b.updatedAt?.seconds || 0;
            return timeB - timeA;
          });

          const summary: Record<string, number[]> = {};
          allEntries.forEach(data => {
            if (!summary[data.studentId]) {
              summary[data.studentId] = [];
            }
            if (summary[data.studentId].length < 6) {
              summary[data.studentId].push(data.total);
            }
          });
          setAllHistoricalScores(summary);
        } catch (e) {
          console.error("Error fetching all history summary:", e);
        }
      }
    };
    fetchAllHistory();
  }, [appState, discipline, professor]);

  // Fetch History for selected student
  useEffect(() => {
    const fetchHistory = async () => {
      if (selectedStudentId && discipline && professor) {
        try {
          const q = query(
            collection(db, "exam_entries"),
            where("studentId", "==", selectedStudentId),
            where("discipline", "==", discipline.trim()),
            where("professor", "==", professor.trim())
          );
          const querySnapshot = await getDocs(q);
          const entries: any[] = [];
          querySnapshot.forEach(doc => {
            entries.push({ id: doc.id, ...doc.data() });
          });

          // Sort in memory to avoid index requirement
          entries.sort((a, b) => {
            const timeA = a.updatedAt?.seconds || 0;
            const timeB = b.updatedAt?.seconds || 0;
            return timeB - timeA;
          });

          setHistoricalEntries(entries.slice(0, 6));
        } catch (e) {
          console.error("Error fetching history:", e);
          setHistoricalEntries([]);
        }
      } else {
        setHistoricalEntries([]);
      }
    };
    fetchHistory();
  }, [selectedStudentId, discipline, professor]);

  // Sync refs with state
  useEffect(() => {
    selectedStudentIdRef.current = selectedStudentId;
  }, [selectedStudentId]);

  useEffect(() => {
    questionCountRef.current = questionCount;
  }, [questionCount]);

  useEffect(() => {
    examEntriesRef.current = examEntries;
  }, [examEntries]);

  // Initializing speech recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition && !recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'pt-BR';

      recognition.onresult = (event: any) => {
        let fullTranscript = "";
        for (let i = 0; i < event.results.length; i++) {
          fullTranscript += event.results[i][0].transcript;
        }
        setTranscript(fullTranscript);
        handleVoiceInput(fullTranscript);
      };

      recognition.onstart = () => {
        isActiveRef.current = true;
        setIsRecording(true);
      };

      recognition.onend = () => {
        isActiveRef.current = false;
        setIsRecording(false);
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error handle:", event.error);
        isActiveRef.current = false;
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }

    return () => {
        if (recognitionRef.current) {
            try {
              recognitionRef.current.abort();
            } catch (e) {}
        }
    };
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) return;

    if (isActiveRef.current) {
      recognitionRef.current.stop();
    } else {
      setTranscript("");
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error("Speech recognition start failed:", e);
      }
    }
  };

  const handleVoiceInput = (text: string) => {
    const studentId = selectedStudentIdRef.current;
    if (!studentId) return;

    const lowerText = text.toLowerCase();
    const qCount = questionCountRef.current;
    
    // Use ref to avoid stale closure from initial mount
    const currentEntries = examEntriesRef.current;
    const entry = currentEntries[studentId] || { studentId, scores: new Array(qCount).fill(0), total: 0 };
    const newScores = [...entry.scores];
    let changed = false;

    // Mapping of spoken numbers to values
    const wordToValue: Record<string, number> = {
      "zero": 0, "nulo": 0, "nada": 0, "nula": 0,
      "meio": 0.5, "metade": 0.5, "meia": 0.5, "meio ponto": 0.5,
      "um": 1, "hum": 1, "uma": 1, "um ponto": 1,
      "dois": 2, "duas": 2, "dois pontos": 2,
      "três": 3, "tres": 3, "três pontos": 3,
      "quatro": 4, "cinco": 5, "seis": 6, "sete": 7, "oito": 8, "nove": 9, "dez": 10,
      "setenta e cinco": 0.75, "vinte e cinco": 0.25, "setenta": 0.7, "vinte": 0.2,
      "cinquenta": 0.5, "setenta e 5": 0.75, "vinte e 5": 0.25, "0.5": 0.5, "0.75": 0.75, "0.25": 0.25
    };

    const qNumToWord: Record<number, string[]> = {
      1: ["1", "um", "uma"],
      2: ["2", "dois", "duas"],
      3: ["3", "três", "tres"],
      4: ["4", "quatro"],
      5: ["5", "cinco"],
      6: ["6", "seis"],
      7: ["7", "sete"],
      8: ["8", "oito"],
      9: ["9", "nove"],
      10: ["10", "dez"],
      11: ["11", "onze"],
      12: ["12", "doze"],
      13: ["13", "treze"],
      14: ["14", "quatorze", "catorze"],
      15: ["15", "quinze"],
      16: ["16", "dezesseis"],
      17: ["17", "dezessete"],
      18: ["18", "dezoito"],
      19: ["19", "dezenove"],
      20: ["20", "vinte"]
    };

    // Regex for: (q|questão) (número) (é|nota|vale) (valor)
    for (let i = 1; i <= qCount; i++) {
        let lastPos = -1;
        let finalScore = newScores[i-1];

        // Try word-based question numbers
        const aliases = qNumToWord[i] || [i.toString()];
        aliases.forEach(alias => {
            // Check for digit values like "questão um 0.5" or "questão 1 0.5"
            const mixedRegex = new RegExp(`(q|questão|pergunta)\\s*\\b${alias}\\b[^\\d]*(\\d+[.,]?\\d*)`, 'gi');
            const matches = Array.from(lowerText.matchAll(mixedRegex));
            matches.forEach(m => {
                if (m.index! > lastPos) {
                    const val = parseFloat(m[2].replace(',', '.'));
                    if (!isNaN(val)) {
                        finalScore = val;
                        lastPos = m.index!;
                        changed = true;
                    }
                }
            });

            // Check for word values like "questão um meio"
            Object.entries(wordToValue).forEach(([word, val]) => {
                const patterns = [
                    `questão ${alias} ${word}`,
                    `questão ${alias} nota ${word}`,
                    `questão ${alias} vale ${word}`,
                    `questão ${alias} foi ${word}`,
                    `q${alias} ${word}`,
                    `q${alias} nota ${word}`,
                    `q${alias} vale ${word}`,
                    `pergunta ${alias} ${word}`
                ];
                
                patterns.forEach(pattern => {
                    const foundIndex = lowerText.lastIndexOf(pattern);
                    if (foundIndex !== -1 && foundIndex > lastPos) {
                        finalScore = val;
                        lastPos = foundIndex;
                        changed = true;
                    }
                });
            });
        });

        if (changed) {
            newScores[i-1] = finalScore;
        }
    }

    if (changed) {
      setExamEntries(prev => {
        const currentEntry = prev[studentId] || { studentId, scores: new Array(qCount).fill(0), total: 0 };
        const total = newScores.reduce((a, b) => a + Number(b), 0);
        const entryToSave = { ...currentEntry, scores: newScores, total };
        const updated = {
            ...prev,
            [studentId]: entryToSave
        };
        // Background save with fresh data
        saveStudentEntry(studentId, entryToSave);
        return updated;
      });
    }
  };

  const addStudent = async (name: string, reg: string) => {
    if (!name) return;
    const sId = Date.now().toString();
    const newStudent = { id: sId, name, registration: reg };
    
    try {
      await setDoc(doc(db, "students", sId), newStudent);
      // Removed setStudents(prev => [...prev, newStudent]) because onSnapshot handles this automatically.
      // This prevents duplicate key warnings (identity mismatch) during real-time sync.
      setSelectedStudentId(sId);
    } catch (e) {
      console.error("Error adding student:", e);
    }
  };

  const updateManualScore = (qIndex: number, val: number) => {
    if (!selectedStudentId) return;
    const currentEntry = examEntries[selectedStudentId] || { studentId: selectedStudentId, scores: new Array(questionCount).fill(0), total: 0 };
    const newScores = [...currentEntry.scores];
    newScores[qIndex] = val;
    const total = newScores.reduce((a, b) => a + Number(b), 0);
    const updatedEntry = { ...currentEntry, scores: newScores, total };
    
    setExamEntries(prev => {
      const updated = {
        ...prev,
        [selectedStudentId]: updatedEntry
      };
      return updated;
    });

    // Background save with fresh data
    saveStudentEntry(selectedStudentId, updatedEntry);
  };

  const sanitizeId = (text: string) => text.trim().replace(/[\/\s]+/g, '_');

  const saveStudentEntry = async (sId: string, manualEntry?: ExamEntry) => {
    const entry = manualEntry || examEntries[sId];
    if (!entry) return;

    setIsSaving(true);
    try {
      // Use a consistent ID for the CURRENT session, but globally unique across days/sessions
      const entryId = `${sId}_${sanitizeId(discipline)}_${sanitizeId(professor)}_${sessionId}`;
      await setDoc(doc(db, "exam_entries", entryId), {
        ...entry,
        discipline: discipline.trim(),
        professor: professor.trim(),
        sessionId: sessionId,
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      console.error("Error saving student entry:", e);
    } finally {
      setIsSaving(false);
    }
  };

  const finalizeSession = async () => {
    setIsSaving(true);
    try {
      const promises = Object.values(examEntries).map(async (entry) => {
        const entryId = `${entry.studentId}_${sanitizeId(discipline)}_${sanitizeId(professor)}_${sessionId}`;
        return setDoc(doc(db, "exam_entries", entryId), {
          ...entry,
          discipline: discipline.trim(),
          professor: professor.trim(),
          sessionId: sessionId,
          updatedAt: serverTimestamp()
        });
      });
      await Promise.all(promises);
      setAppState('RANKING');
    } catch (e) {
      console.error("Error saving exam entries:", e);
      setAppState('RANKING');
    } finally {
      setIsSaving(false);
    }
  };

  const exportToExcel = () => {
    const sortedRanking = Object.values(examEntries)
      .map(entry => {
        const student = students.find(s => s.id === entry.studentId);
        return {
          Nome: student?.name || "Desconhecido",
          Matrícula: student?.registration || "-",
          ...entry.scores.reduce((acc, score, idx) => ({ ...acc, [`Q${idx+1}`]: score }), {}),
          Total: entry.total,
          Situação: entry.total >= (questionCount * 0.6) ? "APROVADO" : "REPROVADO"
        };
      })
      .sort((a, b) => b.Total - a.Total);

    if (sortedRanking.length === 0) {
        alert("Nenhum dado para exportar!");
        return;
    }

    const wb = XLSX.utils.book_new();
    
    // Sheet 1: Lansamento
    const wsLaunch = XLSX.utils.json_to_sheet(sortedRanking);
    XLSX.utils.book_append_sheet(wb, wsLaunch, "Lançamento");

    // Sheet 2: Ranking
    const wsRanking = XLSX.utils.json_to_sheet(sortedRanking);
    XLSX.utils.book_append_sheet(wb, wsRanking, "Ranking");

    XLSX.writeFile(wb, `Correcao_${discipline || 'Exame'}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-[#0F1115] text-[#E0E2E6] font-sans flex flex-col selection:bg-indigo-500/30">
      {/* Dynamic Header */}
      <header className="p-6 border-b border-gray-800 flex justify-between items-center bg-[#0F1115]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-indigo-500/20">
            <GraduationCap size={28} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tighter text-white uppercase italic">IGP EDU V2.0</h1>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Digital Exam Management System</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {appState !== 'SETUP' && (
            <button 
              onClick={() => setAppState('SETUP')}
              className="p-2.5 rounded-xl bg-gray-900 border border-gray-800 text-gray-400 hover:text-white transition-all"
            >
              <Settings2 size={18} />
            </button>
          )}
          <div className="hidden sm:flex px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{discipline || "Configurando..."}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col p-6">
        <AnimatePresence mode="wait">
          {appState === 'SETUP' && (
            <motion.div 
              key="setup"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="max-w-xl mx-auto w-full space-y-8 py-12"
            >
              <div className="text-center space-y-2">
                <h2 className="text-4xl font-black text-white tracking-tighter uppercase italic">Nova Correção</h2>
                <p className="text-gray-500 font-medium">Configure a disciplina e os parâmetros da prova.</p>
              </div>

              <div className="bg-[#1A1D24] p-8 rounded-3xl border border-gray-800 shadow-2xl space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest">Matéria / Disciplina</label>
                    <input 
                      type="text" 
                      value={discipline}
                      onChange={(e) => setDiscipline(e.target.value)}
                      placeholder="Ex: Inteligência Artificial"
                      className="w-full bg-[#12141A] border border-gray-800 rounded-2xl px-5 py-4 focus:outline-none focus:border-indigo-500 transition-all font-bold"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest">Professor / Responsável</label>
                    <input 
                      type="text" 
                      value={professor}
                      onChange={(e) => setProfessor(e.target.value)}
                      placeholder="Nome do Docente"
                      className="w-full bg-[#12141A] border border-gray-800 rounded-2xl px-5 py-4 focus:outline-none focus:border-indigo-500 transition-all font-bold"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-gray-800/50">
                    <span className="text-[10px] font-black text-gray-600 uppercase tracking-widest flex items-center gap-2">
                      <Database size={10} /> Sincronização de Alunos
                    </span>
                    <div className="flex items-center gap-2">
                       {syncStatus === 'SYNCING' && <span className="text-[10px] font-bold text-yellow-500 animate-pulse">Sincronizando...</span>}
                       {syncStatus === 'ERROR' && (
                         <button onClick={refreshStudents} className="text-[10px] font-bold text-red-500 underline flex items-center gap-1">
                           <AlertCircle size={10} /> Falha (Refazer)
                         </button>
                       )}
                       {syncStatus === 'IDLE' && <span className="text-[10px] font-bold text-emerald-500 flex items-center gap-1"><CheckCircle2 size={10} /> {students.length} Alunos Carregados</span>}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest">Quantidade de Questões (Q1 ... QN)</label>
                    <div className="flex items-center gap-4">
                      <input 
                        type="range" min="1" max="20"
                        value={questionCount}
                        onChange={(e) => setQuestionCount(parseInt(e.target.value))}
                        className="flex-1 accent-indigo-500 h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="w-12 h-12 flex items-center justify-center bg-indigo-600 rounded-xl font-black text-xl">{questionCount}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                  <button 
                    onClick={() => {
                      if (discipline) {
                        setExamEntries({});
                        const newSId = Date.now().toString();
                        setSessionId(newSId);
                        localStorage.setItem('current_session_id', newSId);
                        localStorage.setItem('current_exam_entries', '{}');
                        setAppState('ENTRY');
                      }
                    }}
                    disabled={!discipline}
                    className="flex-1 py-5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black rounded-2xl shadow-xl shadow-indigo-900/40 transition-all uppercase tracking-widest flex items-center justify-center gap-3"
                  >
                    Nova Prova <Plus size={20} />
                  </button>
                  {sessionId && discipline && (
                    <button 
                      onClick={() => setAppState('ENTRY')}
                      className="flex-1 py-5 bg-gray-800 hover:bg-gray-700 text-white font-black rounded-2xl border border-gray-700 transition-all uppercase tracking-widest flex items-center justify-center gap-3"
                    >
                      Resumir Atual <TrendingUp size={20} />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {appState === 'ENTRY' && (
            <motion.div 
              key="entry"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full overflow-hidden"
            >
              {/* Left Column: Student Selection */}
              <div className="lg:col-span-4 flex flex-col gap-6 overflow-hidden">
                <div className="bg-[#1A1D24] border border-gray-800 rounded-3xl p-6 flex flex-col gap-4 overflow-hidden shadow-xl">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                       <button 
                         onClick={() => setAppState('SETUP')}
                         className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-400 transition-colors"
                         title="Voltar para Configurações"
                       >
                         <ArrowLeft size={16} />
                       </button>
                       <h3 className="text-xs font-black uppercase text-gray-500 tracking-widest">Alunos Inscritos</h3>
                       {syncStatus === 'SYNCING' && <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" title="Sincronizando..." />}
                       {syncStatus === 'ERROR' && (
                         <button onClick={refreshStudents} className="text-red-500 hover:text-red-400" title="Erro na Sincronização. Clique para tentar novamente.">
                           <AlertCircle size={14} />
                         </button>
                       )}
                    </div>
                    <div className="p-1 px-2 bg-indigo-500/10 rounded-lg text-[10px] font-bold text-indigo-400 border border-indigo-500/20 uppercase tracking-tighter">
                      {students.length} Total
                    </div>
                  </div>
                  
                  {/* Student Quick Add */}
                  <div className="space-y-3">
                    <div className="relative">
                      <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
                      <input 
                        type="text" 
                        id="new-student-name"
                        placeholder="Nome do Aluno..."
                        className="w-full bg-[#12141A] border border-gray-800 rounded-xl pl-9 pr-3 py-3 text-xs focus:outline-none focus:border-indigo-500 transition-all font-bold text-white shadow-inner"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const input = e.currentTarget;
                            const regInput = document.getElementById('new-student-reg') as HTMLInputElement;
                            addStudent(input.value, regInput.value);
                            input.value = "";
                            regInput.value = "";
                          }
                        }}
                      />
                    </div>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        id="new-student-reg"
                        placeholder="Matrícula"
                        className="flex-1 bg-[#12141A] border border-gray-800 rounded-xl px-3 py-3 text-xs focus:outline-none focus:border-indigo-500 transition-all font-bold text-white shadow-inner"
                      />
                      <button 
                        onClick={() => {
                          const nameInput = document.getElementById('new-student-name') as HTMLInputElement;
                          const regInput = document.getElementById('new-student-reg') as HTMLInputElement;
                          addStudent(nameInput.value, regInput.value);
                          nameInput.value = "";
                          regInput.value = "";
                        }}
                        className="p-3 bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all text-white"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2 pr-2">
                    {students.map(s => (
                      <button 
                        key={s.id}
                        onClick={() => setSelectedStudentId(s.id)}
                        className={`w-full p-4 rounded-2xl border transition-all flex justify-between items-center group ${selectedStudentId === s.id ? 'bg-indigo-600 border-indigo-500 shadow-lg shadow-indigo-900/20' : 'bg-[#12141A]/50 border-gray-800 hover:border-gray-700'}`}
                      >
                        <div className="text-left flex-1 min-w-0 pr-2 py-0.5">
                          <div className="flex flex-col gap-1.5">
                            <p className={`text-xs font-black uppercase truncate ${selectedStudentId === s.id ? 'text-white' : 'text-gray-300'}`}>{s.name}</p>
                            <div className="flex flex-wrap gap-1 overflow-hidden">
                              {allHistoricalScores[s.id]?.map((score, idx) => (
                                <span key={idx} className={`text-[8px] font-black px-1 rounded ${selectedStudentId === s.id ? 'bg-white/20 text-indigo-100' : 'bg-indigo-500/10 text-indigo-400/60'}`}>
                                  {score.toFixed(2)}
                                </span>
                              ))}
                            </div>
                          </div>
                          <p className={`text-[10px] mt-1 font-bold ${selectedStudentId === s.id ? 'text-indigo-200/60' : 'text-gray-600'}`}>{s.registration || "—"}</p>
                        </div>
                        {examEntries[s.id] && (
                          <div className={`px-2 py-1 rounded text-[10px] font-black ${selectedStudentId === s.id ? 'bg-white/20 text-white' : 'bg-indigo-500/10 text-indigo-400'}`}>
                            {examEntries[s.id].total.toFixed(2)}
                          </div>
                        )}
                        <ChevronRight size={14} className={selectedStudentId === s.id ? 'text-white' : 'text-gray-700'} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Center Column: Entry Engine */}
              <div className="lg:col-span-8 flex flex-col gap-6 h-full">
                <div className="bg-[#1A1D24] border border-gray-800 rounded-3xl p-6 sm:p-8 flex flex-col gap-6 overflow-y-auto custom-scrollbar shadow-xl relative h-full">
                  {!selectedStudentId ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center space-y-8 p-12">
                      <div className="space-y-4 opacity-50">
                        <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center text-gray-600 mx-auto">
                          <User size={32} />
                        </div>
                        <p className="text-sm font-bold text-gray-500 uppercase tracking-widest">Selecione um aluno para lançar notas</p>
                      </div>
                      
                      {Object.keys(examEntries).length > 0 && (
                        <button 
                          onClick={finalizeSession}
                          className="px-12 py-5 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl shadow-xl shadow-indigo-900/40 transition-all uppercase tracking-widest flex items-center justify-center gap-3"
                        >
                          Encerrar Prova e Ver Ranking <TrendingUp size={20} />
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-center flex-shrink-0 gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-10 h-10 bg-indigo-600/20 text-indigo-400 rounded-xl flex items-center justify-center flex-shrink-0">
                            <BookOpen size={20} />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-sm font-black text-white uppercase tracking-tight truncate">
                              {students.find(s => s.id === selectedStudentId)?.name}
                            </h3>
                            <p className="text-[10px] text-indigo-400 font-black uppercase tracking-widest truncate">Matrícula: {students.find(s => s.id === selectedStudentId)?.registration || "—"}</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest whitespace-nowrap">Nota Atual</p>
                          <p className="text-4xl font-black text-white italic">{(examEntries[selectedStudentId]?.total || 0).toFixed(2)}</p>
                        </div>
                      </div>

                      {/* Historical Entries Timeline */}
                      {historicalEntries.length > 0 && (
                        <div className="bg-[#12141A] border border-indigo-500/20 rounded-2xl p-4 space-y-3 flex-shrink-0">
                          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                             <Database size={10} /> Histórico de Notas ({discipline})
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                            {historicalEntries.map((hist, i) => (
                              <div key={hist.id} className="bg-[#1A1D24] border border-gray-800 rounded-xl p-3">
                                <p className="text-[9px] font-bold text-gray-600 uppercase">
                                  {hist.updatedAt?.toDate ? hist.updatedAt.toDate().toLocaleDateString() : 'Recent'}
                                </p>
                                <p className="text-lg font-black text-indigo-400 italic">{hist.total.toFixed(2)}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Manual Entry Grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 overflow-y-auto custom-scrollbar pr-2 pb-4">
                        {Array.from({ length: questionCount }).map((_, idx) => {
                          const currentScore = examEntries[selectedStudentId]?.scores[idx] || 0;
                          return (
                            <div key={idx} className="bg-[#12141A] border border-gray-800 rounded-2xl p-4 flex flex-col gap-3 group hover:border-indigo-500/50 transition-all">
                              <span className="text-[10px] font-black text-gray-600 uppercase tracking-widest">Questão {idx + 1}</span>
                              <div className="flex flex-col gap-2">
                                <div className="text-xl font-bold text-indigo-400 font-mono tracking-tighter">
                                  {currentScore.toFixed(2)}
                                </div>
                                <div className="grid grid-cols-3 gap-1">
                                  {[1.0, 0.75, 0.5, 0.25, 0].map(v => (
                                    <button 
                                      key={v}
                                      onClick={() => updateManualScore(idx, v)}
                                      className={`text-[9px] font-bold p-1 rounded border transition-all ${currentScore === v ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-500 hover:bg-gray-700'}`}
                                    >
                                      {v.toFixed(2)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Voice Interface */}
                      <div className="mt-auto pt-6 border-t border-gray-800 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <motion.div 
                          onClick={toggleRecording}
                          whileHover={{ scale: 1.02 }}
                          className={`p-6 rounded-2xl border-2 border-dashed flex items-center gap-6 cursor-pointer transition-all ${isRecording ? 'bg-red-500/5 border-red-500/30' : 'bg-[#12141A] border-gray-800 hover:border-indigo-500/40'}`}
                        >
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg ${isRecording ? 'bg-red-500 shadow-red-500/20 animate-pulse' : 'bg-indigo-600 shadow-indigo-600/20'}`}>
                            <Mic size={20} className="text-white" />
                          </div>
                          <div>
                            <p className="text-xs font-black text-white uppercase tracking-tight">{isRecording ? "Capturando Notas..." : "Lançamento por Voz"}</p>
                            <p className="text-[10px] text-gray-500 font-bold">Diga: "Questão 1 valor 0.75"</p>
                          </div>
                        </motion.div>

                        <div className="bg-[#12141A] border border-gray-800 rounded-2xl p-4 flex flex-col justify-center">
                          <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-1">Feed de Voz</p>
                          <p className="text-[10px] font-mono italic text-indigo-400/60 truncate">{transcript || "Aguardando comando..."}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-col sm:flex-row gap-4">
                        <button 
                          onClick={async () => {
                            if (selectedStudentId) {
                              await saveStudentEntry(selectedStudentId);
                            }
                            setSelectedStudentId(null);
                          }}
                          disabled={isSaving}
                          className="flex-1 py-4 bg-gray-800 hover:bg-gray-700 text-white font-black rounded-2xl border border-gray-700 transition-all uppercase tracking-widest flex items-center justify-center gap-3 disabled:opacity-50"
                        >
                          {isSaving ? "Salvando..." : "Confirmar e Salvar (Próximo)"} <ChevronRight size={18} />
                        </button>
                        <button 
                          onClick={finalizeSession}
                          disabled={isSaving}
                          className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl shadow-xl shadow-indigo-900/20 transition-all uppercase tracking-widest flex items-center justify-center gap-3 disabled:opacity-50"
                        >
                          {isSaving ? "Finalizando..." : "Encerrar e Ver Ranking"} <TrendingUp size={18} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {appState === 'RANKING' && (
            <motion.div 
              key="ranking"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-5xl mx-auto w-full h-full flex flex-col gap-8 py-6"
            >
              <div className="flex justify-between items-end">
                <div className="space-y-2">
                  <button 
                    onClick={() => setAppState('ENTRY')}
                    className="flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase hover:text-indigo-400 transition-colors"
                  >
                    <ArrowLeft size={14} /> Voltar para Lançamento
                  </button>
                  <h2 className="text-4xl font-black text-white tracking-tighter uppercase italic">Resultados Finais</h2>
                  <p className="text-gray-500 font-medium">Classificação geral da turma para {discipline}.</p>
                </div>
                <button 
                  onClick={exportToExcel}
                  className="px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-2xl shadow-xl shadow-emerald-900/30 transition-all uppercase tracking-widest flex items-center gap-3"
                >
                  Exportar Planilha <Download size={20} />
                </button>
              </div>

              <div className="bg-[#1A1D24] border border-gray-800 rounded-3xl overflow-hidden shadow-2xl flex-1 flex flex-col">
                <div className="overflow-x-auto overflow-y-auto flex-1 custom-scrollbar">
                  <table className="w-full text-left border-separate border-spacing-0">
                    <thead className="bg-[#12141A] sticky top-0 z-10">
                      <tr>
                        <th className="p-6 text-[10px] font-black uppercase text-gray-500 tracking-widest">Posição</th>
                        <th className="p-6 text-[10px] font-black uppercase text-gray-500 tracking-widest">Estudante</th>
                        <th className="p-6 text-[10px] font-black uppercase text-gray-500 tracking-widest">Matrícula</th>
                        {/* Dynamic Question Columns */}
                        {Array.from({ length: questionCount }).map((_, i) => (
                          <th key={i} className="p-6 text-[10px] font-black uppercase text-gray-500 tracking-widest text-center">Q{i + 1}</th>
                        ))}
                        <th className="p-6 text-[10px] font-black uppercase text-gray-500 tracking-widest text-center">Média Final</th>
                        <th className="p-6 text-[10px] font-black uppercase text-gray-500 tracking-widest text-right">Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.values(examEntries)
                        .sort((a, b) => b.total - a.total)
                        .map((entry, idx) => {
                          const student = students.find(s => s.id === entry.studentId);
                          const isApproved = entry.total >= (questionCount * 0.6);
                          return (
                            <tr key={idx} className="border-b border-gray-800/50 hover:bg-[#12141A]/50 transition-colors group">
                              <td className="p-6 text-2xl font-black text-gray-800 group-hover:text-indigo-500/20 italic font-mono transition-colors">
                                {(idx + 1).toString().padStart(2, '0')}
                              </td>
                              <td className="p-6 font-black uppercase text-gray-300 whitespace-nowrap">{student?.name}</td>
                              <td className="p-6 text-xs text-gray-600 font-mono whitespace-nowrap">{student?.registration || "—"}</td>
                              
                              {/* Dynamic Question Scores */}
                              {Array.from({ length: questionCount }).map((_, qIdx) => (
                                <td key={qIdx} className="p-4 text-center font-bold text-gray-500 text-xs">
                                  {entry.scores[qIdx]?.toFixed(2) || "0.00"}
                                </td>
                              ))}

                              <td className="p-6 text-center">
                                <span className={`text-xl font-black italic ${isApproved ? 'text-indigo-400' : 'text-red-400'}`}>
                                  {entry.total.toFixed(2)}
                                </span>
                              </td>
                              <td className="p-6 text-right">
                                <span className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${isApproved ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                  {isApproved ? 'Aprovado' : 'Reprovado'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  {Object.keys(examEntries).length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center p-20 opacity-20 text-center space-y-4">
                      <AlertCircle size={64} />
                      <p className="text-xs uppercase font-black tracking-[0.3em]">Nenhum dado lançado</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer Info */}
      <footer className="px-8 py-4 border-t border-gray-800 flex justify-between items-center bg-[#12141A]">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${isSaving ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
              {isSaving ? "Salvando no Firebase..." : "Sincronizado com Nuvem"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={12} className="text-indigo-400" />
            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Export: XLSX Supported</span>
          </div>
        </div>
        <div className="text-[9px] font-black text-gray-700 uppercase tracking-widest">
          © 2026 IGP EDU V2.0 • Digital Exam Flow
        </div>
      </footer>
    </div>
  );
}
