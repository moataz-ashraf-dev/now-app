import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { LanguageCode } from '@/lib/i18n';

export type StudyPlanTask = {
  id: string;
  plan_id: string;
  user_id: string;
  subject_id: string | null;
  subject_name?: string | null;
  position: number;
  title: string;
  notes: string | null;
  start_at: string | null;
  duration_minutes: number;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StudyPlan = {
  id: string;
  user_id: string;
  plan_date: string;
  source: 'manual' | 'ai';
  prompt: string | null;
  title: string;
  timezone: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  created_at: string;
  updated_at: string;
  tasks?: StudyPlanTask[];
};

export async function loadPlan(date: string): Promise<StudyPlan | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.from('study_plans').select('*, study_plan_tasks(*)').eq('plan_date', date).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, tasks: ((data.study_plan_tasks ?? []) as StudyPlanTask[]).sort((a, b) => a.position - b.position) } as StudyPlan;
}

export async function generateTomorrowPlan(prompt: string, planDate: string, timezone: string, language: LanguageCode = 'en'): Promise<StudyPlan> {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.functions.invoke('plan-tomorrow', { body: { prompt, plan_date: planDate, timezone, language } });
  if (error) throw error;
  return data as StudyPlan;
}

export async function setTaskStatus(taskId: string, status: Exclude<StudyPlanTask['status'], 'completed'>): Promise<void> {
  if (!isSupabaseConfigured) return;
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error('not_authenticated');
  const { error } = await supabase.from('study_plan_tasks').update({ status, completed_at: null }).eq('id', taskId).eq('user_id', userId);
  if (error) throw error;
}

export async function completePlanTask(taskId: string, sessionId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await supabase.rpc('complete_study_plan_task', {
    p_task_id: taskId,
    p_session_id: sessionId,
  });
  if (error) throw error;
}

export async function deletePlanTask(taskId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await supabase.rpc('delete_study_plan_task', {
    p_task_id: taskId,
  });
  if (error) {
    console.error('[StudyQuest] deletePlanTask failed:', error);
    throw error;
  }
}

export type DailyAIStatus = {
  plan_date: string;
  has_plan: boolean;
  correct: boolean;
  completed_tasks: number;
  total_tasks: number;
  correct_days: number;
  golden_star_awarded: boolean;
  coins: number;
  stars: number;
};

export async function getDailyAIStatus(date: string): Promise<DailyAIStatus | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('get_daily_ai_status', { p_plan_date: date });
  if (error) throw error;
  return (data ?? null) as DailyAIStatus | null;
}

export async function finalizeDailyAIPlan(planId: string): Promise<DailyAIStatus | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('finalize_daily_ai_plan', { p_plan_id: planId });
  if (error) throw error;
  return (data ?? null) as DailyAIStatus | null;
}

export function localCalendarDate(offsetDays = 0): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
