import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Blob, Chat, Part } from "@google/genai";
import type { Transcript } from '../types';
import { MicrophoneIcon, StopIcon, PaperClipIcon, PaperAirplaneIcon, XCircleIcon } from './Icons';

// --- Audio Helper Functions ---
function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

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

function createBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
}

export const TutorPanel: React.FC = () => {
  // Chat state
  const [inputText, setInputText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Voice state
  const [isRecording, setIsRecording] = useState(false);

  // Refs
  const chatRef = useRef<Chat | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRefs = useRef<{ input: AudioContext | null, output: AudioContext | null, scriptProcessor: ScriptProcessorNode | null, source: MediaStreamAudioSourceNode | null}>({ input: null, output: null, scriptProcessor: null, source: null });
  const transcriptRefs = useRef({ currentInput: "", currentOutput: ""});

  useEffect(() => {
    if (!process.env.API_KEY) {
      setError("API key not found.");
      return;
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    chatRef.current = ai.chats.create({
      model: 'gemini-2.5-flash',
      config: {
        systemInstruction: 'You are a friendly and encouraging tutor for a 10-year-old child. Explain concepts simply and be very patient. When presented with an image, describe it or answer questions about it in a simple, engaging way.',
      }
    });
  }, []);

  const fileToGenerativePart = async (file: File): Promise<Part> => {
    const base64EncodedData = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(file);
    });
    return {
      inlineData: {
        data: base64EncodedData,
        mimeType: file.type,
      },
    };
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.type.startsWith('image/')) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFilePreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    } else {
      setFile(null);
      setFilePreview(null);
    }
  };

  const removeFile = () => {
    setFile(null);
    setFilePreview(null);
    if(fileInputRef.current) {
        fileInputRef.current.value = "";
    }
  };

  const handleSendMessage = async () => {
    if ((!inputText.trim() && !file) || isSending || isRecording || !chatRef.current) return;
    
    setIsSending(true);
    setError(null);
    
    const userMessage: Transcript = {
        id: Date.now(),
        speaker: 'user',
        text: inputText,
        image: filePreview ?? undefined,
    };
    setTranscripts(prev => [...prev, userMessage]);

    const textToSend = inputText;
    const fileToSend = file;

    setInputText('');
    removeFile();

    try {
        const parts: Part[] = [];
        if(textToSend.trim()) {
            parts.push({ text: textToSend.trim() });
        }
        if (fileToSend) {
            parts.push(await fileToGenerativePart(fileToSend));
        }

        const response = await chatRef.current.sendMessage({ message: parts });

        const tutorResponse: Transcript = {
            id: Date.now() + 1,
            speaker: 'tutor',
            text: response.text,
        };
        setTranscripts(prev => [...prev, tutorResponse]);

    } catch (err) {
        const errorMsg = "Sorry, I couldn't get a response. Please try again.";
        setError(errorMsg);
        setTranscripts(prev => [...prev, {id: Date.now() + 1, speaker: 'tutor', text: errorMsg}]);
    } finally {
        setIsSending(false);
    }
  };

  const stopConversation = useCallback(async () => {
    setIsRecording(false);
    if (sessionPromiseRef.current) {
        try {
            const session = await sessionPromiseRef.current;
            session.close();
        } catch(e) { console.error("Error closing session:", e); }
        sessionPromiseRef.current = null;
    }
    if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
    }
    const { input, output, scriptProcessor, source } = audioContextRefs.current;
    if(scriptProcessor) {
        scriptProcessor.disconnect();
        scriptProcessor.onaudioprocess = null;
    }
    if(source) source.disconnect();
    if(input && input.state !== 'closed') input.close();
    if(output && output.state !== 'closed') output.close();
    audioContextRefs.current = { input: null, output: null, scriptProcessor: null, source: null };
  }, []);

  const startConversation = useCallback(async () => {
    setError(null);
    setIsRecording(true);
    transcriptRefs.current = { currentInput: "", currentOutput: "" };

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

      const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRefs.current.input = inputAudioContext;
      audioContextRefs.current.output = outputAudioContext;

      let nextStartTime = 0;
      const sources = new Set<AudioBufferSourceNode>();

      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          systemInstruction: 'You are a friendly and encouraging tutor for a 10-year-old child. Explain concepts simply and be very patient.',
        },
        callbacks: {
          onopen: () => {
            const source = inputAudioContext.createMediaStreamSource(mediaStreamRef.current!);
            const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
            audioContextRefs.current.source = source;
            audioContextRefs.current.scriptProcessor = scriptProcessor;
            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const pcmBlob = createBlob(audioProcessingEvent.inputBuffer.getChannelData(0));
              sessionPromiseRef.current?.then((session) => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContext.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) { transcriptRefs.current.currentOutput += message.serverContent.outputTranscription.text; }
            if (message.serverContent?.inputTranscription) { transcriptRefs.current.currentInput += message.serverContent.inputTranscription.text; }
            if(message.serverContent?.turnComplete) {
                const fullInput = transcriptRefs.current.currentInput;
                const fullOutput = transcriptRefs.current.currentOutput;
                setTranscripts(prev => [
                    ...prev,
                    ...(fullInput ? [{ id: Date.now() + 1, speaker: 'user' as const, text: fullInput }] : []),
                    ...(fullOutput ? [{ id: Date.now() + 2, speaker: 'tutor' as const, text: fullOutput }] : []),
                ]);
                transcriptRefs.current = { currentInput: "", currentOutput: "" };
            }
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
            if (audioData) {
              nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
              const audioBuffer = await decodeAudioData(decode(audioData), outputAudioContext, 24000, 1);
              const sourceNode = outputAudioContext.createBufferSource();
              sourceNode.buffer = audioBuffer;
              sourceNode.connect(outputAudioContext.destination);
              sourceNode.addEventListener('ended', () => sources.delete(sourceNode));
              sourceNode.start(nextStartTime);
              nextStartTime += audioBuffer.duration;
              sources.add(sourceNode);
            }
          },
          onerror: (e) => { setError('An error occurred during the session.'); stopConversation(); },
          onclose: () => {},
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
      stopConversation();
    }
  }, [stopConversation]);

  useEffect(() => { return () => { stopConversation(); }; }, [stopConversation]);

  const handleToggleRecording = () => { isRecording ? stopConversation() : startConversation(); };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-lg h-full flex flex-col">
      <h3 className="text-xl font-bold mb-4 text-center text-slate-700">Talk to your Buddy</h3>
      <div className="flex-grow bg-slate-100 rounded-lg p-3 overflow-y-auto mb-4 min-h-[300px]">
        {transcripts.length === 0 && !isRecording && (
          <div className="flex items-center justify-center h-full text-slate-500 text-center p-4">
            <p>Type a message, upload an image, or click the mic to start talking!</p>
          </div>
        )}
        <div className="space-y-4">
          {transcripts.map((t) => (
            <div key={t.id} className={`flex gap-3 ${t.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] p-3 rounded-xl ${t.speaker === 'user' ? 'bg-sky-500 text-white' : 'bg-slate-200 text-slate-800'}`}>
                {t.image && <img src={t.image} alt="User upload" className="rounded-md mb-2 max-h-48" />}
                <p className="whitespace-pre-wrap">{t.text}</p>
              </div>
            </div>
          ))}
           {(isSending || isRecording) && (
            <div className="flex gap-3 justify-start">
              <div className="max-w-[85%] p-3 rounded-xl bg-slate-200 text-slate-800">
                <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse"></div>
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse [animation-delay:0.2s]"></div>
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse [animation-delay:0.4s]"></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="mt-auto pt-4 border-t border-slate-200">
        {filePreview && (
          <div className="relative w-20 h-20 mb-2 p-1 border border-slate-300 rounded-lg">
            <img src={filePreview} className="w-full h-full object-cover rounded-md" alt="Image preview" />
            <button
              onClick={removeFile}
              className="absolute -top-2 -right-2 bg-slate-600 text-white rounded-full flex items-center justify-center w-6 h-6 hover:bg-red-500 transition-colors"
              aria-label="Remove image"
            >
              <XCircleIcon className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="flex items-center space-x-2">
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
            <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isRecording || isSending}
                className="p-2 text-slate-500 hover:text-sky-600 disabled:opacity-50 transition-colors rounded-full hover:bg-slate-100"
                aria-label="Attach image"
            >
                <PaperClipIcon className="w-6 h-6" />
            </button>
            <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                placeholder="Type a message..."
                className="flex-grow p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-400 focus:border-sky-400 transition resize-none"
                rows={1}
                disabled={isRecording || isSending}
            />
            <button
                onClick={handleSendMessage}
                disabled={(!inputText.trim() && !file) || isSending || isRecording}
                className="p-2 text-sky-500 hover:text-sky-700 disabled:opacity-50 transition-colors rounded-full hover:bg-sky-100"
                aria-label="Send message"
            >
                <PaperAirplaneIcon className="w-6 h-6" />
            </button>
             <button
                onClick={handleToggleRecording}
                disabled={isSending}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shadow-sm shrink-0 ${isRecording ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-sky-500 hover:bg-sky-600 text-white'}`}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            >
                {isRecording ? <StopIcon className="h-5 w-5" /> : <MicrophoneIcon className="h-5 w-5" />}
            </button>
        </div>
        {error && <p className="text-red-500 text-xs text-center mt-2">{error}</p>}
      </div>
    </div>
  );
};
