import assert from 'node:assert/strict';

export function approachContainer(game, container) {
  for (const radius of [1.6, 2.1, 2.6]) for (let i = 0; i < 16; i++) {
    const x = container.x + Math.cos(i * Math.PI / 8) * radius, z = container.z + Math.sin(i * Math.PI / 8) * radius;
    if (game.teleport(x, z, (container.y ?? 0) + .02) && game.state.prompt?.kind === 'container' && game.state.prompt.id === container.id) return { x, z, y:container.y??0 };
  }
  assert.fail(`No visible approach to container ${container.id}`);
}
export function openContainer(game, container = game.state.containers[0]) {
  approachContainer(game, container); assert.equal(game.interact(), true);
  for (let i = 0; i < Math.ceil(((container.searchSeconds??1.5)+.1)*60); i++) game.update(1 / 60, {});
  assert.equal(game.state.activeContainerId, container.id); assert.equal(container.searched, true);
  return container;
}
export function takeFirstContainerItem(game, container = game.state.containers[0]) {
  openContainer(game, container);
  const item = container.items.find(value => !value.kind && !value.taken);
  assert.ok(item); assert.equal(game.takeContainerItem(container.id, item.id), true); return item;
}
