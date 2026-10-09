import {useState} from 'react';
import {ImagePlus,X,FileText} from 'lucide-react';
import {CATEGORIES,LABELS,dayKey,inputTime,toCents} from '../model';
import {prepareAsset} from '../storage';
import {Field} from '../components/ui';
export default function RecordForm({type,record,latestFeed,healthRecords,onSave,onClose}) {
  const [assets,setAssets]=useState(record?.assets||[]);const [busy,setBusy]=useState(false);const [uploading,setUploading]=useState(false);const [error,setError]=useState('');
  const defaults=record||{};const title=LABELS[type];
  async function addFiles(e) {const files=[...e.target.files];e.target.value='';setUploading(true);setError('');try{if(files.length+assets.length>3)throw new Error('每条记录最多添加 3 个附件');const prepared=await Promise.all(files.map(prepareAsset));setAssets(prev=>[...prev,...prepared]);}catch(err){setError(err.message);}finally{setUploading(false);}}
  async function submit(e) {
    e.preventDefault();setError('');setBusy(true);
    try {
      const data=new FormData(e.currentTarget);const value=k=>String(data.get(k)||'').trim();const at=new Date(value('at'));if(!Number.isFinite(at.getTime()))throw new Error('请填写有效的时间');
      const next={...defaults,id:record?.id||crypto.randomUUID(),type,at:at.toISOString(),day:dayKey(at),updatedAt:new Date().toISOString(),note:value('note'),assets};
      if(type==='feed') {next.food=value('food');next.grams=value('grams')?Number(value('grams')):null;next.appetite=value('appetite');if(!next.food)throw new Error('请填写食物');}
      if(type==='weight')next.kg=Number(value('kg'));
      if(type==='health') {next.kind=value('kind');next.title=value('title')||next.kind;next.due=value('due')||null;}
      if(type==='behavior'){next.kind=value('kind');next.title=next.kind;next.minutes=value('minutes')?Number(value('minutes')):null;}
      if(type==='journal'){next.title=value('title')||'日常';if(!next.note&&!assets.length&&!value('title'))throw new Error('写一句话或添加一张照片吧');}
      if(type==='expense'){next.cents=toCents(value('amount'));next.category=value('category');next.title=value('title')||next.category;next.linkedHealthId=value('linkedHealthId')||null;}
      if(type==='reminder'){next.title=value('title');next.due=value('due');if(!next.title||!next.due)throw new Error('请填写提醒内容和日期');}
      await onSave(next);onClose();
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <form onSubmit={submit} className="record-form">
    <Field label="记录时间"><input name="at" type="datetime-local" required defaultValue={record?inputTime(new Date(record.at)):inputTime()}/></Field>
    {type==='feed'&&<><Field label="食物"><input name="food" required maxLength={100} placeholder="例如：幼猫干粮" defaultValue={defaults.food||latestFeed?.food||'干粮'}/></Field><div className="field-pair"><Field label="投喂量（g，可选）"><input name="grams" type="number" min="0.1" max="9999" step="0.1" inputMode="decimal" placeholder="未称重可留空" defaultValue={defaults.grams??latestFeed?.grams??''}/></Field><Field label="食欲观察"><select name="appetite" defaultValue={defaults.appetite||'未观察'}>{['未观察','正常','减少','增加'].map(s=><option key={s}>{s}</option>)}</select></Field></div><p className="form-hint">记录投喂情况，不把投喂量当作实际摄入量。</p></>}
    {type==='weight'&&<Field label="体重（kg）"><input name="kg" type="number" min="0.05" max="30" step="0.01" inputMode="decimal" required placeholder="例如：2.10" defaultValue={defaults.kg||''}/></Field>}
    {type==='health'&&<><Field label="健康事件"><select name="kind" defaultValue={defaults.kind||'就诊'}>{['疫苗','驱虫','就诊','用药','症状','体检','其他'].map(s=><option key={s}>{s}</option>)}</select></Field><Field label="事件名称"><input name="title" maxLength={100} placeholder="例如：年度体检" defaultValue={defaults.title||''}/></Field><Field label="下次日期（可选）" hint="按照医嘱或你已确认的照护计划填写"><input name="due" type="date" defaultValue={defaults.due||''}/></Field></>}
    {type==='behavior'&&<><Field label="观察内容"><select name="kind" defaultValue={defaults.kind||'玩耍'}>{['玩耍','主动互动','躲藏变化','叫声变化','抓挠变化','环境变化','其他'].map(s=><option key={s}>{s}</option>)}</select></Field><Field label="时长（分钟，可选）"><input name="minutes" type="number" min="1" max="1440" step="1" inputMode="numeric" placeholder="例如：15" defaultValue={defaults.minutes||''}/></Field><p className="form-hint">记录你看到的行为和环境变化，供日后回顾。</p></>}
    {type==='journal'&&<Field label="标题（可选）"><input name="title" maxLength={100} placeholder="今天的一件小事" defaultValue={defaults.title||''}/></Field>}
    {type==='expense'&&<><div className="field-pair"><Field label="实付金额（元）"><input name="amount" type="number" required min="0.01" max="1000000" step="0.01" inputMode="decimal" placeholder="0.00" defaultValue={defaults.cents?String(defaults.cents/100):''}/></Field><Field label="分类"><select name="category" defaultValue={defaults.category||'食物'}>{CATEGORIES.map(s=><option key={s}>{s}</option>)}</select></Field></div><Field label="购买内容（可选）"><input name="title" maxLength={100} placeholder="例如：猫粮、猫砂" defaultValue={defaults.title||''}/></Field>{healthRecords.length>0&&<Field label="关联健康事件（可选）"><select name="linkedHealthId" defaultValue={defaults.linkedHealthId||''}><option value="">不关联</option>{healthRecords.map(r=><option key={r.id} value={r.id}>{r.day} · {r.title||r.kind}</option>)}</select></Field>}<p className="form-hint">按付款日期记整笔花费，关联健康事件不会重复计费。</p></>}
    {type==='reminder'&&<><Field label="提醒内容"><input name="title" required maxLength={100} placeholder="例如：复查、补充猫粮" defaultValue={defaults.title||''}/></Field><Field label="提醒日期"><input name="due" type="date" required defaultValue={defaults.due||dayKey()}/></Field></>}
    <Field label={type==='behavior'?'观察与背景（可选）':'备注（可选）'}><textarea name="note" rows="3" maxLength={3000} placeholder={type==='behavior'?'例如：今天有客人来，躲藏时间比平时长':'写下一点值得记住的细节'} defaultValue={defaults.note||''}/></Field>
    <div className="attachments"><div className="attachments-head"><span>照片 / 资料（可选）</span><label className={`text-button ${uploading?'disabled':''}`}><ImagePlus size={17}/>{uploading?'读取中…':'添加附件'}<input className="visually-hidden" aria-label="添加记录附件" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={addFiles} disabled={uploading||busy}/></label></div><p className="form-hint">最多 3 个，每个 5MB；照片会压缩保存。</p><div className="attachment-preview">{assets.map((a,i)=><div className="attachment" key={a.id||i}>{a.data.startsWith('data:image/')?<img src={a.data} alt={a.name}/>:<FileText size={32}/>}<span>{a.name}</span><button type="button" aria-label={`移除附件 ${a.name}`} onClick={()=>setAssets(prev=>prev.filter((_,n)=>n!==i))}><X size={16}/></button></div>)}</div></div>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <button className="primary-button" type="submit" disabled={busy||uploading}>{busy?'正在保存…':record?'保存修改':`保存${title}`}</button>
  </form>;
}
