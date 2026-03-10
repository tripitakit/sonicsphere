export type PerformanceTier = 'high' | 'balanced' | 'low';

export interface PerformanceBudget {
  tier: PerformanceTier;
  renderer: {
    pixelRatioCap: number;
    antialias: boolean;
  };
  world: {
    densityMultiplier: number;
    targetMaxActiveSources: number;
    minMaxActiveSources: number;
    maxNewStartsPerFrame: number;
    adaptCheckIntervalSec: number;
    adaptDownDtSec: number;
    adaptUpDtSec: number;
  };
  synth: {
    panningModel: 'HRTF' | 'equalpower';
    enableAirOsc: boolean;
    enableTimbreLfo: boolean;
    minGainDelta: number;
    minPositionDelta: number;
  };
  loop: {
    worldHz: number;
    weatherHz: number;
    renderHz: number;
  };
}

type BudgetShape = Omit<PerformanceBudget, 'tier'>;
type NavWithDeviceMemory = Navigator & { deviceMemory?: number };

function parseTier(value: string | null | undefined): PerformanceTier | null {
  if (value === 'high' || value === 'balanced' || value === 'low') return value;
  return null;
}

function readTierOverride(): PerformanceTier | null {
  if (typeof window === 'undefined') return null;

  const fromQuery = parseTier(new URLSearchParams(window.location.search).get('perfTier'));
  if (fromQuery) return fromQuery;

  try {
    return parseTier(window.localStorage.getItem('sonicsphere.perfTier'));
  } catch {
    return null;
  }
}

function detectTier(): PerformanceTier {
  const override = readTierOverride();
  if (override) return override;

  if (typeof navigator === 'undefined') return 'high';
  const nav = navigator as NavWithDeviceMemory;
  const hw = nav.hardwareConcurrency ?? 8;
  const mem = nav.deviceMemory ?? 8;
  const isWindows = /Windows/i.test(nav.userAgent);

  if (hw <= 4 || mem <= 4) return 'low';
  if (hw <= 8 || mem <= 8 || isWindows) return 'balanced';
  return 'high';
}

const BUDGETS: Record<PerformanceTier, BudgetShape> = {
  high: {
    renderer: {
      pixelRatioCap: 2,
      antialias: true,
    },
    world: {
      densityMultiplier: 3,
      targetMaxActiveSources: 12,
      minMaxActiveSources: 8,
      maxNewStartsPerFrame: 2,
      adaptCheckIntervalSec: 0.35,
      adaptDownDtSec: 1 / 45,
      adaptUpDtSec: 1 / 52,
    },
    synth: {
      panningModel: 'HRTF',
      enableAirOsc: true,
      enableTimbreLfo: true,
      minGainDelta: 0.003,
      minPositionDelta: 0.006,
    },
    loop: {
      worldHz: 60,
      weatherHz: 30,
      renderHz: 60,
    },
  },
  balanced: {
    renderer: {
      pixelRatioCap: 1.5,
      antialias: false,
    },
    world: {
      densityMultiplier: 2.25,
      targetMaxActiveSources: 10,
      minMaxActiveSources: 6,
      maxNewStartsPerFrame: 1,
      adaptCheckIntervalSec: 0.4,
      adaptDownDtSec: 1 / 42,
      adaptUpDtSec: 1 / 55,
    },
    synth: {
      panningModel: 'equalpower',
      enableAirOsc: true,
      enableTimbreLfo: false,
      minGainDelta: 0.0045,
      minPositionDelta: 0.01,
    },
    loop: {
      worldHz: 48,
      weatherHz: 24,
      renderHz: 45,
    },
  },
  low: {
    renderer: {
      pixelRatioCap: 1.25,
      antialias: false,
    },
    world: {
      densityMultiplier: 1.6,
      targetMaxActiveSources: 8,
      minMaxActiveSources: 4,
      maxNewStartsPerFrame: 1,
      adaptCheckIntervalSec: 0.45,
      adaptDownDtSec: 1 / 36,
      adaptUpDtSec: 1 / 48,
    },
    synth: {
      panningModel: 'equalpower',
      enableAirOsc: false,
      enableTimbreLfo: false,
      minGainDelta: 0.006,
      minPositionDelta: 0.015,
    },
    loop: {
      worldHz: 40,
      weatherHz: 18,
      renderHz: 30,
    },
  },
};

const tier = detectTier();
export const PERFORMANCE_TIER: PerformanceTier = tier;
export const PERFORMANCE_BUDGET: PerformanceBudget = {
  tier,
  ...BUDGETS[tier],
};
