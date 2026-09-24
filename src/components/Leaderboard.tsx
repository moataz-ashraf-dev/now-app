import { useEffect, useMemo, useState } from 'react';
import { Flag, ShieldCheck, Filter, FileCheck2, FlagTriangleRight, Users, Trophy, Globe2, MapPin, X, Loader2, GraduationCap, LogIn, LogOut, Send, MessageCircle } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { getActiveUserId, getUserStorageKey } from '@/lib/storageIdentity';
import ProfileAvatar, { avatarThemeDef, type AvatarPetPosition, type AvatarTheme } from '@/components/ProfileAvatar';

type TranslationFn = (key: string) => string;
type LanguageCode = 'en' | 'de' | 'ja' | 'ar' | 'fr';
const EXTRA_COPY: Record<LanguageCode, Record<string,string>> = {
  en: { signIn:'Sign in to use the verified leaderboard.', empty:'No verified students are available in this scope yet.', lounge:'Text study rooms are the safe community foundation. Voice is intentionally not enabled in this release.' },
  ar: { signIn:'سجّل الدخول لاستخدام لوحة الترتيب الموثقة.', empty:'لا يوجد طلاب موثّقون متاحون في هذا النطاق حتى الآن.', lounge:'غرف الدراسة النصية هي أساس المجتمع الآمن. الصوت غير مفعّل في هذا الإصدار.' },
  de: { signIn:'Melde dich an, um die verifizierte Bestenliste zu nutzen.', empty:'In diesem Bereich sind noch keine verifizierten Schüler verfügbar.', lounge:'Text-Lernräume sind die sichere Community-Grundlage. Sprache ist in dieser Version deaktiviert.' },
  ja: { signIn:'認証済みランキングを利用するにはログインしてください。', empty:'この範囲にはまだ認証済みの学生がいません。', lounge:'テキスト学習ルームを安全なコミュニティの基盤としています。音声はこのリリースでは無効です。' },
  fr: { signIn:'Connectez-vous pour utiliser le classement vérifié.', empty:'Aucun élève vérifié n’est encore disponible dans ce périmètre.', lounge:'Les salles d’étude textuelles sont la base de la communauté sécurisée. La voix est désactivée dans cette version.' },
};
type Scope = 'global' | 'international' | 'city';
type Student = { user_id: string; display_name: string; country_code: string | null; city: string | null; total_xp: number; level: number; current_streak: number; longest_streak: number; avatar_url?: string | null; avatar_theme?: string | null; avatar_pet_position?: string | null; equipped_pet_id?: string | null; equipped_frame_id?: string | null; owned_pet_count?: number | null; };
type Room = { id: string; nameKey: string; descriptionKey: string; subjectKey: string };
type RoomMessage = { id: string; room_id: string; user_id: string; body: string; created_at: string; display_name?: string };
type RankMessage = { id: string; scope: Scope; user_id: string; body: string; created_at: string };
const RANK_CHAT_STORAGE = 'studyquest_rank_chat_v1';
function localRankChat(): Record<string, RankMessage[]> {
  try { const raw = localStorage.getItem(getUserStorageKey(RANK_CHAT_STORAGE)); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function saveLocalRankChat(data: Record<string, RankMessage[]>) { try { localStorage.setItem(getUserStorageKey(RANK_CHAT_STORAGE), JSON.stringify(data)); } catch { /* best effort */ } }

const ROOMS: Room[] = [
  { id: 'physics', nameKey: 'physicsMastermindsRoom', descriptionKey: 'roomDescriptionPhysics', subjectKey: 'physicsMastermindsRoom' },
  { id: 'calculus', nameKey: 'advancedCalculusHub', descriptionKey: 'roomDescriptionCalculus', subjectKey: 'advancedCalculusHub' },
  { id: 'javascript', nameKey: 'javascriptBuildersRoom', descriptionKey: 'roomDescriptionJavaScript', subjectKey: 'javascriptBuildersRoom' },
  { id: 'english', nameKey: 'englishConversationStudyRoom', descriptionKey: 'roomDescriptionEnglish', subjectKey: 'englishConversationStudyRoom' },
  { id: 'chemistry', nameKey: 'chemistryFocusRoom', descriptionKey: 'roomDescriptionChemistry', subjectKey: 'chemistryFocusRoom' },
  { id: 'exam', nameKey: 'examPreparationRoom', descriptionKey: 'roomDescriptionExam', subjectKey: 'examPreparationRoom' },
];

const ROOM_STORAGE = 'studyquest_room_lounge_v1';
function localRoomData(): { joined: string[]; messages: Record<string, RoomMessage[]> } {
  try {
    const raw = localStorage.getItem(getUserStorageKey(ROOM_STORAGE));
    const parsed = raw ? JSON.parse(raw) : {};
    return { joined: Array.isArray(parsed.joined) ? parsed.joined : [], messages: parsed.messages ?? {} };
  } catch { return { joined: [], messages: {} }; }
}
function saveLocalRoomData(data: { joined: string[]; messages: Record<string, RoomMessage[]> }) {
  try { localStorage.setItem(getUserStorageKey(ROOM_STORAGE), JSON.stringify(data)); } catch { /* best effort */ }
}

export default function Leaderboard({ t, language = 'en' }: { t: TranslationFn; language?: LanguageCode }) {
  const copy = EXTRA_COPY[language];
  const { user } = useAuth();
  const [scope, setScope] = useState<Scope>('global');
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reportRoomId, setReportRoomId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reported, setReported] = useState(false);
  const [joinedRooms, setJoinedRooms] = useState<string[]>(() => localRoomData().joined);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomError, setRoomError] = useState('');
  const [rankMessages, setRankMessages] = useState<RankMessage[]>([]);
  const [rankMessageText, setRankMessageText] = useState('');
  const [rankChatBusy, setRankChatBusy] = useState(false);
  const [rankChatError, setRankChatError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!user || !isSupabaseConfigured || !navigator.onLine) { setStudents([]); return; }
    setLoading(true); setError('');
    supabase.rpc('get_leaderboard', { p_scope: scope, p_limit: 50 }).then(({ data, error: rpcError }) => {
      if (cancelled) return;
      if (rpcError) setError(rpcError.message);
      else setStudents((data ?? []) as Student[]);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [scope, user?.id]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured || !navigator.onLine) return;
    supabase.from('study_room_members').select('room_id').eq('user_id', user.id).then(({ data }) => {
      if (data) setJoinedRooms(data.map((row) => row.room_id));
    }).catch(() => undefined);
  }, [user?.id]);

  const loadRankMessages = async (chatScope: Scope) => {
    if (chatScope === 'global') { setRankMessages([]); return; }
    setRankChatError('');
    if (!isSupabaseConfigured || !user || !navigator.onLine) {
      setRankMessages((localRankChat()[chatScope] ?? []).slice(-3));
      return;
    }
    const { data, error: chatError } = await supabase
      .from('leaderboard_scope_messages')
      .select('id,scope,user_id,body,created_at')
      .eq('scope', chatScope)
      .order('created_at', { ascending: false })
      .limit(3);
    if (chatError) setRankChatError(chatError.message.replace(/_/g, ' '));
    else setRankMessages(((data ?? []) as RankMessage[]).reverse());
  };

  useEffect(() => {
    loadRankMessages(scope).catch(() => undefined);
    if (scope === 'global') return;
    const timer = window.setInterval(() => loadRankMessages(scope).catch(() => undefined), 7000);
    return () => window.clearInterval(timer);
  }, [scope, user?.id]);

  const sendRankMessage = async () => {
    const body = rankMessageText.trim().slice(0, 240);
    if (scope === 'global' || !body || rankChatBusy) return;
    setRankChatBusy(true); setRankChatError('');
    try {
      const createdAt = new Date().toISOString();
      if (isSupabaseConfigured && user && navigator.onLine) {
        const { data, error: sendError } = await supabase.from('leaderboard_scope_messages').insert({ scope, user_id: user.id, body }).select('id,scope,user_id,body,created_at').single();
        if (sendError) throw sendError;
        if (data) setRankMessages((prev) => [...prev, data as RankMessage].slice(-3));
      } else {
        const local = localRankChat();
        const item: RankMessage = { id:`rank-${Date.now()}-${Math.random().toString(36).slice(2)}`, scope, user_id:user?.id ?? 'local', body, created_at:createdAt };
        local[scope] = [...(local[scope] ?? []), item].slice(-3);
        saveLocalRankChat(local); setRankMessages(local[scope]);
      }
      setRankMessageText('');
    } catch (e) { setRankChatError(e instanceof Error ? e.message.replace(/_/g, ' ') : 'Message failed'); }
    finally { setRankChatBusy(false); }
  };

  const activeRoom = useMemo(() => ROOMS.find((room) => room.id === activeRoomId) ?? null, [activeRoomId]);

  const loadMessages = async (roomId: string) => {
    if (!roomId) return;
    setRoomError('');
    if (!isSupabaseConfigured || !user || !navigator.onLine) {
      const data = localRoomData();
      setMessages(data.messages[roomId] ?? []);
      return;
    }
    const { data, error: loadError } = await supabase
      .from('study_room_messages')
      .select('id,room_id,user_id,body,created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(100);
    if (loadError) setRoomError(loadError.message);
    else setMessages((data ?? []) as RoomMessage[]);
  };

  useEffect(() => {
    if (!activeRoomId) return;
    loadMessages(activeRoomId);
    if (!isSupabaseConfigured || !user || !navigator.onLine) return;
    const timer = window.setInterval(() => loadMessages(activeRoomId), 5000);
    return () => window.clearInterval(timer);
  }, [activeRoomId, user?.id]);

  const joinRoom = async (roomId: string) => {
    setRoomBusy(true); setRoomError('');
    try {
      if (isSupabaseConfigured && user && navigator.onLine) {
        const { error: joinError } = await supabase.from('study_room_members').upsert({ room_id: roomId, user_id: user.id, last_seen_at: new Date().toISOString() }, { onConflict: 'room_id,user_id' });
        if (joinError) throw joinError;
      } else {
        const data = localRoomData();
        if (!data.joined.includes(roomId)) data.joined.push(roomId);
        if (!data.messages[roomId]) data.messages[roomId] = [{ id: `welcome-${roomId}`, room_id: roomId, user_id: 'system', body: language === 'ar' ? 'أهلًا بك في غرفة الدراسة. حافظ على المحادثة مرتبطة بالمذاكرة.' : 'Welcome to the study room. Keep the conversation study-focused.', created_at: new Date().toISOString(), display_name: 'StudyQuest' }];
        saveLocalRoomData(data);
      }
      setJoinedRooms((prev) => Array.from(new Set([...prev, roomId])));
      setActiveRoomId(roomId);
    } catch (e) { setRoomError(e instanceof Error ? e.message.replace(/_/g, ' ') : 'Could not join room'); }
    finally { setRoomBusy(false); }
  };

  const leaveRoom = async (roomId: string) => {
    setRoomBusy(true); setRoomError('');
    try {
      if (isSupabaseConfigured && user && navigator.onLine) {
        const { error: leaveError } = await supabase.from('study_room_members').delete().eq('room_id', roomId).eq('user_id', user.id);
        if (leaveError) throw leaveError;
      } else {
        const data = localRoomData(); data.joined = data.joined.filter((id) => id !== roomId); saveLocalRoomData(data);
      }
      setJoinedRooms((prev) => prev.filter((id) => id !== roomId));
      if (activeRoomId === roomId) { setActiveRoomId(null); setMessages([]); }
    } catch (e) { setRoomError(e instanceof Error ? e.message.replace(/_/g, ' ') : 'Could not leave room'); }
    finally { setRoomBusy(false); }
  };

  const sendMessage = async () => {
    const body = messageText.trim().slice(0, 500);
    if (!activeRoomId || !body) return;
    setRoomBusy(true); setRoomError('');
    try {
      const createdAt = new Date().toISOString();
      if (isSupabaseConfigured && user && navigator.onLine) {
        const { data, error: sendError } = await supabase.from('study_room_messages').insert({ room_id: activeRoomId, user_id: user.id, body }).select('id,room_id,user_id,body,created_at').single();
        if (sendError) throw sendError;
        if (data) setMessages((prev) => [...prev, data as RoomMessage]);
      } else {
        const local = localRoomData();
        const item: RoomMessage = { id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`, room_id: activeRoomId, user_id: getActiveUserId(), body, created_at: createdAt, display_name: language === 'ar' ? 'أنت' : 'You' };
        local.messages[activeRoomId] = [...(local.messages[activeRoomId] ?? []), item].slice(-100);
        saveLocalRoomData(local); setMessages(local.messages[activeRoomId]);
      }
      setMessageText('');
    } catch (e) { setRoomError(e instanceof Error ? e.message.replace(/_/g, ' ') : 'Message failed'); }
    finally { setRoomBusy(false); }
  };

  const ranked = useMemo(() => students.map((s, i) => ({ ...s, rank: i + 1 })), [students]);
  const podium = ranked.slice(0, 3);
  const rest = ranked.slice(3);

  const submitReport = async () => {
    if (!reportRoomId || !reportReason) return;
    if (!user || !isSupabaseConfigured || !navigator.onLine) { setReported(true); return; }
    const { error: reportError } = await supabase.from('room_reports').insert({ room_id: reportRoomId, reporter_id: user.id, reason: reportReason });
    if (!reportError) setReported(true); else setRoomError(reportError.message);
  };

  return (
    <div className="flex flex-col gap-8 animate-fade-in pb-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div><div className="flex items-center gap-2 text-neon-cyan mb-2"><Trophy className="w-5 h-5" /><span className="text-xs font-bold uppercase tracking-[0.2em]">{t('leaderboard')}</span></div><h1 className="font-display text-2xl md:text-3xl font-extrabold text-gray-200">{t('topStudents')}</h1><p className="text-sm text-gray-500 mt-1">{scope === 'global' ? t('globalRank') : scope === 'international' ? t('internationalRanking') : t('regionalRanking')}</p></div>
          <div className="inline-flex flex-wrap p-1 rounded-xl glass border border-white/10 self-start md:self-auto">
            <button onClick={() => setScope('city')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${scope === 'city' ? 'bg-neon-emerald/10 text-neon-emerald' : 'text-gray-500'}`}><MapPin className="w-4 h-4" />{t('regionalRank')}</button>
            <button onClick={() => setScope('international')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${scope === 'international' ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-gray-500'}`}><Globe2 className="w-4 h-4" />{t('internationalRanking')}</button>
            <button onClick={() => setScope('global')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${scope === 'global' ? 'bg-neon-violet/10 text-neon-violet' : 'text-gray-500'}`}><Globe2 className="w-4 h-4" />{t('globalRank')}</button>
          </div>
        </div>
        {!user && <p className="text-xs text-neon-amber">{copy.signIn}</p>}
        {error && <p className="text-xs text-neon-rose" role="alert">{error.replace(/_/g, ' ')}</p>}
        {loading ? <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-neon-cyan" /></div> : ranked.length === 0 ? <div className="rounded-2xl glass border border-white/10 p-8 text-center text-sm text-gray-500">{copy.empty}</div> : <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">{podium.map((student) => <div key={student.user_id} className="rounded-2xl border border-neon-cyan/20 bg-white/[0.03] p-5 flex flex-col items-center text-center"><ProfileAvatar avatarUrl={student.avatar_url} fallbackPetId={student.equipped_pet_id || 'sparky'} petPosition={(student.avatar_pet_position as AvatarPetPosition) || 'bottom-right'} theme={(student.avatar_theme as AvatarTheme) || 'ice'} size="md" /><div className="mt-3 text-[10px] uppercase tracking-widest text-gray-500 mb-1">#{student.rank}</div><div className="font-display font-bold text-gray-200 truncate max-w-full">{student.display_name}</div><div className="text-xs text-gray-500 mt-1">{t('level')} {student.level} · {student.current_streak} {t('days')}</div><div className="mt-2 text-[10px] text-neon-amber">{student.owned_pet_count ?? 0} {language === 'ar' ? 'حيوانات مملوكة' : 'pets owned'}</div><div className="mt-3 font-mono font-bold text-neon-cyan">{student.total_xp.toLocaleString()} XP</div>{(student.country_code || student.city) && <div className="mt-1 text-[10px] text-gray-600">{student.country_code || ''}{student.city ? ` · ${student.city}` : ''}</div>}</div>)}</div>
          <div className="rounded-2xl glass border border-white/10 overflow-hidden"><div className="grid grid-cols-[3rem_1fr_4.5rem_5.5rem_6rem] gap-2 px-4 py-3 border-b border-white/10 text-[10px] uppercase tracking-wider text-gray-500"><span>{t('rank')}</span><span>{t('topStudents')}</span><span>{t('level')}</span><span>{t('streak')}</span><span>XP</span></div>{rest.map((student) => <div key={student.user_id} className="grid grid-cols-[3rem_1fr_4.5rem_5.5rem_6rem] gap-2 items-center px-4 py-3 border-b border-white/5 last:border-b-0"><span className="font-mono text-sm text-gray-500">#{student.rank}</span><span className="flex items-center gap-2 min-w-0"><ProfileAvatar avatarUrl={student.avatar_url} fallbackPetId={student.equipped_pet_id || 'sparky'} petPosition={(student.avatar_pet_position as AvatarPetPosition) || 'bottom-right'} theme={(student.avatar_theme as AvatarTheme) || 'ice'} size="sm" /><span className="min-w-0"><span className="block font-semibold text-sm text-gray-200 truncate">{student.display_name}</span><span className="block text-[9px] text-gray-600 truncate">{student.country_code || ''}{student.city ? ` · ${student.city}` : ''} · {student.owned_pet_count ?? 0} {language === 'ar' ? 'حيوانات' : 'pets'}</span></span></span><span className="text-xs text-gray-400">{student.level}</span><span className="text-xs text-gray-400">{student.current_streak}d</span><span className="text-xs font-mono font-bold text-neon-cyan">{student.total_xp}</span></div>)}</div>
        </>}
        {scope !== 'global' && <section className="rank-scope-chat rounded-2xl glass border border-neon-cyan/20 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0"><MessageCircle className="w-4 h-4 text-neon-cyan" /><div className="min-w-0"><h3 className="text-sm font-black text-gray-200">{language === 'ar' ? 'دردشة الترتيب' : language === 'ja' ? 'ランキングチャット' : language === 'de' ? 'Ranglisten-Chat' : language === 'fr' ? 'Chat du classement' : 'Ranking chat'}</h3><p className="text-[9px] text-gray-500 truncate">{language === 'ar' ? (scope === 'city' ? 'دردشة الترتيب المحلي' : 'دردشة الترتيب الدولي') : (scope === 'city' ? 'Local ranking chat' : 'International ranking chat')}</p></div></div>
            <span className="text-[9px] font-bold text-neon-cyan border border-neon-cyan/20 rounded-full px-2 py-1">{language === 'ar' ? 'آخر 3 رسائل' : 'Last 3 messages'}</span>
          </div>
          <div className="p-3 space-y-2 min-h-[90px]">
            {rankMessages.length === 0 ? <p className="text-center text-[10px] text-gray-500 py-5">{language === 'ar' ? 'لسه مفيش رسائل. خليك مركز في المذاكرة.' : 'No messages yet. Keep the chat study-focused.'}</p> : rankMessages.map((m) => <div key={m.id} className="rounded-xl border border-white/5 bg-white/[.025] px-3 py-2"><div className="flex items-center justify-between gap-2 mb-0.5"><span className="text-[9px] font-bold text-neon-cyan">{m.user_id === user?.id ? (language === 'ar' ? 'أنت' : 'You') : (language === 'ar' ? 'طالب' : 'Student')}</span><span className="text-[8px] text-gray-600">{new Date(m.created_at).toLocaleTimeString(language === 'ar' ? 'ar-EG' : undefined, {hour:'2-digit', minute:'2-digit'})}</span></div><p className="text-[11px] text-gray-300 break-words">{m.body}</p></div>)}
          </div>
          <div className="p-3 pt-0 flex gap-2"><input value={rankMessageText} onChange={(e)=>setRankMessageText(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') sendRankMessage();}} maxLength={240} placeholder={language === 'ar' ? 'اكتب رسالة...' : 'Write a message...'} className="flex-1 min-w-0 rounded-xl bg-ink-700 border border-white/10 px-3 py-2.5 text-xs text-gray-200 outline-none focus:border-neon-cyan/40" /><button type="button" onClick={sendRankMessage} disabled={rankChatBusy || !rankMessageText.trim()} className="rounded-xl px-3 border border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan disabled:opacity-30"><Send className="w-4 h-4" /></button></div>
          {rankChatError && <p className="px-3 pb-3 text-[9px] text-neon-rose">{rankChatError}</p>}
        </section>}
      </section>

      <section className="flex flex-col gap-4">
        <div><div className="flex items-center gap-2 text-neon-emerald mb-2"><Users className="w-5 h-5" /><span className="text-xs font-bold uppercase tracking-[0.2em]">{t('safeStudyLounge')}</span></div><h2 className="font-display text-xl md:text-2xl font-extrabold text-gray-200">{t('studyRooms')}</h2><p className="text-xs text-gray-500 mt-1">{copy.lounge}</p></div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {ROOMS.map((room) => {
            const joined = joinedRooms.includes(room.id);
            return <article key={room.id} className="rounded-2xl glass border border-white/10 p-4 flex flex-col gap-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-display font-bold text-sm text-gray-200">{t(room.nameKey)}</h3><p className="text-[11px] text-neon-cyan mt-1">{t(room.subjectKey)}</p></div><span className="shrink-0 flex items-center gap-1 text-[10px] text-neon-emerald"><ShieldCheck className="w-3.5 h-3.5" /> {t('secureRoom')}</span></div><p className="text-xs text-gray-500 leading-relaxed">{t(room.descriptionKey)}</p><div className="grid grid-cols-2 gap-2 text-[9px] text-gray-500"><span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-neon-emerald" />{t('verifiedStudentsOnly')}</span><span className="flex items-center gap-1"><Filter className="w-3 h-3 text-neon-cyan" />{t('wordFilterActive')}</span><span className="flex items-center gap-1"><FileCheck2 className="w-3 h-3 text-neon-cyan" />{t('textModerationActive')}</span><span className="flex items-center gap-1"><FlagTriangleRight className="w-3 h-3 text-neon-amber" />{t('moderationLog')}</span></div><div className="grid grid-cols-2 gap-2"><button disabled={roomBusy} onClick={() => joined ? setActiveRoomId(room.id) : joinRoom(room.id)} className="w-full px-3 py-2.5 rounded-xl bg-neon-emerald/10 border border-neon-emerald/30 text-neon-emerald text-xs font-bold disabled:opacity-50">{joined ? <><MessageCircle className="w-4 h-4 inline mr-1" />{language === 'ar' ? 'فتح الغرفة' : 'Open room'}</> : <><LogIn className="w-4 h-4 inline mr-1" />{t('joinRoom')}</>}</button><button disabled={roomBusy || !joined} onClick={() => leaveRoom(room.id)} className="px-3 py-2.5 rounded-xl border border-white/10 text-gray-500 text-xs font-bold disabled:opacity-30"><LogOut className="w-4 h-4 inline mr-1" />{t('leaveRoom')}</button></div><button onClick={() => { setReportRoomId(room.id); setReported(false); setReportReason(''); }} className="w-full px-3 py-2.5 rounded-xl border border-white/10 text-gray-400 hover:text-neon-rose hover:border-neon-rose/30"><Flag className="w-4 h-4 inline mr-2" />{t('reportDisruptiveBehavior')}</button></article>;
          })}
        </div>
        {roomError && <p className="text-xs text-neon-rose" role="alert">{roomError}</p>}
      </section>

      {activeRoom && <div className="fixed inset-0 z-[100] flex items-center justify-center px-4"><div className="absolute inset-0 bg-black/70" onClick={() => setActiveRoomId(null)} /><div className="relative w-full max-w-2xl max-h-[85vh] rounded-2xl glass border border-white/10 p-5 flex flex-col"><div className="flex items-center justify-between gap-3 mb-4"><div><div className="text-[10px] uppercase tracking-widest text-neon-emerald">{t('safeStudyLounge')}</div><h3 className="font-display font-bold text-gray-200">{t(activeRoom.nameKey)}</h3></div><button onClick={() => setActiveRoomId(null)} aria-label={t('close')}><X className="w-5 h-5" /></button></div><div className="flex-1 min-h-[260px] max-h-[50vh] overflow-y-auto rounded-xl bg-black/20 border border-white/5 p-3 space-y-2">{messages.length === 0 ? <p className="text-center text-xs text-gray-500 py-10">{language === 'ar' ? 'لسه مفيش رسائل. ابدأ المحادثة.' : 'No messages yet. Start the conversation.'}</p> : messages.map((m) => <div key={m.id} className="rounded-xl border border-white/5 bg-white/[0.03] p-3"><div className="flex items-center justify-between gap-3 mb-1"><span className="text-[10px] font-bold text-neon-cyan">{m.display_name ?? (m.user_id === user?.id ? (language === 'ar' ? 'أنت' : 'You') : 'Student')}</span><span className="text-[9px] text-gray-600">{new Date(m.created_at).toLocaleTimeString(language === 'ar' ? 'ar-EG' : undefined, { hour: '2-digit', minute: '2-digit' })}</span></div><p className="text-xs text-gray-300 break-words">{m.body}</p></div>)}</div><div className="flex gap-2 mt-3"><input value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }} maxLength={500} placeholder={language === 'ar' ? 'اكتب رسالة مرتبطة بالمذاكرة...' : 'Write a study-focused message...'} className="flex-1 rounded-xl bg-ink-700 border border-white/10 px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-neon-cyan/40" /><button disabled={roomBusy || !messageText.trim()} onClick={sendMessage} className="rounded-xl px-4 bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan disabled:opacity-30"><Send className="w-4 h-4" /></button></div><p className="text-[9px] text-gray-600 mt-2">{language === 'ar' ? 'المحادثة نصية فقط. لا يوجد اتصال صوتي مباشر.' : 'Text only. No live voice connection.'}</p></div></div>}

      {reportRoomId && <div className="fixed inset-0 z-[110] flex items-center justify-center px-4"><div className="absolute inset-0 bg-black/60" onClick={() => setReportRoomId(null)} /><div className="relative w-full max-w-sm rounded-2xl glass border border-white/10 p-5"><div className="flex justify-between items-center mb-4"><h3 className="font-display font-bold text-gray-200">{t('report')}</h3><button onClick={() => setReportRoomId(null)} aria-label={t('close')}><X className="w-4 h-4" /></button></div><select value={reportReason} onChange={(e) => setReportReason(e.target.value)} className="w-full rounded-xl bg-ink-700 border border-white/10 p-3 text-sm text-gray-200"><option value="">{t('selectReason')}</option><option value="disruption">{t('reasonDisruption')}</option><option value="harassment">{t('reasonHarassment')}</option><option value="spam">{t('reasonSpam')}</option></select>{reported ? <p className="text-xs text-neon-emerald mt-3">{t('reportSubmitted')}</p> : <button onClick={submitReport} disabled={!reportReason} className="w-full mt-4 px-4 py-2.5 rounded-xl bg-neon-rose/10 border border-neon-rose/30 text-neon-rose text-sm font-bold disabled:opacity-40">{t('submitReport')}</button>}</div></div>}
    </div>
  );
}
