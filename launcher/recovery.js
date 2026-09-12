import {createRecoveryInput} from './recovery-input.js';

const button=document.querySelector('#recover-graphics'),status=document.querySelector('#recovery-status');
button.addEventListener('click',async()=>{button.disabled=true;status.textContent='Spiel wird gestartet …';try{await window.platform.recoverGraphics();}catch{status.textContent='Bitte schließe das Fenster und starte den Launcher erneut.';button.disabled=false;}});
button.focus();
const input=createRecoveryInput({onConfirm:()=>button.click(),isEnabled:()=>document.hasFocus()&&!button.disabled});
window.addEventListener('pagehide',()=>input.dispose(),{once:true});
