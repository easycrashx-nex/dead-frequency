import test from 'node:test';
import assert from 'node:assert/strict';
import {SETTINGS_CATEGORIES,SETTINGS_FIELDS,BINDING_ACTIONS,DEFAULT_BINDINGS,defaultSettings,sanitizeSettings,rebindSetting,resetSettingsCategory,bindingAction} from '../src/settings.js';

test('old saved settings migrate without losing chosen volume, sensitivity or quality',()=>{
  const migrated=sanitizeSettings({volume:0,sensitivity:1.4,quality:'low',fov:92});
  assert.equal(migrated.volume,0);assert.equal(migrated.sensitivity,1.4);assert.equal(migrated.quality,'low');assert.equal(migrated.fov,92);
  assert.equal(migrated.headBob,1);assert.equal(migrated.adsSensitivity,.6);assert.deepEqual(migrated.bindings,DEFAULT_BINDINGS);
  assert.equal(SETTINGS_CATEGORIES.length,7);assert.equal(SETTINGS_FIELDS.length+BINDING_ACTIONS.length,67);
});
test('controller defaults migrate independently from customized mouse controls',()=>{
  const settings=sanitizeSettings({sensitivity:2,adsSensitivity:.9,invertY:true,sprintMode:'hold',crouchMode:'hold',aimMode:'toggle'});
  const expected={controllerEnabled:true,controllerSensitivity:1,controllerAdsSensitivity:.55,controllerDeadzone:.16,controllerLookDeadzone:.14,controllerResponse:1.5,controllerInvertY:false,controllerPrompts:'auto',controllerVibration:true,controllerSprintMode:'toggle',controllerCrouchMode:'toggle',controllerAimMode:'hold'};
  for(const [key,value] of Object.entries(expected))assert.equal(settings[key],value,key);
  assert.equal(SETTINGS_FIELDS.filter(field=>field.category==='controller').length,12);
  assert.equal(settings.sensitivity,2);assert.equal(settings.invertY,true);assert.equal(settings.aimMode,'toggle');
});
test('controller saved settings clamp drift tuning and reject unsupported prompt families',()=>{
  const settings=sanitizeSettings({controllerSensitivity:99,controllerAdsSensitivity:-3,controllerDeadzone:-1,controllerLookDeadzone:.99,controllerResponse:Infinity,controllerPrompts:'steam-custom',controllerVibration:'false',controllerEnabled:false,controllerInvertY:true});
  assert.equal(settings.controllerSensitivity,3);assert.equal(settings.controllerAdsSensitivity,.1);assert.equal(settings.controllerDeadzone,0);assert.equal(settings.controllerLookDeadzone,.4);assert.equal(settings.controllerResponse,1.5);assert.equal(settings.controllerPrompts,'auto');assert.equal(settings.controllerVibration,true);assert.equal(settings.controllerEnabled,false);assert.equal(settings.controllerInvertY,true);
  for(const family of ['auto','xbox','playstation','generic'])assert.equal(sanitizeSettings({controllerPrompts:family}).controllerPrompts,family);
});
test('controller category reset preserves keyboard and mouse customization',()=>{
  const current=sanitizeSettings({controllerEnabled:false,controllerSensitivity:2.7,controllerDeadzone:.3,controllerPrompts:'playstation',controllerVibration:false,sensitivity:2,aimMode:'toggle',bindings:{reload:'KeyT'},volume:.2});
  const reset=resetSettingsCategory(current,'controller');
  for(const field of SETTINGS_FIELDS.filter(field=>field.category==='controller'))assert.equal(reset[field.key],field.default,field.key);
  assert.equal(reset.sensitivity,2);assert.equal(reset.aimMode,'toggle');assert.equal(reset.bindings.reload,'KeyT');assert.equal(reset.volume,.2);
  assert.equal(current.controllerEnabled,false);assert.equal(current.controllerSensitivity,2.7);
});
test('corrupt settings are bounded and cannot add arbitrary styling, properties or bindings',()=>{
  for(const input of [null,[],false,'broken'])assert.deepEqual(sanitizeSettings(input),defaultSettings());
  const result=sanitizeSettings({sensitivity:Infinity,volume:-10,fov:999,headBob:'0',fullscreen:'false',quality:'ultra',crosshairColor:'url(https://bad.invalid)',unexpected:true,bindings:{forward:'Escape',reload:'MetaLeft'}});
  assert.equal(result.sensitivity,1);assert.equal(result.volume,0);assert.equal(result.fov,110);assert.equal(result.headBob,1);assert.equal(result.fullscreen,false);
  assert.equal(result.quality,'high');assert.equal(result.crosshairColor,'#e6ead4');assert.equal(Object.hasOwn(result,'unexpected'),false);assert.deepEqual(result.bindings,DEFAULT_BINDINGS);
});
test('partial changes preserve the remaining settings and reject invalid patch values',()=>{
  const current=sanitizeSettings({volume:.2,quality:'medium',fov:95});
  const result=sanitizeSettings({volume:.35,fov:NaN},current);
  assert.equal(result.volume,.35);assert.equal(result.fov,95);assert.equal(result.quality,'medium');assert.notEqual(result.bindings,current.bindings);
});
test('rebinding resolves actual controls and protects both primary keys and active aliases',()=>{
  const settings=defaultSettings();
  assert.equal(rebindSetting(settings,'reload','KeyW').ok,false);
  assert.equal(rebindSetting(settings,'reload','ArrowUp').ok,false);
  for(const code of ['Escape','F11','F5','MetaLeft','AltLeft','Mouse0','<script>'])assert.equal(rebindSetting(settings,'reload',code).ok,false);
  const changed=rebindSetting(settings,'forward','KeyZ');assert.equal(changed.ok,true);
  assert.equal(bindingAction(changed.bindings,'KeyZ'),'forward');assert.equal(bindingAction(changed.bindings,'KeyW'),null);assert.equal(bindingAction(changed.bindings,'ArrowUp'),null);
  assert.equal(bindingAction(changed.bindings,'ControlRight'),'crouch');assert.equal(bindingAction(changed.bindings,'KeyC'),'crouch');
  assert.equal(settings.bindings.forward,'KeyW');
});
test('duplicate saved bindings do not make two actions share a key',()=>{
  const result=sanitizeSettings({bindings:{forward:'KeyR'}});
  assert.deepEqual(result.bindings,DEFAULT_BINDINGS);
  const valid=sanitizeSettings({bindings:{forward:'KeyZ',reload:'KeyT'}});
  assert.equal(valid.bindings.forward,'KeyZ');assert.equal(valid.bindings.reload,'KeyT');
});
test('category reset changes only that category and global reset does not share mutable bindings',()=>{
  const current=sanitizeSettings({fov:100,volume:.2,headBob:0,bindings:{forward:'KeyZ'}});
  const graphics=resetSettingsCategory(current,'grafik');
  assert.equal(graphics.fov,82);assert.equal(graphics.volume,.2);assert.equal(graphics.headBob,0);assert.equal(graphics.bindings.forward,'KeyZ');
  const bindings=resetSettingsCategory(current,'tasten');assert.deepEqual(bindings.bindings,DEFAULT_BINDINGS);assert.equal(bindings.fov,100);
  const all=resetSettingsCategory(current,'all');assert.deepEqual(all,defaultSettings());all.bindings.forward='KeyZ';assert.equal(defaultSettings().bindings.forward,'KeyW');
});
