
import React, { useState } from 'react';
import { TutorPanel } from './components/TutorPanel';
import { ExamPanel } from './components/ExamPanel';
import type { Exam, ExamResult } from './types';

export default function App() {
  const [difficultyLevel, setDifficultyLevel] = useState(1);
  const [currentExam, setCurrentExam] = useState<Exam | null>(null);
  const [examResult, setExamResult] = useState<ExamResult | null>(null);

  const handleExamComplete = (result: ExamResult, exam: Exam) => {
    setExamResult(result);
    setCurrentExam(exam);
    // Increase difficulty if score is over 70%
    if (result.score > 70) {
      setDifficultyLevel(prev => Math.min(prev + 1, 10)); // Cap difficulty at 10
    }
  };

  const handleNewExam = () => {
    setCurrentExam(null);
    setExamResult(null);
  };

  return (
    <div className="min-h-screen bg-sky-100 font-sans text-slate-800">
      <header className="bg-white shadow-md">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl md:text-3xl font-bold text-sky-600">
            🧠 AI Learning Buddy
          </h1>
          <div className="text-right">
            <p className="text-sm text-slate-500">Current Level</p>
            <p className="text-lg font-bold text-sky-600">{difficultyLevel}</p>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <TutorPanel />
          </div>
          <div className="lg:col-span-2">
            <ExamPanel 
              difficultyLevel={difficultyLevel}
              onExamComplete={handleExamComplete}
              onNewExam={handleNewExam}
              currentExam={currentExam}
              examResult={examResult}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
