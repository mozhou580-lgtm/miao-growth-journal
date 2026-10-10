const url=process.env.VITE_SUPABASE_URL||'',key=process.env.VITE_SUPABASE_ANON_KEY||'';
if(Boolean(url)!==Boolean(key))throw new Error('Both public Supabase URL and publishable/anon key must be configured');
if(url){
  const parsed=new URL(url);if(parsed.protocol!=='https:'&&!(process.env.CI!=='true'&&['localhost','127.0.0.1'].includes(parsed.hostname)))throw new Error('Cloud URL must use HTTPS');
  if(key.startsWith('sb_secret_'))throw new Error('A secret server key must never be included in the frontend');
  if(!key.startsWith('sb_publishable_')){
    let claims;try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));}catch{throw new Error('Use a Supabase publishable key or legacy anon key');}
    if(claims.role!=='anon')throw new Error('Only an anon key may be included in the frontend');
  }
  if(!['VITE_ENABLE_SMS_LOGIN','VITE_ENABLE_EMAIL_LOGIN'].some(name=>process.env[name]==='true'))throw new Error('Enable at least one verified login channel before shipping cloud configuration');
  console.log('Cloud configuration checked: only a public client key is included');
}else console.log('Local mode: cloud service is not configured');
