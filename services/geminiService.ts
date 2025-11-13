import { GoogleGenAI, Type, Modality } from "@google/genai";
import type { Exam, ExamResult, Question } from '../types';

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const EXAM_GENERATION_MODEL = 'gemini-2.5-pro';
const EXAM_GRADING_MODEL = 'gemini-2.5-pro';

const examSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.INTEGER },
      questionText: { type: Type.STRING },
    },
    required: ['id', 'questionText'],
  },
};

const resultSchema = {
  type: Type.OBJECT,
  properties: {
    score: {
      type: Type.NUMBER,
      description: "A score from 0 to 100 based on the number of correct answers.",
    },
    feedback: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          questionId: { type: Type.INTEGER },
          isCorrect: { type: Type.BOOLEAN },
          explanation: {
            type: Type.STRING,
            description: "A simple, encouraging explanation for the correct answer, suitable for a 10-year-old child.",
          },
        },
        required: ['questionId', 'isCorrect', 'explanation'],
      },
    },
  },
  required: ['score', 'feedback'],
};

export const generateExam = async (difficulty: number): Promise<Exam> => {
  const prompt = `You are an AI that creates educational exams for a 10-year-old child. The current difficulty level is ${difficulty} out of 10. Generate 3 short questions about science, math, or history. The complexity of the questions should increase with the difficulty level. For example, level 1 might be 'What is 2+2?', while level 10 might be 'What is the Pythagorean theorem?'. Return the questions as a JSON array. Each question object must have an 'id' (from 1 to 3) and a 'questionText'.`;

  try {
    const response = await ai.models.generateContent({
      model: EXAM_GENERATION_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: examSchema,
      },
    });

    const jsonText = response.text.trim();
    const exam = JSON.parse(jsonText);
    return exam as Exam;
  } catch (error) {
    console.error("Error generating exam:", error);
    // Return a fallback exam on error
    return [
      { id: 1, questionText: "Could not generate an exam. Please try again." }
    ];
  }
};

export const gradeExam = async (exam: Exam, answers: { [key: number]: string }): Promise<ExamResult> => {
  const formattedAnswers = exam.map(q => ({
    question: q.questionText,
    answer: answers[q.id] || "No answer provided"
  }));

  const prompt = `You are an AI exam grader for a 10-year-old child. Please evaluate the following answers. Be encouraging and provide simple explanations.
  
  Questions and Answers:
  ${JSON.stringify(formattedAnswers, null, 2)}
  
  Return the results as a JSON object containing a 'score' (0-100) and a 'feedback' array. Each feedback item should have 'questionId', 'isCorrect', and a simple 'explanation'.`;

  try {
    const response = await ai.models.generateContent({
      model: EXAM_GRADING_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: resultSchema,
      },
    });

    const jsonText = response.text.trim();
    const result = JSON.parse(jsonText);
    return result as ExamResult;
  } catch (error) {
    console.error("Error grading exam:", error);
    // Return fallback result on error
    return {
      score: 0,
      feedback: exam.map(q => ({
        questionId: q.id,
        isCorrect: false,
        explanation: "Sorry, there was an error grading this question."
      }))
    };
  }
};

export const generateSpeech = async (text: string): Promise<string | null> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Say: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error("No audio data received from API.");
    }
    return base64Audio;
  } catch (error) {
    console.error("Error generating speech:", error);
    return null;
  }
};