import {useEffect,useRef,useState} from 'react';
let scriptPromise;
function loadTurnstile(){
  if(window.turnstile)return Promise.resolve(window.turnstile);
  if(!scriptPromise)scriptPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
    script.onload=()=>resolve(window.turnstile);script.onerror=()=>{scriptPromise=null;reject(new Error('验证服务暂时不可用，请联网后重试'));};document.head.appendChild(script);
  });return scriptPromise;
}
export default function Captcha({siteKey,onToken,resetKey}){
  const container=useRef(null),callback=useRef(onToken);const [error,setError]=useState('');callback.current=onToken;
  useEffect(()=>{let active=true,widget;
    callback.current('');setError('');
    loadTurnstile().then(turnstile=>{if(!active)return;widget=turnstile.render(container.current,{sitekey:siteKey,size:'compact',
      callback:token=>callback.current(token),'expired-callback':()=>callback.current(''),'error-callback':()=>{callback.current('');setError('验证未完成，请刷新后重试');}});
    }).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;if(widget!==undefined)window.turnstile?.remove(widget);};
  },[siteKey,resetKey]);
  return <div><div ref={container}/>{error&&<p className="form-error" role="alert">{error}</p>}</div>;
}
