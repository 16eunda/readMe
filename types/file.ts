export interface HistoryFile {
  id: number;
  title: string;
  date: string;
  rating: number;
  lastReadAt: string;
  preview?: string;
  uri?: string;
  path?: string;
  progress?: number;
}

export type SortOrder = 'recent' | 'oldest';
