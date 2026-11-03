import { useEffect, useState } from 'react';
import { getEngine } from '../services/engine/engineService';
import type { EngineState, UciEngine } from '../services/engine/UciEngine';

/** Shared engine instance plus its live state. Does not start the engine by itself. */
export function useEngine(): { engine: UciEngine; state: EngineState } {
  const engine = getEngine();
  const [state, setState] = useState<EngineState>(engine.getState());
  useEffect(() => {
    setState(engine.getState());
    return engine.onStateChange(setState);
  }, [engine]);
  return { engine, state };
}
