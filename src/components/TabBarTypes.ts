export interface SearchState {
  query: string;
  matches: { page: number }[];
  active: number;
  searching: boolean;
}
