import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CloudRain, Waves, Volume2, VolumeX } from 'lucide-react';
import { type LanguageCode, type TranslationKey } from '@/lib/i18n';

type AmbientValue = 'none' | 'rain' | 'ocean' | 'focus';

type Props = {
  value: AmbientValue | string;
  onChange: (sound: AmbientValue) => void;
  language: LanguageCode;
  t: (key: TranslationKey) => string;
};

const OPTIONS = [
  { value: 'none' as const, icon: '🔇', ar: 'بدون صوت', en: 'Silent' },
  { value: 'rain' as const, icon: '🌧️', ar: 'مطر', en: 'Rain' },
  { value: 'ocean' as const, icon: '🌊', ar: 'أمواج هادئة', en: 'Soft Ocean' },
  { value: 'focus' as const, icon: '✨', ar: 'ضوضاء تركيز', en: 'Focus Noise' },
];

export default function AmbientSoundWidget({ value, onChange, language }: Props) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(value !== 'none' && OPTIONS.some((x) => x.value === value));
  const ref = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);

  const current = OPTIONS.find((s) => s.value === value) ?? OPTIONS[0];

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);

  useEffect(() => () => stopAudio(), []);

  function stopAudio() {
    try { sourceRef.current?.stop(); } catch { /* already stopped */ }
    sourceRef.current?.disconnect();
    gainRef.current?.disconnect();
    filterRef.current?.disconnect();
    sourceRef.current = null;
    gainRef.current = null;
    filterRef.current = null;
    if (ctxRef.current) void ctxRef.current.suspend();
    setRunning(false);
  }

  async function startAudio(kind: Exclude<AmbientValue, 'none'>) {
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    stopAudio();
    const ctx = ctxRef.current ?? new AudioCtx();
    ctxRef.current = ctx;
    await ctx.resume();

    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.02 * white) / 1.02;
      data[i] = brown * 3.2;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = kind === 'ocean' ? 'lowpass' : kind === 'rain' ? 'bandpass' : 'lowpass';
    filter.frequency.value = kind === 'ocean' ? 900 : kind === 'rain' ? 4200 : 1800;
    filter.Q.value = kind === 'rain' ? 0.55 : 0.35;
    gain.gain.value = kind === 'focus' ? 0.045 : kind === 'ocean' ? 0.07 : 0.055;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
    sourceRef.current = source;
    filterRef.current = filter;
    gainRef.current = gain;
    setRunning(true);
  }

  function select(kind: AmbientValue) {
    onChange(kind);
    setOpen(false);
    if (kind === 'none') stopAudio();
    else void startAudio(kind);
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button type="button" onClick={() => setOpen((x) => !x)} className="ambient-trigger">
        {current.value === 'rain' ? <CloudRain className="w-4 h-4 text-neon-cyan" /> : current.value === 'ocean' ? <Waves className="w-4 h-4 text-neon-cyan" /> : current.value === 'none' ? <VolumeX className="w-4 h-4 text-gray-400" /> : <Volume2 className="w-4 h-4 text-neon-cyan" />}
        <span className="text-lg">{current.icon}</span>
        <span>{language === 'ar' ? current.ar : current.en}</span>
        {running && <span className="ambient-live-dot" aria-label="playing" />}
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full mt-2 left-0 w-60 rounded-2xl glass border border-white/10 shadow-2xl p-2 z-50">
          <div className="px-3 py-2 text-[10px] uppercase tracking-[.18em] font-black text-[var(--sq-muted)]">{language === 'ar' ? 'الصوت المحيط' : 'Ambient sound'}</div>
          {OPTIONS.map((sound) => (
            <button key={sound.value} type="button" onClick={() => select(sound.value)} className={`ambient-option ${value === sound.value ? 'is-active' : ''}`}>
              <span className="text-lg">{sound.icon}</span><span>{language === 'ar' ? sound.ar : sound.en}</span>
              {value === sound.value && <span className="ml-auto text-neon-cyan text-xs">✓</span>}
            </button>
          ))}
          <p className="px-3 pt-2 pb-1 text-[10px] leading-4 text-[var(--sq-muted)]">{language === 'ar' ? 'أصوات مولّدة داخل المتصفح؛ لا تحتاج ملفات أو حقوق موسيقى.' : 'Browser-generated ambience; no music files or copyrighted tracks.'}</p>
        </div>
      )}
    </div>
  );
}
