import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { RunweftError } from '../../errors';

/** Human terminal only. Agent onboarding uses a browser; passwords never enter argv or stdout. */
export async function terminalInput(label: string, hidden = false): Promise<string> {
    if (!process.stdin.isTTY || !process.stderr.isTTY) throw new RunweftError('account_interaction_required','此操作需要用户在自己的终端输入。','请使用 Hub 的登录或账号设置页面，Agent 不应代收密码。');
    const output = new Writable({write(chunk,encoding,callback){if(!hidden)process.stderr.write(chunk,encoding as BufferEncoding);callback();}});
    const reader=createInterface({input:process.stdin,output,terminal:true});
    process.stderr.write(label+'：');
    const controller=new AbortController();reader.on('SIGINT',()=>controller.abort());reader.on('close',()=>controller.abort());
    try{return await reader.question('',{signal:controller.signal});}
    catch{throw new RunweftError('account_input_cancelled','输入已取消，未提交账号操作。');}
    finally{reader.close();output.end();if(hidden)process.stderr.write('\n');}
}
