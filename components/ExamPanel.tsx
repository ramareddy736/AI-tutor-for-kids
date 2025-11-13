import React, { useState, useEffect, useRef } from 'react';
import { generateExam, gradeExam, generateSpeech } from '../services/geminiService';
import type { Exam, ExamResult, Question } from '../types';
import { CheckCircleIcon, XCircleIcon, SparklesIcon, SpeakerWaveIcon, StopIcon } from './Icons';

interface ExamPanelProps {
  difficultyLevel: number;
  onExamComplete: (result: ExamResult, exam: Exam) => void;
  onNewExam: () => void;
  currentExam: Exam | null;
  examResult: ExamResult | null;
}

// --- Audio Helper Functions ---
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


export const ExamPanel: React.FC<ExamPanelProps> = ({ difficultyLevel, onExamComplete, onNewExam, currentExam, examResult }) => {
  const [localExam, setLocalExam] = useState<Exam | null>(currentExam);
  const [answers, setAnswers] = useState<{ [key: number]: string }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState<number | null>(null);
  const [audioPlaying, setAudioPlaying] = useState<number | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);


  useEffect(() => {
    setLocalExam(currentExam);
  }, [currentExam]);

  const stopCurrentAudio = () => {
    if (audioSourceRef.current) {
        audioSourceRef.current.stop();
        audioSourceRef.current.disconnect();
        audioSourceRef.current = null;
    }
    setAudioPlaying(null);
  };

  useEffect(() => {
    // Cleanup audio context on component unmount
    return () => {
        stopCurrentAudio();
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
        }
    };
  }, []);

  const handlePlayExplanation = async (questionId: number, text: string) => {
    if (audioPlaying === questionId) {
        stopCurrentAudio();
        return;
    }

    stopCurrentAudio(); 

    try {
        setAudioLoading(questionId);
        const audioData = await generateSpeech(text);
        if (!audioData) throw new Error("Failed to generate audio.");

        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        
        const audioContext = audioContextRef.current;
        const decoded = decode(audioData);
        const audioBuffer = await decodeAudioData(decoded, audioContext, 24000, 1);
        const sourceNode = audioContext.createBufferSource();
        
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(audioContext.destination);
        sourceNode.start();

        audioSourceRef.current = sourceNode;
        setAudioPlaying(questionId);

        sourceNode.onended = () => {
            if (audioSourceRef.current === sourceNode) {
                setAudioPlaying(null);
                audioSourceRef.current = null;
            }
        };
    } catch (error) {
        console.error("Error playing explanation:", error);
    } finally {
        setAudioLoading(null);
    }
  };

  const handleGenerateExam = async () => {
    setIsLoading(true);
    stopCurrentAudio();
    onNewExam();
    setAnswers({});
    const newExam = await generateExam(difficultyLevel);
    setLocalExam(newExam);
    setIsLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localExam) return;
    setIsLoading(true);
    const result = await gradeExam(localExam, answers);
    onExamComplete(result, localExam);
    setIsLoading(false);
  };

  const handleAnswerChange = (questionId: number, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const getFeedbackForQuestion = (questionId: number) => {
    return examResult?.feedback.find(f => f.questionId === questionId);
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center h-64">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-sky-500"></div>
          <p className="mt-4 text-slate-600">Working on it...</p>
        </div>
      );
    }

    if (examResult && localExam) {
      return (
        <div>
          <h3 className="text-2xl font-bold mb-4 text-center">Exam Results</h3>
          <div className="bg-sky-100 p-4 rounded-lg mb-6 text-center">
            <p className="text-lg">Your Score</p>
            <p className="text-5xl font-bold text-sky-600">{examResult.score}%</p>
          </div>
          <div className="space-y-4">
            {localExam.map((q, index) => {
              const feedback = getFeedbackForQuestion(q.id);
              return (
                <div key={q.id} className={`p-4 rounded-lg ${feedback?.isCorrect ? 'bg-green-100' : 'bg-red-100'}`}>
                  <p className="font-semibold text-slate-700">Q{index + 1}: {q.questionText}</p>
                  <p className="text-sm text-slate-600 mt-1">Your answer: {answers[q.id] || 'No answer'}</p>
                  <div className="mt-2 pt-2 border-t border-slate-300/50 flex items-start space-x-2">
                    {feedback?.isCorrect ? <CheckCircleIcon className="h-6 w-6 text-green-600 flex-shrink-0 mt-0.5" /> : <XCircleIcon className="h-6 w-6 text-red-600 flex-shrink-0 mt-0.5" />}
                    <p className="flex-grow text-sm text-slate-800">{feedback?.explanation}</p>
                    {feedback?.explanation && (
                      <button
                        type="button"
                        onClick={() => handlePlayExplanation(q.id, feedback.explanation)}
                        disabled={audioLoading !== null && audioLoading !== q.id}
                        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-200 hover:text-sky-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        aria-label={`Play explanation for question ${index + 1}`}
                      >
                        {audioLoading === q.id ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-sky-500"></div>
                        ) : audioPlaying === q.id ? (
                            <StopIcon className="h-5 w-5" />
                        ) : (
                            <SpeakerWaveIcon className="h-5 w-5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            onClick={handleGenerateExam}
            className="w-full mt-6 bg-sky-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-sky-600 transition-colors flex items-center justify-center"
          >
            <SparklesIcon className="h-5 w-5 mr-2" />
            Start a New Exam
          </button>
        </div>
      );
    }
    
    if (localExam) {
      return (
        <form onSubmit={handleSubmit}>
          <h3 className="text-2xl font-bold mb-4 text-center">Let's see what you know!</h3>
          <div className="space-y-6">
            {localExam.map((q, index) => (
              <div key={q.id}>
                <label className="block font-semibold text-slate-700 mb-2">
                  Question {index + 1}: {q.questionText}
                </label>
                <input
                  type="text"
                  value={answers[q.id] || ''}
                  onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-400 focus:border-sky-400 transition"
                  placeholder="Type your answer here..."
                  required
                />
              </div>
            ))}
          </div>
          <button type="submit" className="w-full mt-6 bg-green-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-600 transition-colors">
            Submit Answers
          </button>
        </form>
      );
    }

    return (
      <div className="text-center flex flex-col items-center justify-center h-full">
        <h3 className="text-2xl font-bold mb-2">Ready for a challenge?</h3>
        <p className="text-slate-600 mb-6">Click the button to generate a new exam!</p>
        <button
          onClick={handleGenerateExam}
          className="bg-sky-500 text-white font-bold py-3 px-6 rounded-full hover:bg-sky-600 transition-transform transform hover:scale-105 shadow-lg flex items-center"
          disabled={isLoading}
        >
          <SparklesIcon className="h-5 w-5 mr-2" />
          Generate New Exam
        </button>
      </div>
    );
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-lg min-h-[500px] flex flex-col">
      {renderContent()}
    </div>
  );
};