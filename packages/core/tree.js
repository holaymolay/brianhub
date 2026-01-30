export function buildAdjacency(tasks) {
  const map = new Map();
  tasks.forEach(task => {
    map.set(task.id, { ...task, children: [] });
  });
  const roots = [];
  map.forEach(node => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

export function computeClosure(tasks) {
  const adjacency = new Map();
  tasks.forEach(task => {
    if (!adjacency.has(task.id)) adjacency.set(task.id, []);
  });
  tasks.forEach(task => {
    if (task.parent_id) {
      if (!adjacency.has(task.parent_id)) adjacency.set(task.parent_id, []);
      adjacency.get(task.parent_id).push(task.id);
    }
  });

  const edges = [];
  for (const task of tasks) {
    // DFS from each node to collect descendants
    const stack = [{ id: task.id, depth: 0 }];
    const seen = new Set();
    while (stack.length) {
      const { id, depth } = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ ancestor_id: task.id, descendant_id: id, depth });
      const children = adjacency.get(id) || [];
      children.forEach(child => {
        stack.push({ id: child, depth: depth + 1 });
      });
    }
  }
  return edges;
}

export function assertNoCycles(tasks) {
  const adjacency = new Map();
  tasks.forEach(task => {
    if (!adjacency.has(task.id)) adjacency.set(task.id, []);
  });
  tasks.forEach(task => {
    if (task.parent_id) {
      adjacency.get(task.parent_id)?.push(task.id);
    }
  });

  const visiting = new Set();
  const visited = new Set();

  function dfs(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const child of adjacency.get(node) || []) {
      if (dfs(child)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  for (const node of adjacency.keys()) {
    if (dfs(node)) {
      throw new Error('Cycle detected in task hierarchy');
    }
  }
}

export function reparent(tasks, taskId, newParentId) {
  if (taskId === newParentId) {
    throw new Error('Cannot reparent a task under itself');
  }
  const map = new Map(tasks.map(task => [task.id, { ...task }]));
  if (!map.has(taskId)) throw new Error('Task not found');
  if (newParentId && !map.has(newParentId)) throw new Error('New parent not found');

  map.get(taskId).parent_id = newParentId ?? null;
  const next = Array.from(map.values());
  assertNoCycles(next);
  return next;
}
