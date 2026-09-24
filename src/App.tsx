import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/auth/useAuth';
import { store } from '@/lib/store';
import { focusTimer } from '@/lib/focusTimer';
import type { Subject, AppState, AmbientSound } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import MobileNav from '@/components/MobileNav';
import PomodoroTimer from '@/components/PomodoroTimer';
import SubjectGrid from '@/components/SubjectGrid';
import AmbientSoundWidget from '@/components/AmbientSound';
import StudyAudio from '@/components/StudyAudio';
import StreakBoard from '@/components/StreakBoard';
import PetCard from '@/components/PetCard';
import ProfilePage from '@/components/ProfilePage';
import Leaderboard from '@/components/Leaderboard';
import TomorrowPlanner from '@/components/TomorrowPlanner';
import StudyAssistant from '@/components/StudyAssistant';
import AdminDashboard from '@/components/AdminDashboard';
import AccountMenu from '@/components/AccountMenu';
import PremiumPage from '@/components/PremiumPage';
import { completePlanTask, deletePlanTask, getDailyAIStatus, loadPlan, localCalendarDate, setTaskStatus, type DailyAIStatus, type StudyPlan } from '@/lib/planner';
import { LANGUAGES, type LanguageCode, type ThemeMode, type TranslationKey, translateSubjectName, TRANSLATIONS } from '@/lib/i18n';
import { PET_CATALOG, profileStore } from '@/lib/profileStore';
import { getPetVisual } from '@/lib/petAssets';
import { announceStudyTimer, notifyPlanOverdue, notifyStudyMilestone, requestStudyNotifications } from '@/lib/notifications';
import { cancelStudyCompletionNotification, requestMobileNotificationPermission, scheduleStudyTimerNotifications } from '@/lib/mobile';

const MOTIVATIONAL_QUOTES = [
  'Keep grinding, hero! Your pet is proud of you!',
  'Every minute counts. You are building your future!',
  'Knowledge is power. Claim it, one session at a time!',
  'Stay locked in. The streak gods are watching!',
  'Your pet believes in you. Do not let it down!',
];

const THEME_STORAGE_KEY = 'studyquest-theme';
const LANGUAGE_STORAGE_KEY = 'studyquest-language';


/**
 * Complete offline UI dictionary.
 * The translation layer intentionally lives in App.tsx so no API, package,
 * remote font, icon, or translation service is required at runtime.
 */
const getStoredTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'ice' ? stored : 'ice';
};

const getStoredLanguage = (): LanguageCode => {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return LANGUAGES.some((language) => language.code === stored) ? (stored as LanguageCode) : 'en';
};

export default function App() {
  const { user, loading: authLoading } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [streakDays, setStreakDays] = useState<LocalData['streakDays']>([]);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isRunning, setIsRunning] = useState(false);
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null);
  const [currentDuration, setCurrentDuration] = useState(25);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme);
  const [language, setLanguage] = useState<LanguageCode>(getStoredLanguage);
  const [tomorrowPlan, setTomorrowPlan] = useState<StudyPlan | null>(null);
  const [planDateLabel, setPlanDateLabel] = useState<'today' | 'tomorrow'>('tomorrow');
  const [equippedPetId, setEquippedPetId] = useState(() => profileStore.load().equippedPetId || '');
  const [activePlanTaskId, setActivePlanTaskId] = useState<string | null>(null);
  const [dailyAIStatus, setDailyAIStatus] = useState<DailyAIStatus | null>(null);
  const [rewardToast, setRewardToast] = useState<string | null>(null);

  const rewardToastIsError =
    !!rewardToast &&
    /فشل|تعذر|لم تكتمل|خطأ|failed|could not|cannot|not complete|error/i.test(rewardToast);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [switchTaskId, setSwitchTaskId] = useState<string | null>(null);
  const t = useCallback((key: TranslationKey) => TRANSLATIONS[language][key], [language]);
  const isAdmin = user?.app_metadata?.role === 'admin';

  // Persist theme + language locally and update the document without any network dependency.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const selectedLanguage = LANGUAGES.find((item) => item.code === language) ?? LANGUAGES[0];
    document.documentElement.lang = selectedLanguage.locale;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  // Rotate motivational quote every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % MOTIVATIONAL_QUOTES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Load from localStorage instantly, then try cloud sync
  useEffect(() => {
    const refreshEconomy = () => {
      const local = store.load();
      setAppState((prev) => prev ? { ...prev, coins: local.appState.coins, gems: local.appState.gems } : local.appState);
    };
    window.addEventListener('studyquest:economy-updated', refreshEconomy);
    return () => window.removeEventListener('studyquest:economy-updated', refreshEconomy);
  }, []);

  useEffect(() => {
    if (authLoading) return;

    const local = store.load();
    setEquippedPetId(profileStore.load().equippedPetId);
    setSubjects(local.subjects);
    setStreakDays(local.streakDays);
    setAppState(local.appState);
    const restoredTimer = focusTimer.load();
    const restoredSubjectId =
      restoredTimer.subjectId ?? local.appState.active_subject_id ?? null;

    setActiveSubjectId(restoredSubjectId);
    setActivePlanTaskId(restoredTimer.taskId);

    const restoredDuration =
      restoredTimer.durationSeconds > 0
        ? restoredTimer.durationSeconds / 60
        : local.subjects.find((s) => s.id === restoredSubjectId)?.duration_minutes ?? 25;

    setCurrentDuration(restoredDuration);
    setRemainingSeconds(
      restoredTimer.status === 'idle'
        ? restoredDuration * 60
        : restoredTimer.remainingSeconds,
    );
    setIsRunning(
      restoredTimer.status === 'running' &&
      restoredTimer.remainingSeconds > 0,
    );
    setLoading(false);

    // Attempt background cloud sync if online
    if (navigator.onLine) {
      setIsSyncing(true);
      store.syncFromCloud()
        .then((synced) => {
          setSubjects(synced.subjects);
          setStreakDays(synced.streakDays);
          setAppState(synced.appState);
        })
        .catch(() => {})
        .finally(() => setIsSyncing(false));
    }
  }, [authLoading, user?.id]);

  useEffect(() => {
    const refreshPet = () => setEquippedPetId(profileStore.load().equippedPetId);
    window.addEventListener('studyquest:profile-updated', refreshPet);
    return () => window.removeEventListener('studyquest:profile-updated', refreshPet);
  }, []);

  // Listen for online/offline events
  useEffect(() => {
    if (authLoading) return;

    const handleOnline = () => {
      setIsOnline(true);
      setIsSyncing(true);
      store.syncFromCloud()
        .then((synced) => {
          setSubjects(synced.subjects);
          setStreakDays(synced.streakDays);
          setAppState(synced.appState);
        })
        .catch(() => {})
        .finally(() => setIsSyncing(false));
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [authLoading, user?.id]);

  useEffect(() => {
    if (!user || !isOnline) return;
    let cancelled = false;
    Promise.all([loadPlan(localCalendarDate(0)), loadPlan(localCalendarDate(1))]).then(([today, tomorrow]) => {
      if (cancelled) return;
      const todayHasWork = Boolean(today?.tasks?.some((task) => task.status === 'pending' || task.status === 'in_progress'));
      setTomorrowPlan(todayHasWork ? today : tomorrow);
      setPlanDateLabel(todayHasWork ? 'today' : 'tomorrow');
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [user?.id, isOnline]);

  useEffect(() => {
    if (!user || !isOnline) return;
    getDailyAIStatus(localCalendarDate(0)).then(setDailyAIStatus).catch(() => undefined);
  }, [user?.id, isOnline, tomorrowPlan]);

  useEffect(() => {
    if (!tomorrowPlan?.tasks?.length || planDateLabel !== 'today') return;
    const warned = new Set<string>();
    const check = () => {
      const now = Date.now();
      tomorrowPlan.tasks?.forEach((task) => {
        if (task.status !== 'pending' || !task.start_at || warned.has(task.id)) return;
        const start = new Date(task.start_at).getTime();
        if (Number.isFinite(start) && start + 2 * 60_000 < now) {
          warned.add(task.id);
          notifyPlanOverdue(language, task.title);
        }
      });
    };
    check();
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, [tomorrowPlan, planDateLabel, language]);

  const nextPlanTask = tomorrowPlan?.tasks?.find((task) => task.status === 'pending' || task.status === 'in_progress') ?? null;

  const activeSubject = subjects.find((s) => s.id === activeSubjectId) ?? null;
  const displaySubjects = subjects.map((subject) => ({
    ...subject,
    name: translateSubjectName(subject.name, language),
  }));
  const displayActiveSubject = activeSubject
    ? { ...activeSubject, name: translateSubjectName(activeSubject.name, language) }
    : null;
  const activePlanTask =
    tomorrowPlan?.tasks?.find((task) => task.id === activePlanTaskId) ?? null;
  const timerDisplayName =
    activePlanTask?.title ?? displayActiveSubject?.name ?? null;

  // Update app state locally + queue sync
  const updateAppState = useCallback((updates: Partial<AppState>) => {
    store.saveAppState(updates);
    setAppState((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  // Handle subject selection.
  const handleSelectSubject = useCallback(async (subject: Subject) => {
    if (isRunning) return;

    const timer = focusTimer.load();

    if (timer.status === 'paused') {
      await focusTimer.cancel().catch(() => undefined);
      setActivePlanTaskId(null);
    }

    setActiveSubjectId(subject.id);
    setCurrentDuration(subject.duration_minutes);
    setRemainingSeconds(subject.duration_minutes * 60);
    updateAppState({ active_subject_id: subject.id });
  }, [isRunning, updateAppState]);

  // Handle duration edit
  const handleEditDuration = useCallback((subjectId: string, minutes: number) => {
    const clamped = Math.max(5, Math.min(120, minutes));
    store.updateSubject(subjectId, { duration_minutes: clamped });
    setSubjects((prev) =>
      prev.map((s) => (s.id === subjectId ? { ...s, duration_minutes: clamped } : s))
    );
    if (subjectId === activeSubjectId) setCurrentDuration(clamped);
  }, [activeSubjectId]);

  // Handle subject name edit
  const handleEditName = useCallback((subjectId: string, name: string) => {
    store.updateSubject(subjectId, { name });
    setSubjects((prev) =>
      prev.map((s) => (s.id === subjectId ? { ...s, name } : s))
    );
  }, []);

  // Start / resume focus using one absolute end timestamp.
  const handleStart = useCallback(async () => {
    if (!activeSubjectId) return;

    requestStudyNotifications().catch(() => undefined);
    requestMobileNotificationPermission().catch(() => undefined);
    announceStudyTimer(language, 'start');

    try {
      const current = focusTimer.load();

      const next =
        current.status === 'paused' &&
        current.subjectId === activeSubjectId
          ? await focusTimer.resume()
          : await focusTimer.start(
              activeSubjectId,
              currentDuration,
              activePlanTaskId,
            );

      if (activePlanTaskId) {
        await setTaskStatus(activePlanTaskId, 'in_progress').catch(() => undefined);
      }

      setActiveSubjectId(next.subjectId);
      setActivePlanTaskId(next.taskId);
      setCurrentDuration(next.durationSeconds / 60);
      setRemainingSeconds(next.remainingSeconds);
      setIsRunning(next.status === 'running');

      setRewardToast(
        language === 'ar'
          ? 'بدأت جلسة التركيز'
          : 'Focus session started',
      );

      window.setTimeout(() => setRewardToast(null), 2600);

      scheduleStudyTimerNotifications(
        language,
        next.remainingSeconds,
      ).catch(() => undefined);
    } catch {
      setRewardToast(
        language === 'ar'
          ? 'تعذر بدء جلسة التركيز'
          : 'Could not start the focus session',
      );

      window.setTimeout(() => setRewardToast(null), 3200);
    }
  }, [activeSubjectId, currentDuration, activePlanTaskId, language]);

  // Pause focus.
  const handlePause = useCallback(async () => {
    cancelStudyCompletionNotification().catch(() => undefined);

    try {
      const next = await focusTimer.pause();

      setRemainingSeconds(next.remainingSeconds);
      setIsRunning(next.status === 'running');
    } catch {
      setRewardToast(
        language === 'ar'
          ? 'تعذر إيقاف الجلسة مؤقتًا'
          : 'Could not pause the session',
      );

      window.setTimeout(() => setRewardToast(null), 3200);
    }
  }, [language]);

  // Reset / cancel focus with no reward.
  const handleReset = useCallback(async () => {
    cancelStudyCompletionNotification().catch(() => undefined);

    await focusTimer.cancel();

    setIsRunning(false);
    setActivePlanTaskId(null);
    setActiveSubjectId(null);
    setCurrentDuration(25);
    setRemainingSeconds(25 * 60);

    updateAppState({ active_subject_id: null });
  }, [updateAppState]);

  // Complete session.
  const handleComplete = useCallback(async () => {
    if (!activeSubject) return;

    await cancelStudyCompletionNotification();

    try {
      const result = await focusTimer.complete();

      if (result.reward) {
        const previousCoins = appState?.coins ?? result.reward.coins;
        const rewardCoins = result.reward.coins;

        store.setLocalAppState({
          coins: rewardCoins,
          gems: result.reward.gems,
        });

        setAppState((prev) =>
          prev
            ? {
                ...prev,
                coins: rewardCoins,
                gems: result.reward!.gems,
              }
            : prev,
        );

        const gained = Math.max(0, rewardCoins - previousCoins);
        const awarded = Number(result.reward.coins_awarded ?? gained);

        setRewardToast(
          awarded > 0
            ? `+${awarded} Coins`
            : (
                language === 'ar'
                  ? 'وصلت للحد اليومي للكوينز'
                  : 'Daily Coin cap reached'
              ),
        );

        window.setTimeout(() => setRewardToast(null), 4200);

        const today = new Date().getDay();
        const todayStreak = streakDays.find(
          (d) => d.day_of_week === today,
        );

        if (todayStreak && !todayStreak.completed) {
          const updatedAt = new Date().toISOString();

          setStreakDays((prev) =>
            prev.map((d) =>
              d.id === todayStreak.id
                ? {
                    ...d,
                    completed: true,
                    updated_at: updatedAt,
                  }
                : d,
            ),
          );
        }

        if (activePlanTaskId && result.reward.session_id) {
          try {
            const daily = await completePlanTask(
              activePlanTaskId,
              result.reward.session_id,
            );

            if (daily) {
              setDailyAIStatus({
                ...daily,
                plan_date: localCalendarDate(0),
                has_plan: true,
              } as DailyAIStatus);

              if (daily.golden_star_awarded) {
                setRewardToast(
                  language === 'ar'
                    ? '⭐ نجمة ذهبية! أكملت 26 يومًا صحيحًا'
                    : '⭐ Golden Star! 26 correct days completed',
                );
                window.setTimeout(() => setRewardToast(null), 5200);
              } else if (daily.correct) {
                setRewardToast(
                  language === 'ar'
                    ? '🎉 يوم صحيح! +30 كوين'
                    : '🎉 Perfect day! +30 Coins',
                );
                window.setTimeout(() => setRewardToast(null), 4200);
              }
            }
          } catch (error) {
            console.error('[StudyQuest] planned task completion failed:', error);

            const message =
              error instanceof Error
                ? error.message
                : String(error);

            setRewardToast(
              language === 'ar'
                ? `الجلسة اكتملت لكن تعذر تعليم المهمة كمكتملة: ${message}`
                : `Session completed, but the task could not be marked complete: ${message}`
            );

            window.setTimeout(() => setRewardToast(null), 7000);
          }

          loadPlan(localCalendarDate(0))
            .then((plan) => {
              if (plan) {
                setTomorrowPlan(plan);
                setPlanDateLabel('today');
              }
            })
            .catch(() => undefined);
        }
      } else {
        store.addSession({
          subject_id: activeSubject.id,
          duration_minutes: activeSubject.duration_minutes,
          completed: true,
        });

        if (appState) {
          const todayKey = new Date().toDateString();

          const earnedTodayIncludingCurrent = store
            .getSessions()
            .filter(
              (session) =>
                session.completed &&
                new Date(session.created_at).toDateString() === todayKey,
            )
            .reduce(
              (sum, session) =>
                sum +
                Math.max(
                  0,
                  Number(session.duration_minutes) || 0,
                ),
              0,
            );

          const earnedTodayBeforeCurrent = Math.max(
            0,
            earnedTodayIncludingCurrent -
              activeSubject.duration_minutes,
          );

          const coinsEarned = Math.max(
            0,
            Math.min(
              activeSubject.duration_minutes,
              50 - earnedTodayBeforeCurrent,
            ),
          );

          updateAppState({
            coins: appState.coins + coinsEarned,
            gems:
              appState.gems +
              (activeSubject.duration_minutes >= 45 ? 1 : 0),
          });

          setRewardToast(
            coinsEarned > 0
              ? `+${coinsEarned} Coins`
              : (
                  language === 'ar'
                    ? 'وصلت للحد اليومي للكوينز'
                    : 'Daily Coin cap reached'
                ),
          );

          window.setTimeout(
            () => setRewardToast(null),
            4200,
          );
        }

        const today = new Date().getDay();
        const todayStreak = streakDays.find(
          (d) => d.day_of_week === today,
        );

        if (todayStreak && !todayStreak.completed) {
          store.markStreakComplete(todayStreak.id);

          setStreakDays((prev) =>
            prev.map((d) =>
              d.id === todayStreak.id
                ? { ...d, completed: true }
                : d,
            ),
          );
        }
      }
    } catch {
      setRewardToast(
        language === 'ar'
          ? 'لم تكتمل الجلسة بعد أو تعذر تأكيدها'
          : 'The session is not complete yet or could not be verified',
      );

      window.setTimeout(() => setRewardToast(null), 3600);
      return;
    }

    setIsRunning(false);
    setActivePlanTaskId(null);
    setActiveSubjectId(null);
    setCurrentDuration(25);
    setRemainingSeconds(25 * 60);

    updateAppState({ active_subject_id: null });
  }, [
    activeSubject,
    appState,
    streakDays,
    activePlanTaskId,
    updateAppState,
    language,
  ]);

  // One countdown source: persisted absolute end time.
  useEffect(() => {
    if (!isRunning) return;

    const refresh = () => {
      const snapshot = focusTimer.load();

      setRemainingSeconds(snapshot.remainingSeconds);

      if (
        snapshot.status === 'running' &&
        snapshot.remainingSeconds <= 0
      ) {
        setIsRunning(false);
        void handleComplete();
      }
    };

    refresh();

    const interval = window.setInterval(refresh, 1000);

    return () => window.clearInterval(interval);
  }, [isRunning, handleComplete]);

  const startPlannedTask = useCallback(async (task: StudyPlan['tasks'][number]) => {
    const subject =
      subjects.find((item) => item.id === task.subject_id) ??
      subjects.find(
        (item) =>
          task.subject_name &&
          item.name.toLowerCase().includes(task.subject_name.toLowerCase())
      ) ??
      subjects[0];

    if (!subject) return;

    const duration = Math.max(5, Math.min(120, task.duration_minutes));

    try {
      const currentTimer = focusTimer.load();

      if (currentTimer.status !== 'idle') {
        await focusTimer.cancel().catch(() => undefined);
      }

      const started = await focusTimer.start(
        subject.id,
        duration,
        task.id,
      );

      setActiveSubjectId(started.subjectId);
      setActivePlanTaskId(started.taskId);
      setCurrentDuration(started.durationSeconds / 60);
      setRemainingSeconds(started.remainingSeconds);
      setIsRunning(true);
      updateAppState({ active_subject_id: subject.id });

      requestMobileNotificationPermission().catch(() => undefined);
      requestStudyNotifications().catch(() => undefined);
      announceStudyTimer(language, 'start');
      scheduleStudyTimerNotifications(
        language,
        started.remainingSeconds,
      ).catch(() => undefined);

      await setTaskStatus(task.id, 'in_progress').catch(() => undefined);

      setRewardToast(
        language === 'ar'
          ? `بدأت المهمة: ${task.title}`
          : `Started: ${task.title}`
      );
      window.setTimeout(() => setRewardToast(null), 2800);

      setSwitchTaskId(null);
    } catch (error) {
      console.error('[StudyQuest] planned task start failed:', error);

      setRewardToast(
        language === 'ar'
          ? `تعذر بدء المهمة: ${error instanceof Error ? error.message : String(error)}`
          : `Could not start task: ${error instanceof Error ? error.message : String(error)}`
      );
      window.setTimeout(() => setRewardToast(null), 5000);
    }
  }, [
    subjects,
    updateAppState,
    language,
  ]);

  // Ambient sound change
  const handleSoundChange = useCallback((sound: AmbientSound) => {
    updateAppState({ ambient_sound: sound });
  }, [updateAppState]);


  if (loading) {
    return (
      <div className="studyquest-app min-h-screen overflow-hidden bg-ink-800 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full border-2 border-neon-cyan/30 border-t-neon-cyan animate-spin" />
          <p className="text-sm text-gray-500 font-mono">{TRANSLATIONS[language].loadingStudyQuest}</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="studyquest-app min-h-screen bg-ink-800 flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 w-20 h-20 rounded-3xl border border-neon-cyan/30 bg-neon-cyan/10 flex items-center justify-center shadow-2xl">
            <span className="font-display font-black text-3xl text-neon-cyan">SQ</span>
          </div>
          <h1 className="font-display text-3xl font-black text-white">StudyQuest</h1>
          <p className="mt-2 text-sm text-gray-400">Sign in or create your account to continue. Your progress will be saved to your account.</p>
          <div className="mt-6 flex justify-center">
            <AccountMenu t={t} required />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`studyquest-app relative min-h-screen overflow-x-hidden text-gray-200 theme-${theme}`} data-theme={theme}>
      {/* Background ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] rounded-full bg-neon-cyan/5 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-neon-emerald/5 blur-[100px]" />
      </div>

      <div className="relative z-50">
        <Navbar
          coins={appState?.coins ?? 0}
          gems={appState?.gems ?? 0}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          language={language}
          languages={LANGUAGES}
          onLanguageChange={setLanguage}
          theme={theme}
          onThemeChange={setTheme}
          t={t}
          isAdmin={isAdmin}
        />
      </div>

      <style>{`
        .studyquest-app {
          --sq-bg: #06111f;
          --sq-surface: rgba(8, 25, 47, 0.72);
          --sq-surface-solid: #0a1a30;
          --sq-text: #e8f6ff;
          --sq-muted: #8ca6bc;
          --sq-muted-strong: #c9deef;
          --sq-heading: #f5fbff;
          --sq-border: rgba(105, 211, 255, 0.20);
          --sq-border-soft: rgba(255, 255, 255, 0.08);
          --sq-hover: rgba(89, 198, 255, 0.08);
          --sq-glow: rgba(0, 205, 255, 0.16);
          background: var(--sq-bg);
          color: var(--sq-text);
          transition: background-color 420ms ease, color 300ms ease;
        }

        .studyquest-app.theme-dark {
          --sq-bg: #03050a;
          --sq-surface: rgba(10, 14, 24, 0.82);
          --sq-surface-solid: #0a0f19;
          --sq-text: #eaf4ff;
          --sq-heading: #f8fcff;
          --sq-muted: #8a9bb1;
          --sq-muted-strong: #c2d3e6;
          --sq-border: rgba(100, 205, 255, 0.16);
          --sq-border-soft: rgba(255, 255, 255, 0.065);
          --sq-hover: rgba(70, 190, 255, 0.07);
          --sq-glow: rgba(0, 210, 255, 0.13);
          background-image: radial-gradient(circle at 15% 10%, rgba(43, 95, 160, .14), transparent 26%), radial-gradient(circle at 88% 75%, rgba(107, 53, 190, .12), transparent 28%), linear-gradient(135deg,#02040a,#07101e 50%,#03050b);
        }

        .studyquest-app.theme-light {
          --sq-bg: #f3f7fc;
          --sq-surface: rgba(255, 255, 255, 0.88);
          --sq-surface-solid: #ffffff;
          --sq-text: #172033;
          --sq-muted: #667085;
          --sq-muted-strong: #344054;
          --sq-heading: #101828;
          --sq-border: rgba(15, 23, 42, 0.12);
          --sq-border-soft: rgba(15, 23, 42, 0.07);
          --sq-hover: rgba(15, 23, 42, 0.055);
          --sq-glow: rgba(0, 157, 255, 0.08);
        }

        .studyquest-app.theme-ice {
          --sq-heading: #f5fbff;
          --sq-muted-strong: #d4ebfa;
          background-image: radial-gradient(circle at 75% 5%, rgba(30, 170, 255, .12), transparent 30%), radial-gradient(circle at 10% 90%, rgba(123, 92, 255, .10), transparent 28%), linear-gradient(135deg, #06101e 0%, #07182b 45%, #06111f 100%);
        }

        .studyquest-app.theme-dark.bg-ink-800,
        .studyquest-app.theme-ice.bg-ink-800 { background-color: var(--sq-bg) !important; }
        .studyquest-app.theme-light.bg-ink-800 { background-color: var(--sq-bg) !important; }
        .studyquest-app.theme-light .bg-ink-800 { background-color: var(--sq-bg) !important; }
        .studyquest-app.theme-light .bg-ink-900 { background-color: #e9eef6 !important; }
        .studyquest-app.theme-light .bg-ink-700,
        .studyquest-app.theme-light .bg-ink-600,
        .studyquest-app.theme-light .bg-white\/5 { background-color: var(--sq-hover) !important; }
        .studyquest-app.theme-light .glass {
          background: var(--sq-surface) !important;
          border-color: var(--sq-border-soft) !important;
          box-shadow: 0 10px 35px rgba(15, 23, 42, 0.06);
        }
        .studyquest-app.theme-light .text-gray-200,
        .studyquest-app.theme-light .text-gray-300 { color: var(--sq-text) !important; }
        .studyquest-app.theme-light .text-gray-400,
        .studyquest-app.theme-light .text-gray-500,
        .studyquest-app.theme-light .text-gray-600 { color: var(--sq-muted) !important; }
        .studyquest-app.theme-light .text-white { color: #111827 !important; }
        .studyquest-app.theme-light .border-white\/5,
        .studyquest-app.theme-light .border-white\/10,
        .studyquest-app.theme-light .border-white\/20 { border-color: var(--sq-border) !important; }
        .studyquest-app.theme-light .neon-text-cyan,
        .studyquest-app.theme-light .neon-text-emerald,
        .studyquest-app.theme-light .neon-text-amber,
        .studyquest-app.theme-light .neon-text-rose,
        .studyquest-app.theme-light .neon-text-green { text-shadow: none; }

        .studyquest-control,
        .studyquest-language-control {
          background: var(--sq-surface);
          border-color: var(--sq-border);
          color: var(--sq-text);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        }
        .studyquest-control:hover,
        .studyquest-language-control:hover { background: var(--sq-hover); }
        .studyquest-language-select { color: var(--sq-text); }
        .studyquest-language-select option { background: var(--sq-surface-solid); color: var(--sq-text); }
        .studyquest-app select option { background: var(--sq-surface-solid); color: var(--sq-text); }
        .studyquest-app.theme-light select option { background: #ffffff; color: #111827; }
        .studyquest-app.theme-dark select option, .studyquest-app.theme-ice select option { background: #0a1a30; color: #e8f6ff; }

        .sq-shell-card {
          background: var(--sq-surface);
          border: 1px solid var(--sq-border);
          box-shadow: 0 18px 60px rgba(0, 0, 0, .18), 0 0 30px var(--sq-glow);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }

        .studyquest-app, .studyquest-app *, .studyquest-app::before, .studyquest-app::after {
          transition-property: background-color, border-color, color, box-shadow, text-shadow, opacity, transform;
          transition-duration: 300ms;
          transition-timing-function: ease;
        }
        .studyquest-app .animate-spin, .studyquest-app .animate-pulse, .studyquest-app .animate-fade-in, .studyquest-app .rotate-border, .studyquest-app .motivational-shift { transition: none; }
        @media (prefers-reduced-motion: reduce) { .studyquest-app, .studyquest-app *, .studyquest-app::before, .studyquest-app::after { transition-duration: 0ms !important; } }
      `}</style>

      {/* Sync indicator */}
      {(isSyncing || !isOnline) && (
        <div className="fixed top-14 md:top-16 right-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full glass border border-white/10 text-xs">
          {isSyncing ? (
            <>
              <div className="w-3 h-3 rounded-full border border-neon-cyan/40 border-t-neon-cyan animate-spin" />
              <span className="text-gray-400">{TRANSLATIONS[language].syncing}</span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full bg-neon-amber animate-pulse" />
              <span className="text-neon-amber/80">{TRANSLATIONS[language].offline}</span>
            </>
          )}
        </div>
      )}

      {activeTab === 'dashboard' && appState && (
        <div className="fixed top-[4.4rem] left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 rounded-2xl border border-amber-300/20 bg-slate-950/80 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,.25)]" aria-label="StudyQuest rewards">
          <div className="flex items-center gap-1.5 text-neon-amber font-mono font-black text-sm"><span aria-hidden="true">🪙</span><span>{appState.coins.toLocaleString()}</span><span className="hidden sm:inline text-[10px] font-sans text-gray-500">Coins</span></div>
          <span className="w-px h-4 bg-white/10" />
          <div className="flex items-center gap-1.5 text-neon-cyan font-mono font-black text-sm"><span aria-hidden="true">💎</span><span>{appState.gems}</span></div>
        </div>
      )}
      {typeof document !== 'undefined' && deleteTaskId && createPortal((() => {
        const deleteTask = tomorrowPlan?.tasks?.find((item) => item.id === deleteTaskId);
        if (!deleteTask) return null;

        return (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 backdrop-blur-sm px-4">
            <div className="w-full max-w-md rounded-3xl border border-red-300/20 bg-slate-950/95 p-6 shadow-[0_0_60px_rgba(255,70,90,.16)]">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-red-300/20 bg-red-400/10 text-2xl">
                  🗑️
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-black text-white">
                    {language === 'ar' ? 'حذف المهمة؟' : 'Delete task?'}
                  </h3>
                  <p className="mt-2 text-sm text-gray-400">
                    {language === 'ar'
                      ? 'هل أنت متأكد إنك عايز تحذف هذه المهمة؟'
                      : 'Are you sure you want to delete this task?'}
                  </p>
                  <p className="mt-2 truncate text-sm font-bold text-cyan-300">
                    {deleteTask.title}
                  </p>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteTaskId(null)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-gray-300 transition hover:bg-white/10"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await deletePlanTask(deleteTask.id);

                      setTomorrowPlan((current) =>
                        current
                          ? {
                              ...current,
                              tasks: (current.tasks ?? []).filter(
                                (item) => item.id !== deleteTask.id
                              ),
                            }
                          : current
                      );

                      if (activePlanTaskId === deleteTask.id) {
                        setActivePlanTaskId(null);
                      }

                      setDeleteTaskId(null);

                      setRewardToast(
                        language === 'ar'
                          ? 'تم حذف المهمة بنجاح.'
                          : 'The task was deleted successfully.'
                      );
                      window.setTimeout(() => setRewardToast(null), 2600);
                    } catch (error) {
                      console.error('[StudyQuest] delete task failed:', error);

                      setDeleteTaskId(null);
                      setRewardToast(
                        language === 'ar'
                          ? `فشل الحذف: ${error instanceof Error ? error.message : String(error)}`
                          : `Delete failed: ${error instanceof Error ? error.message : String(error)}`
                      );
                      window.setTimeout(() => setRewardToast(null), 5000);
                    }
                  }}
                  className="rounded-xl border border-red-300/30 bg-red-400/10 px-4 py-2.5 text-sm font-black text-red-300 transition hover:bg-red-400/20"
                >
                  {language === 'ar' ? 'حذف المهمة' : 'Delete task'}
                </button>
              </div>
            </div>
          </div>
        );
})(), document.body)}
      {typeof document !== 'undefined' && switchTaskId && createPortal((() => {
        const switchTask = tomorrowPlan?.tasks?.find((item) => item.id === switchTaskId);
        if (!switchTask) return null;

        const runningTitle =
          tomorrowPlan?.tasks?.find((item) => item.id === activePlanTaskId)?.title ??
          displayActiveSubject?.name ??
          (language === 'ar' ? 'مهمة حالية' : 'Current task');

        return (
          <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
            <div className="w-full max-w-md rounded-3xl border border-violet-300/20 bg-slate-950/95 p-6 shadow-[0_0_70px_rgba(120,90,255,.18)]">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-violet-300/20 bg-violet-400/10 text-2xl">
                  ⚡
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-violet-300 font-black">
                    StudyQuest
                  </p>
                  <h3 className="mt-1 text-lg font-black text-white">
                    {language === 'ar'
                      ? 'عندك جلسة شغالة'
                      : 'A focus session is running'}
                  </h3>
                  <p className="mt-2 text-sm text-gray-400">
                    {language === 'ar'
                      ? 'هل تريد إيقاف الجلسة الحالية وبدء المهمة الجديدة فورًا؟'
                      : 'Do you want to stop the current session and start the new task now?'}
                  </p>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">
                      {language === 'ar' ? 'الحالية' : 'Current'}
                    </p>
                    <p className="mt-1 truncate text-sm font-bold text-cyan-300">
                      {runningTitle}
                    </p>
                    <p className="mt-3 text-[10px] uppercase tracking-wider text-gray-500">
                      {language === 'ar' ? 'الجديدة' : 'New task'}
                    </p>
                    <p className="mt-1 truncate text-sm font-bold text-violet-300">
                      {switchTask.title}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSwitchTaskId(null)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-gray-300 transition hover:bg-white/10"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    await startPlannedTask(switchTask);
                  }}
                  className="rounded-xl border border-violet-300/30 bg-violet-400/10 px-4 py-2.5 text-sm font-black text-violet-200 transition hover:bg-violet-400/20"
                >
                  {language === 'ar'
                    ? 'أوقف الحالية وابدأ الجديدة'
                    : 'Stop current & start new'}
                </button>
              </div>
            </div>
          </div>
        );
})(), document.body)}
      {rewardToast && (
        <div
          className={`fixed top-20 left-1/2 -translate-x-1/2 z-[9998] px-5 py-3 rounded-2xl font-black shadow-[0_0_35px_rgba(0,0,0,.25)] animate-fade-in ${
            rewardToastIsError
              ? 'border border-red-300/35 bg-red-400/10 text-red-300'
              : 'border border-amber-300/35 bg-amber-400/10 text-amber-200'
          }`}
          role="status"
        >
          {rewardToastIsError ? '⚠️' : '🪙'} {rewardToast}
        </div>
      )}

      <main className="relative pt-20 md:pt-20 lg:pt-8 pb-24 md:pb-0 px-4 md:px-6 lg:px-10 lg:pl-[18rem]">
        <div className="max-w-6xl mx-auto">
          {/* Dashboard tab */}
          {activeTab === 'dashboard' && (
            <div className="flex flex-col items-center gap-8 animate-fade-in">
              {/* Timer section */}
              <section className="w-full flex flex-col items-center gap-6 py-4">
                <PomodoroTimer
                  t={t}
                  durationMinutes={currentDuration}
                  remainingSeconds={remainingSeconds}
                  isRunning={isRunning}
                  onStart={handleStart}
                  onPause={handlePause}
                  onReset={handleReset}
                  subjectName={timerDisplayName}
                />

                <StudyAudio language={language} />
                {/* Ambient sound controls remain available for the existing rain/ambient modes. */}
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{TRANSLATIONS[language].ambient}</span>
                  <AmbientSoundWidget
                    language={language}
                    t={t}
                    value={(appState?.ambient_sound as AmbientSound) ?? 'none'}
                    onChange={handleSoundChange}
                  />
                </div>
              </section>

              <TomorrowPlanner language={language} t={t} onPlanReady={(plan) => { setTomorrowPlan(plan); setPlanDateLabel('tomorrow'); }} />
              <StudyAssistant language={language} t={t} />

              {tomorrowPlan?.tasks?.length ? (
                <section className="w-full rounded-3xl sq-shell-card border border-violet-300/15 p-4 md:p-5">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wider text-neon-violet font-bold">{planDateLabel === 'today' ? (language === 'ar' ? 'خطة اليوم' : 'Today’s plan') : t('planCards')}</p>
                      <h3 className="font-display font-bold text-lg text-[var(--sq-heading)] mt-1 truncate">{tomorrowPlan.title}</h3>
                    </div>
                    <span className="premium-tag shrink-0">{t('aiGenerated')}</span>
                  </div>
                  {planDateLabel === 'today' && (() => {
                    const completedTasks =
                      dailyAIStatus?.completed_tasks ??
                      tomorrowPlan.tasks.filter((task) => task.status === 'completed').length;

                    const totalTasks =
                      dailyAIStatus?.total_tasks ??
                      tomorrowPlan.tasks.length;

                    const taskProgress =
                      totalTasks > 0
                        ? Math.min(100, Math.round((completedTasks / totalTasks) * 100))
                        : 0;

                    const correctDays = Math.min(
                      26,
                      Math.max(0, dailyAIStatus?.correct_days ?? 0),
                    );

                    const dayCorrect = Boolean(dailyAIStatus?.correct);

                    return (
                      <div className="mb-4 rounded-3xl border border-violet-300/15 bg-gradient-to-br from-violet-400/[0.07] via-slate-950/20 to-cyan-400/[0.04] p-4 md:p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">
                              {language === 'ar' ? 'تقدم اليوم' : 'Today’s progress'}
                            </p>

                            <h4 className="mt-1 text-base md:text-lg font-black text-[var(--sq-heading)]">
                              {dayCorrect
                                ? (language === 'ar'
                                    ? '⭐ يوم صحيح — أنجزت كل المهام'
                                    : t('dailyCorrectTitle'))
                                : (language === 'ar'
                                    ? '🎯 كمّل مهام اليوم'
                                    : t('dailyIncompleteBody'))}
                            </h4>

                            <p className="mt-1 text-xs text-[var(--sq-muted)]">
                              {completedTasks}/{totalTasks}
                              {' '}
                              {language === 'ar' ? 'مهام مكتملة' : 'tasks completed'}
                            </p>
                          </div>

                          <div className="shrink-0 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-center">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--sq-muted)]">
                              {language === 'ar' ? 'التقدم إلى النجمة الذهبية' : 'Golden Star progress'}
                            </p>
                            <p className="mt-1 text-2xl font-black text-neon-amber">
                              ⭐ {correctDays}/26
                            </p>
                          </div>
                        </div>

                        <div className="mt-4">
                          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-300 transition-all duration-500"
                              style={{ width: `${taskProgress}%` }}
                            />
                          </div>
                        </div>

                        <div className="mt-4">
                          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                              <p className="text-[11px] font-black uppercase tracking-wider text-neon-amber">
                                {t('dailyBonus')}
                              </p>
                              <p className="mt-1 text-xs leading-5 text-[var(--sq-muted)]">
                                {t('dailyBonusBody')}
                              </p>
                            </div>

                            <div className="shrink-0 text-xs font-black text-neon-amber">
                              1 min = 1 🪙 · max 50/day
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {[15, 25, 45, 60].map((minutes) => {
                              const coins = Math.min(50, minutes);

                              return (
                                <div
                                  key={minutes}
                                  className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-center"
                                >
                                  <p className="text-[10px] font-bold text-[var(--sq-muted)]">
                                    {minutes} {t('minutes')}
                                  </p>
                                  <p className="mt-1 text-sm font-black text-neon-amber">
                                    +{coins} {t('coinsShort')}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="grid gap-3">
                    {tomorrowPlan.tasks.map((task, index) => {
                      const isNext = task.id === nextPlanTask?.id;
                      const isActive = task.id === activePlanTaskId;
                      const isDone = task.status === 'completed';
                      return (
                        <article key={task.id} className={`plan-task-card ${isActive || isNext ? 'is-current' : ''} ${isDone ? 'is-complete' : ''}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="plan-task-index">{index + 1}</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-bold text-sm md:text-base text-[var(--sq-heading)]">{task.title}</h4>
                                {(isActive || isNext) && <span className="premium-tag">{isActive ? 'Running' : t('currentTask')}</span>}
                                {isDone && <span className="text-[10px] font-black text-emerald-300">{t('completedTask')}</span>}
                              </div>
                              <p className="text-xs text-[var(--sq-muted)] mt-1">{task.duration_minutes} {t('minutes')}{task.start_at ? ` · ${new Date(task.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
                              {task.notes && <p className="text-xs text-[var(--sq-muted-strong)] mt-1 line-clamp-2">{task.notes}</p>}
                            </div>
                            <button
                              type="button"
                              onClick={async () => {
                                setDeleteTaskId(task.id);
                                return;
                                try {
                                  await deletePlanTask(task.id);
                                  setTomorrowPlan((current) =>
                                    current
                                      ? {
                                          ...current,
                                          tasks: (current.tasks ?? []).filter(
                                            (item) => item.id !== task.id
                                          ),
                                        }
                                      : current
                                  );

                                  if (activePlanTaskId === task.id) {
                                    setActivePlanTaskId(null);
                                  }
                                } catch (error) {
                                  console.error('[StudyQuest] delete task failed:', error);
                                  setRewardToast(
                                    language === 'ar'
                                      ? `فشل الحذف: ${error instanceof Error ? error.message : String(error)}`
                                      : `Delete failed: ${error instanceof Error ? error.message : String(error)}`
                                  );
                                  window.setTimeout(() => setRewardToast(null), 5000);
                                }
                              }}
                              className="shrink-0 px-4 py-2.5 rounded-xl bg-red-400/10 border border-red-300/25 text-red-300 text-sm font-bold"
                            >
                              {language === 'ar' ? 'حذف' : 'Delete'}
                            </button>
                            {!isDone && <button type="button" onClick={async () => {
                              const currentTimer = focusTimer.load();

                              if (
                                currentTimer.status !== 'idle' &&
                                currentTimer.taskId !== task.id
                              ) {
                                setSwitchTaskId(task.id);
                                return;
                              }

                              await startPlannedTask(task);
                            }} className="shrink-0 px-4 py-2.5 rounded-xl bg-neon-violet/10 border border-neon-violet/30 text-neon-violet text-sm font-bold">{t('startPlannedTask')}</button>}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {isOnline && user && (
                <section className="w-full rounded-2xl sq-shell-card border border-amber-300/15 p-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <p className="text-[11px] text-neon-amber uppercase tracking-wider font-black">Coin Economy</p>
                      <h3 className="mt-1 text-sm md:text-base font-black text-[var(--sq-heading)]">50 Coins maximum from study rewards each day</h3>
                      <p className="mt-1 text-[11px] text-[var(--sq-muted)]">1 verified study minute = 1 Coin, until the daily cap is reached. Coins are earned through study, not handed out for opening the app.</p>
                    </div>
                    <div className="shrink-0 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-center">
                      <p className="text-[10px] text-[var(--sq-muted)]">Daily cap</p>
                      <p className="text-2xl font-black text-neon-amber">50 🪙</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {[25, 45, 60].map((minutes) => (
                      <div key={minutes} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-center">
                        <p className="text-[10px] text-[var(--sq-muted)]">{minutes} {t('minutes')}</p>
                        <p className="mt-1 text-xs font-black text-neon-amber">+{Math.min(50, minutes)} {t('coinsShort')}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Manual subjects remain available when no AI plan has been created. */}
              {!tomorrowPlan?.tasks?.length && (
                <section className="w-full">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-display font-bold text-lg text-gray-200">{TRANSLATIONS[language].dailyStudyGoals}</h2>
                    {isRunning && (
                      <span className="text-xs font-medium text-neon-amber px-3 py-1 rounded-full bg-neon-amber/10 border border-neon-amber/20 neon-text-amber">
                        {TRANSLATIONS[language].lockInActive}
                      </span>
                    )}
                  </div>
                  <SubjectGrid
                    t={t}
                    subjects={displaySubjects}
                    activeSubjectId={activeSubjectId}
                    isRunning={isRunning}
                    onSelect={handleSelectSubject}
                    onEditDuration={handleEditDuration}
                    onEditName={handleEditName}
                  />
                </section>
              )}

              {/* Streak + Pet */}
              <section className="w-full grid grid-cols-1 md:grid-cols-2 gap-4">
                <StreakBoard streakDays={streakDays} language={language} t={t} />
                <PetCard
                  language={language}
                  t={t}
                  petId={equippedPetId || undefined}
                  petName={equippedPetId ? (equippedPetId === 'sparky' ? (appState?.pet_name ?? 'Sparky') : (PET_CATALOG.find((p) => p.id === equippedPetId)?.name ?? '')) : ''}
                  petXp={equippedPetId ? (appState?.pet_xp ?? 0) : 0}
                  petXpMax={equippedPetId ? (appState?.pet_xp_max ?? 100) : 100}
                />
                <section className="relative overflow-hidden rounded-3xl sq-shell-card border border-cyan-300/15 p-5">
                  <div className="absolute -right-8 -bottom-10 w-40 h-40 rounded-full bg-cyan-300/10 blur-3xl pointer-events-none" />
                  <div className="relative flex items-start gap-4">
                    <div className="w-14 h-14 rounded-2xl overflow-hidden border border-cyan-300/20 bg-cyan-300/5 shrink-0"><img src={getPetVisual('frost-kit').asset} alt="" className="w-full h-full object-cover mix-blend-screen" style={{filter:getPetVisual('frost-kit').filter}} /></div>
                    <div className="min-w-0"><p className="text-[11px] uppercase tracking-[.18em] text-neon-amber font-black">{t('coinGuideTitle')}</p><p className="mt-1 text-sm font-bold text-[var(--sq-heading)]">{t('coinGuideBody')}</p><p className="mt-2 text-xs text-[var(--sq-muted)]">{streakDays.filter((d) => d.completed).length < 2 ? (streakDays.some((d) => d.completed) ? t('firstDayMessage') : t('starterCompanionBody')) : t('secondDayMessage')}</p></div>
                  </div>
                </section>
              </section>
            </div>
          )}

          {/* Profile */}
          {activeTab === 'profile' && (
            <div className="flex flex-col gap-6">
              <ProfilePage language={language} t={t} />
            </div>
          )}

          {/* Leaderboard + Safe Study Lounge */}
          {activeTab === 'leaderboards' && <Leaderboard language={language} t={(key) => TRANSLATIONS[language][key as TranslationKey]} />}

          {/* Premium world */}
          {activeTab === 'skins' && <PremiumPage language={language} t={t} />}
          {activeTab === 'admin' && isAdmin && <AdminDashboard language={language} />}
        </div>
      </main>

      <Footer t={t} language={language} />
      <MobileNav activeTab={activeTab} onTabChange={setActiveTab} t={t} isAdmin={isAdmin} />

      {/* Mobile motivational quote */}
      <div className="md:hidden fixed bottom-16 left-0 right-0 z-40 px-4 pointer-events-none">
        <p className="text-center text-xs font-display font-bold text-neon-emerald/70 neon-text-emerald truncate">
          {TRANSLATIONS[language][(['keepGrinding', 'everyMinute', 'knowledgePower', 'stayLocked', 'petBelieves'] as TranslationKey[])[quoteIndex]]}
        </p>
      </div>
    </div>
  );
}
