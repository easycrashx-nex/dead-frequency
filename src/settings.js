export const SETTINGS_CATEGORIES = [
  {id:'grafik',label:'Grafik & Anzeige',description:'Bildqualität, Leistung und Bildschirm.'},
  {id:'kamera',label:'Kamera & Bewegung',description:'Passe Sicht und visuelle Bewegung an.'},
  {id:'steuerung',label:'Maus & Spielweise',description:'Empfindlichkeit und Halten oder Umschalten.'},
  {id:'tasten',label:'Tastenbelegung',description:'Deine Tasten für Bewegung und Aktionen.'},
  {id:'audio',label:'Audio',description:'Stimme den Mix auf deine Kopfhörer oder Lautsprecher ab.'},
  {id:'hud',label:'HUD & Fadenkreuz',description:'Informationen, Lesbarkeit und Zielhilfe auf dem Bildschirm.'},
  {id:'controller',label:'Controller',description:'Sticks, Tastenhinweise und Spielweise für deinen Controller.'},
];
const range=(key,category,label,description,value,min,max,step,format='percent')=>({key,category,label,description,type:'range',default:value,min,max,step,format});
const toggle=(key,category,label,description,value=true)=>({key,category,label,description,type:'toggle',default:value});
const select=(key,category,label,description,value,options)=>({key,category,label,description,type:'select',default:value,options:options.map(([value,label])=>({value,label}))});
export const SETTINGS_FIELDS = [
  select('quality','grafik','Qualitätsprofil','Basis für Auflösung, automatische Schatten und Partikel.','high',[['low','Niedrig'],['medium','Mittel'],['high','Hoch']]),
  range('renderScale','grafik','Renderauflösung','Grafikauflösung bis maximal 8,3 Megapixel. Das Menü bleibt scharf.',1,.5,1.5,.05),
  select('shadows','grafik','Schattenqualität','Automatisch folgt dem Qualitätsprofil.','auto',[['auto','Automatisch'],['off','Aus'],['medium','Mittel'],['high','Hoch']]),
  toggle('particles','grafik','Partikel','Atmosphärischer Staub und kleine Trefferpartikel.'),
  range('brightness','grafik','Helligkeit','Helligkeit der Spielwelt; die Bedienoberfläche bleibt unverändert.',1,.7,1.4,.05),
  range('contrast','grafik','Kontrast','Abstand zwischen hellen und dunklen Bildbereichen.',1,.75,1.3,.05),
  range('saturation','grafik','Farbsättigung','Von Schwarzweiß bis zu kräftigeren Farben.',1,0,1.5,.05),
  range('fov','grafik','Sichtfeld','Vertikaler Blickwinkel im Raid außerhalb des Zielvisiers.',82,65,110,1,'degrees'),
  select('fpsLimit','grafik','Bildratenlimit','Begrenzt die gezeichneten Bilder pro Sekunde (FPS). Die Simulation läuft weiter.',0,[[0,'Unbegrenzt'],[30,'30 FPS'],[60,'60 FPS'],[90,'90 FPS'],[120,'120 FPS'],[144,'144 FPS'],[165,'165 FPS'],[240,'240 FPS']]),
  toggle('fullscreen','grafik','Vollbild','Randloses Vollbild. F11 schaltet ebenfalls um.',false),
  range('headBob','kamera','Kopfbewegung','Auf- und Abbewegung sowie leichtes Rollen beim Laufen.',1,0,1,.05),
  range('weaponSway','kamera','Waffenschwanken','Kosmetische Waffenbewegung beim Laufen und Umsehen.',1,0,1,.05),
  range('screenShake','kamera','Erschütterungen','Kamerarollen bei Treffern. Der Waffenrückstoß bleibt unverändert.',1,0,1,.05),
  range('adsZoom','kamera','Visier-Zoom','Stärke der Sichtfeldverengung beim Zielen.',1,0,1,.05),
  range('sprintFov','kamera','Sichtfeld beim Sprinten','Zusätzlicher Blickwinkel beim Sprinten.',4,0,8,.5,'degrees'),
  toggle('showWeapon','kamera','Eigene Waffe anzeigen','Blendet das eigene Waffenmodell ein oder aus.'),
  range('sensitivity','steuerung','Maus-Empfindlichkeit','Geschwindigkeit beim freien Umsehen.',1,.2,3,.05,'factor'),
  range('adsSensitivity','steuerung','Maus-Empfindlichkeit im Visier','Faktor der normalen Empfindlichkeit beim Zielen.',.6,.1,1.5,.05,'factor'),
  toggle('invertY','steuerung','Vertikale Maus invertieren','Maus nach oben bewegt den Blick nach unten.',false),
  select('aimMode','steuerung','Zielen','Rechte Maustaste halten oder zum Umschalten drücken.','hold',[['hold','Halten'],['toggle','Umschalten']]),
  select('sprintMode','steuerung','Sprinten','Sprinttaste halten oder zum Umschalten drücken.','hold',[['hold','Halten'],['toggle','Umschalten']]),
  select('crouchMode','steuerung','Ducken','Ducktaste halten oder zum Umschalten drücken.','hold',[['hold','Halten'],['toggle','Umschalten']]),
  toggle('autoReload','steuerung','Automatisch nachladen','Leeres Magazin ohne erneuten Schussversuch nachladen, wenn Reserve vorhanden ist.',false),
  range('volume','audio','Gesamtlautstärke','Lautstärke aller Spielgeräusche.',.65,0,1,.05),
  range('weaponVolume','audio','Waffen','Eigene Schüsse, Nachladen sowie Schüsse anderer Operatoren.',1,0,1,.05),
  range('effectsVolume','audio','Effekte','Treffer, Einschläge und weitere Geräusche des Einsatzes.',1,0,1,.05),
  range('footstepsVolume','audio','Schritte','Eigene Schritte und Schritte anderer Figuren.',1,0,1,.05),
  range('ambientVolume','audio','Umgebung','Wind und Hintergrundatmosphäre.',1,0,1,.05),
  range('uiVolume','audio','Hinweise','Interaktions-, Beute- und Ergebnissignale.',1,0,1,.05),
  toggle('muteOnBlur','audio','Bei Fensterwechsel stummschalten','Ton aus, solange ein anderes Fenster aktiv ist.',false),
  select('dynamicRange','audio','Dynamikumfang','Nachtmodus gleicht laute Spitzen und leise Geräusche stärker an.','normal',[['normal','Normal'],['night','Nachtmodus']]),
  range('hudScale','hud','HUD-Größe','Skalierung der Einsatzanzeigen, unabhängig vom Menü.',1,.8,1.2,.05),
  range('hudOpacity','hud','HUD-Deckkraft','Deckkraft der Einsatzanzeigen.',1,.5,1,.05),
  toggle('crosshair','hud','Fadenkreuz anzeigen','Fadenkreuz beim Feuern aus der Hüfte.'),
  select('crosshairColor','hud','Fadenkreuz-Farbe','Farbe des Fadenkreuzes und der Vorschau.','#e6ead4',[['#e6ead4','Elfenbein'],['#ff8a4c','Orange'],['#75dce8','Türkis'],['#b6e36f','Limette']]),
  range('crosshairSize','hud','Fadenkreuz-Größe','Skalierung des Fadenkreuzes.',1,.7,1.8,.05),
  range('crosshairOpacity','hud','Fadenkreuz-Deckkraft','Sichtbarkeit des Fadenkreuzes.',1,.3,1,.05),
  toggle('hitMarker','hud','Trefferbestätigung','Visuelle Markierung bei bestätigten Treffern.'),
  toggle('damageVignette','hud','Schadensrand','Rote Bildschirmränder bei erlittenem Schaden.'),
  toggle('compass','hud','Kompass','Richtung und Blickwinkel am oberen Bildschirmrand.'),
  toggle('teammateHud','hud','Teamanzeige','Rufname, Entfernung und Gesundheit des Koop-Partners.'),
  toggle('prompts','hud','Interaktionshinweise','Hinweise zu Beute, Relais und Extraktion in der Spielwelt.'),
  toggle('fps','hud','FPS anzeigen','Aktuelle gezeichnete Bilder pro Sekunde.',false),
  toggle('controllerEnabled','controller','Controller im Raid','Aktiviert die Spielsteuerung. Menüs bleiben mit dem Controller bedienbar.'),
  range('controllerSensitivity','controller','Blick-Empfindlichkeit','Geschwindigkeit des rechten Sticks beim freien Umsehen.',1,.2,3,.05,'factor'),
  range('controllerAdsSensitivity','controller','Empfindlichkeit im Visier','Faktor der normalen Stick-Empfindlichkeit beim Zielen.',.55,.1,1.5,.05,'factor'),
  range('controllerDeadzone','controller','Bewegungs-Totzone','Ignoriert kleine Ausschläge des linken Sticks gegen unbeabsichtigte Bewegung.',.16,0,.4,.01),
  range('controllerLookDeadzone','controller','Blick-Totzone','Ignoriert kleine Ausschläge des rechten Sticks gegen driftenden Blick.',.14,0,.4,.01),
  range('controllerResponse','controller','Stick-Kurve','Höhere Werte erlauben feinere Korrekturen nahe der Stickmitte.',1.5,1,3,.05,'factor'),
  toggle('controllerInvertY','controller','Vertikalen Blick invertieren','Rechten Stick nach oben bewegen, um nach unten zu sehen.',false),
  select('controllerPrompts','controller','Tastensymbole','Automatisch erkennt unterstützte Xbox- und PlayStation-Controller.','auto',[['auto','Automatisch'],['xbox','Xbox'],['playstation','PlayStation'],['generic','Neutral']]),
  toggle('controllerVibration','controller','Vibration','Rückmeldung bei Schüssen und Treffern, sofern das Gerät sie unterstützt.'),
  select('controllerSprintMode','controller','Sprinten mit Controller','Linken Stick drücken: halten oder umschalten.','toggle',[['toggle','Umschalten'],['hold','Halten']]),
  select('controllerCrouchMode','controller','Ducken mit Controller','Ducktaste halten oder zum Umschalten drücken.','toggle',[['toggle','Umschalten'],['hold','Halten']]),
  select('controllerAimMode','controller','Zielen mit Controller','Linken Abzug halten oder zum Umschalten drücken.','hold',[['hold','Halten'],['toggle','Umschalten']]),
];
export const BINDING_ACTIONS = [
  {key:'forward',label:'Vorwärts',default:'KeyW'}, {key:'backward',label:'Rückwärts',default:'KeyS'},
  {key:'left',label:'Nach links',default:'KeyA'}, {key:'right',label:'Nach rechts',default:'KeyD'},
  {key:'sprint',label:'Sprinten',default:'ShiftLeft'}, {key:'crouch',label:'Ducken',default:'ControlLeft'},
  {key:'jump',label:'Springen',default:'Space'}, {key:'reload',label:'Nachladen',default:'KeyR'},
  {key:'heal',label:'Heilen',default:'KeyF'}, {key:'interact',label:'Interagieren',default:'KeyE'},
  {key:'map',label:'Karte',default:'KeyM'}, {key:'inventory',label:'Rucksack',default:'Tab'},
];
export const DEFAULT_BINDINGS=Object.freeze(Object.fromEntries(BINDING_ACTIONS.map(action=>[action.key,action.default])));
export const DEFAULT_SETTINGS=Object.freeze({...Object.fromEntries(SETTINGS_FIELDS.map(field=>[field.key,field.default])),bindings:DEFAULT_BINDINGS});
const aliases={ArrowUp:'forward',ArrowDown:'backward',ArrowLeft:'left',ArrowRight:'right',ShiftRight:'sprint',ControlRight:'crouch',KeyC:'crouch'};
const validCode=code=>typeof code==='string'&&/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Tab|Shift(Left|Right)|Control(Left|Right))$/.test(code);
export function defaultSettings(){return {...DEFAULT_SETTINGS,bindings:{...DEFAULT_BINDINGS}};}
export function bindingAction(bindings,code){
  const direct=BINDING_ACTIONS.find(action=>bindings[action.key]===code);
  if(direct)return direct.key;
  const alias=aliases[code];return alias&&bindings[alias]===DEFAULT_BINDINGS[alias]?alias:null;
}
export function sanitizeSettings(input={},base=DEFAULT_SETTINGS){
  if(!input||typeof input!=='object'||Array.isArray(input))input={};
  const result={};
  for(const field of SETTINGS_FIELDS){
    let value=input[field.key]??base[field.key];
    if(field.type==='range'){
      if(typeof value!=='number'||!Number.isFinite(value))value=base[field.key];
      value=Math.min(field.max,Math.max(field.min,value));
      value=Number((field.min+Math.round((value-field.min)/field.step)*field.step).toFixed(6));
    }else if(field.type==='toggle'){if(typeof value!=='boolean')value=base[field.key];}
    else if(!field.options.some(option=>option.value===value))value=base[field.key];
    result[field.key]=value;
  }
  result.bindings={...base.bindings};
  if(input.bindings&&typeof input.bindings==='object'){
    const proposed={...result.bindings};
    for(const action of BINDING_ACTIONS)if(validCode(input.bindings[action.key]))proposed[action.key]=input.bindings[action.key];
    // A damaged saved map is rejected as a whole, preserving usable controls.
    if(new Set(Object.values(proposed)).size===BINDING_ACTIONS.length)result.bindings=proposed;
  }
  return result;
}
export function rebindSetting(settings,action,code){
  if(!BINDING_ACTIONS.some(item=>item.key===action))return {ok:false,error:'Unbekannte Aktion.'};
  if(!validCode(code))return {ok:false,error:'Nutze Buchstaben, Ziffern, Pfeile, Tab, Leertaste, Umschalt oder Strg. Escape, F8 und F11 bleiben reserviert.'};
  const occupied=bindingAction(settings.bindings,code);
  if(occupied&&occupied!==action)return {ok:false,error:`${keyLabel(code)} ist bereits für „${BINDING_ACTIONS.find(item=>item.key===occupied).label}“ belegt.`};
  return {ok:true,bindings:{...settings.bindings,[action]:code}};
}
export function resetSettingsCategory(settings,category){
  if(category==='all')return defaultSettings();
  if(category==='tasten')return {...settings,bindings:{...DEFAULT_BINDINGS}};
  return {...settings,...Object.fromEntries(SETTINGS_FIELDS.filter(field=>field.category===category).map(field=>[field.key,field.default]))};
}
export function keyLabel(code){
  const names={Space:'Leertaste',Tab:'Tab',ShiftLeft:'Umschalt links',ShiftRight:'Umschalt rechts',ControlLeft:'Strg links',ControlRight:'Strg rechts',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'};
  return names[code]||String(code||'').replace(/^Key|^Digit/,'');
}
export function formatSetting(key,value){
  const field=SETTINGS_FIELDS.find(field=>field.key===key);
  if(!field)return String(value);
  if(field.type==='toggle')return value?'Ein':'Aus';
  if(field.type==='select')return field.options.find(option=>option.value===value)?.label||String(value);
  if(field.format==='degrees')return `${value}°`;
  if(field.format==='factor')return `${Number(value).toFixed(2)} ×`;
  return `${Math.round(Number(value)*100)} %`;
}
