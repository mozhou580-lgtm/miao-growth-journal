export const TYPES = ['feed', 'weight', 'health', 'behavior', 'journal', 'expense', 'reminder'];
export const LABELS = {feed:'喂食',weight:'体重',health:'健康',behavior:'行为观察',journal:'日常',expense:'花费',reminder:'提醒'};
export const CATEGORIES = ['食物','猫砂','医疗','用品 / 玩具','清洁 / 护理','服务','其他'];
export const emptyState = () => ({schemaVersion:1,profile:null,records:[],budgetCents:null,lastBackupAt:null});
export const dayKey = (date=new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const inputTime = (at=new Date()) => `${dayKey(at)}T${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')}`;
export const money = (cents=0) => `¥${(cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export function toCents(value) {
  const text=String(value).trim();
  if(!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('金额最多保留两位小数');
  const [whole,decimal='']=text.split('.');
  const cents=Number(whole)*100+Number(decimal.padEnd(2,'0'));
  if(!Number.isSafeInteger(cents)||cents<=0||cents>100000000) throw new Error('请输入 0.01 至 1,000,000 元之间的金额');
  return cents;
}
export const visibleRecords = (state) => state.records.filter(r=>!r.deletedAt).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
export function expenseSummary(records,month) {
  const entries=records.filter(r=>!r.deletedAt&&r.type==='expense'&&r.day.startsWith(month));
  const categories=CATEGORIES.map(name=>({name,cents:entries.filter(r=>r.category===name).reduce((sum,r)=>sum+r.cents,0)})).filter(x=>x.cents>0);
  return {entries,total:entries.reduce((sum,r)=>sum+r.cents,0),categories};
}
export function recordDescription(r) {
  if(r.type==='feed') return [r.food,r.grams?`投喂${r.grams}g`:null,r.appetite&&r.appetite!=='未观察'?`食欲${r.appetite}`:null].filter(Boolean).join(' · ');
  if(r.type==='weight') return `${r.kg} kg${r.note?` · ${r.note}`:''}`;
  if(r.type==='expense') return `${r.category} · ${money(r.cents)}${r.note?` · ${r.note}`:''}`;
  if(r.type==='behavior') return [r.kind,r.minutes?`${r.minutes}分钟`:null,r.note].filter(Boolean).join(' · ');
  return r.note||r.title||LABELS[r.type];
}
function validDate(value) {if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return false;return !/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;}
function validateAsset(asset) {
  if(!asset||typeof asset.name!=='string'||asset.name.length>200||typeof asset.data!=='string'||!/^data:(image\/(jpeg|png|webp)|application\/pdf);base64,[A-Za-z0-9+/]+=*$/.test(asset.data)||asset.data.length>8*1024*1024) throw new Error('备份包含无效或过大的附件');
}
export function validateBackup(data) {
  const state=data?.state;
  if(data?.format!=='miao-growth-backup'||data.version!==1||state?.schemaVersion!==1||!state.profile||!Array.isArray(state.records)||state.records.length>10000) throw new Error('这不是有效的喵成长备份');
  if(typeof state.profile.id!=='string'||typeof state.profile.name!=='string'||!state.profile.name.trim()||state.profile.name.length>30||!/^\d{4}-\d{2}-\d{2}$/.test(state.profile.birthday)||!validDate(state.profile.birthday)) throw new Error('猫咪档案格式不正确');
  if(state.profile.avatar) validateAsset(state.profile.avatar);
  const ids=new Set();
  for(const r of state.records) {
    if(!r||typeof r.id!=='string'||!r.id||ids.has(r.id)||!TYPES.includes(r.type)||!validDate(r.at)||!validDate(r.updatedAt)||!/^\d{4}-\d{2}-\d{2}$/.test(r.day)||!validDate(r.day)) throw new Error('备份中的记录格式不正确');
    ids.add(r.id);
    for(const field of ['title','note','food','kind','appetite','category']) if(r[field]!=null&&(typeof r[field]!=='string'||r[field].length>5000)) throw new Error('备份中有无效的文本字段');
    if(r.type==='expense'&&(!Number.isSafeInteger(r.cents)||r.cents<=0||r.cents>100000000||!CATEGORIES.includes(r.category))) throw new Error('备份中有无效的花费记录');
    if(r.type==='weight'&&(!(r.kg>0)||r.kg>30||typeof r.kg!=='number')) throw new Error('备份中有无效的体重');
    if(r.grams!=null&&(typeof r.grams!=='number'||r.grams<=0||r.grams>9999)) throw new Error('备份中有无效的投喂量');
    if(r.minutes!=null&&(typeof r.minutes!=='number'||r.minutes<=0||r.minutes>1440)) throw new Error('备份中有无效的时长');
    if(r.due&&(!/^\d{4}-\d{2}-\d{2}$/.test(r.due)||!validDate(r.due))) throw new Error('备份中有无效的提醒日期');
    if(r.deletedAt&&!validDate(r.deletedAt)) throw new Error('备份中的删除状态不正确');
    if(!Array.isArray(r.assets)||r.assets.length>3) throw new Error('备份的附件格式不正确');
    r.assets.forEach(validateAsset);
  }
  if(state.budgetCents!=null&&(!Number.isSafeInteger(state.budgetCents)||state.budgetCents<=0||state.budgetCents>100000000)) throw new Error('备份中的预算不正确');
  return state;
}
export function mergeBackup(current,incoming) {
  if(current.profile&&current.profile.id!==incoming.profile.id) throw new Error('这是另一只猫的备份，当前版本只记录一只猫');
  const map=new Map(current.records.map(r=>[r.id,r]));
  incoming.records.forEach(r=>{const existing=map.get(r.id);if(!existing||Date.parse(r.updatedAt)>Date.parse(existing.updatedAt))map.set(r.id,r);});
  return {...current,profile:current.profile||incoming.profile,records:[...map.values()],budgetCents:current.budgetCents??incoming.budgetCents??null};
}
export function makeDemo(now=new Date()) {
  const date=new Date(now);const birthday=new Date(now);birthday.setDate(birthday.getDate()-127);
  const yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);
  const create=(id,type,days,hour,extra)=>{const at=new Date(now);at.setDate(at.getDate()-days);at.setHours(hour,30,0,0);return {id,type,at:at.toISOString(),day:dayKey(at),updatedAt:at.toISOString(),assets:[],...extra};};
  return {...emptyState(),profile:{id:'demo-cat',name:'小橘',birthday:dayKey(birthday),estimated:false,avatar:null},records:[
    create('demo-feed','feed',0,8,{food:'干粮',grams:35,appetite:'未观察'}),
    create('demo-play','behavior',1,17,{kind:'玩耍',title:'玩耍',minutes:15,note:'逗猫棒'}),
    create('demo-weight','weight',1,9,{kg:2.1}),
    create('demo-weight-older','weight',7,9,{kg:1.9}),
    create('demo-expense-1','expense',2,11,{category:'食物',cents:18650,title:'猫粮和罐头'}),
    create('demo-expense-2','expense',3,11,{category:'猫砂',cents:8000,title:'猫砂'}),
    create('demo-expense-3','expense',4,11,{category:'医疗',cents:12000,title:'常规检查'})]};
}
export function calendarFile(records) {
  const escape=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\r/g,'');
  const events=records.filter(r=>r.due&&!r.completedAt).map(r=>['BEGIN:VEVENT',`UID:${escape(r.id)}@miao-growth`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;VALUE=DATE:${r.due.replaceAll('-','')}`,`SUMMARY:${escape(r.title||r.kind||'猫咪照护提醒')}`,`DESCRIPTION:${escape(r.note||'查看喵成长中的照护记录')}`,'END:VEVENT'].join('\r\n'));
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Miao Growth//Cat Journal//ZH','CALSCALE:GREGORIAN',...events,'END:VCALENDAR'].join('\r\n');
}
