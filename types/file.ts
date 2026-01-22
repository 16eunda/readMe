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

export interface FileRankingDto {
  fileId: number;
  title: string;
  uploadDate: string;
  progress: number;
  rating: number;
  readCount: number;
}
