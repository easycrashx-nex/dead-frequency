import {createRecoveryInput} from '../launcher/recovery-input.js';

// This screen is independent of the game UI and GPU, so a failed frame can
// never leave the player staring at an empty canvas without a way back.
export function createRuntimeRecovery({restart=()=>location.reload()}={}) {
  let screen,input;
  function hide(){input?.dispose();input=null;screen?.remove();screen=null;}
  function show({waiting=false,raid=false}={}){
    hide();screen=document.createElement('section');screen.id='graphics-recovery';
    screen.setAttribute('role','alertdialog');screen.setAttribute('aria-modal','true');
    screen.style.cssText='position:fixed;inset:0;z-index:1000;background:#10151b;color:#e5e9ec;display:grid;place-content:center;padding:32px;font:15px/1.6 system-ui';
    const title=document.createElement('h1');title.textContent=waiting?'Anzeige wird wiederhergestellt':'Anzeige unterbrochen';
    title.style.cssText='font-size:25px;margin:0 0 12px';
    const text=document.createElement('p');text.style.maxWidth='560px';
    text.textContent=waiting?'Die Grafikkarte hat die Anzeige unterbrochen. Das Spiel wartet auf die Wiederherstellung.': 'Ein Grafikfehler hat die Anzeige gestoppt. Du kannst das Spiel mit reduzierter Renderauflösung neu starten.';
    const button=document.createElement('button');button.textContent='Mit reduzierter Auflösung neu starten';
    button.style.cssText='background:#d5a75d;color:#111820;border:0;padding:14px 20px;font:600 14px system-ui;cursor:pointer';
    button.onclick=restart;screen.append(title,text,button);
    if(raid){const note=document.createElement('p');note.textContent='Ein Neustart beendet deinen laufenden Raid. Dein gesichertes Lager bleibt erhalten.';note.style.cssText='max-width:560px;color:#a8b2bc;font-size:13px';screen.append(note);}
    document.body.append(screen);button.focus();
    input=createRecoveryInput({onConfirm:()=>button.click(),isEnabled:()=>document.hasFocus()&&!button.disabled});
  }
  return {show,hide,get visible(){return !!screen;}};
}
