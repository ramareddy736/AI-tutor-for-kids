export interface Question {
  id: number;
  questionText: string;
}

export type Exam = Question[];

export interface Answer {
  questionId: number;
  answerText: string;
}

export interface Feedback {
  questionId: number;
  isCorrect: boolean;
  explanation: string;
}

export interface ExamResult {
  score: number;
  feedback: Feedback[];
}

export interface Transcript {
  id: number;
  speaker: 'user' | 'tutor';
  text: string;
  image?: string; // For displaying uploaded images in the chat
}
