// Stands in for @kirocrew/app-sdk in tests only. The Crew host provides the real
// module at runtime; tests replace these with vi.mock.
export const useAppApi = () => {
  throw new Error('useAppApi is only available inside Crew');
};
export const useNotify = () => () => undefined;
