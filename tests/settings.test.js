import test from 'node:test';
import assert from 'node:assert/strict';
import {SETTINGS_CATEGORIES,SETTINGS_FIELDS,BINDING_ACTIONS,DEFAULT_BINDINGS,defaultSettings,sanitizeSettings,rebindSetting,resetSettingsCategory,bindingAction} from '../src/settings.js';

test('old saved settings migrate without losing chosen volume, sensitivity or quality',()=>{
  const migrated=sanitizeSettings({volume:0,sensitivity:1.4,quality:'low',fov:92});
  assert.equal(migrated.volume,0);assert.equal(migrated.sensitivity,1.4);assert.equal(migrated.quality,'low');assert.equal(migrated.fov,92);
  assert.equal(migrated.headBob,1);assert.equal(migrated.adsSensitivity,.6);assert.deepEqual(migrated.bindings,DEFAULT_BINDINGS);
  assert.equal(SETTINGS_CATEGORIES.length,6);assert.equal(SETTINGS_FIELDS.length+BINDING_ACTIONS.length,55);
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
