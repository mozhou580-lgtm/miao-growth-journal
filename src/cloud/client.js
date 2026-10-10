export const cloudConfig={url:import.meta.env.VITE_SUPABASE_URL||'',key:import.meta.env.VITE_SUPABASE_ANON_KEY||'',
  phone:import.meta.env.VITE_ENABLE_SMS_LOGIN==='true',email:import.meta.env.VITE_ENABLE_EMAIL_LOGIN==='true',captcha:import.meta.env.VITE_TURNSTILE_SITE_KEY||''};
export const cloudConfigured=Boolean(cloudConfig.url&&cloudConfig.key);
let clientPromise;
export function getCloudClient(){
  if(!cloudConfigured)return Promise.resolve(null);
  if(!clientPromise)clientPromise=import('@supabase/supabase-js').then(({createClient})=>createClient(cloudConfig.url,cloudConfig.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}));
  return clientPromise;
}
export function normalizeIdentity(kind,value){
  const text=value.trim();
  if(kind==='phone'){const canonical=text.replace(/[\s()-]/g,'');if(!/^\+[1-9]\d{7,14}$/.test(canonical))throw new Error('请填写带区号的手机号，例如 +86 13812345678');return canonical;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)||text.length>254)throw new Error('请填写有效邮箱');return text.toLowerCase();
}
