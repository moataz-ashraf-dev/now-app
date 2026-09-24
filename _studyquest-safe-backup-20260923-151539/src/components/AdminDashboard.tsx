import { useEffect, useMemo, useState } from 'react';
import { Check, ImagePlus, Mail, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { loadPetCatalog, type CloudPetDefinition } from '@/lib/catalog';
import type { LanguageCode } from '@/lib/i18n';
import { getPetVisual } from '@/lib/petAssets';

const rarities = ['Common','Rare','Epic','Legendary','Mythic'] as const;
type Props = { language: LanguageCode };

type Draft = {
  id: string; name: string; rarity: typeof rarities[number]; coinPrice: number; gemPrice: number;
  premiumOnly: boolean; purchasable: boolean; eventOnly: boolean; imageUrl: string; sortOrder: number;
};
const emptyDraft = (): Draft => ({ id:'', name:'', rarity:'Common', coinPrice:100, gemPrice:0, premiumOnly:false, purchasable:true, eventOnly:false, imageUrl:'', sortOrder:0 });

export default function AdminDashboard({ language }: Props) {
  const ar = language === 'ar';
  const [pets,setPets] = useState<CloudPetDefinition[]>([]);
  const [draft,setDraft] = useState<Draft>(emptyDraft());
  const [support,setSupport] = useState({ email:'', whatsapp:'', telegram:'', message:'' });
  const [saving,setSaving] = useState(false); const [uploading,setUploading] = useState(false); const [message,setMessage] = useState('');
  const [filter,setFilter] = useState<'all'|'premium'|'standard'>('all');

  const refresh = async () => { setPets(await loadPetCatalog()); };
  useEffect(() => { refresh(); (async()=>{ const {data}=await supabase.from('site_settings').select('key,value'); const next={email:'',whatsapp:'',telegram:'',message:''}; (data??[]).forEach(x=>{ if(x.key==='support_email')next.email=x.value; if(x.key==='support_whatsapp')next.whatsapp=x.value; if(x.key==='support_telegram')next.telegram=x.value; if(x.key==='support_message')next.message=x.value; }); setSupport(next); })(); }, []);
  const visible = useMemo(()=>pets.filter(p=>filter==='all'||(filter==='premium'?p.premiumOnly:!p.premiumOnly)),[pets,filter]);
  const select = (p: CloudPetDefinition) => setDraft({ id:p.id,name:p.name,rarity:p.rarity,coinPrice:p.coinPrice,gemPrice:p.gemPrice,premiumOnly:Boolean(p.premiumOnly),purchasable:p.purchasable!==false,eventOnly:Boolean(p.eventOnly),imageUrl:p.imageUrl??'',sortOrder:p.sortOrder??0 });

  const upload = async (file?: File) => {
    if(!file || !isSupabaseConfigured) return; if(file.size>6*1024*1024){setMessage(ar?'الصورة أكبر من 6MB.':'Image is larger than 6MB.');return;}
    setUploading(true); setMessage('');
    try { const ext=(file.name.split('.').pop()||'png').toLowerCase(); const path=`pets/${draft.id.trim()||crypto.randomUUID()}.${ext}`; const {error}=await supabase.storage.from('catalog-assets').upload(path,file,{upsert:true,contentType:file.type}); if(error)throw error; const {data}=supabase.storage.from('catalog-assets').getPublicUrl(path); setDraft(x=>({...x,imageUrl:data.publicUrl})); setMessage(ar?'تم رفع الصورة.':'Image uploaded.'); } catch(e){setMessage(e instanceof Error?e.message:(ar?'تعذر رفع الصورة.':'Upload failed.'));} finally{setUploading(false);}
  };
  const savePet = async () => {
    setSaving(true); setMessage('');
    try { const {error}=await supabase.rpc('admin_upsert_catalog_item',{p_item_id:draft.id.trim().toLowerCase().replace(/[^a-z0-9-]/g,'-'),p_name:draft.name.trim(),p_rarity:draft.rarity,p_coin_price:Math.max(0,Math.round(draft.coinPrice)),p_gem_price:Math.max(0,Math.round(draft.gemPrice)),p_premium_only:draft.premiumOnly,p_purchasable:draft.purchasable,p_event_only:draft.eventOnly,p_image_url:draft.imageUrl||null,p_sort_order:Math.round(draft.sortOrder)}); if(error)throw error; await refresh(); setMessage(ar?'تم حفظ الحيوان في الكتالوج.':'Companion saved to the catalog.'); } catch(e){setMessage(e instanceof Error?e.message:(ar?'تعذر الحفظ.':'Save failed.'));} finally{setSaving(false);}
  };
  const saveSupport = async () => {
    setSaving(true); setMessage('');
    try { for(const [key,value] of Object.entries({support_email:support.email,support_whatsapp:support.whatsapp,support_telegram:support.telegram,support_message:support.message})){ const {error}=await supabase.rpc('admin_update_site_setting',{p_key:key,p_value:value}); if(error)throw error; } setMessage(ar?'تم تحديث طرق التواصل.':'Contact settings updated.'); } catch(e){setMessage(e instanceof Error?e.message:(ar?'تعذر حفظ التواصل.':'Could not save contact settings.'));} finally{setSaving(false);}
  };
  const archive = async (p: CloudPetDefinition) => { setDraft({...draft,id:p.id,name:p.name,rarity:p.rarity,coinPrice:p.coinPrice,gemPrice:p.gemPrice,premiumOnly:Boolean(p.premiumOnly),purchasable:false,eventOnly:true,imageUrl:p.imageUrl??'',sortOrder:p.sortOrder??0}); setMessage(ar?'حوّلته إلى مسودة إيقاف؛ اضغط حفظ لتطبيقها.':'Set as archived draft; press Save to apply.'); };

  return <div className="w-full space-y-6 animate-fade-in pb-10" dir={ar?'rtl':'ltr'}>
    <section className="rounded-3xl sq-shell-card p-5 md:p-6 border border-neon-cyan/20">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.22em] text-neon-cyan font-black">StudyQuest Control Center</p><h1 className="text-2xl md:text-3xl font-black text-[var(--sq-heading)] mt-1">{ar?'لوحة التحكم':'Admin Control Center'}</h1><p className="text-sm text-[var(--sq-muted)] mt-2">{ar?'إدارة حيوانات Premium والعامة والتواصل من مكان واحد. التغييرات تُحفظ في السحابة.':'Manage Premium/standard companions and contact settings from one place. Changes are saved to the cloud.'}</p></div><ShieldCheck className="w-8 h-8 text-neon-emerald"/></div>
    </section>

    <section className="rounded-3xl sq-shell-card p-5 md:p-6"><div className="flex flex-wrap items-center justify-between gap-3 mb-5"><div><h2 className="text-lg font-black text-[var(--sq-heading)]">{ar?'الحيوانات':'Companions'}</h2><p className="text-xs text-[var(--sq-muted)]">{ar?'أضف حيوانًا جديدًا أو عدّل الموجود، وحدد هل هو Premium أم عام.':'Add or edit companions and choose whether they are Premium-only or standard.'}</p></div><div className="flex gap-2"><button onClick={()=>setDraft(emptyDraft())} className="px-3 py-2 rounded-xl border border-white/10 text-xs font-bold"><Plus className="w-4 h-4 inline mr-1"/>{ar?'جديد':'New'}</button>{(['all','premium','standard'] as const).map(x=><button key={x} onClick={()=>setFilter(x)} className={`px-3 py-2 rounded-xl text-xs font-bold border ${filter===x?'border-cyan-300/40 bg-cyan-300/10 text-neon-cyan':'border-white/10 text-[var(--sq-muted)]'}`}>{x==='all'?(ar?'الكل':'All'):x==='premium'?(ar?'Premium':'Premium'):(ar?'عام':'Standard')}</button>)}</div></div>
      <div className="grid lg:grid-cols-[1fr_360px] gap-5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[620px] overflow-auto pr-1">{visible.map(p=>{const visual=getPetVisual(p.id); return <button key={p.id} onClick={()=>select(p)} className="text-left rounded-2xl border border-white/10 bg-white/[.03] p-3 hover:border-cyan-300/30 transition"><div className="h-32 rounded-xl bg-black/10 overflow-hidden flex items-center justify-center"><img src={p.imageUrl||visual.asset} alt="" className="w-full h-full object-contain" style={{filter:visual.filter}}/></div><div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs font-black text-[var(--sq-heading)] truncate">{p.name}</span><span className="text-[9px] font-bold text-neon-amber">{p.premiumOnly?'PREMIUM':'STANDARD'}</span></div><div className="text-[10px] text-[var(--sq-muted)] mt-1">{p.rarity} · {p.coinPrice.toLocaleString()} C · {p.gemPrice} G</div></button>})}</div>
        <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4 space-y-3"><div className="flex items-center justify-between"><h3 className="font-black text-[var(--sq-heading)]">{ar?'تحرير / إضافة':'Edit / Add'}</h3><button onClick={()=>setDraft(emptyDraft())}><X className="w-4 h-4 text-[var(--sq-muted)]"/></button></div>
          {(['id','name'] as const).map(k=><label key={k} className="block text-xs font-bold text-[var(--sq-muted)]">{k==='id'?'ID':'Name'}<input value={draft[k]} onChange={e=>setDraft({...draft,[k]:e.target.value})} className="mt-1 w-full rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-sm text-[var(--sq-heading)]" placeholder={k==='id'?'crystal-fox':'Crystal Fox'}/></label>)}
          <div className="grid grid-cols-2 gap-2"><label className="text-xs font-bold text-[var(--sq-muted)]">Rarity<select value={draft.rarity} onChange={e=>setDraft({...draft,rarity:e.target.value as Draft['rarity']})} className="mt-1 w-full rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-sm">{rarities.map(x=><option key={x}>{x}</option>)}</select></label><label className="text-xs font-bold text-[var(--sq-muted)]">Sort<input type="number" value={draft.sortOrder} onChange={e=>setDraft({...draft,sortOrder:Number(e.target.value)})} className="mt-1 w-full rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-sm"/></label></div>
          <div className="grid grid-cols-2 gap-2"><label className="text-xs font-bold text-[var(--sq-muted)]">Coins<input type="number" min="0" value={draft.coinPrice} onChange={e=>setDraft({...draft,coinPrice:Number(e.target.value)})} className="mt-1 w-full rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-sm"/></label><label className="text-xs font-bold text-[var(--sq-muted)]">Gems<input type="number" min="0" value={draft.gemPrice} onChange={e=>setDraft({...draft,gemPrice:Number(e.target.value)})} className="mt-1 w-full rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-sm"/></label></div>
          <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.premiumOnly} onChange={e=>setDraft({...draft,premiumOnly:e.target.checked})}/>{ar?'Premium فقط':'Premium only'}</label><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.purchasable} onChange={e=>setDraft({...draft,purchasable:e.target.checked})}/>{ar?'متاح للشراء':'Purchasable'}</label>
          <label className="block text-xs font-bold text-[var(--sq-muted)]">Image URL<input value={draft.imageUrl} onChange={e=>setDraft({...draft,imageUrl:e.target.value})} className="mt-1 w-full rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-xs" placeholder="https://..."/></label>
          <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-cyan-300/20 p-3 cursor-pointer text-xs font-bold text-neon-cyan"><ImagePlus className="w-4 h-4"/>{uploading?(ar?'جارٍ الرفع...':'Uploading...'):(ar?'رفع صورة من الجهاز':'Upload image') }<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={uploading} onChange={e=>upload(e.target.files?.[0])}/></label>
          <div className="grid grid-cols-2 gap-2"><button onClick={savePet} disabled={saving||!draft.id.trim()||!draft.name.trim()} className="rounded-xl py-2.5 bg-neon-cyan/10 border border-cyan-300/25 text-neon-cyan text-xs font-black"><Save className="w-4 h-4 inline mr-1"/>{ar?'حفظ':'Save'}</button>{draft.id && <button onClick={()=>{const p=pets.find(x=>x.id===draft.id);if(p)archive(p)}} className="rounded-xl py-2.5 bg-rose-500/5 border border-rose-300/15 text-rose-200 text-xs font-black"><Trash2 className="w-4 h-4 inline mr-1"/>{ar?'إيقاف':'Archive'}</button>}</div>
        </div>
      </div>
    </section>

    <section className="rounded-3xl sq-shell-card p-5 md:p-6"><div className="flex items-center gap-3 mb-4"><Mail className="w-5 h-5 text-neon-amber"/><div><h2 className="text-lg font-black text-[var(--sq-heading)]">{ar?'التواصل معنا':'Contact settings'}</h2><p className="text-xs text-[var(--sq-muted)]">{ar?'غيّر بيانات التواصل من هنا، وستظهر في الفوتر للمستخدمين.':'Change support channels here; they appear in the user-facing footer.'}</p></div></div><div className="grid md:grid-cols-2 gap-3">{(['email','whatsapp','telegram'] as const).map(k=><label key={k} className="text-xs font-bold text-[var(--sq-muted)]">{k==='email'?'Support email':k==='whatsapp'?'WhatsApp URL':'Telegram URL'}<input value={support[k]} onChange={e=>setSupport({...support,[k]:e.target.value})} className="mt-1 w-full rounded-xl border border-white/10 bg-black/10 px-3 py-2.5 text-sm text-[var(--sq-heading)]"/></label>)}</div><label className="block mt-3 text-xs font-bold text-[var(--sq-muted)]">Support message<textarea value={support.message} onChange={e=>setSupport({...support,message:e.target.value})} rows={3} className="mt-1 w-full rounded-xl border border-white/10 bg-black/10 px-3 py-2.5 text-sm text-[var(--sq-heading)]"/></label><button onClick={saveSupport} disabled={saving} className="mt-3 rounded-xl px-5 py-2.5 bg-neon-amber/10 border border-amber-300/20 text-neon-amber text-xs font-black"><Check className="w-4 h-4 inline mr-1"/>{ar?'حفظ التواصل':'Save contact settings'}</button></section>
    {message && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[120] rounded-2xl px-5 py-3 glass border border-cyan-300/20 text-sm text-[var(--sq-heading)] shadow-2xl">{message}</div>}
  </div>;
}
