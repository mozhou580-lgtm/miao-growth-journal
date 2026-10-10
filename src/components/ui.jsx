import {cloneElement,useEffect,useId,useRef} from 'react';
import {X,Weight,Heart,Camera,WandSparkles,Wallet,Bell,Cat} from 'lucide-react';
import {LABELS,recordDescription,dayKey} from '../model';
export function Bowl({size=24,...props}) {return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}><ellipse cx="12" cy="8" rx="7" ry="2.5"/><path d="m5 8-2 8c0 2.8 18 2.8 18 0l-2-8"/></svg>;}
export const TYPE_ICONS={feed:Bowl,weight:Weight,health:Heart,behavior:WandSparkles,journal:Camera,expense:Wallet,reminder:Bell};
export function Sheet({title,onClose,children,wide=false}) {
  const ref=useRef(null);const id=useId();
  useEffect(()=>{const old=document.activeElement;const dialog=ref.current;dialog.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{dialog.close();document.body.style.overflow=overflow;old?.focus?.();};},[]);
  return <dialog className={`sheet ${wide?'wide':''}`} ref={ref} aria-labelledby={id} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="sheet-inner"><header className="sheet-header"><h2 id={id}>{title}</h2><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={22}/></button></header>{children}</div></dialog>;
}
export function Empty({title='还没有记录',text='随手留下一笔，慢慢看见它的成长。',action}) {return <div className="empty"><Cat size={38} strokeWidth={1.3}/><h3>{title}</h3><p>{text}</p>{action}</div>;}
export function Assets({assets=[]}) {return assets.length>0?<div className="asset-gallery">{assets.map(a=>a.data.startsWith('data:image/')?<a key={a.id||a.name} href={a.data} download={a.name} aria-label={`保存照片 ${a.name}`}><img src={a.data} alt={a.name} loading="lazy"/></a>:<a key={a.id||a.name} className="document-link" href={a.data} download={a.name}>下载 {a.name}</a>)}</div>:null;}
export function dateLabel(record) {const today=dayKey();const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);if(record.day===today)return new Date(record.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});if(record.day===dayKey(yesterday))return '昨天';const [,m,d]=record.day.split('-');return `${Number(m)}月${Number(d)}日`;}
export function RecordList({records,onSelect,limit}) {return <div className="record-list">{(limit?records.slice(0,limit):records).map(r=>{const Icon=TYPE_ICONS[r.type]||Camera;return <button type="button" className="record-row" key={r.id} onClick={()=>onSelect(r)}><span className="record-time">{dateLabel(r)}</span><span className="record-icon"><Icon size={23}/></span><span className="record-copy"><strong>{r.title||r.kind||LABELS[r.type]}</strong><span>{recordDescription(r)}</span>{r.authorName&&<small>记录：{r.authorName}{r.editorName&&r.editorName!==r.authorName?` · 修改：${r.editorName}`:''}</small>}{r.assets?.length>0&&<small>{r.assets.length} 个附件</small>}</span></button>;})}</div>;}
export function Field({label,children,hint}) {
  const fieldId=useId();const id=children.props.id||fieldId;const hintId=`${id}-hint`;
  return <div className="field"><label htmlFor={id}>{label}</label>{cloneElement(children,{id,'aria-describedby':hint?hintId:children.props['aria-describedby']})}{hint&&<small id={hintId}>{hint}</small>}</div>;
}
