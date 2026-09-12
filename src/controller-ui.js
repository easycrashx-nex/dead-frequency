import { keyLabel, defaultSettings } from './settings.js';

const labels = {
  xbox: {confirm:'A',back:'B',jump:'A',crouch:'B',reload:'X',interact:'Y',fire:'RT',aim:'LT',heal:'LB',inventory:'RB',map:'VIEW',pause:'MENU',sprint:'LS',look:'RS',move:'LS'},
  playstation: {confirm:'×',back:'○',jump:'×',crouch:'○',reload:'□',interact:'△',fire:'R2',aim:'L2',heal:'L1',inventory:'R1',map:'SHARE',pause:'OPTIONS',sprint:'L3',look:'RS',move:'LS'},
  generic: {confirm:'1',back:'2',jump:'1',crouch:'2',reload:'3',interact:'4',fire:'RT',aim:'LT',heal:'LB',inventory:'RB',map:'VIEW',pause:'MENU',sprint:'LS',look:'RS',move:'LS'},
};
const familyName = family => ({xbox:'Xbox',playstation:'PlayStation',generic:'Standard-Controller'})[family] || 'Standard-Controller';
const visible = node => !!node && !node.closest('[hidden]') && !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
const enabled = node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true';
const candidates = scope => [...scope.querySelectorAll('button,input:not([type="hidden"]),select,textarea,summary')].filter(enabled);
const text = (node,value) => { if(node && node.textContent !== value) node.textContent=value; };
const emitInput = node => { node.dispatchEvent(new Event('input',{bubbles:true})); node.dispatchEvent(new Event('change',{bubbles:true})); };

export const controllerStatusMarkup = `<div id="controller-status" class="controller-status" data-connected="false"><svg viewBox="0 0 80 50" aria-hidden="true"><path d="M23 12h34c8 0 13 8 16 22 2 11-7 14-14 5l-7-7H28l-7 7C14 48 5 45 7 34c3-14 8-22 16-22Z"/><path d="M21 20v13m-6-6h13"/><circle cx="57" cy="21" r="2"/><circle cx="64" cy="27" r="2"/><circle cx="57" cy="33" r="2"/><circle cx="50" cy="27" r="2"/></svg><div><span class="micro orange" id="controller-family">KEIN CONTROLLER</span><strong id="controller-name">Controller verbinden</strong><p id="controller-connection-note">Per USB oder Bluetooth verbinden und eine Taste drücken.</p></div></div><div class="controller-layout-guide"><span><kbd data-controller-guide="move">LS</kbd> Bewegen</span><span><kbd data-controller-guide="look">RS</kbd> Umsehen</span><span><kbd data-controller-guide="fire">RT</kbd> Feuern</span><span><kbd data-controller-guide="aim">LT</kbd> Zielen</span><span><kbd data-controller-guide="jump">A</kbd> Springen</span><span><kbd data-controller-guide="crouch">B</kbd> Ducken</span><span><kbd data-controller-guide="reload">X</kbd> Nachladen</span><span><kbd data-controller-guide="interact">Y</kbd> Interagieren</span><span><kbd data-controller-guide="heal">LB</kbd> Heilen</span><span><kbd data-controller-guide="inventory">RB</kbd> Rucksack</span><span><kbd data-controller-guide="map">VIEW</kbd> Karte</span><span><kbd data-controller-guide="pause">MENU</kbd> Pause</span><span><kbd data-controller-guide="sprint">LS</kbd> Sprinten</span></div><p class="controller-menu-help">MENÜS · Steuerkreuz oder linker Stick zum Wählen · Bestätigen zum Öffnen · Links / rechts ändert Regler und Listen · Schultertasten wechseln Bereiche.</p>`;

export function createControllerUI(root, actions, {onBack=()=>false}={}) {
  let settings=defaultSettings(), info={}, family='generic', active=false, focused=null, scopeBefore=null, lastRect=null;
  let direction='', repeatIn=0, keyboardTarget=null, keyboardToken=0, uppercase=false;
  const memories=new WeakMap();
  const overlay=document.createElement('div'); overlay.id='controller-keyboard-overlay'; overlay.className='controller-keyboard-overlay'; overlay.hidden=true;
  overlay.innerHTML=`<section class="controller-keyboard-dialog" role="dialog" aria-modal="true" aria-labelledby="controller-keyboard-title"><header><div><span class="micro orange">CONTROLLER / TEXTEINGABE</span><h2 id="controller-keyboard-title">EINGABE</h2></div><button id="controller-keyboard-cancel" class="close-button" aria-label="Eingabe abbrechen">×</button></header><input id="controller-keyboard-value" type="text" autocomplete="off" spellcheck="false" aria-label="Eingabetext"><p id="controller-keyboard-error" role="status"></p><div id="controller-keyboard-keys" class="controller-keyboard-keys"></div><footer><button id="controller-keyboard-paste" class="secondary-button">EINFÜGEN</button><span class="controller-keyboard-hint">Steuerkreuz wählen · Bestätigen eingeben · Zurück abbrechen</span><button id="controller-keyboard-apply" class="primary-button">ÜBERNEHMEN <span>↗</span></button></footer></section>`;
  root.append(overlay);
  const query=id=>overlay.querySelector(`#${id}`), value=query('controller-keyboard-value'), keys=query('controller-keyboard-keys'), error=query('controller-keyboard-error');
  const footer=root.querySelector('.footer-hint'), originalFooter=footer?.innerHTML;
  let footerController=false;

  function buttonLabel(action) {
    const arrows={forward:'↑',backward:'↓',left:'←',right:'→'};
    return arrows[action] ? `LS ${arrows[action]}` : labels[family]?.[action] || action;
  }
  function scope() {
    return [overlay,...['admin-overlay','friends-overlay','account-overlay','utility-overlay','coop-overlay','container-panel','inventory-panel','map-panel','pause-screen','result-screen','hub-screen'].map(id=>root.querySelector(`#${id}`))].find(visible) || null;
  }
  function focus(node) {
    if(!enabled(node))return;
    focused?.classList.remove('controller-focused'); focused=node; node.classList.add('controller-focused');
    node.focus({preventScroll:true}); node.scrollIntoView({block:'nearest',inline:'nearest'});
    const area=scope(); if(area) memories.set(area,node);
    lastRect=node.getBoundingClientRect();
  }
  function ensureFocus() {
    const area=scope(); if(!area)return null;
    const items=candidates(area); if(!items.length)return null;
    const current=document.activeElement;
    if(items.includes(current)) { if(focused!==current)focus(current); else current.classList.add('controller-focused'); }
    else if(items.includes(memories.get(area)))focus(memories.get(area));
    else {
      let target=items.find(node=>node.id===({ 'hub-screen':'start-raid','pause-screen':'resume-raid','result-screen':'result-hub'}[area.id]));
      if(!target && area===scopeBefore && lastRect) {
        const distance=node=>{const r=node.getBoundingClientRect();return Math.hypot(r.x-lastRect.x,r.y-lastRect.y);};
        target=[...items].sort((a,b)=>distance(a)-distance(b))[0];
      }
      focus(target||items[0]);
    }
    scopeBefore=area; return area;
  }
  function closeKeyboard() {
    if(overlay.hidden)return false;
    const target=keyboardTarget; overlay.hidden=true; keyboardTarget=null; keyboardToken++; direction='';value.value='';value.type='text';
    if(enabled(target))focus(target); else ensureFocus();
    return true;
  }
  function buildKeys(numeric) {
    keys.classList.toggle('numeric',numeric);
    const characters=numeric?'1234567890'.split(''):'1234567890qwertzuiopasdfghjklyxcvbnm.-_:/+=@?&'.split('');
    keys.replaceChildren();
    const add=(label,key,wide=false)=>{const button=document.createElement('button');button.type='button';button.dataset.keyboardKey=key;button.textContent=label;if(wide)button.className='wide';keys.append(button);};
    characters.forEach(character=>add(uppercase?character.toUpperCase():character,uppercase?character.toUpperCase():character));
    if(numeric){add('−10','step:-10');add('−1','step:-1');add('+1','step:1');add('+10','step:10');}
    else {add(uppercase?'abc':'ABC','case',true);add('LEERZEICHEN','space',true);}
    add('⌫','delete',true); add('LEEREN','clear',true);
  }
  function openKeyboard(target) {
    if(target.readOnly || target.disabled)return;
    keyboardTarget=target; keyboardToken++; uppercase=false;
    const label=target.labels?.[0]?.textContent?.trim() || target.getAttribute('aria-label') || target.placeholder || 'Eingabe';
    text(query('controller-keyboard-title'),label.replace(/\s+/g,' ').slice(0,70));
    value.type=target.type==='password'?'password':'text';value.value=target.value; value.maxLength=target.maxLength>0?target.maxLength:2048;
    value.inputMode=target.type==='number'?'numeric':'text'; text(error,'');
    buildKeys(target.type==='number'); overlay.hidden=false;
    query('controller-keyboard-paste').disabled=typeof actions.pasteClipboard!=='function';
    focus(keys.querySelector('button')); direction='';
  }
  function applyKeyboard() {
    const target=keyboardTarget; if(!target)return;
    let draft=value.value;
    if(target.type==='number') {
      const amount=Number(draft), min=target.min===''?-Infinity:Number(target.min), max=target.max===''?Infinity:Number(target.max);
      if(!draft.trim() || !Number.isFinite(amount) || amount<min || amount>max || (target.step==='1' && !Number.isInteger(amount))) {
        text(error,`Gib eine ganze Zahl von ${min.toLocaleString('de-DE')} bis ${max.toLocaleString('de-DE')} ein.`);return;
      }
      draft=String(amount);
    }
    target.value=draft; emitInput(target); closeKeyboard();
  }
  function insert(content) {
    const start=value.selectionStart??value.value.length,end=value.selectionEnd??start;
    const next=value.value.slice(0,start)+content+value.value.slice(end);
    value.value=next.slice(0,value.maxLength); value.setSelectionRange(Math.min(start+content.length,value.value.length),Math.min(start+content.length,value.value.length));text(error,'');
  }
  async function keyboardClick(event) {
    const button=event.target.closest('button'); if(!button || button.disabled)return;
    if(button.id==='controller-keyboard-cancel')closeKeyboard();
    else if(button.id==='controller-keyboard-apply')applyKeyboard();
    else if(button.id==='controller-keyboard-paste') {
      const token=keyboardToken;
      try {const content=await actions.pasteClipboard();if(token===keyboardToken&&!overlay.hidden){insert(String(content||''));text(error,content?'Aus Zwischenablage eingefügt.':'Die Zwischenablage ist leer.');}}
      catch {if(token===keyboardToken)text(error,'Zwischenablage konnte nicht gelesen werden.');}
    } else if(button.dataset.keyboardKey) {
      const key=button.dataset.keyboardKey;
      if(key==='case'){uppercase=!uppercase;buildKeys(false);focus(keys.querySelector('[data-keyboard-key="case"]'));}
      else if(key==='clear'){value.value='';text(error,'');}
      else if(key==='delete'){const start=value.selectionStart??value.value.length,end=value.selectionEnd??start;if(start===end)value.setSelectionRange(Math.max(0,start-1),end);insert('');}
      else if(key==='space')insert(' ');
      else if(key.startsWith('step:')){const amount=Number(value.value)||0;value.value=String(Math.max(Number(keyboardTarget.min)||0,Math.min(Number(keyboardTarget.max)||1000000,amount+Number(key.slice(5)))));value.setSelectionRange(value.value.length,value.value.length);}
      else insert(key);
    }
  }
  function adjust(node,x) {
    if(node.tagName==='SELECT') {
      const options=[...node.options].filter(option=>!option.disabled),index=options.indexOf(node.selectedOptions[0]);
      node.value=options[Math.max(0,Math.min(options.length-1,index+x))]?.value??node.value;emitInput(node);return true;
    }
    if(node.tagName==='INPUT' && ['range','number'].includes(node.type)) {
      const step=Number(node.step)||1,min=node.min===''?-Infinity:Number(node.min),max=node.max===''?Infinity:Number(node.max);
      node.value=String(Number(Math.max(min,Math.min(max,(Number(node.value)||0)+x*step)).toFixed(6)));emitInput(node);return true;
    }
    return false;
  }
  function move(x,y) {
    if(x && adjust(focused,x))return;
    const area=scope();
    // The field manual contains long text between its two buttons. Scroll it
    // incrementally so controller users can read every paragraph before leaving.
    if(y && area.id==='utility-overlay' && visible(area.querySelector('#help-content'))) {
      const dialog=area.querySelector('.utility-dialog'),before=dialog.scrollTop;
      dialog.scrollTop+=y*64;
      if(dialog.scrollTop!==before)return;
    }
    if(y && area.id==='admin-overlay' && visible(area.querySelector('[data-admin-panel="audit"]'))) {
      const content=area.querySelector('.admin-content'),before=content.scrollTop;
      content.scrollTop+=y*64;
      if(content.scrollTop!==before)return;
    }
    const r=focused.getBoundingClientRect(),cx=r.x+r.width/2,cy=r.y+r.height/2;
    const options=candidates(area).filter(node=>node!==focused).map(node=>{const q=node.getBoundingClientRect(),dx=q.x+q.width/2-cx,dy=q.y+q.height/2-cy,along=x?dx*x:dy*y,across=x?Math.abs(dy):Math.abs(dx);return{node,along,score:along+across*2+across*across/Math.max(20,along)};}).filter(item=>item.along>3).sort((a,b)=>a.score-b.score);
    if(options[0])focus(options[0].node);
  }
  function switchTab(amount) {
    const area=scope(); if(!area || area===overlay)return;
    let list=[...area.querySelectorAll('[data-settings-category]')].filter(enabled);
    if(!list.length)list=[...area.querySelectorAll('[data-admin-tab]')].filter(enabled);
    if(!list.length)list=[...area.querySelectorAll('[data-social-tab]')].filter(enabled);
    if(!list.length && focused?.closest('#hub-arsenal'))list=[...area.querySelectorAll('.armory-tabs [data-armory-tab]')].filter(enabled);
    if(!list.length && focused?.closest('.skill-branch-tabs'))list=[...area.querySelectorAll('[data-skill-branch]')].filter(enabled);
    if(!list.length)list=[...area.querySelectorAll('.hub-navigation [data-hub-tab]')].filter(enabled);
    if(!list.length)return;
    const selected=Math.max(0,list.findIndex(node=>node.getAttribute('aria-pressed')==='true'||node.classList.contains('selected'))),next=list[(selected+amount+list.length)%list.length];
    next.click();focus(next);
  }
  function navigate(input={},dt=1/60) {
    // A fresh controller event may arrive before the next low-frequency UI update.
    active=true;root.dataset.inputDevice='controller';
    if(input.back){direction='';return closeKeyboard() || onBack();}
    if(!ensureFocus())return false;
    if(input.tabPrev||input.tabNext){switchTab(input.tabNext?1:-1);direction='';return true;}
    if(input.confirm) {
      const node=focused;
      if(node===value)focus(keys.querySelector('button'));
      else if(node.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),textarea'))openKeyboard(node);
      else if(node.tagName==='SELECT')adjust(node,1);
      else if(node.type!=='range')node.click();
      ensureFocus();return true;
    }
    const x=Math.sign(input.x||0),y=x?0:Math.sign(input.y||0),next=x?`x${x}`:y?`y${y}`:'';
    if(!next){direction='';repeatIn=0;return true;}
    if(next!==direction){direction=next;repeatIn=.34;move(x,y);}
    else {repeatIn-=Math.min(.1,Math.max(0,dt));if(repeatIn<=0){repeatIn=.11;move(x,y);}}
    return true;
  }
  function update(nextInfo={},nextSettings=settings) {
    info=nextInfo.controller||{};settings=nextSettings;active=nextInfo.inputDevice==='controller';
    family=settings.controllerPrompts!=='auto'?settings.controllerPrompts:info.family||'generic';if(!labels[family])family='generic';
    root.dataset.inputDevice=active?'controller':'keyboard';
    const status=root.querySelector('#controller-status');if(status)status.dataset.connected=String(!!info.connected);
    text(root.querySelector('#controller-name'),info.connected?info.name||'Standard-Controller':'Controller verbinden');
    text(root.querySelector('#controller-family'),info.connected?familyName(info.detectedFamily||info.family||family).toUpperCase():'KEIN CONTROLLER');
    text(root.querySelector('#controller-connection-note'),!info.connected?'Per USB oder Bluetooth verbinden und eine Taste drücken.':!info.supported?'Dieses Gerät meldet keine Standard-Belegung. Nutze einen kompatiblen Controller.':!settings.controllerEnabled?'Verbunden · Raidsteuerung deaktiviert · Menüs bedienbar':active?'Verbunden · Controller ist aktiv':'Verbunden · Maus / Tastatur ist aktiv');
    if(footer && footerController!==active){footerController=active;footer.innerHTML=active?'<span class="micro" data-controller-guide="move">LS</span> BEWEGEN <span class="footer-separator">/</span> <span class="micro" data-controller-guide="look">RS</span> UMSEHEN <span class="footer-separator">/</span> <span class="micro" data-controller-guide="interact">Y</span> INTERAGIEREN':originalFooter;}
    for(const node of root.querySelectorAll('[data-binding-code],[data-control-action],[data-controller-guide],[data-preview-interact]')) {
      const action=node.dataset.bindingCode||node.dataset.controlAction||node.dataset.controllerGuide||'interact',usePad=active||node.hasAttribute('data-controller-guide');
      text(node,usePad?buttonLabel(action):node.dataset.keyboardLabel||keyLabel(settings.bindings[action]));
      if(usePad){node.dataset.controllerGlyph=action;node.dataset.glyphFamily=family;node.classList.add('controller-glyph');}
      else{delete node.dataset.controllerGlyph;delete node.dataset.glyphFamily;node.classList.remove('controller-glyph');}
    }
    if(active)ensureFocus();else{focused?.classList.remove('controller-focused');direction='';}
  }
  function handleKey(event) {
    if(overlay.hidden)return false;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeKeyboard();return true;}
    if(event.key==='Enter' && document.activeElement===value){event.preventDefault();event.stopImmediatePropagation();applyKeyboard();return true;}
    if(event.key==='Tab'){const items=candidates(overlay),index=items.indexOf(document.activeElement);event.preventDefault();focus(items[(index+(event.shiftKey?-1:1)+items.length)%items.length]);}
    event.stopImmediatePropagation();return true;
  }
  overlay.addEventListener('click',keyboardClick);
  return {update,navigate,buttonLabel,handleKey,closeKeyboard,isKeyboardOpen:()=>!overlay.hidden,dispose(){overlay.removeEventListener('click',keyboardClick);overlay.remove();focused?.classList.remove('controller-focused');}};
}
