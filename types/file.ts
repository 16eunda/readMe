export interface HistoryFile {
  id: number;
  title: string;
  date: string;       // ISO 형식: "2026-05-07T12:17:33.267"
  lastReadAt?: string | null;
  rating: number;
  preview?: string;
  uri?: string;
  path?: string;
  review?: string | null;
}

export type SortOrder = 'recent' | 'oldest';

export interface FileRankingDto {
  fileId: number;
  title: string;
  lastReadAt: string;
  progress: number;
  uri : string;
  rating: number;
  readCount: number;
}
