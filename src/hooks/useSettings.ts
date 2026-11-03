import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_SETTINGS, loadSettings } from '../db/settings';
import type { Settings } from '../types/domain';

export function useSettings(): Settings {
  return useLiveQuery(() => loadSettings(), [], DEFAULT_SETTINGS);
}
