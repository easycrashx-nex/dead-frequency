import { ECONOMY_BALANCE } from './economy.js';

export const XP_PER_LEVEL = 250;
export const STARTING_SKILL_POINTS = 3;
export const SKILL_BRANCHES = [
  { id: 'combat', name: 'Kampf', color: '#ca9363', description: 'Waffenschaden, Kontrolle und Nachladen' },
  { id: 'protection', name: 'Schutz', color: '#7ca6ba', description: 'Panzerung, Behandlung und Widerstandskraft' },
  { id: 'field', name: 'Feld', color: '#8dac74', description: 'Ausdauer, Bewegung und Feldversorgung' },
  { id: 'logistics', name: 'Logistik', color: '#b6a377', description: 'Traglast, Suche und sichere Rückkehr' },
];
const node = (id, branch, name, description, cost, requires, column, row, effects) => ({ id, branch, name, description, cost, requires, column, row, effects });
export const SKILL_NODES = [
  node('weapon-1', 'combat', 'Waffentraining I', '+10 % Waffenschaden.', 1, [], 1, 0, { damageBonus: .1 }),
  node('weapon-2', 'combat', 'Waffentraining II', 'Weitere +10 % Waffenschaden.', 1, ['weapon-1'], 0, 1, { damageBonus: .1 }),
  node('weapon-3', 'combat', 'Waffentraining III', 'Weitere +10 % Waffenschaden.', 1, ['weapon-2'], 0, 2, { damageBonus: .1 }),
  node('reload-drill', 'combat', 'Magazindrill', '12 % kürzere Nachladezeit.', 1, ['weapon-1'], 2, 1, { reloadMultiplier: .88 }),
  node('steady-hands', 'combat', 'Ruhige Hände', '15 % weniger Waffenrückstoß.', 1, ['reload-drill'], 2, 2, { recoilMultiplier: .85 }),
  node('combat-master', 'combat', 'Waffenmeister', '+8 % Schaden und nochmals 7 % kürzere Nachladezeit.', 2, ['weapon-3', 'steady-hands'], 1, 3, { damageBonus: .08, reloadMultiplier: .93 }),
  node('armor-1', 'protection', 'Panzerung I', '+20 Startpanzerung.', 1, [], 1, 0, { armorBonus: 20 }),
  node('armor-2', 'protection', 'Panzerung II', 'Weitere +20 Startpanzerung.', 1, ['armor-1'], 0, 1, { armorBonus: 20 }),
  node('armor-3', 'protection', 'Panzerung III', 'Weitere +20 Startpanzerung.', 1, ['armor-2'], 0, 2, { armorBonus: 20 }),
  node('field-dressing', 'protection', 'Verbandstechnik', 'Medkits stellen 10 zusätzliche Lebenspunkte wieder her.', 1, ['armor-1'], 2, 1, { healBonus: 10 }),
  node('impact-lining', 'protection', 'Schutzpolster', '6 % weniger eingehender Schaden.', 1, ['field-dressing'], 2, 2, { damageReduction: .06 }),
  node('protection-master', 'protection', 'Bollwerk', '+20 maximale Lebenspunkte; startet vollständig geheilt.', 2, ['armor-3', 'impact-lining'], 1, 3, { maxHpBonus: 20 }),
  node('endurance', 'field', 'Langstrecke', '+20 maximale Ausdauer.', 1, [], 1, 0, { staminaBonus: 20 }),
  node('breathing', 'field', 'Atemtechnik', '20 % schnellere Ausdauerregeneration.', 1, ['endurance'], 0, 1, { staminaRegenMultiplier: 1.2 }),
  node('light-foot', 'field', 'Leichter Schritt', '6 % höhere Bewegungsgeschwindigkeit.', 1, ['breathing'], 0, 2, { moveSpeedMultiplier: 1.06 }),
  node('triage', 'field', 'Schnelle Triage', '18 % kürzere Medkit-Behandlung.', 1, ['endurance'], 2, 1, { healDurationMultiplier: .82 }),
  node('medical-supply', 'field', 'Sanitätsreserve', 'Ein zusätzliches Medkit zu Raidbeginn.', 1, ['triage'], 2, 2, { extraMedkits: 1 }),
  node('field-master', 'field', 'Spurensucher', '18 % weniger Sprintverbrauch und weitere +10 Ausdauer.', 2, ['light-foot', 'medical-supply'], 1, 3, { sprintDrainMultiplier: .82, staminaBonus: 10 }),
  node('backpack-1', 'logistics', 'Rucksack I', '+2 Beuteplätze.', 1, [], 1, 0, { capacityBonus: 2 }),
  node('backpack-2', 'logistics', 'Rucksack II', 'Weitere +2 Beuteplätze.', 1, ['backpack-1'], 0, 1, { capacityBonus: 2 }),
  node('backpack-3', 'logistics', 'Rucksack III', 'Weitere +2 Beuteplätze.', 1, ['backpack-2'], 0, 2, { capacityBonus: 2 }),
  node('quick-search', 'logistics', 'Geschulter Blick', '20 % kürzere Kistensuche.', 1, ['backpack-1'], 2, 1, { searchMultiplier: .8 }),
  node('ammo-supply', 'logistics', 'Munitionsreserve', '20 % mehr Reservemunition zu Raidbeginn.', 1, ['quick-search'], 2, 2, { reserveMultiplier: 1.2 }),
  node('logistics-master', 'logistics', 'Rückkehrplan', `Extraktion dauert 7 statt 8 Sekunden; +${ECONOMY_BALANCE.extractionSkillBonus} CR bei erfolgreicher Rückkehr.`, 2, ['backpack-3', 'ammo-supply'], 1, 3, { extractionMultiplier: .875, extractionBonus: ECONOMY_BALANCE.extractionSkillBonus }),
];
const byId = new Map(SKILL_NODES.map(skill => [skill.id, skill]));
const integer = (value, max = 1e9) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0;
export function validateProgression(saved, legacyUpgrades = {}) {
  const source = saved && typeof saved === 'object' ? saved : {};
  const xp = integer(source.xp), legacy = [];
  for (const kind of ['weapon', 'armor', 'backpack']) for (let rank = 1; rank <= integer(legacyUpgrades[kind], 3); rank++) legacy.push(`${kind}-${rank}`);
  const legacyPoints = Math.max(integer(source.legacyPoints, 9), legacy.length);
  const requested = new Set([...(Array.isArray(source.unlocked) ? source.unlocked.filter(id => typeof id === 'string') : []), ...legacy]);
  const accepted = new Set(legacy); let available = STARTING_SKILL_POINTS + Math.floor(xp / XP_PER_LEVEL) + legacyPoints - legacy.length;
  // Definition order is topological. Invalid or unaffordable save entries cannot
  // create effects, while the old paid ranks consume exactly their migration grant.
  for (const skill of SKILL_NODES) if (!accepted.has(skill.id) && requested.has(skill.id) && skill.requires.every(id => accepted.has(id)) && skill.cost <= available) {
    accepted.add(skill.id); available -= skill.cost;
  }
  const unlocked = SKILL_NODES.filter(skill => accepted.has(skill.id)).map(skill => skill.id);
  return { xp, unlocked, legacyPoints };
}
export function getProgression(profile) {
  const progression = validateProgression(profile?.progression, profile?.upgrades);
  const spentPoints = progression.unlocked.reduce((sum, id) => sum + byId.get(id).cost, 0), xpIntoLevel = progression.xp % XP_PER_LEVEL;
  return { level: 1 + Math.floor(progression.xp / XP_PER_LEVEL), xp: progression.xp, xpIntoLevel, xpToNext: XP_PER_LEVEL - xpIntoLevel,
    availablePoints: STARTING_SKILL_POINTS + Math.floor(progression.xp / XP_PER_LEVEL) + progression.legacyPoints - spentPoints,
    spentPoints, unlocked: [...progression.unlocked] };
}
export function canUnlockSkill(profile, id) {
  const skill = byId.get(id), progress = getProgression(profile);
  return !!skill && !progress.unlocked.includes(id) && progress.availablePoints >= skill.cost && skill.requires.every(required => progress.unlocked.includes(required));
}
export function getSkillEffects(profile) {
  const effects = { damageBonus: 0, armorBonus: 0, capacityBonus: 0, healBonus: 0, damageReduction: 0, maxHpBonus: 0, staminaBonus: 0, extraMedkits: 0, extractionBonus: 0,
    reloadMultiplier: 1, recoilMultiplier: 1, staminaRegenMultiplier: 1, moveSpeedMultiplier: 1, healDurationMultiplier: 1, sprintDrainMultiplier: 1, searchMultiplier: 1, reserveMultiplier: 1, extractionMultiplier: 1 };
  for (const id of getProgression(profile).unlocked) for (const [key, value] of Object.entries(byId.get(id).effects)) {
    if (key.endsWith('Multiplier')) effects[key] *= value; else effects[key] += value;
  }
  return effects;
}
