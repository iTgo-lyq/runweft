import { spawn } from 'node:child_process';
import { RunweftError } from './errors';

export async function openBrowser(url:string){
    const code=await new Promise<number>((resolve,reject)=>{
        const child=spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore'});
        child.once('error',()=>reject(new RunweftError('browser_unavailable','无法打开本机浏览器。',`请打开 ${url}`)));
        child.once('exit',value=>resolve(value??1));
    });
    if(code)throw new RunweftError('browser_unavailable','浏览器未能打开。',`请打开 ${url}`);
}
