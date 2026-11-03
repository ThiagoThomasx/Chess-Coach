import { lazy, useEffect } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { ToastProvider } from '../components/feedback/Toast';
import { NotFound } from './NotFound';
import { useSettings } from '../hooks/useSettings';
import { recoverInterruptedAnalyses } from '../db/analysisRepo';

const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const GamesPage = lazy(() => import('../features/games/GamesPage').then((m) => ({ default: m.GamesPage })));
const AnalysisPage = lazy(() => import('../features/analysis/AnalysisPage').then((m) => ({ default: m.AnalysisPage })));
const TrainingPage = lazy(() => import('../features/training/TrainingPage').then((m) => ({ default: m.TrainingPage })));
const ExerciseSolver = lazy(() => import('../features/training/ExerciseSolver').then((m) => ({ default: m.ExerciseSolver })));
const OpeningsPage = lazy(() => import('../features/openings/OpeningsPage').then((m) => ({ default: m.OpeningsPage })));
const ProgressPage = lazy(() => import('../features/progress/ProgressPage').then((m) => ({ default: m.ProgressPage })));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));

export function App() {
  const settings = useSettings();
  useEffect(() => {
    document.documentElement.dataset.theme = settings.appTheme;
  }, [settings.appTheme]);
  useEffect(() => {
    recoverInterruptedAnalyses().catch(() => undefined);
  }, []);
  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="games" element={<GamesPage />} />
            <Route path="analysis/:gameId" element={<AnalysisPage />} />
            <Route path="train" element={<TrainingPage />} />
            <Route path="train/:exerciseId" element={<ExerciseSolver />} />
            <Route path="openings" element={<OpeningsPage />} />
            <Route path="progress" element={<ProgressPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}
